// A bounded, credential-free snapshot for operational checks. The registry,
// rather than the jobs table, determines which pages must be accounted for.
export function adScanAudit(status,directory,{now=new Date()}={}){
  const maxAge=status.visibility.max_observation_age_hours;
  const runs=new Map((status.capture_provider?.runs||[]).map(run=>[run.page_id,run]));
  const jobs=new Map();
  for(const job of status.sources||[]){
    const prior=jobs.get(job.page_id);
    if(!prior||+new Date(job.created_at)>+new Date(prior.created_at)||
      (+new Date(job.created_at)===+new Date(prior.created_at)&&BigInt(job.job_id)>BigInt(prior.job_id)))jobs.set(job.page_id,job);
  }
  const sources=directory.map(source=>{
    const run=runs.get(source.page_id),job=jobs.get(source.page_id);
    const checked=run?.created_at,age=checked?+now-+new Date(checked):NaN;
    const fresh=Number.isFinite(age)&&age>=-300000&&age<=maxAge*3600000;
    const pending=job&&['queued','running','retry'].includes(job.status);
    const latest=run&&job&&String(run.job_id)===String(job.job_id);
    const complete=Boolean(latest&&['ok','no_ads'].includes(job.status)&&run.state==='complete'&&run.coverage_complete===true&&fresh);
    return {brand:source.brand,page_id:source.page_id,job_id:run?.job_id||null,
      status:pending?job.status:!run?'missing':!latest?'partial':!fresh?'stale':complete?(run.expected_ads===0?'no_ads':'ok'):['error','blocked'].includes(job?.status)?job.status:run.state,
      checked_at:checked||null,finished_at:run?.finished_at||null,
      found_ads:run?.ads??null,expected_ads:run?.expected_ads??null,
      active_observations:job?.active_count??0,coverage_complete:complete,
      list_matches_latest_scan:complete?run.list_matches_latest_scan??null:null,
      coverage_reasons:run?.coverage_reasons||[],last_error:run?.last_error||null};
  });
  return {day:status.schedule.last_scheduled_day,timezone:status.schedule.timezone,
    daily_at:status.schedule.daily_at,max_observation_age_hours:maxAge,
    verified_pages:sources.length,complete_pages:sources.filter(s=>s.coverage_complete).length,
    matched_pages:sources.filter(s=>s.list_matches_latest_scan===true).length,sources};
}
