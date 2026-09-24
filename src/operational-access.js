// Read-only market data and personal report delivery remain available to every
// signed-in user. Manual collection, reanalysis and forced refresh are admin work.
export function requireOperationalAdmin(req,res,next){
  if(!req.appUser)return res.status(401).json({error:'Oturum gerekli',code:'AUTH_REQUIRED'});
  if(req.appUser.role!=='admin')return res.status(403).json({error:'Bu işlem için admin yetkisi gerekli',code:'ADMIN_REQUIRED'});
  next();
}

export function requireAdminForRefresh(req,res,next){
  if(req.query.refresh==='1')return requireOperationalAdmin(req,res,next);
  next();
}

export async function reportStatusForUser(pool,user,email){
  if(user?.role!=='admin')return {email:{configured:email.configured===true},recent_runs:[]};
  const result=await pool.query('SELECT id,report_type,period_start,period_end,generated_at,trigger_type,delivery_status,recipients,sent_at,file_name,file_size_bytes,error,meta_json FROM report_runs ORDER BY generated_at DESC LIMIT 30');
  return {email,recent_runs:result.rows};
}

export function standardAdVisuals(data){
  const monitoring=data.monitoring||{},cloud=data.cloud,provider=cloud?.capture_provider;
  const incomplete=monitoring.status!=='ok'||Boolean(monitoring.stale||monitoring.last_error)||Number(data.pending_media?.total)>0||
    Boolean(cloud&&(cloud.worker_online===false||cloud.vision_configured===false||cloud.capture_transport?.configured===false||
      ['pending','retry','error'].some(status=>Number(cloud.candidates?.[status])>0)||
      (cloud.sources||[]).some(source=>['blocked','error','retry','queued','running','unverified'].includes(source.status))))||
    Boolean(provider?.enabled&&(provider.configured===false||(provider.runs||[]).some(run=>run.coverage_complete!==true)));
  const {generated_at,categories,groups,brand_groups,total,pagination}=data;
  return {generated_at,categories,groups,brand_groups,total,pagination,
    rows:(data.rows||[]).map(({ai_queue_status,ai_analysis,taxonomy_version,...published})=>published),
    source_directory:(data.source_directory||[]).map(({brand,page_id,capture_brand,ad_library_url,country,facebook,instagram})=>({brand,page_id,capture_brand,ad_library_url,country,facebook,instagram})),
    display_status:{incomplete,updated_at:monitoring.checked_at||null}};
}
