import { buildMarketPulse, marketPulseFromRows } from './intelligence.js';
import { collectMonthlyData } from './monthly-report-data.js';
import { currentBenchmark } from './live-benchmark.js';
import { ENGINE_VERSION } from './comparable-engine.js';
import { getHomeInternetMarket } from './home-internet.js';
import {buildAdReportSection} from './report-ad-media.js';

export const REPORT_TZ = 'Asia/Famagusta';
export const REPORT_NAMES = {
  daily: 'Günlük Yönetici Özeti',
  weekly: 'Haftalık Markets Pulse Raporu',
  monthly: 'Aylık Birleşik Yönetici Raporu · Son 30 Gün',
  telsim7: 'Son 7 Günde Telsim Ne Yaptı?',
  evidence: 'Evidence Pack',
  home: 'Turkcell Ev İnterneti Rekabet Raporu',
  fwa: 'Superbox / Red Box Rekabet Raporu'
};

export function reportDays(type,requestedDays=7){
  return type==='monthly'?30:type==='daily'?1:Math.max(1,Math.min(30,Number(requestedDays)||7));
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

export async function periodEvidence(pool, days, mode='meta') {
  const cols = mode==='full'
    ? "sn.html_gzip,sn.extracted_json,sn.screenshot_png,sn.focused_screenshot_png,"
    : mode==='visual'
      ? "NULL::bytea html_gzip,NULL::jsonb extracted_json,sn.screenshot_png,sn.focused_screenshot_png,"
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
    " WHERE bucket_at <= NOW()-($1::text||' days')::interval AND details_json->>'engine_version'=$2" +
    " ORDER BY segment,bucket_at DESC", [days,ENGINE_VERSION]
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

function dailyHomeSections(home,days=1,now=new Date()){
  const cutoff=new Date(now).getTime()-Math.max(1,Number(days)||1)*86400000;
  const productMap=new Map((home.products||[]).map(x=>[x.product_key,x]));
  const familyChanges=family=>(home.changes||[]).filter(ch=>{
    if(new Date(ch.detected_at).getTime()<cutoff||new Date(ch.detected_at)>new Date(now))return false;
    const p=productMap.get(ch.product_key);
    if(p)return (p.product_family||'fixed')===family;
    if(family==='fwa')return ['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(ch.source_slug)||/superbox|red box/i.test(ch.product_name||'');
    return !['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(ch.source_slug)&&!/superbox|red box/i.test(ch.product_name||'');
  });
  const fixedProducts=(home.products||[]).filter(x=>(x.product_family||'fixed')==='fixed');
  const fwaProducts=(home.products||[]).filter(x=>x.product_family==='fwa');
  const fixedSources=(home.sources||[]).filter(s=>!['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(s.slug));
  const fwaSources=(home.sources||[]).filter(s=>['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(s.slug));
  const fixedChanges=familyChanges('fixed'),fwaChanges=familyChanges('fwa');
  return {
    fixed:{products:fixedProducts,sources:fixedSources,changes:fixedChanges,stats:changeStats(fixedChanges),opportunities:home.opportunities||[]},
    fwa:{products:fwaProducts,sources:fwaSources,changes:fwaChanges,stats:changeStats(fwaChanges),comparison:home.fwa_comparison||{}}
  };
}

export async function buildReportContext(pool, type, options={},loaders={currentBenchmark,sourceHealth,getHomeInternetMarket}) {
  const days = reportDays(type,options.days);
  const periodEnd = new Date(), periodStart = new Date(periodEnd.getTime()-days*86400000);

  const adSection=await buildAdReportSection(pool,type,periodStart,periodEnd);

  if(type==='monthly'){
    const [data,benchmark,sources,home]=await Promise.all([
      collectMonthlyData(pool,periodStart,periodEnd),loaders.currentBenchmark(pool),loaders.sourceHealth(pool),loaders.getHomeInternetMarket(pool,{refresh:false})
    ]);
    const changes=data.changes,daily_home=dailyHomeSections({...home,changes:data.homeChanges},30,periodEnd);
    return {...adSection,type,title:REPORT_NAMES[type],days,period_start:periodStart.toISOString(),period_end:periodEnd.toISOString(),generated_at:periodEnd.toISOString(),
      market:marketPulseFromRows(changes,30,periodEnd),benchmark,sources,changes,stats:changeStats(changes),score_deltas:scoreDeltas(benchmark,data.baseline),evidence:data.evidence,daily_home,
      monthly:{...data.summary,trend:data.trend,coverage:data.coverage,total_changes:changes.length+data.homeChanges.length}};
  }

  if(type==='home'||type==='fwa'){
    const home=await getHomeInternetMarket(pool,{refresh:false});
    const family=type==='fwa'?'fwa':'fixed';
    const products=(home.products||[]).filter(x=>(x.product_family||'fixed')===family);
    const productMap=new Map((home.products||[]).map(x=>[x.product_key,x]));
    const changes=(home.changes||[]).filter(ch=>{
      const p=productMap.get(ch.product_key);
      if(p)return (p.product_family||'fixed')===family;
      if(type==='fwa')return ch.source_slug==='telsim-redbox'||/superbox|red box/i.test(ch.product_name||'');
      return ch.source_slug!=='telsim-redbox'&&!/superbox|red box/i.test(ch.product_name||'');
    });
    const sources=(home.sources||[]).filter(s=>type==='fwa'?['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(s.slug):!['kktcell-superbox','lifecell-digital-superbox','telsim-redbox'].includes(s.slug));
    return {
      ...adSection,type,title:REPORT_NAMES[type],days,
      period_start:periodStart.toISOString(),period_end:periodEnd.toISOString(),generated_at:new Date().toISOString(),
      home:{...home,products,changes,sources},
      changes,stats:changeStats(changes),sources
    };
  }

  const tasks=[
    buildMarketPulse(pool,days),currentBenchmark(pool),sourceHealth(pool),periodChanges(pool,days),scoreBaselines(pool,days),periodEvidence(pool,days,type==='evidence'?'full':type==='daily'?'meta':'visual')
  ];
  if(type==='daily'||type==='weekly')tasks.push(getHomeInternetMarket(pool,{refresh:false}));
  const results=await Promise.all(tasks);
  const [market,benchmark,sources,changes,baseline,evidence]=results;
  const daily_home=(type==='daily'||type==='weekly')?dailyHomeSections(results[6],days):null;
  return {
    ...adSection,type,title:REPORT_NAMES[type]||'Markets Pulse Raporu',days,
    period_start:periodStart.toISOString(),period_end:periodEnd.toISOString(),generated_at:new Date().toISOString(),
    market,benchmark,sources,changes,stats:changeStats(changes),score_deltas:scoreDeltas(benchmark,baseline),evidence,
    daily_home
  };
}
