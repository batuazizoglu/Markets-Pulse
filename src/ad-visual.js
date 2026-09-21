import {createHash} from 'node:crypto';
import {socialDirectory} from './isp-registry.js';
import {AD_CATEGORIES,AD_TAXONOMY_VERSION,AD_CAPTION_MAX_LENGTH,isDynamicCategory,resolveCategoryProposal} from './ad-categories.js';

export const AD_FEED_ROOT='https://raw.githubusercontent.com/batuazizoglu/Markets-Pulse/ad-visual-data/';
export {AD_CATEGORIES};
export async function getAdCategories(pool){
  const rows=(await pool.query('SELECT category_key,label FROM ad_visual_categories ORDER BY label,category_key')).rows;
  const categories={...AD_CATEGORIES};
  for(const {category_key,label} of rows){
    const resolved=resolveCategoryProposal(category_key,label);
    if(isDynamicCategory(category_key)&&resolved?.category===category_key&&resolved.category_label===label)categories[category_key]=label;
  }
  return categories;
}
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
  if(input?.schema_version!==1||!['chatgpt-browser-visual','cloud-vision'].includes(input.producer)||!Array.isArray(input.ads)||input.ads.length>400)throw new Error('Geçersiz reklam analiz akışı');
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
    const dynamic=isDynamicCategory(a.category);
    if(!brands.has(a.brand)||! /^\d{5,30}$/.test(a.ad_id)||! /^\d{5,30}$/.test(a.page_id)||!Object.hasOwn(AD_CATEGORIES,a.category)&&!dynamic||!['active','inactive','unknown'].includes(a.ad_status))throw new Error('Geçersiz reklam kimliği');
    const known=directory.find(x=>x.brand===a.brand)?.page_id;
    if(known&&known!==a.page_id)throw new Error('Marka ve sayfa kimliği uyuşmuyor');
    const variant=clean(a.variant_id||'1',40);if(!/^[a-zA-Z0-9_-]+$/.test(variant))throw new Error('Geçersiz varyant');
    const key=[a.page_id,a.ad_id,variant].join(':');if(keys.has(key))throw new Error('Tekrarlanan reklam kimliği');keys.add(key);
    const evidence=clean(a.category_evidence),fold=evidence.toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
    if(dynamic){
      const resolved=resolveCategoryProposal(a.category,a.category_label);
      if(input.producer!=='cloud-vision'||a.taxonomy_version!==AD_TAXONOMY_VERSION||!resolved||resolved.category!==a.category||resolved.category_label!==a.category_label||typeof a.category_confidence!=='number'||!Number.isFinite(a.category_confidence)||a.category_confidence<0.8||a.category_confidence>1||!evidence||![clean(a.visible_text,12000),clean(a.ad_text,AD_CAPTION_MAX_LENGTH)].some(text=>text.includes(evidence)))throw new Error('Yeni kategori için doğrulanmış AI görsel analizi gerekli');
    }
    if(a.category==='mnp'&&!/numara.{0,40}(tasi|degis)|mnp|operator.{0,30}(gecis|degis)/.test(fold))throw new Error('MNP için numara taşıma koşulu gerekli');
    if(a.category==='home'&&!/ev(de)?\s*internet|fiber|vdsl|wdsl|adsl|superbox|red\s*box|sabit\s*internet|apartman/.test(fold))throw new Error('Ev interneti sınıfı için kanıt gerekli');
    if(a.category==='gsm'&&!/tarife|mobil|gsm|\bgb\b/.test(fold))throw new Error('GSM sınıfı için kanıt gerekli');
    if(!clean(a.title)||!evidence||!clean(a.visual_summary))throw new Error('Görsel analiz eksik');
    if(!Array.isArray(a.images)||!a.images.length||a.images.length>3)throw new Error('Görsel kanıt gerekli');
    const images=a.images.map(img=>{
      if(!/^[a-f0-9]{64}$/.test(img.sha256)||img.path!=='evidence/'+img.sha256+'.jpg')throw new Error('Geçersiz kanıt yolu');
      return {sha256:img.sha256,path:img.path,captured_at:observed(img.captured_at,now),...(['creative','ad_card'].includes(img.role)?{role:img.role}:{})};
    });
    const offer={};for(const f of ['price_try','previous_price_try','data_gb','bonus_data_gb','minutes','speed_mbps','commitment_months'])offer[f]=number(a.offer?.[f]);
    if(!['monthly','one_time','unknown'].includes(a.offer?.billing_period))throw new Error('Fiyat dönemi gerekli');
    offer.billing_period=a.offer.billing_period;
    const seen=observed(a.observed_at,now);
    if(seen>at||images.some(x=>x.captured_at>seen))throw new Error('Gözlem ve kanıt tarihleri tutarsız');
    let ai_analysis;
    if(input.producer==='cloud-vision'&&a.ai_analysis){
      const ai=a.ai_analysis,analyzed_at=observed(ai.analyzed_at,now);
      if(ai.status!=='completed'||!Number.isInteger(ai.pass)||ai.pass<1||ai.pass>100||!clean(ai.model,100)||analyzed_at>at)throw new Error('Geçersiz AI inceleme kaydı');
      ai_analysis={status:'completed',analyzed_at,pass:ai.pass,model:clean(ai.model,100)};
    }
    return {key,ad_id:a.ad_id,page_id:a.page_id,variant_id:variant,brand:a.brand,category:a.category,category_evidence:evidence,title:clean(a.title,250),
      source_url:socialUrl(a.source_url),ad_status:a.ad_status,observed_at:seen,started_on:a.started_on&&/^\d{4}-\d{2}-\d{2}$/.test(a.started_on)?a.started_on:null,
      ad_text:clean(a.ad_text,AD_CAPTION_MAX_LENGTH),offer,conditions:list(a.conditions),uncertainties:list(a.uncertainties),visual_summary:clean(a.visual_summary),
      ...(input.producer==='cloud-vision'&&a.taxonomy_version===AD_TAXONOMY_VERSION?{taxonomy_version:AD_TAXONOMY_VERSION,visible_text:clean(a.visible_text,12000)}:{}),
      ...(dynamic?{category_label:a.category_label,category_confidence:a.category_confidence}:{}),
      review_required:a.review_required===true||a.category==='review',images,...(input.producer==='cloud-vision'&&['image','video_preview'].includes(a.media_kind)?{media_kind:a.media_kind}:{}),...(ai_analysis?{ai_analysis}:{})};
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
export async function importAdFeed(pool,feed,{fetcher=fetch,reanalysis=false}={}){
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
    for(const supplied of feed.ads){
      const ad={...supplied};
      const prior=(await client.query('SELECT meaning_hash,observed_at,analysis_json FROM ad_visual_items WHERE ad_key=$1',[ad.key])).rows[0];
      const sameObservation=prior&&+new Date(prior.observed_at)===+new Date(ad.observed_at);
      const revised=sameObservation&&reanalysis&&ad.ai_analysis&&
        +new Date(ad.ai_analysis.analyzed_at)>+new Date(prior.analysis_json.ai_analysis?.analyzed_at||0)&&
        JSON.stringify((ad.images||[]).map(x=>x.sha256).sort())===JSON.stringify((prior.analysis_json.images||[]).map(x=>x.sha256).sort());
      if(prior&&(+new Date(prior.observed_at)>+new Date(ad.observed_at)||sameObservation&&!revised))continue;
      if(isDynamicCategory(ad.category)){
        await client.query('INSERT INTO ad_visual_categories(category_key,label,first_ad_key) VALUES($1,$2,$3) ON CONFLICT(category_key) DO NOTHING',[ad.category,ad.category_label,ad.key]);
        const registered=(await client.query('SELECT label FROM ad_visual_categories WHERE category_key=$1',[ad.category])).rows[0];
        // Equivalent label spellings retain the first published display name.
        ad.category_label=registered.label;
      }
      const meaning=adMeaningHash(ad);
      await client.query('INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,$5,$6::jsonb) ON CONFLICT(ad_key) DO UPDATE SET brand=EXCLUDED.brand,category=EXCLUDED.category,observed_at=EXCLUDED.observed_at,meaning_hash=EXCLUDED.meaning_hash,analysis_json=EXCLUDED.analysis_json',[ad.key,ad.brand,ad.category,ad.observed_at,meaning,JSON.stringify(ad)]);
      if(revised){
        await client.query('INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,$3,$4::jsonb)',[ad.key,ad.ai_analysis.analyzed_at,'analysis_updated',JSON.stringify(ad)]);
      }else if(!prior||prior.meaning_hash!==meaning){
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
      const counts=await pool.query('SELECT category,count(*)::int count FROM ad_visual_items GROUP BY category');
      const evidence=await pool.query('SELECT count(*)::int count FROM ad_visual_evidence');
      const verified={...result,stored_groups:Object.fromEntries(counts.rows.map(x=>[x.category,x.count])),stored_evidence:evidence.rows[0].count};
      console.log('[ad-visual-sync]',JSON.stringify(verified));return verified;
    }catch(e){
      const message=clean(e.message,300);
      await pool.query('INSERT INTO ad_visual_sync(id,last_error,last_attempt_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET last_error=$1,last_attempt_at=NOW()',[message]);
      console.error('[ad-visual-sync]',JSON.stringify({ok:false,error:message}));return {ok:false,error:message};
    }
  })().finally(()=>{inFlight=null});return inFlight;
}
function pageInput({limit=400,brand='',category='',cursor}={},categories=AD_CATEGORIES){
  const invalid=()=>{const e=new Error('Geçersiz reklam sayfası veya filtresi');e.status=400;throw e};
  if(typeof limit!=='number'&&typeof limit!=='string'||!/^\d{1,3}$/.test(String(limit))||Number(limit)<1||Number(limit)>400)invalid();
  if(typeof brand!=='string'||brand.length>120||brand!==brand.trim()||/[\u0000-\u001f\u007f]/.test(brand)||typeof category!=='string'||category&&!Object.hasOwn(categories,category))invalid();
  let after=null;
  if(cursor!==undefined&&cursor!==null){
    if(typeof cursor!=='string'||!/^[A-Za-z0-9_-]{1,1500}$/.test(cursor))invalid();
    try{after=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))}catch{invalid()}
    if(!after||after.v!==1||after.brand!==brand||after.category!==category||typeof after.k!=='string'||!after.k||after.k.length>120||/[\u0000-\u001f\u007f]/.test(after.k)||typeof after.t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(after.t)||after.t.startsWith('0000')||!Number.isFinite(+new Date(after.t))||new Date(after.t).toISOString()!==after.t.slice(0,23)+'Z')invalid();
  }
  return {limit:Number(limit),brand,category,after};
}
const pendingMediaWhere="c.status IN ('pending','retry','error') AND NOT EXISTS (SELECT 1 FROM ad_visual_items a WHERE a.ad_key=c.ad_key AND a.observed_at>=c.observed_at) AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload->'images')='array' THEN c.payload->'images' ELSE '[]'::jsonb END) image JOIN ad_visual_evidence e ON e.sha256=image->>'sha256')";
async function pendingMediaCounts(pool){
  const result=await pool.query("SELECT c.payload->>'brand' brand,count(*)::int count FROM ad_cloud_candidates c WHERE "+pendingMediaWhere+" GROUP BY c.payload->>'brand'");
  return {total:result.rows.reduce((n,row)=>n+row.count,0),brand_totals:Object.fromEntries(result.rows.map(row=>[row.brand,row.count]))};
}
export async function getPendingAdVisuals(pool,{limit=50,...options}={}){
  const {brand,after,limit:pageLimit}=pageInput({...options,limit,category:'review'});
  if(pageLimit>100){const error=new Error('Bir sayfada en fazla 100 görsel alınabilir');error.status=400;throw error}
  const params=[],where=[pendingMediaWhere];
  if(brand){params.push(brand);where.push("c.payload->>'brand'=$"+params.length)}
  if(after){params.push(after.t,after.k);where.push('(c.observed_at<$'+(params.length-1)+'::timestamptz OR (c.observed_at=$'+(params.length-1)+'::timestamptz AND c.ad_key>$'+params.length+'))')}
  params.push(pageLimit+1);
  const [result,counts]=await Promise.all([
    pool.query('SELECT c.ad_key,c.payload,c.status,c.observed_at,to_char(c.observed_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') cursor_time FROM ad_cloud_candidates c WHERE '+where.join(' AND ')+' ORDER BY c.observed_at DESC,c.ad_key ASC LIMIT $'+params.length,params),pendingMediaCounts(pool)
  ]);
  const hasMore=result.rows.length>pageLimit,page=result.rows.slice(0,pageLimit),last=page.at(-1);
  const hashes=[...new Set(page.flatMap(row=>(row.payload.images||[]).map(image=>image.sha256)).filter(hash=>/^[a-f0-9]{64}$/.test(hash)))];
  const stored=new Set((await pool.query('SELECT sha256 FROM ad_visual_evidence WHERE sha256=ANY($1::text[])',[hashes])).rows.map(row=>row.sha256));
  return {rows:page.map(row=>{
    const p=row.payload;let source='';try{source=socialUrl(p.source_url)}catch{}
    return {key:row.ad_key,brand:clean(p.brand,120),ad_id:clean(p.ad_id,30),page_id:clean(p.page_id,30),variant_id:clean(p.variant_id,40),observed_at:row.observed_at,status:row.status,media_kind:p.media_kind==='video_preview'?'video_preview':'image',ad_text:clean(p.ad_text,5000),source_url:source,images:(p.images||[]).filter(image=>stored.has(image.sha256)).slice(0,3).map(image=>({sha256:image.sha256,captured_at:image.captured_at}))};
  }),pagination:{limit:pageLimit,total:brand?(counts.brand_totals[brand]||0):counts.total,has_more:hasMore,next_cursor:hasMore?Buffer.from(JSON.stringify({v:1,t:last.cursor_time,k:last.ad_key,brand,category:'review'})).toString('base64url'):null,brand:brand||null},...counts};
}
export async function getAdVisuals(pool,{now=new Date(),...options}={}){
  const categories=await getAdCategories(pool);
  const {limit,brand,category,after}=pageInput(options,categories),params=[],where=[];
  if(brand){params.push(brand);where.push('a.brand=$'+params.length)}
  if(category){params.push(category);where.push('a.category=$'+params.length)}
  if(after){params.push(after.t,after.k);where.push('(a.observed_at<$'+(params.length-1)+'::timestamptz OR (a.observed_at=$'+(params.length-1)+'::timestamptz AND a.ad_key>$'+params.length+'))')}
  params.push(limit+1);
  const [data,sync,counts,pendingMedia]=await Promise.all([
    pool.query('SELECT a.ad_key,a.first_seen_at,a.observed_at,to_char(a.observed_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') cursor_time,a.analysis_json,c.status ai_queue_status,c.analyzed_at,c.review_round FROM ad_visual_items a LEFT JOIN ad_cloud_candidates c ON c.ad_key=a.ad_key '+(where.length?'WHERE '+where.join(' AND ')+' ':'')+'ORDER BY a.observed_at DESC,a.ad_key ASC LIMIT $'+params.length,params),
    pool.query('SELECT * FROM ad_visual_sync WHERE id=1'),
    pool.query('SELECT brand,category,count(*)::int count FROM ad_visual_items GROUP BY brand,category'),pendingMediaCounts(pool)
  ]);
  const status=sync.rows[0]||{};
  const stale=t=>!t||+now-+new Date(t)>48*3600000;
  const hasMore=data.rows.length>limit,page=data.rows.slice(0,limit),last=page.at(-1);
  const groups=Object.fromEntries(Object.keys(categories).map(k=>[k,0])),brandGroups=Object.create(null);let total=0;
  for(const row of counts.rows){
    groups[row.category]=(groups[row.category]||0)+row.count;
    brandGroups[row.brand]||=Object.fromEntries(Object.keys(categories).map(k=>[k,0]));brandGroups[row.brand][row.category]=row.count;
    if((!brand||row.brand===brand)&&(!category||row.category===category))total+=row.count;
  }
  const rows=page.map(x=>({...x.analysis_json,first_seen_at:x.first_seen_at,stale:stale(x.observed_at),ai_queue_status:x.ai_queue_status||null,
    ai_analysis:x.analysis_json.ai_analysis||(x.analyzed_at?{status:'completed',analyzed_at:x.analyzed_at,pass:x.ai_queue_status==='analyzed'?(x.review_round||0)+1:Math.max(1,x.review_round||0)}:null)}));
  return {generated_at:now.toISOString(),categories,rows,
    groups,brand_groups:brandGroups,total:Object.values(groups).reduce((sum,n)=>sum+n,0),pending_media:pendingMedia,
    pagination:{limit,total,has_more:hasMore,next_cursor:hasMore?Buffer.from(JSON.stringify({v:1,t:last.cursor_time,k:last.ad_key,brand,category})).toString('base64url'):null,brand:brand||null,category:category||null},
    monitoring:{...status,stale:stale(status.checked_at),status:status.last_error?'sync_error':!status.checked_at?'pending':stale(status.checked_at)?'stale':status.status,
      coverage:(status.coverage_json||[]).map(x=>({...x,stale:stale(x.checked_at)})),schedule:status.schedule_json||null}};
}
export async function getAdReport(pool,start,end,{category}={}){
  const params=[date(start),date(end)];if(category)params.push(category);
  const r=await pool.query("SELECT event_type,analysis_json,observed_at FROM ad_visual_versions WHERE observed_at >= $1 AND observed_at < $2 AND event_type IN ('first_seen','changed') "+(category?"AND analysis_json->>'category'=$3 ":'')+"ORDER BY observed_at DESC,id DESC",params);
  const current=await pool.query('SELECT checked_at,status,last_error FROM ad_visual_sync WHERE id=1');
  return {rows:r.rows,categories:await getAdCategories(pool),checked_at:current.rows[0]?.checked_at||null,status:current.rows[0]?.status||'pending',last_error:current.rows[0]?.last_error||null};
}
export function registerAdVisualRoutes(app,pool,sources,{sync=syncAdVisuals,now=Date.now,cloudStatus=null}={}){
  let lastManualSync=-Infinity;
  app.post('/api/ad-visuals/sync',async(req,res,next)=>{
    if(cloudStatus)return res.status(409).json({error:'Tarama artık bulutta çalışıyor. Bulutta tara düğmesini kullanın.'});
    // Existing authentication applies; never accept a caller-controlled source URL.
    if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli'});
    const origin=req.get('origin');
    if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Geçersiz kaynak'})}catch{return res.status(403).json({error:'Geçersiz kaynak'})}}
    const wait=Math.ceil((60000-(now()-lastManualSync))/1000);
    if(wait>0)return res.set('Retry-After',String(wait)).status(429).json({error:'Yeni aktarım için '+wait+' saniye bekleyin.'});
    lastManualSync=now();
    try{const result=await sync(pool,sources);res.json({...await getAdVisuals(pool),sync:result})}catch(e){next(e)}
  });
  app.get('/api/ad-visuals',async(req,res,next)=>{try{
    const data=await getAdVisuals(pool,{limit:req.query.limit,brand:req.query.brand,category:req.query.category,cursor:req.query.cursor});
    // Source identity is independent of successful capture or AI publication.
    data.source_directory=socialDirectory(sources).map(({brand,page_id,ad_library_url,ad_library_type,facebook,instagram,additional_social_links,research_note,research_checked_at})=>({brand,page_id:page_id||null,ad_library_url,ad_library_type,country:'CY',facebook,instagram,additional_social_links,research_note,research_checked_at}));
    if(cloudStatus){data.cloud=await cloudStatus();data.monitoring.schedule=data.cloud.schedule}
    res.json(data);
  }catch(e){if(e.status===400)return res.status(400).json({error:e.message});next(e)}});
  app.get('/api/ad-visuals/pending',async(req,res,next)=>{
    try{res.json(await getPendingAdVisuals(pool,{limit:req.query.limit,brand:req.query.brand,cursor:req.query.cursor}))}
    catch(e){if(e.status===400)return res.status(400).json({error:e.message});next(e)}
  });
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
