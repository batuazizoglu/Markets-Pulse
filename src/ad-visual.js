import {createHash} from 'node:crypto';
import {socialDirectory} from './isp-registry.js';

export const AD_FEED_ROOT='https://raw.githubusercontent.com/batuazizoglu/Markets-Pulse/ad-visual-data/';
export const AD_CATEGORIES={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'İnceleme Bekleyen'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);
const date=v=>{const d=new Date(v);if(!v||!Number.isFinite(+d))throw new Error('Geçersiz inceleme tarihi');return d.toISOString()};
const list=(v,max=20)=>{if(!Array.isArray(v)||v.length>max)throw new Error('Geçersiz analiz listesi');return v.map(x=>clean(x)).filter(Boolean)};
function socialUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.facebook.com','facebook.com','www.instagram.com','instagram.com'].includes(u.hostname)||u.href.length>2048)throw new Error('Geçersiz reklam kaynağı');
  return u.href;
}
function number(v){if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>10000000)throw new Error('Geçersiz teklif sayısı');return v}
function observed(v,now){const t=date(v);if(+new Date(t)>+now+300000)throw new Error('Gelecek tarihli gözlem');return t}
export function validateAdFeed(input,sources,now=new Date()){
  if(input?.schema_version!==1||input.producer!=='chatgpt-browser-visual'||!Array.isArray(input.ads)||input.ads.length>400)throw new Error('Geçersiz reklam analiz akışı');
  const directory=socialDirectory(sources),brands=new Set([...directory.map(x=>x.brand),'KKTCELL']);
  const run=input.run;
  if(!run||!/^[a-zA-Z0-9_.:-]{8,100}$/.test(run.id)||!['ok','partial','blocked','error'].includes(run.status)||!Array.isArray(run.coverage)||run.coverage.length>60)throw new Error('Geçersiz tarama kaydı');
  const at=observed(run.checked_at,now);
  const coverage=run.coverage.map(c=>{
    if(!brands.has(c.brand)||!['ok','partial','blocked','error','unverified','no_ads'].includes(c.status)||!['ALL','CY','TR'].includes(c.country))throw new Error('Geçersiz kaynak kapsamı');
    const seen=observed(c.checked_at,now);if(seen>at)throw new Error('Kapsam tarihi tutarsız');
    return {brand:c.brand,source_url:socialUrl(c.source_url),country:c.country,status:c.status,checked_at:seen,reviewed_ads:number(c.reviewed_ads),note:clean(c.note)};
  });
  const keys=new Set();
  const ads=input.ads.map(a=>{
    if(!brands.has(a.brand)||! /^\d{5,30}$/.test(a.ad_id)||! /^\d{5,30}$/.test(a.page_id)||!Object.hasOwn(AD_CATEGORIES,a.category)||!['active','inactive','unknown'].includes(a.ad_status))throw new Error('Geçersiz reklam kimliği');
    const known=directory.find(x=>x.brand===a.brand)?.page_id;
    if(known&&known!==a.page_id)throw new Error('Marka ve sayfa kimliği uyuşmuyor');
    const variant=clean(a.variant_id||'1',40);if(!/^[a-zA-Z0-9_-]+$/.test(variant))throw new Error('Geçersiz varyant');
    const key=[a.page_id,a.ad_id,variant].join(':');if(keys.has(key))throw new Error('Tekrarlanan reklam kimliği');keys.add(key);
    const evidence=clean(a.category_evidence),fold=evidence.toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
    if(a.category==='mnp'&&!/numara.{0,40}(tasi|degis)|mnp|operator.{0,30}(gecis|degis)/.test(fold))throw new Error('MNP için numara taşıma koşulu gerekli');
    if(a.category==='home'&&!/ev(de)?\s*internet|fiber|vdsl|wdsl|adsl|superbox|red\s*box|sabit\s*internet|apartman/.test(fold))throw new Error('Ev interneti sınıfı için kanıt gerekli');
    if(a.category==='gsm'&&!/tarife|mobil|gsm|\bgb\b/.test(fold))throw new Error('GSM sınıfı için kanıt gerekli');
    if(!clean(a.title)||!evidence||!clean(a.visual_summary))throw new Error('Görsel analiz eksik');
    if(!Array.isArray(a.images)||!a.images.length||a.images.length>3)throw new Error('Görsel kanıt gerekli');
    const images=a.images.map(img=>{
      if(!/^[a-f0-9]{64}$/.test(img.sha256)||img.path!=='evidence/'+img.sha256+'.jpg')throw new Error('Geçersiz kanıt yolu');
      return {sha256:img.sha256,path:img.path,captured_at:observed(img.captured_at,now)};
    });
    const offer={};for(const f of ['price_try','previous_price_try','data_gb','bonus_data_gb','minutes','speed_mbps','commitment_months'])offer[f]=number(a.offer?.[f]);
    if(!['monthly','one_time','unknown'].includes(a.offer?.billing_period))throw new Error('Fiyat dönemi gerekli');
    offer.billing_period=a.offer.billing_period;
    const seen=observed(a.observed_at,now);
    if(seen>at||images.some(x=>x.captured_at>seen))throw new Error('Gözlem ve kanıt tarihleri tutarsız');
    return {key,ad_id:a.ad_id,page_id:a.page_id,variant_id:variant,brand:a.brand,category:a.category,category_evidence:evidence,title:clean(a.title,250),
      source_url:socialUrl(a.source_url),ad_status:a.ad_status,observed_at:seen,started_on:a.started_on&&/^\d{4}-\d{2}-\d{2}$/.test(a.started_on)?a.started_on:null,
      ad_text:clean(a.ad_text,5000),offer,conditions:list(a.conditions),uncertainties:list(a.uncertainties),visual_summary:clean(a.visual_summary),
      review_required:a.review_required===true||a.category==='review',images};
  });
  const schedule=input.schedule;
  if(!schedule||typeof schedule.enabled!=='boolean'||schedule.timezone!=='Asia/Famagusta'||!clean(schedule.description,200))throw new Error('Zamanlama bilgisi gerekli');
  return {schema_version:1,producer:input.producer,run:{id:run.id,checked_at:at,status:run.status,coverage},ads,
    schedule:{enabled:schedule.enabled,description:clean(schedule.description,200),timezone:schedule.timezone}};
}
export function adMeaningHash(ad){
  // Observation timestamps, screenshots and prose paraphrases do not create market changes.
  return sha(JSON.stringify({category:ad.category,title:ad.title,ad_status:ad.ad_status,offer:ad.offer,conditions:[...ad.conditions].sort(),review_required:ad.review_required}));
}
async function boundedFetch(path,maxBytes,fetcher){
  const res=await fetcher(AD_FEED_ROOT+path,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:path.endsWith('.json')?'application/json':'image/jpeg'}});
  if(!res.ok)throw new Error('Analiz akışı HTTP '+res.status);
  if(Number(res.headers.get('content-length'))>maxBytes)throw new Error('Analiz dosyası çok büyük');
  const chunks=[];let size=0;
  for await(const chunk of res.body){size+=chunk.length;if(size>maxBytes)throw new Error('Analiz dosyası çok büyük');chunks.push(Buffer.from(chunk))}
  return Buffer.concat(chunks);
}
export async function importAdFeed(pool,feed,{fetcher=fetch}={}){
  const current=(await pool.query('SELECT checked_at,run_id FROM ad_visual_sync WHERE id=1')).rows[0];
  if(current?.run_id===feed.run.id)return {duplicate:true,imported:0};
  if(current?.checked_at&&+new Date(current.checked_at)>+new Date(feed.run.checked_at))return {older:true,imported:0};
  const assets=new Map();
  for(const ad of feed.ads)for(const img of ad.images)assets.set(img.sha256,img);
  const stored=(await pool.query('SELECT sha256 FROM ad_visual_evidence WHERE sha256=ANY($1::text[])',[[...assets.keys()]])).rows;
  for(const row of stored)assets.delete(row.sha256);
  if(assets.size>100)throw new Error('Bir aktarımda en fazla 100 yeni görsel');
  let total=0;
  for(const [hash,img] of assets){
    const bytes=await boundedFetch(img.path,1500000,fetcher);total+=bytes.length;
    if(total>25000000)throw new Error('Aktarım görsel sınırı aşıldı');
    if(sha(bytes)!==hash||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw new Error('Görsel kanıt doğrulanamadı');
    assets.set(hash,bytes);
  }
  const client=pool.connect?await pool.connect():pool;
  let imported=0,changed=0;
  try{
    await client.query('BEGIN');
    await client.query('INSERT INTO ad_visual_sync(id) VALUES(1) ON CONFLICT DO NOTHING');
    const lock=(await client.query('SELECT checked_at,run_id FROM ad_visual_sync WHERE id=1 FOR UPDATE')).rows[0];
    if(lock.run_id===feed.run.id||lock.checked_at&&+new Date(lock.checked_at)>+new Date(feed.run.checked_at)){await client.query('ROLLBACK');return {duplicate:true,imported:0}}
    for(const [hash,bytes] of assets)await client.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2) ON CONFLICT DO NOTHING',[hash,bytes]);
    for(const ad of feed.ads){
      const prior=(await client.query('SELECT meaning_hash,observed_at FROM ad_visual_items WHERE ad_key=$1',[ad.key])).rows[0];
      if(prior&&+new Date(prior.observed_at)>=+new Date(ad.observed_at))continue;
      const meaning=adMeaningHash(ad);
      await client.query('INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,$5,$6::jsonb) ON CONFLICT(ad_key) DO UPDATE SET brand=EXCLUDED.brand,category=EXCLUDED.category,observed_at=EXCLUDED.observed_at,meaning_hash=EXCLUDED.meaning_hash,analysis_json=EXCLUDED.analysis_json',[ad.key,ad.brand,ad.category,ad.observed_at,meaning,JSON.stringify(ad)]);
      if(!prior||prior.meaning_hash!==meaning){
        await client.query('INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,$3,$4::jsonb)',[ad.key,ad.observed_at,prior?'changed':'first_seen',JSON.stringify(ad)]);
        changed++;
      }
      imported++;
    }
    await client.query('UPDATE ad_visual_sync SET run_id=$1,checked_at=$2,imported_at=NOW(),status=$3,coverage_json=$4::jsonb,schedule_json=$5::jsonb,last_error=NULL,last_attempt_at=NOW() WHERE id=1',
      [feed.run.id,feed.run.checked_at,feed.run.status,JSON.stringify(feed.run.coverage),JSON.stringify(feed.schedule)]);
    await client.query('COMMIT');
    return {imported,changed,evidence:assets.size,run_id:feed.run.id,status:feed.run.status};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release?.()}
}
let inFlight=null;
export function syncAdVisuals(pool,sources,{fetcher=fetch}={}){
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    try{
      const bytes=await boundedFetch('latest.json',4000000,fetcher);
      const feed=validateAdFeed(JSON.parse(bytes.toString('utf8')),sources);
      const result=await importAdFeed(pool,feed,{fetcher});
      await pool.query('UPDATE ad_visual_sync SET last_error=NULL,last_attempt_at=NOW() WHERE id=1');
      console.log('[ad-visual-sync]',JSON.stringify(result));return result;
    }catch(e){
      const message=clean(e.message,300);
      await pool.query('INSERT INTO ad_visual_sync(id,last_error,last_attempt_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET last_error=$1,last_attempt_at=NOW()',[message]);
      console.error('[ad-visual-sync]',JSON.stringify({ok:false,error:message}));return {ok:false,error:message};
    }
  })().finally(()=>{inFlight=null});return inFlight;
}
export async function getAdVisuals(pool,{now=new Date()}={}){
  const [data,sync]=await Promise.all([
    pool.query('SELECT ad_key,first_seen_at,observed_at,analysis_json FROM ad_visual_items ORDER BY observed_at DESC,ad_key LIMIT 400'),
    pool.query('SELECT * FROM ad_visual_sync WHERE id=1')
  ]);
  const status=sync.rows[0]||{};
  const stale=t=>!t||+now-+new Date(t)>48*3600000;
  const rows=data.rows.map(x=>({...x.analysis_json,first_seen_at:x.first_seen_at,stale:stale(x.observed_at)}));
  return {generated_at:now.toISOString(),categories:AD_CATEGORIES,rows,
    groups:Object.fromEntries(Object.keys(AD_CATEGORIES).map(k=>[k,rows.filter(x=>x.category===k).length])),
    monitoring:{...status,stale:stale(status.checked_at),status:status.last_error?'sync_error':!status.checked_at?'pending':stale(status.checked_at)?'stale':status.status,
      coverage:(status.coverage_json||[]).map(x=>({...x,stale:stale(x.checked_at)})),schedule:status.schedule_json||null}};
}
export async function getAdReport(pool,start,end,{category}={}){
  const params=[date(start),date(end)];if(category)params.push(category);
  const r=await pool.query("SELECT event_type,analysis_json,observed_at FROM ad_visual_versions WHERE observed_at >= $1 AND observed_at < $2 "+(category?"AND analysis_json->>'category'=$3 ":'')+"ORDER BY observed_at DESC,id DESC",params);
  const current=await pool.query('SELECT checked_at,status,last_error FROM ad_visual_sync WHERE id=1');
  return {rows:r.rows,checked_at:current.rows[0]?.checked_at||null,status:current.rows[0]?.status||'pending',last_error:current.rows[0]?.last_error||null};
}
export function registerAdVisualRoutes(app,pool){
  app.get('/api/ad-visuals',async(req,res,next)=>{try{res.json(await getAdVisuals(pool))}catch(e){next(e)}});
  app.get('/api/ad-visuals/history',async(req,res,next)=>{
    try{const r=await pool.query('SELECT id,observed_at,event_type,analysis_json FROM ad_visual_versions WHERE ad_key=$1 ORDER BY observed_at DESC,id DESC LIMIT 30',[clean(req.query.key,100)]);res.json({rows:r.rows})}catch(e){next(e)}
  });
  app.get('/api/ad-visuals/evidence/:hash.jpg',async(req,res,next)=>{
    if(!/^[a-f0-9]{64}$/.test(req.params.hash))return res.status(400).end();
    try{const r=await pool.query('SELECT jpeg FROM ad_visual_evidence WHERE sha256=$1',[req.params.hash]);if(!r.rows[0])return res.status(404).end();
      res.set({'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}).send(Buffer.from(r.rows[0].jpeg));
    }catch(e){next(e)}
  });
}
