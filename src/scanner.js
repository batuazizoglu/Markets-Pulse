import zlib from 'zlib';
import { pool } from './db.js';
import { TRACKED_FIELDS } from './config.js';
import { rebaseCardBoundaries, recoverEmbeddedCards, rebaseCommercialTerms, sha256 } from './parser.js';
import { parseValidatedTariffPage } from './tariff-contract.js';
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

export async function scanSource(source, {db=pool, fetchPage=fetch, captureEvidence=captureEvidenceScreenshots} = {}) {
  const started = new Date();
  const t0 = Date.now();
  let responseStatus = null;
  let parsedCount = 0;
  let pageHash = null;
  let validation = null;
  const prior = await db.query("SELECT COUNT(*)::int AS c FROM scans WHERE source_id=$1 AND status='ok'", [source.id]);
  const baseline = (prior.rows[0]?.c || 0) === 0;
  const ins = await db.query("INSERT INTO scans(source_id,started_at,status) VALUES($1,$2,'running') RETURNING id", [source.id, started]);
  const scanId = ins.rows[0].id;

  try {
    const response = await fetchPage(source.url, {
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
    // Retain a response fingerprint even if validation rejects the payload.
    pageHash = sha256(html);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    assertSourceResponseUrl(source.url, response.url);
    // Validate the complete HTML card catalogue before deduplication or any
    // product writes: a dropped malformed card must never imply a removal.
    const parsed = parseValidatedTariffPage(html, source);
    const {relevantText} = parsed;
    validation = parsed.validation || null;
    pageHash = sha256(relevantText);
    const cards = dedupeCards(parsed.cards);
    parsedCount = cards.length;

    if (cards.length === 0) throw new Error('Parser returned 0 tariff cards; source layout may have changed.');

    // Publish versions, changes, absence counters and the successful scan as
    // one unit. A failed write cannot leak a partly updated catalogue/email.
    const meaningfulChanges = await scanTransaction(db, async client => {
      await assertExcludedTariffsUntracked(source, validation, cards, client);
      await assertNoAmbiguousVariantCollapse(source, parsed.cards, cards, client);
      const changeCount = await processCards(source, scanId, cards, baseline, started, client);
      const removedCount = await processMissing(source, scanId, cards, baseline, started, client);
      await client.query(`UPDATE scans SET finished_at=clock_timestamp(), status='ok', http_status=$1, response_ms=$2, page_hash=$3, parsed_count=$4, error=NULL WHERE id=$5`,
        [responseStatus, Date.now()-t0, pageHash, parsedCount, scanId]);
      return changeCount + removedCount;
    });

    let screenshotOk = null;
    let focusOk = null;
    let evidenceError = null;
    // Visual evidence is supplementary. Its failure after the commit must
    // not relabel a validated, atomically published scan as failed.
    try {
      const lastEvidence = await db.query(`SELECT captured_at,(screenshot_png IS NOT NULL) has_screenshot,(focused_screenshot_png IS NOT NULL) has_focus FROM snapshots WHERE source_id=$1 ORDER BY captured_at DESC LIMIT 1`,[source.id]);
      const previous = lastEvidence.rows[0];
      const evidenceDue = !previous || !previous.has_screenshot || !previous.has_focus || (Date.now()-new Date(previous.captured_at).getTime() >= 24*60*60*1000);
      if (baseline || meaningfulChanges > 0 || evidenceDue) {
        let fullScreenshot = null;
        let focusedScreenshot = null;
        let screenshotError = null;
        let focusedScreenshotError = null;
        let screenshotMeta = null;
        try {
          const evidence = await captureEvidence(source.url);
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
        await db.query(`INSERT INTO snapshots(source_id,scan_id,captured_at,kind,page_hash,html_gzip,extracted_json,screenshot_png,focused_screenshot_png,screenshot_error,focused_screenshot_error,screenshot_meta)
                          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb)`,
          [source.id, scanId, started, kind, pageHash, zlib.gzipSync(Buffer.from(html)), JSON.stringify(cards), fullScreenshot, focusedScreenshot, screenshotError, focusedScreenshotError, JSON.stringify({...screenshotMeta,validation})]);
      }
    } catch (error) {
      evidenceError = error?.message || String(error);
      console.error('[scan-evidence]', source.slug, evidenceError);
    }

    return { ok:true, scan_id:scanId, source:source.slug, http_status:responseStatus, response_ms:Date.now()-t0, parsed_count:parsedCount, baseline, changes:meaningfulChanges, screenshot_ok:screenshotOk, focused_screenshot_ok:focusOk, validation, ...(evidenceError?{evidence_error:evidenceError}:{}) };
  } catch (error) {
    const detail = error?.message || String(error);
    const message = error?.code === 'TARIFF_CONTRACT_ERROR' && !detail.startsWith('TARIFF_CONTRACT_ERROR:') ? `${error.code}: ${detail}` : detail;
    await db.query(`UPDATE scans SET finished_at=NOW(), status='error', http_status=$1, response_ms=$2, page_hash=$3, parsed_count=$4, error=$5 WHERE id=$6`,
      [responseStatus, Date.now()-t0, pageHash, parsedCount, message, scanId]);
    return { ok:false, scan_id:scanId, source:source.slug, http_status:responseStatus, response_ms:Date.now()-t0, parsed_count:parsedCount, error:message, validation };
  }
}

function assertSourceResponseUrl(requested, received) {
  if (!received) return;
  try {
    const expected = new URL(requested), actual = new URL(received);
    if (actual.protocol === 'https:' && actual.host === expected.host && !actual.username && !actual.password &&
      actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '')) return;
  } catch { /* A malformed or unexpected final URL is not source evidence. */ }
  const error = new Error('Yanıt adresi izlenen tarife sayfasıyla eşleşmiyor. Son doğrulanmış veriler korundu.');
  error.code = 'TARIFF_CONTRACT_ERROR';
  throw error;
}

async function assertExcludedTariffsUntracked(source, validation, cards, db) {
  const excluded = validation?.excluded || [];
  if (!excluded.length) return;
  const current = (await db.query(`SELECT p.current_name,p.identity_base,v.raw_text
    FROM products p LEFT JOIN LATERAL (
      SELECT raw_text FROM product_versions WHERE product_id=p.id ORDER BY captured_at DESC,id DESC LIMIT 1
    ) v ON TRUE WHERE p.source_id=$1 AND p.active=TRUE`,[source.id])).rows;
  const normalized = value => String(value || '').trim().toLocaleLowerCase('tr-TR');
  for (const item of excluded) {
    const identities = new Set([item.identity_base,...(item.protected_identity_bases || [])].filter(Boolean));
    const tracked = current.filter(product => identities.has(product.identity_base) ||
      (normalized(item.name) && normalized(item.name) === normalized(product.current_name)));
    if (!tracked.length) continue;
    const existing = tracked[0];
    if (item.reason === 'retired-super-red-combined-allowance') {
      const counterparts = cards.filter(card => card.identity_base === item.identity_base);
      const previousRows = String(existing.raw_text || '').split(' | ');
      // Permit the archive duplicate only when one previously tracked split
      // card and one currently verified live card resolve the same exact name.
      // With no live counterpart or more than one tracked variant, fail closed.
      if (tracked.length === 1 && existing.current_name === item.name &&
          previousRows[0] === item.name && /^\d+\s*GB$/i.test(previousRows[1] || '') &&
          previousRows.some(row => /^\+\s*\d+\s*GB Özgür Pass$/i.test(row)) &&
          !previousRows.includes('Bu tarife sonlanmıştır') &&
          counterparts.length === 1 && counterparts[0].name === item.name &&
          counterparts[0].product_hash === item.live_counterpart_hash &&
          counterparts[0].bonus_data_gb > 0 &&
          counterparts[0].raw_text.split(' | ').some(row => /^\+\s*\d+\s*GB Özgür Pass$/i.test(row)) &&
          !counterparts[0].raw_text.split(' | ').includes('Bu tarife sonlanmıştır')) continue;
    }
    const error = new Error(`İzlenen paket mevcut kart biçimiyle doğrulanamadı: ${existing.current_name}. Son doğrulanmış veriler korundu.`);
    error.code = 'TARIFF_CONTRACT_ERROR';
    throw error;
  }
}

async function assertNoAmbiguousVariantCollapse(source, rawCards, dedupedCards, db) {
  const groups = new Map();
  for (const card of rawCards) {
    const group = groups.get(card.identity_base) || {raw:0, unique:0, hashes:new Set()};
    group.raw++;
    group.hashes.add(card.product_hash);
    groups.set(card.identity_base,group);
  }
  for (const card of dedupedCards) groups.get(card.identity_base).unique++;
  const collapsed = [...groups].filter(([,group]) => group.hashes.size < group.raw);
  if (!collapsed.length) return;
  const active = (await db.query(`SELECT identity_base,COUNT(*)::int AS active_count FROM products
    WHERE source_id=$1 AND active=TRUE GROUP BY identity_base`,[source.id])).rows;
  const counts = new Map(active.map(row=>[row.identity_base,Number(row.active_count)]));
  for (const [identity,group] of collapsed) {
    const count = counts.get(identity) || 0;
    if (count <= group.unique) continue;
    // Identical static markup may safely repeat one known offer. Two tracked
    // offers converging to the same terms cannot safely become one identity.
    const error = new Error('Aynı adlı tekliflerin ayrı kimlikleri doğrulanamadı. Son doğrulanmış veriler korundu.');
    error.code = 'TARIFF_CONTRACT_ERROR';
    throw error;
  }
}

async function scanTransaction(db, callback) {
  if (typeof db.connect !== 'function') return db.transaction(callback);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

async function processMissing(source, scanId, cards, baseline, detectedAt, db=pool) {
  const seen = cards._seenProductIds || new Set();
  const { rows } = await db.query('SELECT * FROM products WHERE source_id=$1 AND active=TRUE',[source.id]);
  let changes = 0;
  for (const p of rows) {
    if (seen.has(String(p.id))) continue;
    const next = Number(p.missing_count || 0) + 1;
    if (next >= 2) {
      await db.query('UPDATE products SET missing_count=$1,active=FALSE WHERE id=$2',[next,p.id]);
      if (!baseline) {
        await addChange(source.id,p.id,scanId,detectedAt,'removed',null,p.current_name,null,'critical',db);
        changes++;
      }
    } else {
      await db.query('UPDATE products SET missing_count=$1 WHERE id=$2',[next,p.id]);
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
