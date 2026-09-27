import zlib from 'zlib';
import { pool } from './db.js';
import { TRACKED_FIELDS } from './config.js';
import { extractRelevantText, parseCards, rebaseCardBoundaries, recoverEmbeddedCards, rebaseCommercialTerms, sha256 } from './parser.js';
import { matchCardsToProducts } from './matcher.js';
import { captureEvidenceScreenshots } from './screenshot.js';

let scanRunning = false;

export async function scanAll() {
  if (scanRunning) return { ok: false, skipped: true, reason: 'scan already running' };
  scanRunning = true;
  try {
    const { rows } = await pool.query('SELECT * FROM sources WHERE enabled=TRUE ORDER BY id');
    const results = [];
    for (const source of rows) {
      const result = await scanSource(source);
      results.push(result);
      console.log('[scan]', source.slug, JSON.stringify(result));
    }
    return { ok: results.every(x => x.ok), scanned_at: new Date().toISOString(), sources: results };
  } finally {
    scanRunning = false;
  }
}

async function scanSource(source) {
  const started = new Date();
  const t0 = Date.now();
  let responseStatus = null;
  let parsedCount = 0;
  let pageHash = null;
  const prior = await pool.query("SELECT COUNT(*)::int AS c FROM scans WHERE source_id=$1 AND status='ok'", [source.id]);
  const baseline = (prior.rows[0]?.c || 0) === 0;
  const ins = await pool.query("INSERT INTO scans(source_id,started_at,status) VALUES($1,$2,'running') RETURNING id", [source.id, started]);
  const scanId = ins.rows[0].id;

  try {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'tr-TR,tr;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
        'pragma': 'no-cache'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    responseStatus = response.status;
    const html = await response.text();
    const relevantText = extractRelevantText(html, source.name);
    pageHash = sha256(relevantText);
    const cards = dedupeCards(parseCards(relevantText));
    parsedCount = cards.length;

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (cards.length === 0) throw new Error('Parser returned 0 tariff cards; source layout may have changed.');

    const changeCount = await processCards(source, scanId, cards, baseline, started);
    const removedCount = await processMissing(source, scanId, cards, baseline, started);
    const meaningfulChanges = changeCount + removedCount;

    await pool.query(`UPDATE scans SET finished_at=NOW(), status='ok', http_status=$1, response_ms=$2, page_hash=$3, parsed_count=$4, error=NULL WHERE id=$5`,
      [responseStatus, Date.now()-t0, pageHash, parsedCount, scanId]);

    const lastEvidence = await pool.query(`SELECT captured_at,(screenshot_png IS NOT NULL) has_screenshot,(focused_screenshot_png IS NOT NULL) has_focus FROM snapshots WHERE source_id=$1 ORDER BY captured_at DESC LIMIT 1`,[source.id]);
    const previous = lastEvidence.rows[0];
    const evidenceDue = !previous || !previous.has_screenshot || !previous.has_focus || (Date.now()-new Date(previous.captured_at).getTime() >= 24*60*60*1000);
    let screenshotOk = null;
    let focusOk = null;
    if (baseline || meaningfulChanges > 0 || evidenceDue) {
      let fullScreenshot = null;
      let focusedScreenshot = null;
      let screenshotError = null;
      let focusedScreenshotError = null;
      let screenshotMeta = null;
      try {
        const evidence = await captureEvidenceScreenshots(source.url);
        fullScreenshot = evidence?.fullPage || null;
        focusedScreenshot = evidence?.focused || null;
        screenshotMeta = evidence?.meta || null;
        screenshotOk = Boolean(fullScreenshot?.length);
        focusOk = Boolean(focusedScreenshot?.length);
        if (!focusOk) focusedScreenshotError = 'Tarife kart alanı otomatik olarak bulunamadı.';
      } catch (e) {
        screenshotError = e?.message || String(e);
        focusedScreenshotError = screenshotError;
        screenshotOk = false;
        focusOk = false;
        console.error('[screenshot]', source.slug, screenshotError);
      }
      const kind = baseline ? 'baseline' : meaningfulChanges > 0 ? 'change' : 'daily';
      await pool.query(`INSERT INTO snapshots(source_id,scan_id,captured_at,kind,page_hash,html_gzip,extracted_json,screenshot_png,focused_screenshot_png,screenshot_error,focused_screenshot_error,screenshot_meta)
                        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb)`,
        [source.id, scanId, started, kind, pageHash, zlib.gzipSync(Buffer.from(html)), JSON.stringify(cards), fullScreenshot, focusedScreenshot, screenshotError, focusedScreenshotError, JSON.stringify(screenshotMeta)]);
    }

    return { ok:true, source:source.slug, http_status:responseStatus, response_ms:Date.now()-t0, parsed_count:parsedCount, baseline, changes:meaningfulChanges, screenshot_ok:screenshotOk, focused_screenshot_ok:focusOk };
  } catch (error) {
    await pool.query(`UPDATE scans SET finished_at=NOW(), status='error', http_status=$1, response_ms=$2, page_hash=$3, parsed_count=$4, error=$5 WHERE id=$6`,
      [responseStatus, Date.now()-t0, pageHash, parsedCount, error?.message || String(error), scanId]);
    return { ok:false, source:source.slug, http_status:responseStatus, response_ms:Date.now()-t0, parsed_count:parsedCount, error:error?.message || String(error) };
  }
}

