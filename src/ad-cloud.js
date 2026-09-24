import {randomUUID,createHash} from 'node:crypto';
import {socialDirectory} from './isp-registry.js';
import {captureCloudAds,adLibrarySource} from './ad-cloud-capture.js';
import {captureTransportStatus} from './ad-capture-proxy.js';
import {getProxyPoolStatus,selectCaptureProxy,recordProxyResult,canFailoverProxy} from './ad-proxy-pool.js';
import {analyzeCloudImage,visionConfig} from './ad-cloud-vision.js';
import {validateAdFeed,importAdFeed,getAdCategories} from './ad-visual.js';
import {AD_TAXONOMY_VERSION} from './ad-categories.js';
import {providerConfig,providerStatus} from './ad-provider-client.js';
import {runProviderTick,getProviderStatus} from './ad-provider-worker.js';
import {normalizeProviderJpeg} from './ad-provider-image.js';

export const CLOUD_SCHEDULE={enabled:true,description:'Bulutta her gün 06:00; Telsim ve sayfası doğrulanmış rakipler',timezone:'Asia/Famagusta',daily_at:'06:00'};
export function localCloudTime(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return {day:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)};
}
export function verifiedCloudSources(sources){
  const pages=new Set();
  return socialDirectory(sources).filter(adLibrarySource)
    .sort((a,b)=>Number(b.brand==='Telsim')-Number(a.brand==='Telsim')||a.brand.localeCompare(b.brand,'tr'))
    .filter(source=>{
      // One advertiser page is one capture, even when several product brands use it.
      if(pages.has(source.page_id))return false;
      pages.add(source.page_id);return true;
    });
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
export async function queueNewCloudSources(pool,sources,owner){
  const directory=socialDirectory(sources),verified=verifiedCloudSources(sources);
  return transaction(pool,async db=>{
    await assertLease(db,owner);
    // Refresh old keyword shortcuts without changing brand identities, evidence,
    // verified page IDs, capture state or the provider's spend/creation fences.
    for(const source of directory.filter(source=>source.ad_library_search_name&&source.ad_library_type==='brand_search')){
      const patch={ad_library_search_name:source.ad_library_search_name,ad_library_url:source.ad_library_url,ad_library_type:source.ad_library_type};
      await db.query(`UPDATE ad_cloud_jobs SET source_json=source_json||$2::jsonb
        WHERE brand=$1 AND COALESCE(source_json->>'page_id','') !~ '^[0-9]{5,30}$'
        AND (source_json->>'ad_library_url' IS DISTINCT FROM $3 OR source_json->>'ad_library_search_name' IS DISTINCT FROM $4)`,
      [source.brand,JSON.stringify(patch),source.ad_library_url,source.ad_library_search_name]);
    }
    const added=[];
    for(const source of verified){
      // Historical unverified jobs do not mean this numeric page has been scanned.
      const seen=await db.query("SELECT id FROM ad_cloud_jobs WHERE source_json->>'page_id'=$1 AND status<>'imported' LIMIT 1",[source.page_id]);
      if(seen.rows.length)continue;
      const result=await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id",['source-'+source.page_id,source.brand,JSON.stringify(source)]);
      if(result.rows.length)added.push(source.brand);
    }
    return added;
  });
}
export async function queueProviderHandoff(pool,sources,owner,{env=process.env}={}){
  if(providerConfig(env).mode!=='apify')return {recovered:0,queued:0,brands:[]};
  const verified=verifiedCloudSources(sources);
  return transaction(pool,async db=>{
    await assertLease(db,owner);
    // The acquired worker lease proves these unowned browser captures were interrupted.
    // Provider creation fences, accepted runs, captured evidence and spend reservations stay intact.
    const recovered=await db.query(`UPDATE ad_cloud_jobs SET status=CASE WHEN attempts>=3 THEN 'error' ELSE 'retry' END,
      available_at=GREATEST(available_at,NOW()),note='Yarım kalan tarayıcı taraması sağlayıcıya geçiş için toparlandı; kaydedilmiş kanıtlar korundu.'
      WHERE status='running' AND source_json->>'page_id'=ANY($1::text[])
      AND NOT EXISTS(SELECT 1 FROM ad_provider_runs p WHERE p.job_id=ad_cloud_jobs.id) RETURNING id`,[verified.map(source=>source.page_id)]);
    const brands=[];
    for(const source of verified){
      // Any provider history includes ambiguous starts and must prevent a second bootstrap run.
      const history=await db.query(`SELECT p.job_id FROM ad_provider_runs p JOIN ad_cloud_jobs j ON j.id=p.job_id
        WHERE j.source_json->>'page_id'=$1 LIMIT 1`,[source.page_id]);
      if(history.rows.length)continue;
      // A future retry remains the source's existing queue entry; never shorten its wait.
      const queued=await db.query(`SELECT id FROM ad_cloud_jobs WHERE source_json->>'page_id'=$1
        AND status IN ('queued','retry') AND attempts<3 LIMIT 1`,[source.page_id]);
      if(queued.rows.length)continue;
      const result=await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,note)
        VALUES($1,$2,$3::jsonb,'Doğrulanmış reklam sayfası ilk sağlayıcı aktarımı için kuyruğa alındı.')
        ON CONFLICT(batch_key,brand) DO NOTHING RETURNING id`,['provider-source-'+source.page_id,source.brand,JSON.stringify(source)]);
      if(result.rows.length)brands.push(source.brand);
    }
    return {recovered:recovered.rows.length,queued:brands.length,brands};
  });
}
export async function queueCloudReview(pool,sources,{manual=false,now=new Date(),env=process.env}={}){
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
    // Unverified keyword searches cannot be captured and must not consume the
    // six daily competitor slots ahead of known advertiser pages.
    const directory=verifiedCloudSources(sources);
    const selected=[...directory.filter(x=>x.brand==='Telsim'),...directory.filter(x=>x.brand!=='Telsim').sort((a,b)=>(dates.get(a.brand)||0)-(dates.get(b.brand)||0)||Number(Boolean(b.page_id))-Number(Boolean(a.page_id))).slice(0,providerConfig(env).mode==='apify'?undefined:6)];
    const batch=manual?'manual-'+randomUUID():'daily-'+local.day;let queued=0;
    for(const source of selected){
      const active=await db.query("SELECT id FROM ad_cloud_jobs WHERE source_json->>'page_id'=$1 AND status IN ('queued','running','retry') LIMIT 1",[source.page_id]);
      if(active.rows.length)continue;
      const r=await db.query('INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id',[batch,source.brand,JSON.stringify(source)]);queued+=r.rows.length;
    }
    if(!manual)await db.query('UPDATE ad_cloud_control SET scheduled_day=$1 WHERE id=1',[local.day]);
    return {queued,batch_key:batch};
  });
}
export async function queueStoredAdReviews(pool,sources,{manual=false,key=null,now=new Date()}={}){
  return transaction(pool,async db=>{
    const control=(await db.query('SELECT * FROM ad_cloud_control WHERE id=1 FOR UPDATE')).rows[0];
    if(manual&&control.analysis_manual_after&&+new Date(control.analysis_manual_after)>+now)return {queued:0,rate_limited:true};
    if(manual)await db.query('UPDATE ad_cloud_control SET analysis_manual_after=$1 WHERE id=1',[new Date(+now+5*60000)]);
    const rows=(await db.query(`SELECT a.ad_key,a.analysis_json,c.ad_key candidate_key,c.review_round FROM ad_visual_items a
      LEFT JOIN ad_cloud_candidates c ON c.ad_key=a.ad_key
      WHERE ${key?'a.ad_key=$1':"a.category='review'"}
      AND (c.ad_key IS NULL OR (c.status IN ('analyzed'${manual?",'error'":''}) AND ${manual?'c.review_round<99':`(c.review_round<99 AND COALESCE(a.analysis_json->>'taxonomy_version','')<>'${AD_TAXONOMY_VERSION}' OR c.review_round<1 OR (c.review_round<2 AND a.analysis_json->>'category_evidence'='Kategori için açık ve doğrulanabilir ifade bulunamadı.'))`}))
      ORDER BY a.observed_at,a.ad_key LIMIT 400`,key?[key]:[])).rows;
    const directory=socialDirectory(sources);let queued=0,missing_evidence=0;
    for(const row of rows){
      const ad=row.analysis_json;
      if(row.candidate_key){
        await db.query("UPDATE ad_cloud_candidates SET status='pending',attempts=0,last_error=NULL,available_at=NOW(),analysis_json=NULL,review_round=review_round+1,payload=payload||$1::jsonb WHERE ad_key=$2",[JSON.stringify({previous_analysis:ad}),row.ad_key]);
      }else{
        // Historical reviewed cards also use the durable worker and their original evidence.
        const hashes=[...new Set((ad.images||[]).map(x=>x.sha256))];
        const stored=await db.query('SELECT sha256 FROM ad_visual_evidence WHERE sha256=ANY($1::text[])',[hashes]);
        if(!hashes.length||stored.rows.length!==hashes.length){missing_evidence++;continue}
        const source=directory.find(x=>x.brand===ad.brand);if(!source)continue;
        const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,finished_at,note) VALUES($1,$2,$3::jsonb,'imported',NOW(),'Arşivdeki görsel AI incelemesi için kuyruğa alındı.') ON CONFLICT(batch_key,brand) DO UPDATE SET batch_key=EXCLUDED.batch_key RETURNING id",['stored-review',ad.brand,JSON.stringify(source)])).rows[0];
        const payload={...ad,previous_analysis:ad};
        await db.query("INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,observed_at,review_round) VALUES($1,$2,$3,$4::jsonb,$5,1) ON CONFLICT DO NOTHING",[row.ad_key,job.id,hash(JSON.stringify({images:hashes,text:ad.ad_text})),JSON.stringify(payload),ad.observed_at]);
      }
      queued++;
    }
    return {queued,missing_evidence};
  });
}
// Shared transaction primitive: provider asset completion and capture commit together.
export async function persistCloudCapture(db,candidate,job){
  if(!candidate.evidence?.length||candidate.evidence.length>3||candidate.evidence.some(x=>!Buffer.isBuffer(x.bytes)||x.bytes.length>1500000||hash(x.bytes)!==x.sha256||x.bytes[0]!==255||x.bytes[1]!==216))throw new Error('CLOUD_INVALID_EVIDENCE');
  if(candidate.brand!==job.brand||candidate.page_id!==job.source_json.page_id||!/^\d{5,30}$/.test(candidate.ad_id)||!/^[-a-zA-Z0-9_]{1,40}$/.test(candidate.variant_id))throw new Error('CLOUD_IDENTITY_MISMATCH');
  const adKey=[candidate.page_id,candidate.ad_id,candidate.variant_id].join(':');
  const {evidence,...payload}=candidate;
  payload.images=evidence.map(x=>({sha256:x.sha256,path:'evidence/'+x.sha256+'.jpg',captured_at:x.captured_at,...(['creative','ad_card'].includes(x.role)?{role:x.role}:{})}));
  const fingerprint=hash(JSON.stringify({images:payload.images.map(x=>x.sha256),text:payload.ad_text}));
  for(const image of evidence)await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2) ON CONFLICT DO NOTHING',[image.sha256,image.bytes]);
  await db.query(`INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,observed_at) VALUES($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT(ad_key) DO UPDATE SET job_id=EXCLUDED.job_id,
    analysis_json=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.analysis_json ELSE NULL END,
    analyzed_at=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.analyzed_at ELSE NULL END,
    review_round=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.review_round ELSE 0 END,
    status=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.status ELSE 'pending' END,
    attempts=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.attempts ELSE 0 END,
    last_error=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.last_error ELSE NULL END,
    available_at=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.available_at ELSE NOW() END,
    payload=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.payload ELSE EXCLUDED.payload END,
    observed_at=CASE WHEN ad_cloud_candidates.fingerprint=EXCLUDED.fingerprint THEN ad_cloud_candidates.observed_at ELSE EXCLUDED.observed_at END,
    fingerprint=EXCLUDED.fingerprint`,[adKey,job.id,fingerprint,JSON.stringify(payload),candidate.observed_at]);
  const link=await db.query('INSERT INTO ad_cloud_capture_links(job_id,ad_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING ad_key',[job.id,adKey]);
  await db.query('UPDATE ad_cloud_jobs SET captured=(SELECT COUNT(*)::int FROM ad_cloud_capture_links WHERE job_id=$1) WHERE id=$1',[job.id]);
  return {ad_key:adKey,added:link.rows.length===1};
}
export async function saveCloudCapture(pool,candidate,job,owner){
  return transaction(pool,async db=>{await assertLease(db,owner);return persistCloudCapture(db,candidate,job)});
}
async function cloudCoverage(pool){
  const jobs=await pool.query("SELECT DISTINCT ON (brand) brand,source_json,status,created_at,finished_at,captured,note FROM ad_cloud_jobs WHERE status<>'imported' ORDER BY brand,created_at DESC,id DESC");
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
  await importAdFeed(pool,feed,{reanalysis:candidate.review_round>0,fetcher:async()=>{throw new Error('Cloud evidence missing')}});
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
      analysis=await analyze(candidate.payload,images,{env,categories:await getAdCategories(pool)});
      analysis={...analysis,ai_analysis:{status:'completed',analyzed_at:new Date().toISOString(),model:config.model,pass:(candidate.review_round||0)+1}};
      // Keep a successful response if publication fails; retrying must not buy the same inference again.
      await transaction(pool,async db=>{await assertLease(db,owner);await db.query('UPDATE ad_cloud_candidates SET analysis_json=$1::jsonb WHERE ad_key=$2 AND fingerprint=$3',[JSON.stringify(analysis),candidate.ad_key,candidate.fingerprint])});
    }
    await publishCloudAnalysis(pool,sources,candidate,analysis,owner);
    return {status:'analyzed',brand:candidate.payload.brand,ad_id:candidate.payload.ad_id,category:analysis.category,category_evidence_missing:analysis.category_evidence==='Kategori için açık ve doğrulanabilir ifade bulunamadı.',pass:analysis.ai_analysis?.pass||1};
  }catch(e){
    const code=/^(VISION_[A-Z0-9_]+|CLOUD_[A-Z0-9_]+)$/.test(e.message)?e.message:'VISION_VALIDATION_ERROR';
    await pool.query("UPDATE ad_cloud_candidates SET status=CASE WHEN attempts>=3 THEN 'error' ELSE 'retry' END,last_error=$1 WHERE ad_key=$2",[code,candidate.ad_key]);
    return {status:'error',code};
  }
}
export async function getCloudStatus(pool,{env=process.env,sources=[]}={}){
  const config=visionConfig(env);
  const [control,jobs,counts,errors,transport,provider]=await Promise.all([
    pool.query('SELECT heartbeat_at,vision_day,vision_calls,capture_after,scheduled_day FROM ad_cloud_control WHERE id=1'),
    pool.query("SELECT DISTINCT ON (brand) brand,status,captured,note,created_at,finished_at,available_at FROM ad_cloud_jobs WHERE status<>'imported' ORDER BY brand,created_at DESC,id DESC"),
    pool.query('SELECT status,count(*)::int count,MAX(analyzed_at) last_analyzed_at FROM ad_cloud_candidates GROUP BY status'),
    pool.query('SELECT last_error FROM ad_cloud_candidates WHERE last_error IS NOT NULL ORDER BY observed_at DESC LIMIT 1'),
    getProxyPoolStatus(pool,{env}),getProviderStatus(pool,{env})]);
  const row=control.rows[0]||{},heartbeat=row.heartbeat_at;
  return {mode:'cloud',schedule:{...CLOUD_SCHEDULE,last_scheduled_day:row.scheduled_day||null,verified_pages_count:verifiedCloudSources(sources).length},capture_transport:transport,capture_provider:provider,vision_configured:config.configured,
    analysis_status:config.configured?'configured':'waiting_config',
    message:!config.configured?'Bulut taraması etkin. Görsel analiz için sunucu API bağlantısı eksik; kaydedilen görseller kuyrukta bekler.':errors.rows.length?'Son görsel analizi tamamlanamadı. Kayıtlar kuyrukta korunuyor; servis bağlantısı ve kota kontrol edilmeli.':'Görseller sunucuda analiz edilir.',
    worker_heartbeat:heartbeat||null,worker_online:Boolean(heartbeat&&Date.now()-+new Date(heartbeat)<180000),
    calls_today:row.vision_day===localCloudTime().day?row.vision_calls:0,daily_limit:config.dailyLimit,capture_after:row.capture_after||null,
    candidates:Object.fromEntries(counts.rows.map(x=>[x.status,x.count])),sources:jobs.rows};
}
export function createCloudWorker(pool,sources,{capture=captureCloudAds,analyze=analyzeCloudImage,env=process.env,log=console.log,providerTick=runProviderTick}={}){
  let running=false,reportedSources=false;
  return async function tick(){
    if(running)return {status:'busy'};running=true;
    const owner=randomUUID();let lease=false;
    try{
      const lock=await pool.query("UPDATE ad_cloud_control SET lease_owner=$1,lease_until=NOW()+INTERVAL '10 minutes',heartbeat_at=NOW() WHERE id=1 AND (lease_until IS NULL OR lease_until<NOW()) RETURNING id",[owner]);
      if(!lock.rows.length)return {status:'busy'};lease=true;
      const provider=providerConfig(env);
      if(provider.mode==='apify'){
        const handoff=await queueProviderHandoff(pool,sources,owner,{env});
        if(handoff.recovered||handoff.queued)log('[ad-provider-handoff]',JSON.stringify(handoff));
      }
      const added=await queueNewCloudSources(pool,sources,owner);
      if(added.length)log('[ad-cloud-sources]',JSON.stringify({registered:added.length,brands:added}));
      await queueCloudReview(pool,sources,{env});
      const reviews=await queueStoredAdReviews(pool,sources);
      if(reviews.queued)log('[ad-cloud-review]',JSON.stringify(reviews));
      await pool.query("UPDATE ad_cloud_candidates SET status='error',last_error=COALESCE(last_error,'VISION_RETRY_EXHAUSTED') WHERE status='retry' AND attempts>=3 AND available_at<=NOW()");
      const transport=provider.mode==='apify'||provider.code?providerStatus(env):captureTransportStatus(env);
      let scan=transport.configured?null:{status:'waiting_config',reason:transport.code};
      if(provider.mode==='apify'){
        try{scan=await providerTick(pool,sources,{env,owner,assertLease,persistCapture:persistCloudCapture,normalizeImage:normalizeProviderJpeg})}
        catch(e){scan={status:'error',reason:/^PROVIDER_[A-Z_]+$/.test(e.code||'')?e.code:'PROVIDER_WORKER_ERROR'}}
        log('[ad-provider]',JSON.stringify(scan));
      }else{
      // Upgrade old HTTP 429 outcomes to bounded retries; hard access/challenge blocks stay blocked.
      const recovered=await pool.query(`UPDATE ad_cloud_jobs SET status='retry',available_at=GREATEST(NOW(),finished_at+INTERVAL '15 minutes')
        WHERE status='blocked' AND note LIKE '%HTTP 429%' AND attempts<3 AND created_at>NOW()-INTERVAL '2 days'
        AND id IN (SELECT MAX(id) FROM ad_cloud_jobs WHERE status<>'imported' GROUP BY brand) RETURNING available_at`);
      if(recovered.rows.length){
        const after=new Date(Math.max(...recovered.rows.map(x=>+new Date(x.available_at))));
        await pool.query('UPDATE ad_cloud_control SET capture_after=GREATEST(capture_after,$1) WHERE id=1',[after]);
      }
      // An interrupted capture resumes from persisted candidates and remains bounded to three tries.
      await pool.query("UPDATE ad_cloud_jobs SET status=CASE WHEN attempts>=3 THEN 'error' ELSE 'retry' END,available_at=NOW(),note='Sunucu yeniden başladı; tamamlanan görseller korundu.' WHERE status='running' AND NOT EXISTS (SELECT 1 FROM ad_provider_runs p WHERE p.job_id=ad_cloud_jobs.id)");
      await pool.query("UPDATE ad_cloud_jobs SET status='error' WHERE status='retry' AND attempts>=3 AND NOT EXISTS (SELECT 1 FROM ad_provider_runs p WHERE p.job_id=ad_cloud_jobs.id)");
      for(let n=0;transport.configured&&n<7;n++){
        const cooling=await pool.query('SELECT id FROM ad_cloud_control WHERE id=1 AND capture_after>NOW()');
        if(cooling.rows.length)break;
        const next=(await pool.query("SELECT * FROM ad_cloud_jobs WHERE status IN ('queued','retry') AND attempts<3 AND available_at<=NOW() AND NOT EXISTS (SELECT 1 FROM ad_provider_runs p WHERE p.job_id=ad_cloud_jobs.id) ORDER BY id LIMIT 1")).rows[0];
        if(!next)break;
        let selected=null;
        if(transport.mode==='proxy'&&adLibrarySource(next.source_json)){
          const choice=await selectCaptureProxy(pool,{env,pinnedKey:next.proxy_key});
          selected=choice.proxy;
          if(!selected){
            scan={status:'waiting_proxy',reason:choice.reason,retry_at:choice.retry_at};
            await transaction(pool,async db=>{
              await assertLease(db,owner);
              await db.query('UPDATE ad_cloud_jobs SET note=$2 WHERE id=$1',[next.id,choice.reason==='PROXY_PIN_MISSING'?'Bu taramada kullanılan proxy yapılandırmada bulunamadı; bağlantı ayarları bekleniyor.':'Proxy bağlantıları dinleniyor; tarama denemesi tüketilmeden kuyrukta bekliyor.']);
            });
            break;
          }
        }
        const job=await transaction(pool,async db=>{
          await assertLease(db,owner);
          return (await db.query("UPDATE ad_cloud_jobs SET status='running',attempts=attempts+1,started_at=NOW() WHERE id=$1 AND status IN ('queued','retry') AND attempts<3 RETURNING *",[next.id])).rows[0];
        });
        if(!job)break;
        const tried=[],deadline=Date.now()+110000;
        for(let attempt=0;attempt<2;attempt++){
          if(selected){
            tried.push(selected.key);
            await transaction(pool,async db=>{
              await assertLease(db,owner);
              await db.query('UPDATE ad_cloud_jobs SET proxy_key=$2,proxy_attempts=proxy_attempts+1 WHERE id=$1',[job.id,selected.key]);
            });
          }
          try{scan=await capture(job.source_json,c=>saveCloudCapture(pool,c,job,owner),{env,proxyConfig:selected||undefined,timeoutMs:Math.max(1,deadline-Date.now())})}
          catch{scan={status:'error',note:'Bulut tarayıcısı çalıştırılamadı; sonraki deneme kuyrukta.'}}
          // Saved evidence is authoritative even when a collector throws or reports zero.
          const saved=(await pool.query('SELECT captured FROM ad_cloud_jobs WHERE id=$1',[job.id])).rows[0]?.captured||0;
          scan.captured=Math.max(Number(scan.captured)||0,saved);
          if(!selected)break;
          scan.proxy_id=selected.id;
          await transaction(pool,async db=>{await assertLease(db,owner);await recordProxyResult(db,selected,scan)});
          if(!canFailoverProxy(scan,saved))break;
          // Only a confirmed transport outage before any evidence releases this pin.
          await transaction(pool,async db=>{await assertLease(db,owner);await db.query('UPDATE ad_cloud_jobs SET proxy_key=NULL WHERE id=$1',[job.id])});
          scan.status='error';
          if(attempt===1||Date.now()>=deadline-1000)break;
          const backup=await selectCaptureProxy(pool,{env,excludeKeys:tried});
          if(!backup.proxy)break;
          log('[ad-cloud-proxy-switch]',JSON.stringify({brand:job.brand,from:selected.id,to:backup.proxy.id,reason:'PROXY_CONNECTION_FAILED'}));
          selected=backup.proxy;
        }
        const limited=scan.status==='rate_limited';
        const status=(scan.status==='error'||limited)&&job.attempts<3?'retry':limited?'blocked':scan.status;
        const retryDelay=Number(scan.retry_after_ms);
        const delay=limited?Math.max(15*60000,Number.isFinite(retryDelay)?retryDelay:15*60000):10*60000;
        const availableAt=new Date(Math.min(Date.UTC(9999,11,31),Date.now()+delay));
        await transaction(pool,async db=>{
          await assertLease(db,owner);
          await db.query('UPDATE ad_cloud_jobs SET status=$1,note=$2,finished_at=NOW(),available_at=$4 WHERE id=$3',[status,String(scan.note||'').slice(0,2000),job.id,availableAt]);
          if(limited)await db.query('UPDATE ad_cloud_control SET capture_after=$1 WHERE id=1',[availableAt]);
        });
        log('[ad-cloud-capture]',JSON.stringify({brand:job.brand,transport:transport.mode,proxy_id:scan.proxy_id||null,proxy_attempts:tried.length,status,http_status:scan.http_status||null,reason:scan.reason||null,captured:scan.captured||0,retry_at:status==='retry'?availableAt.toISOString():null}));
        if(adLibrarySource(job.source_json))break;
      }
      }
      const analysis=await analyzeNextCloudCandidate(pool,sources,owner,{env,analyze});
      const status=await getCloudStatus(pool,{env,sources});
      if(!reportedSources){log('[ad-cloud-source-status]',JSON.stringify(status.sources.map(s=>({brand:s.brand,status:s.status,http_status:Number(s.note?.match(/HTTP (\d{3})/)?.[1])||null}))));reportedSources=true}
      log('[ad-cloud-worker]',JSON.stringify({mode:'cloud',capture_transport:transport.mode,capture_configured:transport.configured,capture_code:transport.code,proxy_count:status.capture_transport.proxy_count||0,proxy_available:status.capture_transport.available_count||0,scan_waiting:scan?.status?.startsWith('waiting')?scan.reason:null,analysis:analysis.status,code:analysis.code||null,brand:analysis.brand||null,category:analysis.category||null,category_evidence_missing:analysis.category_evidence_missing??null,pass:analysis.pass||null,vision_configured:status.vision_configured,candidates:status.candidates,calls_today:status.calls_today,scheduled_day:status.schedule.last_scheduled_day}));
      return {scan,analysis};
    }catch(e){log('[ad-cloud-worker]',JSON.stringify({status:'error',code:/^CLOUD_[A-Z_]+$/.test(e.message)?e.message:'WORKER_ERROR'}));return {status:'error'}}
    finally{try{if(lease)await pool.query('UPDATE ad_cloud_control SET lease_owner=NULL,lease_until=NULL,heartbeat_at=NOW() WHERE id=1 AND lease_owner=$1',[owner])}finally{running=false}}
  };
}
export function registerCloudRoutes(app,pool,sources){
  app.post('/api/ad-visuals/analyze',async(req,res,next)=>{
    if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli'});
    try{const origin=req.get('origin');if(origin&&new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Geçersiz kaynak'})}catch{return res.status(403).json({error:'Geçersiz kaynak'})}
    const key=req.body?.key??null;
    if(key!==null&&(typeof key!=='string'||!/^\d{5,30}:\d{5,30}:[a-zA-Z0-9_-]{1,40}$/.test(key)))return res.status(400).json({error:'Geçersiz reklam kaydı'});
    try{
      const result=await queueStoredAdReviews(pool,sources,{manual:true,key});
      if(result.rate_limited)return res.status(429).json({error:'Yeni AI incelemesi için 5 dakika bekleyin.'});
      res.status(202).json({...result,message:result.queued?result.queued+' kayıt AI inceleme kuyruğuna alındı. Kaydedilmiş görseller bulutta yeniden okunacak.':'Yeni kayıt eklenmedi; mevcut AI incelemeleri kuyrukta olabilir.'});
    }catch(e){next(e)}
  });
  app.post('/api/ad-visuals/scan',async(req,res,next)=>{
    if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli'});
    try{const origin=req.get('origin');if(origin&&new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Geçersiz kaynak'})}catch{return res.status(403).json({error:'Geçersiz kaynak'})}
    try{const result=await queueCloudReview(pool,sources,{manual:true});if(result.rate_limited)return res.status(429).json({error:'Yeni bulut taraması için 5 dakika bekleyin.'});const provider=providerStatus(),transport=provider.mode==='apify'||provider.code?provider:captureTransportStatus();res.status(202).json({...result,capture_transport:transport,message:transport.configured?'Tarama sunucu kuyruğuna alındı; sayfayı kapatabilirsiniz.':provider.mode==='apify'?'Tarama kuyruğa alındı; veri sağlayıcısı anahtarı ve harcama sınırları bekleniyor.':'Tarama kuyruğa alındı; proxy bağlantısı tamamlanınca sunucuda başlayacak.'})}catch(e){next(e)}
  });
}
