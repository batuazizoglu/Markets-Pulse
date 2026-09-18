import {randomUUID,createHash} from 'node:crypto';
import {socialDirectory} from './isp-registry.js';
import {captureCloudAds,adLibrarySource} from './ad-cloud-capture.js';
import {analyzeCloudImage,visionConfig} from './ad-cloud-vision.js';
import {validateAdFeed,importAdFeed} from './ad-visual.js';

export const CLOUD_SCHEDULE={enabled:true,description:'Bulutta her gün 06:00; Telsim ve dönüşümlü rakipler',timezone:'Asia/Famagusta'};
export function localCloudTime(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return {day:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)};
}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function transaction(pool,fn){
  const db=pool.connect?await pool.connect():pool;
  try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release?.()}
}
async function assertLease(db,owner){
  const r=await db.query('SELECT lease_owner,lease_until FROM ad_cloud_control WHERE id=1 FOR UPDATE');
  if(r.rows[0]?.lease_owner!==owner||+new Date(r.rows[0]?.lease_until)<=Date.now())throw new Error('CLOUD_LEASE_LOST');
}
export async function queueCloudReview(pool,sources,{manual=false,now=new Date()}={}){
  const local=localCloudTime(now);
  if(!manual&&local.hour<6)return {queued:0};
  return transaction(pool,async db=>{
    const control=(await db.query('SELECT * FROM ad_cloud_control WHERE id=1 FOR UPDATE')).rows[0];
    if(!manual&&control.scheduled_day===local.day)return {queued:0};
    if(manual&&control.manual_after&&+new Date(control.manual_after)>+now)return {queued:0,rate_limited:true};
    if(manual){
      await db.query('UPDATE ad_cloud_control SET manual_after=$1 WHERE id=1',[new Date(+now+5*60000)]);
      const active=await db.query("SELECT id FROM ad_cloud_jobs WHERE status IN ('queued','running','retry') LIMIT 1");
      if(active.rows.length)return {queued:0,already_queued:true};
    }
    const prior=await db.query('SELECT brand,MAX(created_at) last_at FROM ad_cloud_jobs GROUP BY brand');
    const dates=new Map(prior.rows.map(r=>[r.brand,+new Date(r.last_at)]));
    const directory=socialDirectory(sources);
    const selected=[...directory.filter(x=>x.brand==='Telsim'),...directory.filter(x=>x.brand!=='Telsim').sort((a,b)=>(dates.get(a.brand)||0)-(dates.get(b.brand)||0)||Number(Boolean(b.page_id))-Number(Boolean(a.page_id))).slice(0,6)];
    const batch=manual?'manual-'+randomUUID():'daily-'+local.day;let queued=0;
    for(const source of selected){
      const active=await db.query("SELECT id FROM ad_cloud_jobs WHERE brand=$1 AND status IN ('queued','running','retry') LIMIT 1",[source.brand]);
      if(active.rows.length)continue;
      const r=await db.query('INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id',[batch,source.brand,JSON.stringify(source)]);queued+=r.rows.length;
    }
    if(!manual)await db.query('UPDATE ad_cloud_control SET scheduled_day=$1 WHERE id=1',[local.day]);
    return {queued,batch_key:batch};
  });
}
export async function saveCloudCapture(pool,candidate,job,owner){
  if(!candidate.evidence?.length||candidate.evidence.length>3||candidate.evidence.some(x=>x.bytes.length>1500000||hash(x.bytes)!==x.sha256||x.bytes[0]!==255||x.bytes[1]!==216))throw new Error('CLOUD_INVALID_EVIDENCE');
  if(candidate.brand!==job.brand||candidate.page_id!==job.source_json.page_id||!/^\d{5,30}$/.test(candidate.ad_id))throw new Error('CLOUD_IDENTITY_MISMATCH');
  const adKey=[candidate.page_id,candidate.ad_id,candidate.variant_id].join(':');
  const {evidence,...payload}=candidate;
  payload.images=evidence.map(x=>({sha256:x.sha256,path:'evidence/'+x.sha256+'.jpg',captured_at:x.captured_at}));
  const fingerprint=hash(JSON.stringify({images:payload.images.map(x=>x.sha256),text:payload.ad_text}));
  await transaction(pool,async db=>{
    await assertLease(db,owner);
    for(const image of evidence)await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2) ON CONFLICT DO NOTHING',[image.sha256,image.bytes]);
    await db.query(`INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,observed_at) VALUES($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT(ad_key) DO UPDATE SET job_id=EXCLUDED.job_id,
      analysis_json=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.analysis_json ELSE NULL END,
      fingerprint=EXCLUDED.fingerprint,payload=EXCLUDED.payload,observed_at=EXCLUDED.observed_at,status='pending',attempts=0,last_error=NULL,available_at=NOW()`,
      [adKey,job.id,fingerprint,JSON.stringify(payload),candidate.observed_at]);
    await db.query('UPDATE ad_cloud_jobs SET captured=captured+1 WHERE id=$1',[job.id]);
  });
}
async function cloudCoverage(pool){
  const jobs=await pool.query('SELECT DISTINCT ON (brand) brand,source_json,status,created_at,finished_at,captured,note FROM ad_cloud_jobs ORDER BY brand,created_at DESC,id DESC');
  return jobs.rows.map(j=>({brand:j.brand,source_url:adLibrarySource(j.source_json)||j.source_json.ad_library_url,country:'CY',
    status:['blocked','unverified','no_ads','error'].includes(j.status)?j.status:'partial',
    checked_at:new Date(j.finished_at||j.created_at).toISOString(),reviewed_ads:null,note:j.note||'Bulut taraması kuyrukta; görsel analizi henüz tamamlanmadı.'}));
}
async function publishCloudAnalysis(pool,sources,candidate,analysis,owner){
  // The worker lease serializes publication and capture; fence expired workers before importing.
  await transaction(pool,db=>assertLease(db,owner));
  const at=new Date().toISOString(),coverage=await cloudCoverage(pool);
  const feed=validateAdFeed({schema_version:1,producer:'cloud-vision',schedule:CLOUD_SCHEDULE,
    run:{id:'cloud-'+randomUUID(),checked_at:at,status:'partial',coverage},ads:[{...candidate.payload,...analysis}]},sources);
  await importAdFeed(pool,feed,{fetcher:async()=>{throw new Error('Cloud evidence missing')}});
  await pool.query("UPDATE ad_cloud_candidates SET status='analyzed',analysis_json=$1::jsonb,analyzed_at=NOW(),last_error=NULL WHERE ad_key=$2 AND fingerprint=$3",[JSON.stringify(analysis),candidate.ad_key,candidate.fingerprint]);
}
export async function analyzeNextCloudCandidate(pool,sources,owner,{env=process.env,analyze=analyzeCloudImage}={}){
  const config=visionConfig(env);if(!config.configured)return {status:'waiting_config'};
  const r=await pool.query("SELECT * FROM ad_cloud_candidates WHERE status IN ('pending','retry') AND attempts<3 AND available_at<=NOW() ORDER BY observed_at,ad_key LIMIT 1");
  if(!r.rows.length)return {status:'idle'};
  const candidate=r.rows[0];
  const images=[];for(const img of candidate.payload.images){
    const bytes=(await pool.query('SELECT jpeg FROM ad_visual_evidence WHERE sha256=$1',[img.sha256])).rows[0]?.jpeg;
    if(!bytes||hash(Buffer.from(bytes))!==img.sha256)throw new Error('CLOUD_EVIDENCE_MISSING');images.push(Buffer.from(bytes));
  }
  try{
    let analysis=candidate.analysis_json;
    if(!analysis){
      const day=localCloudTime().day;
      const reservation=await pool.query(`UPDATE ad_cloud_control SET vision_day=$1,
        vision_calls=CASE WHEN vision_day=$1 THEN vision_calls+1 ELSE 1 END
        WHERE id=1 AND lease_owner=$2 AND lease_until>NOW() AND (vision_day IS DISTINCT FROM $1 OR vision_calls<$3) RETURNING vision_calls`,[day,owner,config.dailyLimit]);
      if(!reservation.rows.length)return {status:'daily_limit'};
      // Persist attempt before the external request; a restart cannot reset paid-call accounting.
      await pool.query("UPDATE ad_cloud_candidates SET status='retry',attempts=attempts+1,available_at=NOW()+INTERVAL '10 minutes' WHERE ad_key=$1",[candidate.ad_key]);
      analysis=await analyze(candidate.payload,images,{env});
    }
    await publishCloudAnalysis(pool,sources,candidate,analysis,owner);
    return {status:'analyzed',ad_id:candidate.payload.ad_id,category:analysis.category};
  }catch(e){
    const code=/^(VISION_[A-Z0-9_]+|CLOUD_[A-Z0-9_]+)$/.test(e.message)?e.message:'VISION_VALIDATION_ERROR';
    await pool.query("UPDATE ad_cloud_candidates SET status=CASE WHEN attempts>=3 THEN 'error' ELSE 'retry' END,last_error=$1 WHERE ad_key=$2",[code,candidate.ad_key]);
    return {status:'error',code};
  }
}
export async function getCloudStatus(pool,{env=process.env}={}){
  const config=visionConfig(env);
  const [control,jobs,counts,errors]=await Promise.all([
    pool.query('SELECT heartbeat_at,vision_day,vision_calls FROM ad_cloud_control WHERE id=1'),
    pool.query('SELECT DISTINCT ON (brand) brand,status,captured,note,created_at,finished_at FROM ad_cloud_jobs ORDER BY brand,created_at DESC,id DESC'),
    pool.query('SELECT status,count(*)::int count,MAX(analyzed_at) last_analyzed_at FROM ad_cloud_candidates GROUP BY status'),
    pool.query('SELECT last_error FROM ad_cloud_candidates WHERE last_error IS NOT NULL ORDER BY observed_at DESC LIMIT 1')]);
  const row=control.rows[0]||{},heartbeat=row.heartbeat_at;
  return {mode:'cloud',schedule:CLOUD_SCHEDULE,vision_configured:config.configured,
    analysis_status:config.configured?'configured':'waiting_config',
    message:!config.configured?'Bulut taraması etkin. Görsel analiz için sunucu API bağlantısı eksik; kaydedilen görseller kuyrukta bekler.':errors.rows.length?'Son görsel analizi tamamlanamadı. Kayıtlar kuyrukta korunuyor; servis bağlantısı ve kota kontrol edilmeli.':'Görseller sunucuda analiz edilir.',
    worker_heartbeat:heartbeat||null,worker_online:Boolean(heartbeat&&Date.now()-+new Date(heartbeat)<180000),
    calls_today:row.vision_day===localCloudTime().day?row.vision_calls:0,daily_limit:config.dailyLimit,
    candidates:Object.fromEntries(counts.rows.map(x=>[x.status,x.count])),sources:jobs.rows};
}
export function createCloudWorker(pool,sources,{capture=captureCloudAds,analyze=analyzeCloudImage,env=process.env,log=console.log}={}){
  let running=false;
  return async function tick(){
    if(running)return {status:'busy'};running=true;
    const owner=randomUUID();let lease=false;
    try{
      const lock=await pool.query("UPDATE ad_cloud_control SET lease_owner=$1,lease_until=NOW()+INTERVAL '10 minutes',heartbeat_at=NOW() WHERE id=1 AND (lease_until IS NULL OR lease_until<NOW()) RETURNING id",[owner]);
      if(!lock.rows.length)return {status:'busy'};lease=true;
      await queueCloudReview(pool,sources);
      await pool.query("UPDATE ad_cloud_candidates SET status='error',last_error=COALESCE(last_error,'VISION_RETRY_EXHAUSTED') WHERE status='retry' AND attempts>=3 AND available_at<=NOW()");
      // An interrupted capture resumes from persisted candidates and remains bounded to three tries.
      await pool.query("UPDATE ad_cloud_jobs SET status=CASE WHEN attempts>=3 THEN 'error' ELSE 'retry' END,available_at=NOW(),note='Sunucu yeniden başladı; tamamlanan görseller korundu.' WHERE status='running'");
      let scan=null;
      for(let n=0;n<7;n++){
        const result=await pool.query("UPDATE ad_cloud_jobs SET status='running',attempts=attempts+1,started_at=NOW() WHERE id=(SELECT id FROM ad_cloud_jobs WHERE status IN ('queued','retry') AND available_at<=NOW() ORDER BY id LIMIT 1) RETURNING *");
        const job=result.rows[0];if(!job)break;
        try{scan=await capture(job.source_json,c=>saveCloudCapture(pool,c,job,owner))}catch{scan={status:'error',note:'Bulut tarayıcısı çalıştırılamadı; sonraki deneme kuyrukta.'}}
        const status=scan.status==='error'&&job.attempts<3?'retry':scan.status;
        await pool.query("UPDATE ad_cloud_jobs SET status=$1,note=$2,finished_at=NOW(),available_at=NOW()+INTERVAL '10 minutes' WHERE id=$3",[status,String(scan.note||'').slice(0,2000),job.id]);
        log('[ad-cloud-capture]',JSON.stringify({brand:job.brand,status,captured:scan.captured||0}));
        if(adLibrarySource(job.source_json))break;
      }
      const analysis=await analyzeNextCloudCandidate(pool,sources,owner,{env,analyze});
      const status=await getCloudStatus(pool,{env});
      log('[ad-cloud-worker]',JSON.stringify({mode:'cloud',analysis:analysis.status,vision_configured:status.vision_configured,candidates:status.candidates,calls_today:status.calls_today,scheduled_day:localCloudTime().day}));
      return {scan,analysis};
    }catch(e){log('[ad-cloud-worker]',JSON.stringify({status:'error',code:/^CLOUD_[A-Z_]+$/.test(e.message)?e.message:'WORKER_ERROR'}));return {status:'error'}}
    finally{try{if(lease)await pool.query('UPDATE ad_cloud_control SET lease_owner=NULL,lease_until=NULL,heartbeat_at=NOW() WHERE id=1 AND lease_owner=$1',[owner])}finally{running=false}}
  };
}
export function registerCloudRoutes(app,pool,sources){
  app.post('/api/ad-visuals/scan',async(req,res,next)=>{
    if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli'});
    try{const origin=req.get('origin');if(origin&&new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Geçersiz kaynak'})}catch{return res.status(403).json({error:'Geçersiz kaynak'})}
    try{const result=await queueCloudReview(pool,sources,{manual:true});if(result.rate_limited)return res.status(429).json({error:'Yeni bulut taraması için 5 dakika bekleyin.'});res.status(202).json({...result,message:'Tarama sunucu kuyruğuna alındı; sayfayı kapatabilirsiniz.'})}catch(e){next(e)}
  });
}