function dedupeCards(cards) {
  const seen = new Set();
  const unique = [];
  for (const card of cards) {
    if (seen.has(card.product_hash)) continue;
    seen.add(card.product_hash);
    unique.push({ ...card, position: unique.length });
  }
  return unique;
}

export async function processCards(source, scanId, cards, baseline, capturedAt, db = pool) {
  const { rows: current } = await db.query(`
    SELECT p.*,
      v.data_gb, v.bonus_data_gb, v.local_tr_minutes, v.international_minutes, v.sms,
      v.validity_days, v.red_passport_days, v.price_try, v.extras_json, v.product_hash, v.raw_text,
      v.captured_at AS version_captured_at, v.scan_id AS version_scan_id
    FROM products p
    LEFT JOIN LATERAL (
      SELECT * FROM product_versions pv WHERE pv.product_id=p.id ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1
    ) v ON TRUE
    WHERE p.source_id=$1 AND p.active=TRUE
  `,[source.id]);

  const matches = matchCardsToProducts(cards, current);
  // Red Junior was previously swallowed by the preceding card. Its dated raw
  // evidence is a baseline, not a newly launched tariff. Use the latest such
  // observation so a genuine concurrent Junior change remains detectable.
  const embeddedBaselines = new Map();
  let donors = [];
  if (cards.some((card,index) => card.identity_base === 'red-junior' && !matches.has(index))) {
    // Search durable versions as well: a previous interrupted scan may already
    // have cleaned the donor's latest version before reaching Junior.
    const result = await db.query(`SELECT v.name AS current_name,v.card_position AS last_position,v.raw_text,
      v.captured_at AS version_captured_at,v.scan_id AS version_scan_id
      FROM product_versions v JOIN products p ON p.id=v.product_id
      WHERE p.source_id=$1 AND v.raw_text LIKE '%Red Junior%'
      AND NOT EXISTS (SELECT 1 FROM products existing WHERE existing.source_id=$1 AND existing.identity_base='red-junior')
      ORDER BY v.captured_at DESC,v.id DESC`,[source.id]);
    donors = result.rows;
  }
  for (const previous of donors) {
    if (!previous.version_captured_at || !previous.version_scan_id) continue;
    for (const recovered of recoverEmbeddedCards(previous)) {
      const existing = embeddedBaselines.get(recovered.identity_base);
      if (!existing || new Date(previous.version_captured_at) > new Date(existing.at)) {
        embeddedBaselines.set(recovered.identity_base, {
          card: {...recovered, position:Number(previous.last_position || 0) + recovered.position},
          at:previous.version_captured_at, scanId:previous.version_scan_id
        });
      }
    }
  }
  const seenProductIds = new Set();
  let changes = 0;

  for (let i=0;i<cards.length;i++) {
    const card = cards[i];
    let product = matches.get(i);
    let prev = null;
    const created = !product;

    if (!product) {
      const recovered = embeddedBaselines.get(card.identity_base);
      if (recovered) {
        // Append the separately recovered observation; never rewrite the
        // original combined version or claim it was observed at today's scan.
        // Product + recovered baseline are atomic, even if the scan is cut off.
        product = await addRecoveredProduct(source, card, recovered, capturedAt, db);
        prev = {...recovered.card, current_name:recovered.card.name};
      } else {
        const r = await db.query(`INSERT INTO products(source_id,identity_base,current_name,first_seen_at,last_seen_at,active,missing_count,last_position)
          VALUES($1,$2,$3,$4,$4,TRUE,0,$5) RETURNING *`,
          [source.id,card.identity_base,card.name,capturedAt,card.position]);
        product = r.rows[0];
        if (!baseline) {
          await addChange(source.id, product.id, scanId, capturedAt, 'added', null, null, card.name, 'critical', db);
          changes++;
        }
      }
    } else {
      prev = rebaseCommercialTerms(rebaseCardBoundaries(product), card);
      await db.query(`UPDATE products SET identity_base=$1,current_name=$2,last_seen_at=$3,active=TRUE,missing_count=0,last_position=$4 WHERE id=$5`,
        [card.identity_base,card.name,capturedAt,card.position,product.id]);
    }

    seenProductIds.add(String(product.id));

    // Removed terms can restore the old, pre-enrichment hash. Compare the
    // reconstructed observation too, otherwise that real removal is missed.
    const fieldsChanged = prev && TRACKED_FIELDS.some(([field]) => !same(prev[field], card[field]));
    if (created || !prev || prev.product_hash !== card.product_hash || fieldsChanged || prev.current_name !== card.name) {
      await addVersion(product.id, scanId, capturedAt, card, db);

      if (prev && !baseline) {
        for (const [field,label,severity] of TRACKED_FIELDS) {
          const before = prev[field];
          const after = card[field];
          if (!same(before,after)) {
            await addChange(source.id,product.id,scanId,capturedAt,'field_changed',label,before,after,severity,db);
            changes++;
          }
        }
        if (prev.current_name !== card.name) {
          await addChange(source.id,product.id,scanId,capturedAt,'field_changed','Paket Adı',prev.current_name,card.name,'medium',db);
          changes++;
        }
      }
    }
  }
  cards._seenProductIds = seenProductIds;
  return changes;
}

