import {createHash} from 'node:crypto';
import {socialDirectory} from './isp-registry.js';
import {adLibrarySource} from './ad-cloud-capture.js';
import {providerConfig,startProviderRun,getProviderRun,getProviderItems,fetchProviderImage} from './ad-provider-client.js';
import {normalizeProviderItem} from './ad-provider-normalize.js';

const ACTIVE = ['creating','running','importing','downloading'];
const ID = /^\d{5,30}$/;
const CLIENT = {startProviderRun,getProviderRun,getProviderItems,fetchProviderImage,normalizeProviderItem};
const sha = value => createHash('sha256').update(value).digest('hex');
const safeCode = error => /^(?:PROVIDER|MEDIA|CLOUD)_[A-Z0-9_]+$/.test(error?.code || error?.message || '') ? (error.code || error.message) : 'PROVIDER_OPERATION_FAILED';
const dayAt = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const after = (date,delay) => new Date(Math.min(Date.UTC(9999,11,31),+date+delay));
const delayFor = error => Math.max(60000,Number.isFinite(error?.retry_after_ms) && error.retry_after_ms>0 ? error.retry_after_ms : 60000);
const isRate = error => error?.http_status===429 || /RATE_LIMITED$/.test(safeCode(error));
const isAuth = error => [401,403,407,451].includes(error?.http_status) || /(?:AUTH_FAILED|ACCESS_DENIED)$/.test(safeCode(error));

async function transaction(pool,owner,assertLease,fn) {
  const db=pool.connect ? await pool.connect() : pool;
  try {await db.query('BEGIN');await assertLease(db,owner);const result=await fn(db);await db.query('COMMIT');return result;}
  catch(error) {await db.query('ROLLBACK');throw error;}
  finally {db.release?.();}
}
async function counts(db,jobId) {
  return (await db.query(`SELECT COUNT(DISTINCT ad_id)::int ads,COUNT(*)::int assets,
    COUNT(*) FILTER(WHERE status='captured')::int captured,
    COUNT(*) FILTER(WHERE status IN ('pending','retry'))::int pending,
    COUNT(*) FILTER(WHERE status='missing')::int missing,
    COUNT(*) FILTER(WHERE status='error')::int errors
    FROM ad_provider_assets WHERE job_id=$1`,[jobId])).rows[0];
}
async function finish(db,run,now) {
  const tally=await counts(db,run.job_id);
  if(tally.pending){await db.query('UPDATE ad_provider_runs SET updated_at=$2 WHERE job_id=$1',[run.job_id,now]);return {...tally,status:'downloading',job_id:run.job_id};}
  const complete=run.coverage_complete && !run.coverage_denied && run.source_exhausted && !run.limit_reached && !run.rows_rejected && !tally.missing && !tally.errors && run.expected_ads!=null && run.expected_ads===tally.ads;
  const state=complete ? 'complete' : 'partial';
  const jobStatus=complete && tally.ads===0 ? 'no_ads' : 'partial';
  const note=`Sağlayıcıdan ${tally.ads} reklamda ${tally.assets} görsel kaydı bulundu; ${tally.captured} görsel arşivlendi, ${tally.missing+tally.errors} eksik/hatalı. `+
    (complete ? 'Sağlayıcının bildirdiği sonuçlar tamamlandı.' : 'Kaynak kapsamının tamamı doğrulanmadı; sonuçlar kısmi olarak gösteriliyor.');
  await db.query('UPDATE ad_provider_runs SET state=$2,updated_at=$3,finished_at=$3,coverage_complete=$4 WHERE job_id=$1',[run.job_id,state,now,complete]);
  await db.query('UPDATE ad_cloud_jobs SET status=$2,note=$3,finished_at=$4 WHERE id=$1',[run.job_id,jobStatus,note,now]);
  return {...tally,status:state,job_id:run.job_id,coverage_complete:complete};
}

