import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, pool } from './db.js';
import { scanAll } from './scanner.js';
import { buildMarketPulse } from './intelligence.js';
import { getKktcellCatalog, warmKktcellCatalog } from './kktcell-benchmark.js';
import { currentBenchmark } from './live-benchmark.js';
import { ENGINE_VERSION } from './comparable-engine.js';
import { persistBenchmarkHistory, buildBenchmarkHistoryPayload } from './benchmark-history.js';
import { generateReportPdf } from './report-render.js';
import { generateEvidencePack } from './evidence-pack.js';
import { getReportEmailStatus, sendReportEmail } from './report-email.js';
import { sendPersonalReportEmail } from './manual-report-email.js';
import { getHomeInternetMarket, scanHomeInternet, HOME_INTERNET_SOURCES } from './home-internet.js';
import { registerAuth, bootstrapInitialUsers } from './auth.js';
import { registerEvidenceRoutes } from './evidence-archive.js';
import { reportDays } from './report-data.js';
import {registerSocialWatchRoutes} from './social-watch.js';
import {registerAdVisualRoutes,syncAdVisuals} from './ad-visual.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));

registerAuth(app,pool,path.join(__dirname,'..','public'));
registerSocialWatchRoutes(app,pool,HOME_INTERNET_SOURCES);
registerAdVisualRoutes(app,pool,HOME_INTERNET_SOURCES);

const localMidnightSql = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Famagusta') AT TIME ZONE 'Asia/Famagusta')`;
const latestPackagesSql = `SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,
  s.slug source_slug,s.name source_name,s.url source_url,
  v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json
  FROM products p JOIN sources s ON s.id=p.source_id
  LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE`;

async function buildCurrentBenchmark(force=false,{persist=true}={}){
  const benchmark=await currentBenchmark(pool,{refresh:force});
  const sourcesHealthy=benchmark.kktcell_sources.length>0&&benchmark.kktcell_sources.every(s=>s.ok);
  let history_capture={persisted:false,reason:null};
  if(persist){
    if(!sourcesHealthy) history_capture={persisted:false,reason:'KKTCELL source health is not fully green'};
    else if(!benchmark.total_matches) history_capture={persisted:false,reason:'No comparable SKU matches'};
    else history_capture=await persistBenchmarkHistory(pool,benchmark);
  }
  return {...benchmark,history_capture};
}

async function captureBenchmarkHistory(forceCatalog=false){
  const benchmark=await buildCurrentBenchmark(forceCatalog,{persist:true});
  console.log('[benchmark-history]',JSON.stringify({
    persisted:benchmark.history_capture?.persisted||false,
    bucket_at:benchmark.history_capture?.bucket_at||null,
    engine_version:benchmark.engine_version,mode:benchmark.mode,
    matches:benchmark.total_matches,secondary_matches:benchmark.secondary_matches.length,
    matching:benchmark.matching,
    segments:benchmark.segment_scores.map(s=>({segment:s.segment,score:s.score,level:s.level,matches:s.match_count,reason:s.score==null?s.rationale:null})),
    overall_score:benchmark.overall_score?.score??null,
    reason:benchmark.history_capture?.reason||null
  }));
  return benchmark;
}