async function addRecoveredProduct(source,current,recovered,capturedAt,db) {
  const old = recovered.card;
  const result = await db.query(`WITH recovered_product AS (
    INSERT INTO products(source_id,identity_base,current_name,first_seen_at,last_seen_at,active,missing_count,last_position)
    VALUES($1,$2,$3,$4,$5,TRUE,0,$6) RETURNING *
  ), recovered_version AS (
    INSERT INTO product_versions(product_id,scan_id,captured_at,name,card_position,data_gb,bonus_data_gb,local_tr_minutes,
      international_minutes,sms,validity_days,red_passport_days,price_try,extras_json,raw_text,product_hash)
    SELECT p.id,$7,$4,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20 FROM recovered_product p
    RETURNING product_id
  ) SELECT p.* FROM recovered_product p JOIN recovered_version v ON v.product_id=p.id`,
    [source.id,current.identity_base,current.name,recovered.at,capturedAt,current.position,
     recovered.scanId,old.name,old.position,old.data_gb,old.bonus_data_gb,old.local_tr_minutes,
     old.international_minutes,old.sms,old.validity_days,old.red_passport_days,old.price_try,
     JSON.stringify(old.extras_json),old.raw_text,old.product_hash]);
  return result.rows[0];
}

async function addVersion(productId,scanId,capturedAt,card,db) {
  await db.query(`INSERT INTO product_versions(product_id,scan_id,captured_at,name,card_position,data_gb,bonus_data_gb,local_tr_minutes,
    international_minutes,sms,validity_days,red_passport_days,price_try,extras_json,raw_text,product_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
    [productId,scanId,capturedAt,card.name,card.position,card.data_gb,card.bonus_data_gb,card.local_tr_minutes,
     card.international_minutes,card.sms,card.validity_days,card.red_passport_days,card.price_try,
     JSON.stringify(card.extras_json),card.raw_text,card.product_hash]);
}

async function processMissing(source, scanId, cards, baseline, detectedAt) {
  const seen = cards._seenProductIds || new Set();
  const { rows } = await pool.query('SELECT * FROM products WHERE source_id=$1 AND active=TRUE',[source.id]);
  let changes = 0;
  for (const p of rows) {
    if (seen.has(String(p.id))) continue;
    const next = Number(p.missing_count || 0) + 1;
    if (next >= 2) {
      await pool.query('UPDATE products SET missing_count=$1,active=FALSE WHERE id=$2',[next,p.id]);
      if (!baseline) {
        await addChange(source.id,p.id,scanId,detectedAt,'removed',null,p.current_name,null,'critical');
        changes++;
      }
    } else {
      await pool.query('UPDATE products SET missing_count=$1 WHERE id=$2',[next,p.id]);
    }
  }
  return changes;
}

async function addChange(sourceId,productId,scanId,when,type,field,oldValue,newValue,severity,db=pool){
  await db.query(`INSERT INTO changes(source_id,product_id,detected_at,change_type,field_name,old_value,new_value,severity,scan_id)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [sourceId,productId,when,type,field,stringify(oldValue),stringify(newValue),severity,scanId]);
}

function same(a,b){
  if (a == null && b == null) return true;
  if (Array.isArray(a) || Array.isArray(b) || typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return String(a ?? '') === String(b ?? '');
}
function stringify(v){ return v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v)); }