/** One bounded provider operation per tick; external runs are never restarted by polling. */
export async function runProviderTick(pool,sources,{env=process.env,owner,assertLease,persistCapture,normalizeImage,now=()=>new Date(),client={}}={}) {
  const config=providerConfig(env),api={...CLIENT,...client};
  if(config.mode==='browser')return {status:'disabled'};
  if(!config.configured)return {status:'waiting_config',reason:config.code};
  if(typeof assertLease!=='function')throw new Error('PROVIDER_LEASE_REQUIRED');
  const clock=typeof now==='function' ? now : ()=>new Date(now);
  const atomic=fn=>transaction(pool,owner,assertLease,fn);
  const stamp=()=>new Date(clock());
  const readExpired=r=>r.state==='running' ? +stamp()-+new Date(r.created_at)>2*3600000 : r.state==='importing' && r.read_failed_at && +stamp()-+new Date(r.read_failed_at)>2*3600000;
  const markError=async(run,error,state='error')=>atomic(async db=>{
    const code=safeCode(error),at=stamp();
    await db.query('UPDATE ad_provider_runs SET state=$2,last_error=$3,updated_at=$4,finished_at=$4 WHERE job_id=$1',[run.job_id,state,code,at]);
    await db.query('UPDATE ad_cloud_jobs SET status=$2,note=$3,finished_at=$4 WHERE id=$1',[run.job_id,state==='start_unknown'?'blocked':'error',state==='start_unknown'?'Sağlayıcı başlatma yanıtı belirsiz; mükerrer ücret oluşmaması için yeni çalışma başlatılmadı.':'Sağlayıcı aktarımı tamamlanamadı: '+code+'. Arşivlenen kanıtlar korunuyor.',at]);
    return {status:state,reason:code,job_id:run.job_id};
  });
  const retryRead=async(run,error)=>{
    const expired=readExpired(run);
    if(isAuth(error) || expired || (!isRate(error) && run.poll_attempts>=2)) {
      if(run.state!=='importing')return markError(run,error);
      // Preserve metadata already imported from an incomplete/failed dataset read.
      return atomic(async db=>{
        const at=stamp(),code=expired?'PROVIDER_IMPORT_TIMEOUT':safeCode(error);
        await db.query("UPDATE ad_provider_runs SET state='downloading',coverage_denied=TRUE,coverage_complete=FALSE,last_error=$2,next_poll_at=$3,updated_at=$3 WHERE job_id=$1",[run.job_id,code,at]);
        return {status:'downloading',job_id:run.job_id,reason:code};
      });
    }
    return atomic(async db=>{
      const at=stamp(),retryAt=after(at,isRate(error)?delayFor(error):60000*Math.pow(2,run.poll_attempts));
      await db.query('UPDATE ad_provider_runs SET poll_attempts=poll_attempts+1,last_error=$2,next_poll_at=$3,updated_at=$4,read_failed_at=COALESCE(read_failed_at,$4) WHERE job_id=$1',[run.job_id,safeCode(error),retryAt,at]);
      return {status:'waiting_provider',reason:safeCode(error),retry_at:retryAt.toISOString(),job_id:run.job_id};
    });
  };

  const active=(await pool.query(`SELECT r.*,j.brand,j.source_json FROM ad_provider_runs r JOIN ad_cloud_jobs j ON j.id=r.job_id
    WHERE r.state=ANY($1::text[]) ORDER BY r.updated_at,r.job_id`,[ACTIVE])).rows;
  let run=active.find(r=>r.state==='creating' || readExpired(r) || +new Date(r.next_poll_at)<=+stamp());
  const waiting=()=>({status:'waiting_provider',job_id:active[0].job_id,retry_at:new Date(Math.min(...active.map(r=>+new Date(r.next_poll_at)))).toISOString()});
  if(!run) {
    // At most one extra supplier run can progress while another source honors its wait period.
    if(active.length>=2)return waiting();
    const directory=socialDirectory(sources);
    const eligible=(await pool.query(`SELECT j.* FROM ad_cloud_jobs j LEFT JOIN ad_provider_runs r ON r.job_id=j.id
      WHERE r.job_id IS NULL AND j.status IN ('queued','retry') AND j.available_at<=$1 AND j.attempts<3
      AND NOT EXISTS(SELECT 1 FROM ad_provider_runs old JOIN ad_cloud_jobs prior ON prior.id=old.job_id
        WHERE prior.source_json->>'page_id'=j.source_json->>'page_id' AND old.state IN ('creating','start_unknown','running','importing','downloading')) ORDER BY j.id`,[stamp()])).rows;
    const job=eligible.find(j=>ID.test(String(j.source_json?.page_id || '')) && directory.some(s=>s.brand===j.brand && s.page_id===j.source_json.page_id));
    if(!job)return active.length?waiting():{status:'idle'};
    const reserved=await atomic(async db=>{
      const at=stamp(),day=dayAt(at);
      await db.query('INSERT INTO ad_provider_budget(day) VALUES($1) ON CONFLICT DO NOTHING',[day]);
      const budget=(await db.query('SELECT reserved_usd FROM ad_provider_budget WHERE day=$1 FOR UPDATE',[day])).rows[0];
      if(Number(budget.reserved_usd)+config.maxRunUsd>config.dailyBudgetUsd+0.0000001)return false;
      const inserted=await db.query(`INSERT INTO ad_provider_runs(job_id,state,max_run_usd,created_at,updated_at,next_poll_at)
        VALUES($1,'creating',$2,$3,$3,$3) ON CONFLICT DO NOTHING RETURNING job_id`,[job.id,config.maxRunUsd,at]);
      if(!inserted.rows.length)return false;
      await db.query('UPDATE ad_provider_budget SET reserved_usd=reserved_usd+$2,starts=starts+1 WHERE day=$1',[day,config.maxRunUsd]);
      await db.query("UPDATE ad_cloud_jobs SET status='running',attempts=attempts+1,started_at=$2,note='Reklam sağlayıcısında çalışma başlatılıyor.' WHERE id=$1",[job.id,at]);
      return true;
    });
    if(!reserved)return {status:'daily_budget',reason:'PROVIDER_DAILY_BUDGET',job_id:job.id};
    run={job_id:job.id,brand:job.brand,source_json:job.source_json};
    let result;
    try {result=await api.startProviderRun(job.source_json,{env});}
    catch(error) {return markError(run,error,error?.ambiguous?'start_unknown':'error');}
    // Failure to persist an accepted run leaves the creation fence intact. Never issue another POST.
    return atomic(async db=>{
      const at=stamp();
      await db.query("UPDATE ad_provider_runs SET state='running',run_id=$2,dataset_id=$3,usage_usd=$4,updated_at=$5,next_poll_at=$6 WHERE job_id=$1",[job.id,result.id,result.defaultDatasetId,result.usageTotalUsd,at,after(at,15000)]);
      await db.query("UPDATE ad_cloud_jobs SET note='Reklam sağlayıcısı çalışıyor; sayfayı kapatabilirsiniz.' WHERE id=$1",[job.id]);
      return {status:'running',job_id:job.id};
    });
  }
  if(run.state==='creating')return markError(run,{code:'PROVIDER_START_UNKNOWN'},'start_unknown');
  // Expiry is a local state transition and never shortens a supplier Retry-After by issuing another request.
  if(readExpired(run)) {
    if(run.state==='running')return markError(run,{code:'PROVIDER_RUN_TIMEOUT'});
    return retryRead(run,{code:'PROVIDER_IMPORT_TIMEOUT'});
  }
  if(+new Date(run.next_poll_at)>+stamp())return {status:'waiting_provider',job_id:run.job_id,retry_at:new Date(run.next_poll_at).toISOString()};
  if(run.state==='running') {
    // The supplier run has its own 15-minute timeout. Polling cannot spend on a replacement run.
    if(+stamp()-+new Date(run.created_at)>2*3600000)return markError(run,{code:'PROVIDER_RUN_TIMEOUT'});
    let result;
    try {result=await api.getProviderRun(run.run_id,{env});}
    catch(error) {return retryRead(run,error);}
    const failed=['FAILED','TIMED-OUT','ABORTED'].includes(result.status);
    if(failed && !result.defaultDatasetId)return markError(run,{code:'PROVIDER_RUN_'+result.status.replace(/-/g,'_')});
    if(result.status==='SUCCEEDED' && !result.defaultDatasetId)return markError(run,{code:'PROVIDER_DATASET_MISSING'});
    return atomic(async db=>{
      const at=stamp(),state=result.status==='SUCCEEDED' || failed?'importing':'running';
      const limited=result.usageTotalUsd!=null && result.usageTotalUsd>=Number(run.max_run_usd);
      await db.query('UPDATE ad_provider_runs SET state=$2,dataset_id=COALESCE($3,dataset_id),usage_usd=$4,limit_reached=limit_reached OR $5,poll_attempts=0,last_error=$8,coverage_denied=coverage_denied OR $9,next_poll_at=$6,updated_at=$7,read_failed_at=NULL WHERE job_id=$1',[run.job_id,state,result.defaultDatasetId,result.usageTotalUsd,limited,state==='running'?after(at,30000):at,at,failed?'PROVIDER_RUN_'+result.status.replace(/-/g,'_'):null,failed]);
      return {status:state,job_id:run.job_id};
    });
  }
  if(run.state==='importing') {
    let page;
    try {page=await api.getProviderItems(run.dataset_id,{offset:run.dataset_offset,limit:20,env});}
    catch(error) {return retryRead(run,error);}
    const normalized=page.items.map(item=>{
      try {return api.normalizeProviderItem(item,run.source_json);}
      catch {return {kind:'invalid',assets:[],error:'PROVIDER_ITEM_INVALID'};}
    });
    return atomic(async db=>{
      const at=stamp();let rejected=0,expected=run.expected_ads,complete=run.coverage_complete,denied=run.coverage_denied,lastError=run.last_error;
      for(const row of normalized) {
        if(row.expected_count!=null)expected=expected==null?row.expected_count:Math.max(expected,row.expected_count);
        if(row.complete===false)denied=true;
        if(row.complete===true)complete=true;
        if(row.kind==='summary')continue;
        if(row.kind!=='ad' || row.page_id!==String(run.source_json.page_id) || !ID.test(row.ad_id) || !Array.isArray(row.assets) || row.assets.length>1000) {rejected++;lastError=row.error || 'PROVIDER_ITEM_INVALID';denied=true;continue;}
        for(const asset of row.assets) {
          if(!/^[a-zA-Z0-9_-]{1,40}$/.test(asset.variant_id || '') || !['image','video_preview'].includes(asset.kind) || !Array.isArray(asset.urls)) {rejected++;lastError='PROVIDER_ASSET_INVALID';continue;}
          const key=[row.page_id,row.ad_id,asset.variant_id].join(':'),missing=!asset.urls.length;
          const payload={brand:run.brand,page_id:row.page_id,ad_id:row.ad_id,variant_id:asset.variant_id,source_url:adLibrarySource(run.source_json),
            ad_status:row.ad_status,started_on:row.started_on,ad_text:asset.ad_text || row.ad_text || '',has_video:asset.kind==='video_preview',media_kind:asset.kind,media:{kind:asset.kind,urls:asset.urls}};
          await db.query(`INSERT INTO ad_provider_assets(job_id,asset_key,page_id,ad_id,variant_id,payload,source_url,media_kind,status,last_error,created_at,updated_at,available_at)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$11,$11) ON CONFLICT(job_id,asset_key) DO NOTHING`,
          [run.job_id,key,row.page_id,row.ad_id,asset.variant_id,JSON.stringify(payload),asset.urls[0] || null,asset.kind,missing?'missing':'pending',missing?'MEDIA_URL_MISSING':null,at]);
        }
      }
      const offset=page.offset+page.count,exhausted=offset===page.total;
      await db.query(`UPDATE ad_provider_runs SET dataset_offset=$2,item_count=$3,expected_ads=$4,rows_imported=rows_imported+$5,
        rows_rejected=rows_rejected+$6,source_exhausted=$7,coverage_complete=$8,state=$9,last_error=$10,poll_attempts=0,updated_at=$11,next_poll_at=$11,coverage_denied=$12,read_failed_at=NULL WHERE job_id=$1`,
      [run.job_id,offset,page.total,expected,page.count,rejected,exhausted,complete && !denied,exhausted?'downloading':'importing',lastError,at,denied]);
      return {status:exhausted?'downloading':'importing',job_id:run.job_id,rows_imported:run.rows_imported+page.count,...await counts(db,run.job_id)};
    });
  }
  if(run.state==='downloading') {
    if(typeof persistCapture!=='function' || typeof normalizeImage!=='function')throw new Error('PROVIDER_CAPTURE_HELPER_REQUIRED');
    const deadline=Date.now()+90000;
    let processed=0;
    for(;processed<3 && Date.now()<deadline-25000;processed++) {
      const asset=(await pool.query("SELECT * FROM ad_provider_assets WHERE job_id=$1 AND status IN ('pending','retry') AND attempts<3 AND available_at<=$2 ORDER BY asset_key LIMIT 1",[run.job_id,stamp()])).rows[0];
      if(!asset)break;
      // Reserve the attempt before the request. Restarted downloads retain retry accounting.
      await atomic(async db=>{
        const at=stamp();
        await db.query("UPDATE ad_provider_assets SET status='retry',attempts=attempts+1,available_at=$3,updated_at=$4 WHERE job_id=$1 AND asset_key=$2",[run.job_id,asset.asset_key,after(at,60000),at]);
      });
      try {
        const image=await api.fetchProviderImage(asset.payload.media,{});
        const bytes=await normalizeImage(image);
        const at=stamp(),capturedAt=at.toISOString();
        if(!Buffer.isBuffer(bytes) || bytes.length>1500000 || bytes.length<3 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255)throw Object.assign(new Error('MEDIA_INVALID_JPEG'),{code:'MEDIA_INVALID_JPEG'});
        const {media,...payload}=asset.payload,evidence=[{bytes,sha256:sha(bytes),captured_at:capturedAt}];
        await atomic(async db=>{
          await persistCapture(db,{...payload,observed_at:capturedAt,evidence},{id:run.job_id,brand:run.brand,source_json:run.source_json});
          await db.query("UPDATE ad_provider_assets SET status='captured',evidence_sha256=$3,last_error=NULL,updated_at=$4 WHERE job_id=$1 AND asset_key=$2",[run.job_id,asset.asset_key,evidence[0].sha256,at]);
        });
      } catch(error) {
        if(safeCode(error)==='CLOUD_LEASE_LOST')throw error;
        const limited=isRate(error),terminal=isAuth(error) || (!limited && asset.attempts>=2) || /(?:URL_INVALID|TYPE_INVALID|TOO_LARGE|INVALID_JPEG|IMAGE_INVALID|DECODE|DIMENSIONS)/.test(safeCode(error));
        await atomic(async db=>{
          const at=stamp(),retryAt=after(at,limited?delayFor(error):60000*Math.pow(2,asset.attempts));
          await db.query('UPDATE ad_provider_assets SET status=$3,last_error=$4,available_at=$5,updated_at=$6 WHERE job_id=$1 AND asset_key=$2',[run.job_id,asset.asset_key,terminal?'error':'retry',safeCode(error),retryAt,at]);
          // A media host restriction pauses this source instead of trying another image/IP immediately.
          if(limited)await db.query('UPDATE ad_provider_runs SET next_poll_at=$2,last_error=$3,updated_at=$4 WHERE job_id=$1',[run.job_id,retryAt,safeCode(error),at]);
          if(isAuth(error)) {
            await db.query("UPDATE ad_provider_assets SET status='error',last_error='MEDIA_SOURCE_ACCESS_DENIED',updated_at=$2 WHERE job_id=$1 AND status IN ('pending','retry')",[run.job_id,at]);
            await db.query('UPDATE ad_provider_runs SET coverage_denied=TRUE,last_error=$2,updated_at=$3 WHERE job_id=$1',[run.job_id,safeCode(error),at]);
          }
        });
        if(limited || isAuth(error))break;
      }
    }
    return atomic(async db=>{
      const at=stamp();
      await db.query("UPDATE ad_provider_assets SET status='error',last_error=COALESCE(last_error,'MEDIA_RETRY_EXHAUSTED'),updated_at=$2 WHERE job_id=$1 AND status='retry' AND attempts>=3 AND available_at<=$2",[run.job_id,at]);
      return finish(db,run,at);
    });
  }
  return {status:'idle'};
}