async function logReportRun(data){
  try{
    await pool.query(`INSERT INTO report_runs(report_type,period_start,period_end,trigger_type,delivery_status,recipients,sent_at,file_name,file_size_bytes,error,meta_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,[
      data.report_type,data.period_start||null,data.period_end||null,data.trigger_type||'manual',data.delivery_status||'generated',
      data.recipients||null,data.sent_at||null,data.file_name||null,data.file_size_bytes||null,data.error||null,JSON.stringify(data.meta_json||{})
    ]);
  }catch(e){console.error('report run logging failed',e)}
}

async function scheduledReportEmail(type){
  const status=getReportEmailStatus();
  if(!status.configured){console.log('[report-email]',type,'skipped: email not configured');return;}
  try{
    const result=await sendReportEmail(pool,type,{days:type==='daily'?1:7});
    await logReportRun({report_type:type,period_start:result.ctx.period_start,period_end:result.ctx.period_end,trigger_type:'scheduled',delivery_status:'sent',recipients:result.recipients,sent_at:new Date(),file_size_bytes:result.total_bytes,meta_json:{subject:result.subject,message_id:result.message_id}});
    console.log('[report-email]',type,'sent',result.recipients.join(','));
  }catch(e){
    await logReportRun({report_type:type,trigger_type:'scheduled',delivery_status:'error',error:e?.message||String(e)});
    console.error('[report-email]',type,'failed',e);
  }
}

app.get('/api/health', async (req,res)=>{
  try { await pool.query('SELECT 1'); res.json({ok:true,now:new Date().toISOString()}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/market-pulse', async (req,res,next)=>{try{
  const days=Math.max(1,Math.min(180,parseInt(req.query.days||'30',10)||30));
  res.json(await buildMarketPulse(pool,days));
}catch(e){next(e)}});

app.get('/api/home-internet', async (req,res,next)=>{try{
  const refresh=req.query.refresh==='1';
  res.json(await getHomeInternetMarket(pool,{refresh}));
}catch(e){next(e)}});

app.post('/api/home-internet/scan', async (req,res,next)=>{try{
  const scan=await scanHomeInternet(pool);
  res.json({scan,market:await getHomeInternetMarket(pool)});
}catch(e){next(e)}});

app.get('/api/home-internet/changes', async (req,res,next)=>{try{
  const days=Math.max(1,Math.min(180,parseInt(req.query.days||'30',10)||30));
  const r=await pool.query(`SELECT * FROM home_internet_changes WHERE detected_at>=NOW()-($1::text||' days')::interval ORDER BY detected_at DESC,id DESC LIMIT 500`,[days]);
  res.json({generated_at:new Date().toISOString(),days,rows:r.rows});
}catch(e){next(e)}});

app.get('/api/kktcell-catalog', async (req,res,next)=>{try{
  const force=req.query.refresh==='1';
  const catalog=await getKktcellCatalog(force);
  res.json({generated_at:new Date(catalog.at).toISOString(),sources:catalog.sources,error:catalog.error,products:catalog.rows});
}catch(e){next(e)}});

app.get('/api/benchmark', async (req,res,next)=>{try{
  const force=req.query.refresh==='1';
  res.json(await buildCurrentBenchmark(force,{persist:true}));
}catch(e){next(e)}});

app.get('/api/benchmark-history', async (req,res,next)=>{try{
  const days=Math.max(1,Math.min(180,parseInt(req.query.days||'90',10)||90));
  const queryDays=Math.min(182,Math.max(days+2,92));
  const r=await pool.query(`SELECT bucket_at,captured_at,segment,score,level,confidence,match_count,
    kktcell_advantage_count,telsim_advantage_count,parity_count,avg_value_gap_pct,avg_match_score,rationale,details_json
    FROM competitive_position_history
    WHERE bucket_at >= NOW()-($1::text||' days')::interval AND details_json->>'engine_version'=$2
    ORDER BY segment,bucket_at`,[queryDays,ENGINE_VERSION]);
  res.json({...buildBenchmarkHistoryPayload(r.rows,days),engine_version:ENGINE_VERSION,history_note:'Motor geçişinden önceki skorlar korunur; bu grafik yalnız v2.4 canlı motorun skorlarını gösterir.'});
}catch(e){next(e)}});

app.get('/api/summary', async (req,res,next)=>{try{
  const src=await pool.query(`SELECT s.*,
    (SELECT started_at FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_checked_at,
    (SELECT status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_status,
    (SELECT http_status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) http_status,
    (SELECT response_ms FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) response_ms,
    (SELECT parsed_count FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) parsed_count,
    (SELECT error FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_error,
    (SELECT detected_at FROM changes c WHERE c.source_id=s.id ORDER BY c.id DESC LIMIT 1) last_change_at,
    (SELECT COUNT(*)::int FROM products p WHERE p.source_id=s.id AND p.active=TRUE) active_products
    FROM sources s ORDER BY s.id`);
  const ch=await pool.query("SELECT COUNT(*)::int c FROM changes WHERE detected_at >= NOW()-INTERVAL '24 hours'");
  const today=await pool.query(`SELECT COUNT(*)::int c FROM changes WHERE detected_at >= ${localMidnightSql}`);
  const ap=await pool.query('SELECT COUNT(*)::int c FROM products WHERE active=TRUE');
  res.json({generated_at:new Date().toISOString(),sources:src.rows,active_products:ap.rows[0].c,changes_24h:ch.rows[0].c,changes_today:today.rows[0].c});
}catch(e){next(e)}});

app.get('/api/packages', async (req,res,next)=>{try{
  const params=[]; let where='';
  if(req.query.source){params.push(req.query.source);where='WHERE s.slug=$1'}
  res.json((await pool.query(`${latestPackagesSql} ${where} ORDER BY s.id,p.active DESC,v.price_try ASC NULLS LAST,p.current_name`,params)).rows);
}catch(e){next(e)}});

app.get('/api/comparison', async (req,res,next)=>{try{
  const r=await pool.query(`SELECT
    p.id,p.active,p.current_name,s.slug source_slug,s.name source_name,s.url source_url,
    cur.id current_version_id,cur.captured_at current_captured_at,cur.name current_name_version,
    cur.data_gb current_data_gb,cur.bonus_data_gb current_bonus_data_gb,cur.local_tr_minutes current_local_tr_minutes,
    cur.international_minutes current_international_minutes,cur.sms current_sms,cur.validity_days current_validity_days,cur.price_try current_price_try,
    prev.id previous_version_id,prev.captured_at previous_captured_at,prev.name previous_name,
    prev.data_gb previous_data_gb,prev.bonus_data_gb previous_bonus_data_gb,prev.local_tr_minutes previous_local_tr_minutes,
    prev.international_minutes previous_international_minutes,prev.sms previous_sms,prev.validity_days previous_validity_days,prev.price_try previous_price_try
    FROM products p
    JOIN sources s ON s.id=p.source_id
    JOIN LATERAL (SELECT * FROM product_versions v WHERE v.product_id=p.id ORDER BY v.captured_at DESC,v.id DESC LIMIT 1) cur ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM product_versions v WHERE v.product_id=p.id AND v.captured_at < ${localMidnightSql} ORDER BY v.captured_at DESC,v.id DESC LIMIT 1) prev ON TRUE
    WHERE p.active=TRUE OR p.last_seen_at >= ${localMidnightSql}
    ORDER BY s.id,cur.price_try ASC NULLS LAST,cur.name`);
  const numeric=['data_gb','bonus_data_gb','local_tr_minutes','international_minutes','sms','validity_days','price_try'];
  const rows=r.rows.map(x=>{
    const diffs={};
    for(const f of numeric){
      const a=x[`previous_${f}`], b=x[`current_${f}`];
      const an=a==null?null:Number(a), bn=b==null?null:Number(b);
      diffs[f]={old:an,new:bn,delta:(an==null||bn==null)?null:bn-an,pct:(an&&bn!=null)?((bn-an)/an)*100:null};
    }
    const changed=Object.values(diffs).some(d=>d.old!==d.new) || (x.previous_name!=null && x.previous_name!==x.current_name_version);
    return {...x,diffs,changed};
  });
  res.json({generated_at:new Date().toISOString(),cutoff:'local-midnight-Asia/Famagusta',rows});
}catch(e){next(e)}});

app.get('/api/value-index', async (req,res,next)=>{try{
  const r=await pool.query(`SELECT p.id,p.current_name,s.slug source_slug,s.name source_name,
    v.captured_at,v.name,v.data_gb,v.price_try,
    CASE WHEN v.price_try>0 AND v.data_gb>0 THEN ROUND((v.data_gb/v.price_try*100)::numeric,2) END gb_per_100tl,
    CASE WHEN v.price_try>0 AND v.data_gb>0 THEN ROUND((v.price_try/v.data_gb)::numeric,2) END tl_per_gb
    FROM products p JOIN sources s ON s.id=p.source_id
    JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE
    WHERE p.active=TRUE AND v.price_try>0 AND v.data_gb>0
    ORDER BY (v.data_gb/v.price_try) DESC, v.price_try ASC`);
  res.json(r.rows.map((x,i)=>({...x,rank:i+1})));
}catch(e){next(e)}});

app.get('/api/timeline', async (req,res,next)=>{try{
  const days=Math.max(1,Math.min(180,parseInt(req.query.days||'30',10)||30));
  const r=await pool.query(`SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,p.current_name product_name
    FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id
    WHERE c.detected_at >= NOW()-($1::text||' days')::interval
    ORDER BY c.detected_at DESC,c.id DESC LIMIT 300`,[days]);
  res.json(r.rows);
}catch(e){next(e)}});

app.get('/api/changes', async (req,res,next)=>{try{
  const limit=Math.max(1,Math.min(250,parseInt(req.query.limit||'80',10)||80));
  const r=await pool.query(`SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,p.current_name product_name
    FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id
    ORDER BY c.detected_at DESC,c.id DESC LIMIT $1`,[limit]);
  res.json(r.rows);
}catch(e){next(e)}});

app.get('/api/scans', async (req,res,next)=>{try{
  const limit=Math.max(1,Math.min(250,parseInt(req.query.limit||'30',10)||30));
  const r=await pool.query(`SELECT sc.*,s.slug source_slug,s.name source_name,s.url source_url FROM scans sc JOIN sources s ON s.id=sc.source_id ORDER BY sc.id DESC LIMIT $1`,[limit]);
  res.json(r.rows);
}catch(e){next(e)}});

app.get('/api/product/:id/history', async (req,res,next)=>{try{
  res.json((await pool.query(`SELECT * FROM product_versions WHERE product_id=$1 ORDER BY captured_at DESC,id DESC LIMIT 200`,[req.params.id])).rows);
}catch(e){next(e)}});

registerEvidenceRoutes(app,pool);

app.get('/api/reports/status', async (req,res,next)=>{try{
  const r=await pool.query('SELECT id,report_type,period_start,period_end,generated_at,trigger_type,delivery_status,recipients,sent_at,file_name,file_size_bytes,error,meta_json FROM report_runs ORDER BY generated_at DESC LIMIT 30');
  res.json({email:getReportEmailStatus(),recent_runs:r.rows});
}catch(e){next(e)}});

app.get('/api/reports/:type/download', async (req,res,next)=>{try{
  const type=String(req.params.type||'');
  if(!['daily','weekly','monthly','telsim7','evidence','home','fwa'].includes(type)) return res.status(400).json({error:'Unknown report type'});
  const result=type==='evidence'?await generateEvidencePack(pool,{days:7}):await generateReportPdf(pool,type,{days:reportDays(type)});
  await logReportRun({report_type:type,period_start:result.ctx.period_start,period_end:result.ctx.period_end,trigger_type:'manual',delivery_status:'generated',file_name:result.fileName,file_size_bytes:result.buffer.length,meta_json:{download:true}});
  const payload=Buffer.isBuffer(result.buffer)?result.buffer:Buffer.from(result.buffer);res.set('Content-Type',result.contentType);res.set('Content-Disposition','attachment; filename="'+result.fileName+'"');res.set('Content-Length',String(payload.length));res.set('Cache-Control','no-store');res.end(payload);
}catch(e){next(e)}});

app.post('/api/reports/:type/email', async (req,res,next)=>{try{
  const type=String(req.params.type||'');
  if(!['daily','weekly','monthly','telsim7','evidence','home','fwa'].includes(type)) return res.status(400).json({error:'Unknown report type'});
  const result=await sendPersonalReportEmail(pool,type,req.appUser?.email,{days:reportDays(type)});
  await logReportRun({report_type:type,period_start:result.ctx.period_start,period_end:result.ctx.period_end,trigger_type:'manual',delivery_status:'sent',recipients:result.recipients,sent_at:new Date(),file_size_bytes:result.total_bytes,meta_json:{subject:result.subject,message_id:result.message_id,recipient_mode:'manual-user',user_id:req.appUser?.id||null}});
  res.json({ok:true,recipients:result.recipients,delivery_to:result.delivery_to,subject:result.subject,message_id:result.message_id,total_bytes:result.total_bytes});
}catch(e){
  const status=e?.code==='PERSONAL_EMAIL_REQUIRED'?400:e?.code==='EMAIL_NOT_CONFIGURED'?503:e?.code==='ATTACHMENT_TOO_LARGE'?413:500;
  await logReportRun({report_type:req.params.type,trigger_type:'manual',delivery_status:'error',error:e?.message||String(e),meta_json:{recipient_mode:'manual-user',user_id:req.appUser?.id||null}});
  res.status(status).json({error:e?.message||String(e),code:e?.code||null});
}});

app.post('/api/scan', async (req,res,next)=>{try{res.json(await scanAll())}catch(e){next(e)}});

app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));
app.use(express.static(path.join(__dirname,'..','public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err?.message||String(err)})});

const port=Number(process.env.PORT||3000);
await initDb();
await bootstrapInitialUsers(pool);
app.listen(port,()=>console.log(`Markets Pulse / Telsim Watch listening on ${port}`));
{
  const es=getReportEmailStatus();
  console.log('[report-email-config]',JSON.stringify({
    delivery_mode:es.delivery_mode,
    api_configured:es.api_configured,
    smtp_configured:es.smtp_configured,
    brevo_api_key_present:Boolean(String(process.env.BREVO_API_KEY||'').trim()),
    brevo_api_key_length:String(process.env.BREVO_API_KEY||'').trim().length,
    recipients:es.recipients.length,
    from:es.from
  }));
}
const timezone=process.env.TZ||'Asia/Famagusta';
const schedule=process.env.SCAN_CRON || '0 * * * *';
cron.schedule(schedule,()=>scanAll().catch(e=>console.error('scheduled scan failed',e)),{timezone});
cron.schedule('5 * * * *',()=>captureBenchmarkHistory(false).catch(e=>console.error('benchmark history capture failed',e)),{timezone});
cron.schedule(process.env.HOME_INTERNET_CRON||'12 * * * *',()=>scanHomeInternet(pool).catch(e=>console.error('home internet scan failed',e)),{timezone});
cron.schedule(process.env.REPORT_DAILY_CRON||'0 8 * * *',()=>scheduledReportEmail('daily'),{timezone});
cron.schedule(process.env.REPORT_WEEKLY_CRON||'15 8 * * 1',()=>scheduledReportEmail('weekly'),{timezone});
cron.schedule('7,22,37,52 * * * *',()=>syncAdVisuals(pool,HOME_INTERNET_SOURCES).catch(e=>console.error('ad visual sync failed',e)),{timezone});
setTimeout(()=>syncAdVisuals(pool,HOME_INTERNET_SOURCES).catch(e=>console.error('startup ad visual sync failed',e)),8000);
setTimeout(warmKktcellCatalog,1500);
setTimeout(()=>scanAll().catch(e=>console.error('startup scan failed',e)),5000);
setTimeout(()=>captureBenchmarkHistory(false).catch(e=>console.error('startup benchmark history failed',e)),25000);
setTimeout(()=>scanHomeInternet(pool).catch(e=>console.error('startup home internet scan failed',e)),45000);
if(process.env.REPORT_SMOKE_TEST==='1'){
  setTimeout(async()=>{
    for(const type of ['daily','weekly','home','fwa']){
      try{
        const r=await generateReportPdf(pool,type,{days:type==='daily'?1:7});
        console.log('[report-smoke]',JSON.stringify({type,ok:true,file_name:r.fileName,file_size_bytes:r.buffer.length,product_count:r.ctx.home?.products?.length||0,daily_fixed_products:r.ctx.daily_home?.fixed?.products?.length||0,daily_fixed_changes:r.ctx.daily_home?.fixed?.changes?.length||0,daily_fwa_products:r.ctx.daily_home?.fwa?.products?.length||0,daily_fwa_changes:r.ctx.daily_home?.fwa?.changes?.length||0}));
      }catch(e){console.error('[report-smoke]',JSON.stringify({type,ok:false,error:e?.message||String(e)}))}
    }
  },80000);
}
