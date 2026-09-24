import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {getAdVisuals,getAdReport} from '../src/ad-visual.js';
import {createCloudWorker,queueCloudReview,queueNewCloudSources,queueStoredAdReviews,getCloudStatus,localCloudTime,analyzeNextCloudCandidate,registerCloudRoutes,verifiedCloudSources} from '../src/ad-cloud.js';
import {adLibrarySource,pageState,markAdCards,captureRetryDelay} from '../src/ad-cloud-capture.js';
import {normalizeVision,analyzeCloudImage} from '../src/ad-cloud-vision.js';
const jpeg=Buffer.from([255,216,255,224,0,0,255,217]),hash=createHash('sha256').update(jpeg).digest('hex');
const env={OPENAI_API_KEY:'synthetic-test-only',AD_VISION_DAILY_LIMIT:'1'};
async function dbFixture(){const db=new PGlite();await db.exec(SCHEMA_SQL);return db}
function observation(source){const at=new Date().toISOString();return {brand:source.brand,page_id:source.page_id,ad_id:'99999999',variant_id:'1',source_url:adLibrarySource(source),ad_status:'active',started_on:null,observed_at:at,ad_text:'Numaranızı taşıyın 25 GB 799 TL',has_video:false,evidence:[{sha256:hash,bytes:jpeg,captured_at:at}]}}
function vision(){return {category:'mnp',category_evidence:'Numaranızı taşıyın',title:'Numara taşıma 25 GB',visible_text:'25 GB 799 TL',visual_summary:'Kırmızı fiyat kutusu',conditions:[],uncertainties:[],offer:{price_try:799,previous_price_try:null,data_gb:25,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'},field_evidence:{price_try:'799 TL',previous_price_try:'',data_gb:'25 GB',bonus_data_gb:'',minutes:'',speed_mbps:'',commitment_months:'',billing_period:''}}}
const capture=async(source,save)=>{if(!source.page_id)return {status:'unverified',captured:0,note:'Sayfa kimliği yok'};await save(observation(source));return {status:'partial',captured:1,note:'Gerçek tarayıcı yerine izole test görüntüsü'}};

test('cloud scheduling persists daily deduplication, rotates competitors and throttles manual scans',async()=>{
  assert.deepEqual(localCloudTime(new Date('2026-09-18T03:00:00Z')),{day:'2026-09-18',hour:6});
  assert.equal(localCloudTime(new Date('2026-12-18T04:00:00Z')).hour,6);
  const db=await dbFixture();
  try{
    assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{now:new Date('2026-09-18T02:00:00Z')})).queued,0);
    const first=await queueCloudReview(db,HOME_INTERNET_SOURCES,{now:new Date('2026-09-18T03:00:00Z')});assert.equal(first.queued,7);
    assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{now:new Date('2026-09-18T05:00:00Z')})).queued,0);
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true})).rate_limited,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_jobs')).rows[0].n,7);
  }finally{await db.close()}
});
test('unverified brands never displace verified ISP pages from the next daily or manual batch',async()=>{
  const db=await dbFixture(),env={AD_CAPTURE_PROVIDER:'apify'},total=verifiedCloudSources(HOME_INTERNET_SOURCES).length;
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,now:new Date('2026-09-18T03:00:00Z')});
    await db.query("UPDATE ad_cloud_jobs SET status='blocked',finished_at=NOW(),note='HTTP 403'");
    const before=(await db.query('SELECT id,status,attempts FROM ad_cloud_jobs ORDER BY id')).rows;
    const daily=await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,now:new Date('2026-09-19T03:00:00Z')});
    assert.equal(daily.queued,total);
    const scheduled=(await db.query('SELECT brand,source_json FROM ad_cloud_jobs WHERE batch_key=$1',[daily.batch_key])).rows;
    assert.ok(scheduled.every(row=>adLibrarySource(row.source_json)));
    assert.ok(scheduled.some(row=>row.brand==='Nethouse'&&row.source_json.page_id==='159064954156749'));
    assert.ok(scheduled.some(row=>row.brand==='Kıbrıs Online'&&row.source_json.page_id==='107418628779416'));
    assert.deepEqual((await db.query('SELECT id,status,attempts FROM ad_cloud_jobs WHERE id=ANY($1::int[]) ORDER BY id',[before.map(row=>row.id)])).rows,before);
    await db.query("UPDATE ad_cloud_jobs SET status='blocked' WHERE status='queued'");
    const manual=await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,manual:true,now:new Date('2026-09-19T04:00:00Z')});
    assert.equal(manual.queued,total);
    assert.ok((await db.query('SELECT source_json FROM ad_cloud_jobs WHERE batch_key=$1',[manual.batch_key])).rows.every(row=>adLibrarySource(row.source_json)));
  }finally{await db.close()}
});
test('server capture persists evidence without a model key; subsequent worker analyzes without recapturing',async()=>{
  const db=await dbFixture();
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
    const first=await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,env:{},log:()=>{}})();
    assert.equal(first.analysis.status,'waiting_config');assert.equal((await getAdVisuals(db)).rows.length,0);
    const state=await getCloudStatus(db,{env:{}});assert.equal(state.candidates.pending,1);assert.equal(state.vision_configured,false);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_visual_evidence')).rows[0].n,1);
    // Prevent new captures: test proves persistent backlog is sufficient after process replacement.
    await db.query("UPDATE ad_cloud_jobs SET status='unverified' WHERE status='queued'");
    await db.query("UPDATE ad_cloud_control SET capture_after=NOW()+INTERVAL '1 hour'");
    let calls=0;
    const second=await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture:async()=>{throw Error('must not recapture')},env,analyze:async c=>{calls++;return normalizeVision(vision(),c)},log:()=>{}})();
    assert.equal(second.analysis.status,'analyzed');assert.equal(calls,1);
    const data=await getAdVisuals(db);assert.equal(data.groups.mnp,1);assert.equal(data.rows[0].offer.price_try,799);assert.equal(data.monitoring.schedule.timezone,'Asia/Famagusta');
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_visual_versions')).rows[0].n,1);
  }finally{await db.close()}
});
test('missing primary proxy preserves queued attempts while stored images are analyzed',async()=>{
  const db=await dbFixture();const logs=[];
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,env:{},log:()=>{}})();
    const before=(await db.query('SELECT id,status,attempts FROM ad_cloud_jobs ORDER BY id')).rows;
    assert.ok(before.some(job=>job.status==='queued'&&job.attempts===0));
    const proxyEnv={...env,AD_CAPTURE_TRANSPORT:'proxy'};
    const result=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env:proxyEnv,
      capture:async()=>{throw Error('must not capture without primary proxy')},
      analyze:async c=>normalizeVision(vision(),c),log:(...args)=>logs.push(args.join(' '))})();
    assert.equal(result.scan.status,'waiting_config');assert.equal(result.scan.reason,'PROXY_CONFIG_MISSING');
    assert.equal(result.analysis.status,'analyzed');
    assert.deepEqual((await db.query('SELECT id,status,attempts FROM ad_cloud_jobs ORDER BY id')).rows,before);
    assert.equal((await getAdVisuals(db)).groups.mnp,1);
    assert.ok(logs.some(line=>line.includes('"capture_configured":false')));
    const status=await getCloudStatus(db,{env:{...proxyEnv,AD_CAPTURE_PROXY_URL:'http://private-user:private-password@private-proxy.example:8080'}});
    assert.equal(status.capture_transport.configured,true);
    assert.doesNotMatch(JSON.stringify(status),/private-user|private-password|private-proxy/);
  }finally{await db.close()}
});
test('ambiguous images receive a second AI pass without recapture or false market changes',async()=>{
  const db=await dbFixture();let calls=0;
  const analyze=async candidate=>{calls++;const result=vision();if(calls===1){result.category='review';result.category_evidence='İlk okuma belirsiz'}else{assert.equal(candidate.previous_analysis.category,'review');result.title='AI ile düzeltilen numara taşıma teklifi'}return normalizeVision(result,candidate)};
  const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,analyze,env:{...env,AD_VISION_DAILY_LIMIT:'10'},log:()=>{}});
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});await worker();
    const first=(await getAdVisuals(db)).rows[0];assert.equal(first.category,'review');assert.equal(first.ai_analysis.status,'completed');
    await db.query("UPDATE ad_cloud_jobs SET status='unverified' WHERE status='queued'");
    await worker();
    const second=(await getAdVisuals(db)).rows[0];assert.equal(second.category,'mnp');assert.equal(second.ai_analysis.pass,2);
    assert.equal(second.observed_at,first.observed_at);assert.equal(second.images[0].sha256,first.images[0].sha256);
    assert.equal((await db.query("SELECT count(*)::int n FROM ad_visual_versions WHERE event_type='analysis_updated'")).rows[0].n,1);
    const report=await getAdReport(db,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+60000).toISOString());assert.equal(report.rows.length,1);assert.equal(report.rows[0].event_type,'first_seen');
    await worker();assert.equal(calls,2);
  }finally{await db.close()}
});
test('AI also reads historical review cards and does not endlessly retry a completed ambiguous category',async()=>{
  const db=await dbFixture();let calls=0;
  const analyze=async candidate=>{calls++;const v=vision();v.category='review';v.category_evidence='Cihaz tanıtımı';return normalizeVision(v,candidate)};
  const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,analyze,env:{...env,AD_VISION_DAILY_LIMIT:'10'},log:()=>{}});
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});await worker();
    await db.query("UPDATE ad_cloud_jobs SET status='unverified' WHERE status='queued'");
    // A historical published card with stored evidence but no cloud candidate.
    await db.query('DELETE FROM ad_cloud_candidates');
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,1);
    assert.equal((await getAdVisuals(db)).rows[0].ai_queue_status,'pending');
    await worker();const row=(await getAdVisuals(db)).rows[0];assert.equal(row.category,'review');assert.equal(row.ai_analysis.pass,2);
    await worker();assert.equal(calls,2);assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,0);
  }finally{await db.close()}
});
test('older missing-quote classifications receive one bounded corrective pass',async()=>{
  const db=await dbFixture();let calls=0;
  const analyze=async candidate=>{calls++;const v=vision();v.category='review';v.category_evidence='Kategori için açık ve doğrulanabilir ifade bulunamadı.';return normalizeVision(v,candidate)};
  const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,analyze,env:{...env,AD_VISION_DAILY_LIMIT:'10'},log:()=>{}});
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});await worker();
    await db.query("UPDATE ad_cloud_jobs SET status='unverified' WHERE status='queued'");
    await worker();assert.equal((await getAdVisuals(db)).rows[0].ai_analysis.pass,2);
    const corrective=await worker();assert.equal(corrective.analysis.category_evidence_missing,true);
    assert.equal((await getAdVisuals(db)).rows[0].ai_analysis.pass,3);
    await worker();assert.equal(calls,3);assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,0);
  }finally{await db.close()}
});
test('capture rate limits preserve Retry-After and pause other sources without blocking stored-image analysis',async()=>{
  assert.equal(captureRetryDelay('1800'),1800000);assert.equal(captureRetryDelay('bad'),900000);
  assert.equal(captureRetryDelay('2026-09-19T08:00:00Z',Date.parse('2026-09-19T07:00:00Z')),3600000);
  const db=await dbFixture();let captures=0;
  const limited=async()=>{captures++;return {status:'rate_limited',http_status:429,retry_after_ms:1800000,captured:0,note:'Ad Library erişimi HTTP 429'}};
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
    const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{capture:limited,env:{},log:()=>{}});
    await worker();await worker();assert.equal(captures,1);
    const job=(await db.query("SELECT status,available_at FROM ad_cloud_jobs WHERE brand='Telsim'")).rows[0];assert.equal(job.status,'retry');assert.ok(+new Date(job.available_at)>Date.now()+1700000);
    assert.ok(+new Date((await getCloudStatus(db,{env:{}})).capture_after)>Date.now()+1700000);
  }finally{await db.close()}
});
test('newly verified pages enter the queue even after daily scheduling and do not repeat on restart',async()=>{
  const db=await dbFixture();
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{now:new Date('2026-09-19T03:00:00Z')});
    await db.query("UPDATE ad_cloud_jobs SET status='unverified',source_json=source_json-'page_id' WHERE brand NOT IN ('Telsim','Cypking')");
    await db.query("UPDATE ad_cloud_control SET lease_owner='registration-test',lease_until=NOW()+INTERVAL '10 minutes'");
    const added=await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'registration-test');
    assert.equal(added.length,verifiedCloudSources(HOME_INTERNET_SOURCES).length-2);
    assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{now:new Date('2026-09-19T05:00:00Z')})).queued,0);
    const registered=(await db.query("SELECT source_json FROM ad_cloud_jobs WHERE batch_key LIKE 'source-%'")).rows;
    assert.equal(registered.length,verifiedCloudSources(HOME_INTERNET_SOURCES).length-2);
    for(const {source_json:source} of registered){
      const url=new URL(adLibrarySource(source));
      assert.equal(url.searchParams.get('country'),'CY');assert.equal(url.searchParams.get('view_all_page_id'),source.page_id);
    }
    await db.query("UPDATE ad_cloud_jobs SET status='no_ads' WHERE batch_key LIKE 'source-%'");
    assert.deepEqual(await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'registration-test'),[]);
  }finally{await db.close()}
});
test('leases exclude another process; interrupted capture resumes and keeps prior evidence',async()=>{
  const db=await dbFixture();
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
    await db.query("UPDATE ad_cloud_control SET lease_owner='other',lease_until=NOW()+INTERVAL '10 minutes'");
    assert.equal((await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,env:{},log:()=>{}})()).status,'busy');
    await db.query("UPDATE ad_cloud_control SET lease_until=NOW()-INTERVAL '1 minute'");
    await db.query("UPDATE ad_cloud_jobs SET status='running',attempts=1 WHERE brand='Telsim'");
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,env:{},log:()=>{}})();
    const job=(await db.query("SELECT status,attempts,captured FROM ad_cloud_jobs WHERE brand='Telsim'")).rows[0];
    assert.equal(job.status,'partial');assert.equal(job.attempts,2);assert.equal(job.captured,1);
  }finally{await db.close()}
});
test('failed vision calls are bounded and billed-call budget survives retries',async()=>{
  const db=await dbFixture();
  try{
    await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
    let calls=0;const analyze=async()=>{calls++;throw new Error('VISION_RATE_LIMIT')};
    const first=await createCloudWorker(db,HOME_INTERNET_SOURCES,{capture,env,analyze,log:()=>{}})();assert.equal(first.analysis.status,'error');
    await db.query("UPDATE ad_cloud_candidates SET available_at=NOW()-INTERVAL '1 minute'");
    await db.query("UPDATE ad_cloud_control SET lease_owner='test',lease_until=NOW()+INTERVAL '1 minute'");
    assert.equal((await analyzeNextCloudCandidate(db,HOME_INTERNET_SOURCES,'test',{env,analyze})).status,'daily_limit');
    assert.equal(calls,1);assert.equal((await getAdVisuals(db)).rows.length,0);
    const status=await getCloudStatus(db,{env});assert.equal(status.calls_today,1);assert.equal(status.candidates.retry,1);
  }finally{await db.close()}
});
test('vision normalizer refuses invented totals, unsupported commitments and category guesses',()=>{
  const v=vision(),candidate={ad_text:'Numaranızı taşıyın',has_video:true};
  v.visible_text='25 GB 25 GB Özgür Pass 799 TL 6+6 ay 2X';v.offer.data_gb=50;v.field_evidence.data_gb='25 GB';
  v.offer.bonus_data_gb=25;v.field_evidence.bonus_data_gb='25 GB Özgür Pass';v.offer.commitment_months=12;v.field_evidence.commitment_months='6+6 ay';
  v.offer.billing_period='monthly';v.field_evidence.billing_period='799 TL';
  const a=normalizeVision(v,candidate);assert.equal(a.offer.data_gb,null);assert.equal(a.offer.bonus_data_gb,null);assert.equal(a.offer.commitment_months,null);assert.equal(a.offer.billing_period,'unknown');assert.match(a.uncertainties.join(' '),/yalnız yakalanan karesi/);
  v.category_evidence='MNP yeni müşteriler';assert.equal(normalizeVision(v,{...candidate,ad_text:'Ürün tanıtımı'}).category,'review');
  const supported=normalizeVision(v,candidate);assert.equal(supported.category,'mnp');assert.ok((v.visible_text+' '+candidate.ad_text).includes(supported.category_evidence));
  v.category='review';assert.equal(normalizeVision(v,candidate).category,'review');
});
test('vision request uses actual image bytes, strict schema, no storage and handles provider refusal',async()=>{
  let body;
  const fetcher=async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(opts.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(vision())}]}]}))};
  const a=await analyzeCloudImage({brand:'Telsim',ad_id:'99999999',ad_text:'Numaranızı taşıyın'},[jpeg],{env,fetcher});
  assert.equal(a.category,'mnp');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input[0].content[1].image_url,'data:image/jpeg;base64,'+jpeg.toString('base64'));
  await assert.rejects(analyzeCloudImage({},[jpeg],{env:{},fetcher}),/VISION_NOT_CONFIGURED/);
  await assert.rejects(analyzeCloudImage({},[jpeg],{env,fetcher:async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal'}]}]}))}),/VISION_REFUSED/);
  await assert.rejects(analyzeCloudImage({},[jpeg],{env,fetcher:async()=>new Response('secret provider error',{status:401})}),/VISION_AUTH_ERROR/);
});
test('capture detects blocks and explicit empty results without equating parse failure to no ads',()=>{
  assert.equal(pageState('Log in to continue'),'blocked');assert.equal(pageState('No matching structure'),'unknown');assert.equal(pageState('0 results'),'no_ads');assert.equal(pageState('Library ID: 123456'),'cards');assert.equal(pageState('',429),'rate_limited');assert.equal(adLibrarySource({brand:'unknown'}),null);
  assert.equal(pageState('Hiçbir reklam arama kriterinizle eşleşmiyor'),'no_ads');
  assert.equal(pageState('No ads match your search criteria'),'no_ads');
  assert.equal(pageState('Log in to continue\nNo ads match your search criteria'),'blocked');
  const dom=new JSDOM('<div><article><span>Library ID: 123456</span><button>See ad details</button><img></article><article><span>Library ID: 234567</span><button>See ad details</button><img></article></div>',{runScripts:'outside-only'});
  for(const img of dom.window.document.querySelectorAll('img')){Object.defineProperty(img,'naturalWidth',{value:600});Object.defineProperty(img,'naturalHeight',{value:800});img.getBoundingClientRect=()=>({width:400,height:500})}
  const videoCard=dom.window.document.createElement('article');videoCard.innerHTML='<span>Library ID: 345678</span><button>See ad details</button><video></video>';dom.window.document.body.append(videoCard);
  const video=videoCard.querySelector('video');Object.defineProperties(video,{readyState:{value:2},videoWidth:{value:600},videoHeight:{value:400}});video.getBoundingClientRect=()=>({width:400,height:300});
  const cards=dom.window.eval('('+markAdCards.toString()+')()');assert.equal(cards.length,3);assert.equal(dom.window.document.querySelectorAll('article[data-mp-ad-card]').length,3);assert.equal(cards.find(x=>x.ad_id==='345678').has_video,true);dom.window.close();
});
test('cloud scan endpoint only queues work, rejects cross-site requests and shares durable throttling',async()=>{
  const {default:express}=await import('express');const db=await dbFixture();
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.appUser={id:1,role:'admin'};next()});registerCloudRoutes(app,db,HOME_INTERNET_SOURCES);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/ad-visuals/scan';
  try{
    const post=headers=>fetch(url,{method:'POST',headers,body:'{}'});
    assert.equal((await post({'Content-Type':'application/json',Origin:'https://other.example'})).status,403);
    assert.equal((await post({'Content-Type':'application/json'})).status,202);
    assert.equal((await post({'Content-Type':'application/json'})).status,429);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_candidates')).rows[0].n,0);
    const aiUrl=url.replace('/scan','/analyze');
    assert.equal((await fetch(aiUrl,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'})).status,403);
    assert.equal((await fetch(aiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'https://untrusted.example/'})})).status,400);
    assert.equal((await fetch(aiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,202);
    assert.equal((await fetch(aiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,429);
  }finally{await new Promise(r=>server.close(r));await db.close()}
});
