import { buildMarketPulse } from './intelligence.js';
import { getKktcellCatalog, buildBenchmark } from './kktcell-benchmark.js';

export const REPORT_TZ = 'Asia/Famagusta';
export const REPORT_NAMES = {
  daily: 'Günlük Yönetici Özeti',
  weekly: 'Haftalık Market Pulse Raporu',
  telsim7: 'Son 7 Günde Telsim Ne Yaptı?',
  evidence: 'Evidence Pack'
};

function latestPackagesSql() {
  return "SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position," +
    " s.slug source_slug,s.name source_name,s.url source_url," +
    " v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json" +
    " FROM products p JOIN sources s ON s.id=p.source_id" +
    " LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE";
}

async function currentBenchmark(pool) {
  const [telsim,catalog] = await Promise.all([
    pool.query(latestPackagesSql() + " WHERE p.active=TRUE ORDER BY s.id,v.price_try ASC NULLS LAST,p.current_name"),
    getKktcellCatalog(false)
  ]);
  return Object.assign({}, buildBenchmark(telsim.rows,catalog.rows), {kktcell_sources:catalog.sources});
}

async function sourceHealth(pool) {
  const r = await pool.query(
    "SELECT s.id,s.slug,s.name,s.url," +
    " (SELECT started_at FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_checked_at," +
    " (SELECT status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_status," +
    " (SELECT http_status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) http_status," +
    " (SELECT response_ms FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) response_ms," +
    " (SELECT parsed_count FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) parsed_count," +
    " (SELECT error FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_error," +
    " (SELECT COUNT(*)::int FROM products p WHERE p.source_id=s.id AND p.active=TRUE) active_products" +
    " FROM sources s ORDER BY s.id"
  );
  return r.rows;
}

async function periodChanges(pool, days) {
  const r = await pool.query(
    "SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,p.current_name product_name" +
    " FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id" +
    " WHERE c.detected_at >= NOW()-($1::text||' days')::interval" +
    " ORDER BY c.detected_at DESC,c.id DESC LIMIT 600", [days]
  );
  return r.rows;
}

export async function periodEvidence(pool, days, includeBinary=false) {
  const cols = includeBinary
    ? "sn.html_gzip,sn.extracted_json,sn.screenshot_png,sn.focused_screenshot_png,"
    : "(sn.html_gzip IS NOT NULL) has_html,(sn.extracted_json IS NOT NULL) has_json,(sn.screenshot_png IS NOT NULL) has_screenshot,(sn.focused_screenshot_png IS NOT NULL) has_focus,";
  const r = await pool.query(
    "SELECT sn.id,sn.captured_at,sn.kind,sn.page_hash,sn.screenshot_meta," + cols +
    " s.slug source_slug,s.name source_name,s.url source_url" +
    " FROM snapshots sn JOIN sources s ON s.id=sn.source_id" +
    " WHERE sn.captured_at >= NOW()-($1::text||' days')::interval" +
    " ORDER BY sn.captured_at DESC LIMIT 80", [days]
  );
  return r.rows;
}

async function scoreBaselines(pool, days) {
  const r = await pool.query(
    "SELECT DISTINCT ON (segment) segment,score,bucket_at,level,confidence" +
    " FROM competitive_position_history" +
    " WHERE bucket_at <= NOW()-($1::text||' days')::interval" +
    " ORDER BY segment,bucket_at DESC", [days]
  );
  const m = {};
  for (const x of r.rows) m[x.segment] = x;
  return m;
}

function changeStats(changes) {
  const stats = {total:changes.length,added:0,removed:0,field_changed:0,critical:0,high:0,medium:0,low:0};
  const fields = {}, products = {};
  for (const c of changes) {
    if (Object.prototype.hasOwnProperty.call(stats,c.change_type)) stats[c.change_type]++;
    if (Object.prototype.hasOwnProperty.call(stats,c.severity)) stats[c.severity]++;
    const f = c.field_name || c.change_type;
    fields[f] = (fields[f] || 0) + 1;
    const p = c.product_name || c.new_value || c.old_value || 'Paket';
    products[p] = (products[p] || 0) + 1;
  }
  stats.top_fields = Object.entries(fields).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>({name:x[0],count:x[1]}));
  stats.top_products = Object.entries(products).sort((a,b)=>b[1]-a[1]).slice(0,10).map(x=>({name:x[0],count:x[1]}));
  return stats;
}

function scoreDeltas(benchmark, baseline) {
  return [benchmark.overall_score,...(benchmark.segment_scores||[])].filter(Boolean).map(s=>{
    const b=baseline[s.segment];
    return {
      segment:s.segment,current:s.score,baseline:b&&b.score!=null?Number(b.score):null,
      delta:b&&b.score!=null&&s.score!=null?Number(s.score)-Number(b.score):null,
      level:s.level,confidence:s.confidence,rationale:s.rationale
    };
  });
}

export async function buildReportContext(pool, type, options={}) {
  const days = type === 'daily' ? 1 : Math.max(1,Math.min(30,Number(options.days||7)));
  const periodEnd = new Date(), periodStart = new Date(periodEnd.getTime()-days*86400000);
  const [market,benchmark,sources,changes,baseline,evidence] = await Promise.all([
    buildMarketPulse(pool,days),currentBenchmark(pool),sourceHealth(pool),periodChanges(pool,days),scoreBaselines(pool,days),periodEvidence(pool,days,type!=='daily')
  ]);
  return {
    type,title:REPORT_NAMES[type]||'Market Pulse Raporu',days,
    period_start:periodStart.toISOString(),period_end:periodEnd.toISOString(),generated_at:new Date().toISOString(),
    market,benchmark,sources,changes,stats:changeStats(changes),score_deltas:scoreDeltas(benchmark,baseline),evidence
  };
}