export async function getProviderStatus(pool,{env=process.env,now=new Date()}={}) {
  const config=providerConfig(env),enabled=config.mode==='apify';
  const [budget,runs]=await Promise.all([
    pool.query('SELECT reserved_usd,starts FROM ad_provider_budget WHERE day=$1',[dayAt(now)]),
    pool.query(`SELECT DISTINCT ON(j.brand) r.*,j.brand,j.source_json->>'page_id' page_id,
      COUNT(DISTINCT a.ad_id)::int ads,COUNT(a.asset_key)::int assets,
      COUNT(*) FILTER(WHERE a.status='captured')::int captured,
      COUNT(*) FILTER(WHERE a.status IN ('pending','retry'))::int pending,
      COUNT(*) FILTER(WHERE a.status='missing')::int missing,
      COUNT(*) FILTER(WHERE a.status='error')::int errors
      FROM ad_provider_runs r JOIN ad_cloud_jobs j ON j.id=r.job_id LEFT JOIN ad_provider_assets a ON a.job_id=r.job_id
      GROUP BY r.job_id,j.brand,j.source_json ORDER BY j.brand,r.created_at DESC,r.job_id DESC`)
  ]);
  return {provider:'apify',enabled,configured:enabled && config.configured,code:config.code,
    message:!enabled?'Reklam sağlayıcısı seçilmedi.':!config.configured?'Reklam sağlayıcısı için bağlantı ve harcama sınırı bekleniyor.':'Reklamlar sağlayıcıdan buluta aktarılır; kapsam ve eksik görseller ayrıca izlenir.',
    daily_budget_usd:config.dailyBudgetUsd,reserved_today_usd:Number(budget.rows[0]?.reserved_usd || 0),starts_today:budget.rows[0]?.starts || 0,
    runs:runs.rows.map(r=>({job_id:r.job_id,brand:r.brand,page_id:r.page_id,state:r.state,ads:r.ads,assets:r.assets,captured:r.captured,pending:r.pending,missing:r.missing,errors:r.errors,
      rows_imported:r.rows_imported,rows_rejected:r.rows_rejected,source_exhausted:r.source_exhausted,coverage_complete:r.state==='complete',limit_reached:r.limit_reached,
      last_error:r.last_error,updated_at:r.updated_at}))};
}
