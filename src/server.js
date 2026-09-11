import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, pool } from './db.js';
import { scanAll } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));

function auth(req,res,next){
  const user=process.env.DASHBOARD_USER, pass=process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return next();
  const hdr=req.headers.authorization||'';
  if (hdr.startsWith('Basic ')) {
    const [u,p]=Buffer.from(hdr.slice(6),'base64').toString().split(':');
    if (u===user && p===pass) return next();
  }
  res.set('WWW-Authenticate','Basic realm="Telsim Tarife Watch"');
  return res.status(401).send('Authentication required');
}
app.use(auth);

app.get('/api/health', async (req,res)=>{
  try { await pool.query('SELECT 1'); res.json({ok:true,now:new Date().toISOString()}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/summary', async (req,res,next)=>{try{
  const src=await pool.query(`SELECT s.*,
    (SELECT started_at FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_checked_at,
    (SELECT status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) last_status,
    (SELECT http_status FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) http_status,
    (SELECT response_ms FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) response_ms,
    (SELECT parsed_count FROM scans sc WHERE sc.source_id=s.id ORDER BY sc.id DESC LIMIT 1) parsed_count,
    (SELECT detected_at FROM changes c WHERE c.source_id=s.id ORDER BY c.id DESC LIMIT 1) last_change_at,
    (SELECT COUNT(*)::int FROM products p WHERE p.source_id=s.id AND p.active=TRUE) active_products
    FROM sources s ORDER BY s.id`);
  const ch=await pool.query("SELECT COUNT(*)::int c FROM changes WHERE detected_at >= NOW()-INTERVAL '24 hours'");
  const ap=await pool.query('SELECT COUNT(*)::int c FROM products WHERE active=TRUE');
  res.json({generated_at:new Date().toISOString(),sources:src.rows,active_products:ap.rows[0].c,changes_24h:ch.rows[0].c});
}catch(e){next(e)}});

app.get('/api/packages', async (req,res,next)=>{try{
  const params=[]; let where='';
  if(req.query.source){params.push(req.query.source);where='WHERE s.slug=$1'}
  const q=`SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,
    s.slug source_slug,s.name source_name,s.url source_url,
    v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json
    FROM products p JOIN sources s ON s.id=p.source_id
    LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE
    ${where} ORDER BY s.id,p.active DESC,v.price_try ASC,p.current_name`;
  res.json((await pool.query(q,params)).rows);
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
  const r=await pool.query(`SELECT * FROM product_versions WHERE product_id=$1 ORDER BY captured_at DESC,id DESC LIMIT 200`,[req.params.id]);
  res.json(r.rows);
}catch(e){next(e)}});

app.get('/api/snapshots', async (req,res,next)=>{try{
  const r=await pool.query(`SELECT sn.id,sn.captured_at,sn.kind,sn.page_hash,s.slug source_slug,s.name source_name,sc.parsed_count
    FROM snapshots sn JOIN sources s ON s.id=sn.source_id JOIN scans sc ON sc.id=sn.scan_id ORDER BY sn.captured_at DESC LIMIT 100`);
  res.json(r.rows);
}catch(e){next(e)}});

app.post('/api/scan', async (req,res,next)=>{try{res.json(await scanAll())}catch(e){next(e)}});

app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));
app.use(express.static(path.join(__dirname,'..','public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err?.message||String(err)})});

const port=Number(process.env.PORT||3000);
await initDb();
app.listen(port,()=>console.log(`Telsim Tarife Watch listening on ${port}`));

const schedule=process.env.SCAN_CRON || '0 * * * *';
cron.schedule(schedule,()=>scanAll().catch(e=>console.error('scheduled scan failed',e)),{timezone:process.env.TZ||'Asia/Famagusta'});
setTimeout(()=>scanAll().catch(e=>console.error('startup scan failed',e)),5000);
