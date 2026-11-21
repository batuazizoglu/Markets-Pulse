import {adLibraryUrl} from './ad-library-url.js';
import {getAdLifecyclePolicy} from './ad-live.js';
import {socialDirectory} from './isp-registry.js';

// Source checks are independent of AI publication: unchanged creatives and
// empty successful scans may not publish another analysis feed at all.
export async function getCloudSourceCoverage(pool,{end=new Date(),sources,maxAgeHours}={}){
  const cutoff=new Date(end);
  const {rows}=await pool.query(`SELECT DISTINCT ON (j.source_json->>'page_id')
    j.brand,j.source_json,j.status,j.created_at,j.started_at,j.finished_at,j.note,
    p.state provider_state,p.created_at provider_started_at,p.finished_at provider_finished_at,
    p.coverage_complete,p.expected_ads
    FROM ad_cloud_jobs j LEFT JOIN ad_provider_runs p ON p.job_id=j.id
    WHERE j.status<>'imported' AND j.created_at<$1
    ORDER BY j.source_json->>'page_id',(j.status='skipped'),j.created_at DESC,j.id DESC`,[cutoff]);
  // Keep the external-feed path until cloud collection has actually been used.
  if(!rows.length&&sources===undefined)return null;
  const hours=maxAgeHours??(await getAdLifecyclePolicy(pool)).active_max_age_hours;
  const jobs=new Map(rows.filter(j=>j.status!=='skipped').map(j=>[j.source_json?.page_id,j]));
  const pages=new Set();
  // The registry, not the queue, defines the required coverage. A missing job
  // must remain visible, and shared brand aliases must not count twice.
  const directory=socialDirectory(sources||[])
    .filter(source=>adLibraryUrl(source,{allowKeyword:false}))
    .sort((a,b)=>Number(Boolean(a.capture_brand))-Number(Boolean(b.capture_brand))||a.brand.localeCompare(b.brand,'tr'))
    .filter(source=>{if(pages.has(source.page_id))return false;pages.add(source.page_id);return true;});
  const coverage=directory.map(source=>{
    const j=jobs.get(source.page_id);
    const identity={brand:source.brand,source_url:adLibraryUrl(source),country:'CY'};
    if(!j)return {...identity,status:'partial',checked_at:null,reviewed_ads:null,
      note:'Doğrulanmış reklam sayfasının güncel kontrolü henüz başlatılmadı.'};
    const finished=j.provider_state?j.provider_finished_at:j.finished_at;
    const completed=finished&&+new Date(finished)<+cutoff;
    const checkedAt=new Date(j.provider_started_at||j.started_at||j.created_at);
    const fresh=+checkedAt<=+cutoff&&+cutoff-+checkedAt<=hours*3600000;
    const verified=completed&&fresh&&j.provider_state==='complete'&&j.coverage_complete===true&&Number.isSafeInteger(j.expected_ads)&&j.expected_ads>=0;
    const status=verified?(j.expected_ads===0?'no_ads':'ok'):
      j.provider_state==='start_unknown'?'blocked':j.provider_state==='error'?'error':j.provider_state?'partial':
      ['blocked','unverified','error'].includes(j.status)?j.status:
      completed&&fresh&&['ok','no_ads'].includes(j.status)?j.status:'partial';
    return {...identity,status,checked_at:checkedAt.toISOString(),reviewed_ads:verified?j.expected_ads:null,
      note:!fresh?'Kaynağın son kontrolü güncellik süresini aştı; yeni kontrol tamamlanmadı.':j.note||'Güncel kaynak kontrolü henüz tamamlanmadı.'};
  });
  return {coverage,status:coverage.every(x=>['ok','no_ads'].includes(x.status))?'ok':'partial',
    checked_at:coverage.map(x=>x.checked_at).filter(Boolean).sort().at(-1)||null,last_error:null};
}
