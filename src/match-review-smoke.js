import { pool } from './db.js';
import { buildMatchReviewSnapshot } from './match-review.js';

try{
  const s=await buildMatchReviewSnapshot(pool,{refresh:false});
  console.log('[match-review-smoke]',JSON.stringify({
    engine_version:s.engine_version,
    mode:s.mode,
    catalog:s.catalog,
    engine_counts:s.engine_counts,
    effective_counts:s.effective_counts,
    override_count:s.override_count,
    row_count:s.rows?.length||0,
    sample:(s.rows||[]).slice(0,3).map(r=>({
      telsim_name:r.telsim?.name||null,
      engine_status:r.engine_status,
      engine_score:r.engine_score,
      match_name:r.engine_match?.name||null,
      candidate_count:r.candidates?.length||0
    }))
  }));
}catch(e){
  console.error('[match-review-smoke-error]',e?.stack||e?.message||String(e));
  process.exitCode=1;
}finally{
  await pool.end().catch(()=>{});
}
