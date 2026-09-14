import { pool } from './db.js';
import { getKktcellCatalog } from './kktcell-benchmark.js';
import { buildComparableV2 } from './comparable-v2.js';

const latestPackagesSql = `SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,
  s.slug source_slug,s.name source_name,s.url source_url,
  v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json
  FROM products p JOIN sources s ON s.id=p.source_id
  LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE`;

function compact(r){
  const p=x=>x?{name:x.name,data_gb:x.core_data_gb,bonus_gb:x.bonus_data_gb,minutes:x.minutes,intl_minutes:x.international_minutes,sms:x.sms,validity_days:x.validity_days,price_try:x.price_try,intent:x.intent,eligibility:x.eligibility}:null;
  return {status:r.status,score:r.score,mutual_best:r.mutual_best,segment:r.telsim?.segment,telsim:p(r.telsim),kktcell:p(r.kktcell),penalties:r.penalties||[],runner_up:r.runner_up||null,score_margin:r.score_margin??null};
}

if(process.env.BENCHMARK_V2_SHADOW_RUN==='1'){
  setTimeout(async()=>{
    try{
      const [telsim,catalog]=await Promise.all([
        pool.query(`${latestPackagesSql} WHERE p.active=TRUE ORDER BY s.id,v.price_try ASC NULLS LAST,p.current_name`),
        getKktcellCatalog(false)
      ]);
      const out=buildComparableV2(telsim.rows,catalog.rows);
      console.log('[benchmark-v2-shadow-summary]',JSON.stringify({generated_at:out.generated_at,engine_version:out.engine_version,catalog:out.catalog,counts:out.counts,by_segment:out.by_segment,diagnostics:out.diagnostics,golden:{total:out.golden.total,evaluated:out.golden.evaluated,passed:out.golden.passed,failed:out.golden.failed,skipped:out.golden.skipped}}));
      console.log('[benchmark-v2-shadow-golden]',JSON.stringify(out.golden.tests));
      for(const r of out.results)console.log('[benchmark-v2-shadow-row]',JSON.stringify(compact(r)));
    }catch(e){console.error('[benchmark-v2-shadow-error]',e?.stack||e?.message||String(e))}
  },40000);
}
