import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {validateAdFeed,adMeaningHash,importAdFeed,getAdVisuals,getAdReport,syncAdVisuals,registerAdVisualRoutes,AD_FEED_ROOT} from '../src/ad-visual.js';
import {adVisualReportHtml} from '../src/ad-visual-report.js';
const jpeg=Buffer.from([255,216,255,224,0,0,255,217]),hash=createHash('sha256').update(jpeg).digest('hex');
const start=new Date(Date.now()-3600000),iso=n=>new Date(+start+n*60000).toISOString();
function fixture(category='gsm',n=0){
  return {schema_version:1,producer:'chatgpt-browser-visual',schedule:{enabled:true,description:'Her sabah',timezone:'Asia/Famagusta'},
    run:{id:'fixture-run-'+n,checked_at:iso(n),status:'partial',coverage:[{brand:'Telsim',source_url:'https://www.facebook.com/kktctelsim',country:'CY',status:'partial',checked_at:iso(n),reviewed_ads:1,note:'Bir reklam incelendi'}]},
    ads:[{brand:'Telsim',page_id:'164143610515',ad_id:'1053718350996629',variant_id:'1',category,
      category_evidence:category==='mnp'?'Numaranızın hiçbir rakamı değişmeden':category==='home'?'Vodafone Evde İnternet':'Red Junior tarife 25 GB',title:'Red Junior',
      ad_status:'active',source_url:'https://www.facebook.com/ads/library/?id=1053718350996629',observed_at:iso(n),started_on:'2026-09-14',
      ad_text:'25 GB ve 2X',offer:{price_try:499,previous_price_try:569,data_gb:25,bonus_data_gb:null,minutes:500,speed_mbps:null,commitment_months:null,billing_period:'unknown'},
      conditions:['6–17 yaş'],uncertainties:['2X koşulu okunamadı'],visual_summary:'Kırmızı zemin, fiyat ve çocuk karakterleri',review_required:true,
      images:[{path:'evidence/'+hash+'.jpg',sha256:hash,captured_at:iso(0)}]}]};
}
const valid=f=>validateAdFeed(f,HOME_INTERNET_SOURCES);
async function dbFixture(){const db=new PGlite();await db.exec(SCHEMA_SQL);return db}
test('visual feed separates home, GSM and MNP using explicit evidence, never doubles uncertain GB',()=>{
  for(const category of ['home','gsm','mnp'])assert.equal(valid(fixture(category)).ads[0].category,category);
  const ad=valid(fixture()).ads[0];assert.equal(ad.offer.data_gb,25);assert.equal(ad.offer.bonus_data_gb,null);assert.equal(ad.offer.commitment_months,null);
  const bad=fixture('mnp');bad.ads[0].category_evidence='25 GB herkese';assert.throws(()=>valid(bad),/numara taşıma/);
  const wrongPage=fixture();wrongPage.ads[0].page_id='123456';assert.throws(()=>valid(wrongPage),/uyuşmuyor/);
  const duplicate=fixture();duplicate.ads.push(duplicate.ads[0]);assert.throws(()=>valid(duplicate),/Tekrarlanan/);
});
test('feed refuses arbitrary URLs, paths, future observations and invented numeric values',()=>{
  const mutations=[
    a=>a.source_url='https://facebook.com.evil.example/ad',
    a=>a.source_url='https://user:pass@facebook.com/ad',
    a=>a.images[0].path='../secret.jpg',
    a=>a.offer.price_try='499',
    a=>a.offer.speed_mbps=-1,
    a=>a.observed_at='2099-01-01',
    a=>a.images=[],
    a=>a.category='devices'
  ];
  for(const mutate of mutations){const f=fixture();mutate(f.ads[0]);assert.throws(()=>valid(f))}
});
test('Postgres import deduplicates repeated runs, versions actual changes and keeps data during blocked scans',async()=>{
  const db=await dbFixture();let fetches=0;
  const fetcher=async url=>{assert.ok(url.startsWith(AD_FEED_ROOT+'evidence/'));fetches++;return new Response(jpeg)};
  try{
    const feed=valid(fixture());
    assert.equal((await importAdFeed(db,feed,{fetcher})).changed,1);
    assert.equal((await importAdFeed(db,feed,{fetcher})).duplicate,true);assert.equal(fetches,1);
    const again=valid(fixture('gsm',1));again.ads[0].visual_summary='Aynı görselin başka anlatımı';
    assert.equal(adMeaningHash(again.ads[0]),adMeaningHash(feed.ads[0]));
    assert.equal((await importAdFeed(db,again,{fetcher})).changed,0);
    const changed=valid(fixture('gsm',2));changed.ads[0].offer.price_try=549;
    assert.equal((await importAdFeed(db,changed,{fetcher})).changed,1);
    const blocked=valid(fixture('gsm',3));blocked.run.status='blocked';blocked.ads=[];
    await importAdFeed(db,blocked,{fetcher});
    const data=await getAdVisuals(db);assert.equal(data.rows.length,1);assert.equal(data.rows[0].offer.price_try,549);assert.equal(data.monitoring.status,'blocked');
    assert.equal((await db.query('SELECT * FROM ad_visual_versions')).rows.length,2);
    const stale=await getAdVisuals(db,{now:new Date(+start+72*3600000)});assert.equal(stale.rows[0].stale,true);assert.equal(stale.monitoring.status,'stale');
    assert.equal((await importAdFeed(db,feed,{fetcher})).older,true);
    const report=await getAdReport(db,iso(0),iso(3));assert.equal(report.rows.length,2);
    assert.equal((await getAdReport(db,iso(0),iso(3),{category:'home'})).rows.length,0);
  }finally{await db.close()}
});
test('corrupt screenshots and failed imports cannot replace prior validated data',async()=>{
  const db=await dbFixture();
  try{
    await assert.rejects(importAdFeed(db,valid(fixture()),{fetcher:async()=>new Response('not a jpeg')}),/doğrulanamadı/);
    assert.equal((await db.query('SELECT * FROM ad_visual_items')).rows.length,0);
    await importAdFeed(db,valid(fixture()),{fetcher:async()=>new Response(jpeg)});
    const broken=await syncAdVisuals(db,HOME_INTERNET_SOURCES,{fetcher:async()=>new Response('bad json')});assert.equal(broken.ok,false);
    const data=await getAdVisuals(db);assert.equal(data.rows.length,1);assert.equal(data.monitoring.status,'sync_error');
  }finally{await db.close()}
});
test('a valid checkpoint clears the initial setup error and logs persisted category/evidence totals',async()=>{
  const db=await dbFixture();
  try{
    const failed=valid(fixture());failed.ads=[];failed.run.status='error';
    await importAdFeed(db,failed);
    const checkpoint=fixture('home',1);
    const fetcher=async url=>new Response(url.endsWith('latest.json')?JSON.stringify(checkpoint):jpeg);
    const result=await syncAdVisuals(db,HOME_INTERNET_SOURCES,{fetcher});
    assert.equal(result.imported,1);assert.deepEqual(result.stored_groups,{home:1});assert.equal(result.stored_evidence,1);
    const data=await getAdVisuals(db);assert.equal(data.monitoring.status,'partial');assert.equal(data.monitoring.last_error,null);assert.equal(data.rows.length,1);
  }finally{await db.close()}
});
test('manual sync imports immediately, rejects cross-site requests and bounds repeated work',async()=>{
  const {default:express}=await import('express');const db=await dbFixture();
  let calls=0,clock=100000;
  const app=express();app.use(express.json());
  registerAdVisualRoutes(app,db,HOME_INTERNET_SOURCES,{now:()=>clock,sync:async()=>{calls++;return importAdFeed(db,valid(fixture()),{fetcher:async()=>new Response(jpeg)})}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port+'/api/ad-visuals/sync';
  try{
    const post=headers=>fetch(url,{method:'POST',headers,body:'{}'});
    assert.equal((await post({'Content-Type':'application/json',Origin:'https://other.example'})).status,403);
    assert.equal((await post({'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await post({'Content-Type':'text/plain'})).status,415);assert.equal(calls,0);
    const response=await post({'Content-Type':'application/json'});assert.equal(response.status,200);assert.equal((await response.json()).groups.gsm,1);assert.equal(calls,1);
    const limited=await post({'Content-Type':'application/json'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(calls,1);
    clock+=60000;assert.equal((await post({'Content-Type':'application/json'})).status,200);assert.equal(calls,2);
  }finally{await new Promise(r=>server.close(r));await db.close()}
});
test('report includes separate categories, qualifies first observations and escapes stored analysis',()=>{
  const ad=valid(fixture('mnp')).ads[0];ad.title='<img src=x onerror=bad()>';
  const html=adVisualReportHtml({checked_at:iso(0),status:'partial',rows:[{event_type:'first_seen',analysis_json:ad}]});
  const dom=new JSDOM(html);try{
    const d=dom.window.document;assert.equal(d.querySelector('img,script'),null);
    for(const text of ['Ev İnterneti','GSM Paketleri','MNP / Numara Taşıma','2X koşulu okunamadı','yayına başladığı anlamına gelmez'])assert.ok(d.body.textContent.includes(text));
  }finally{dom.window.close()}
});
test('UI category navigation isolates GSM/MNP and home embeds only fixed-home ads with evidence links',async()=>{
  const ads=['home','gsm','mnp'].map((category,i)=>({...valid(fixture(category)).ads[0],key:'key'+i,ad_id:String(123450+i),title:category==='mnp'?'<script>bad()</script>':category,stale:i===1}));
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'});
  const requests=[];
  dom.window.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({rows:ads,groups:{home:1,gsm:1,mnp:1},monitoring:{status:'partial',checked_at:iso(0),schedule:{enabled:true,description:'Her sabah'},coverage:[]}})}};
  try{
    dom.window.eval(await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8'));
    await dom.window.AdVisualUI.load();const d=dom.window.document;
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);
    dom.window.AdVisualUI.setCategory('mnp');
    assert.match(d.querySelector('#ad-visual-section .av-card h3').textContent,/<script>/);assert.equal(d.querySelectorAll('#ad-visual-section script').length,0);
    await dom.window.AdVisualUI.mountHome();
    assert.equal(d.querySelector('#hiAdVisualMount .av-card h3').textContent,'home');
    dom.window.AdVisualUI.setCategory('gsm');assert.match(d.querySelector('#ad-visual-section .av-flags').textContent,/Son doğrulanmış/);
    assert.equal(d.querySelector('#hiAdVisualMount .av-card h3').textContent,'home');
    assert.match(d.querySelector('.av-image a')?.href||d.querySelector('.av-image').href,/\/api\/ad-visuals\/evidence\//);
    d.querySelector('#ad-visual-section [data-av-refresh]').click();await dom.window.AdVisualUI.load();
    assert.equal(requests.at(-1).url,'/api/ad-visuals');assert.equal(requests.at(-1).options.cache,'no-store');
    assert.equal(d.querySelector('#ad-visual-section [data-av-refresh]').disabled,false);
  }finally{dom.window.close()}
});
