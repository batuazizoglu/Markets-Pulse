import {adLibraryUrl} from './ad-library-url.js';

// Source checks are independent of AI publication: unchanged creatives and
// empty successful scans may not publish another analysis feed at all.
export async function getCloudSourceCoverage(pool,{end=new Date()}={}){
  const cutoff=new Date(end);
  const {rows}=await pool.query(`SELECT DISTINCT ON (j.brand)
    j.brand,j.source_json,j.status,j.created_at,j.started_at,j.finished_at,j.note,
    p.state provider_state,p.created_at provider_started_at,p.finished_at provider_finished_at,
    p.coverage_complete,p.expected_ads
    FROM ad_cloud_jobs j LEFT JOIN ad_provider_runs p ON p.job_id=j.id
    WHERE j.status<>'imported' AND j.created_at<$1
    ORDER BY j.brand,j.created_at DESC,j.id DESC`,[cutoff]);
  if(!rows.length)return null;
  const coverage=rows.map(j=>{
    const finished=j.provider_state?j.provider_finished_at:j.finished_at;
    const completed=finished&&+new Date(finished)<+cutoff;
    const verified=completed&&j.provider_state==='complete'&&j.coverage_complete===true&&Number.isSafeInteger(j.expected_ads)&&j.expected_ads>=0;
    const status=verified?(j.expected_ads===0?'no_ads':'ok'):
      j.provider_state==='start_unknown'?'blocked':j.provider_state==='error'?'error':j.provider_state?'partial':
      ['blocked','unverified','error'].includes(j.status)?j.status:
      completed&&['ok','no_ads'].includes(j.status)?j.status:'partial';
    return {brand:j.brand,source_url:adLibraryUrl(j.source_json),country:'CY',status,
      checked_at:new Date(j.provider_started_at||j.started_at||j.created_at).toISOString(),
      reviewed_ads:verified?j.expected_ads:null,note:j.note||'Güncel kaynak kontrolü henüz tamamlanmadı.'};
  });
  return {coverage,status:coverage.every(x=>['ok','no_ads'].includes(x.status))?'ok':'partial',
    checked_at:coverage.map(x=>x.checked_at).sort().at(-1),last_error:null};
}
