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
test('empty dashboard retains the verified ISP directory independently of image imports',async()=>{
  const {default:express}=await import('express');const db=await dbFixture(),app=express();
  const blocked={brand:'Nethouse',status:'blocked',captured:0,note:'Ad Library erişimi HTTP 403 ile sonuçlandı.'};
  registerAdVisualRoutes(app,db,HOME_INTERNET_SOURCES,{cloudStatus:async()=>({sources:[blocked]})});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ad-visuals');
    assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.rows,[]);
    for(const [brand,id] of [['Nethouse','159064954156749'],['Kıbrıs Online','107418628779416']]){
      const source=data.source_directory.find(s=>s.brand===brand);assert.ok(source,brand+' missing');
      assert.equal(source.page_id,id);assert.equal(new URL(source.ad_library_url).searchParams.get('view_all_page_id'),id);
    }
    assert.deepEqual(data.cloud.sources,[blocked]);
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
test('registered ISPs remain selectable without images, live blocking supersedes old no-ads coverage, and home respects brands',async()=>{
  const telsim={...valid(fixture('home')).ads[0],key:'home',brand:'Telsim'};
  const directory=[['Nethouse','159064954156749'],['Kıbrıs Online','107418628779416'],['Yeni kaynak','123456789']].map(([brand,page_id])=>({brand,page_id,ad_library_type:'page',ad_library_url:'https://www.facebook.com/ads/library/?view_all_page_id='+page_id}));
  const data={rows:[telsim],groups:{home:1},source_directory:directory,
    monitoring:{status:'partial',coverage:[{brand:'Nethouse',status:'no_ads',checked_at:iso(0),source_url:directory[0].ad_library_url,note:'Eski taramada reklam yok.'},{brand:'Eski kapsam markası',status:'pending'}]},
    cloud:{sources:[{brand:'Nethouse',status:'blocked',captured:0,finished_at:iso(1),note:'Ad Library erişimi HTTP 403 ile sonuçlandı. Reklam yok olarak yorumlanmadı.'},{brand:'Kıbrıs Online',status:'blocked',captured:0,finished_at:iso(1),note:'Ad Library erişimi HTTP 403 ile sonuçlandı.'},{brand:'Kuyruktaki kaynak',status:'queued',captured:0}]}};
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'});
  dom.window.fetch=async()=>({ok:true,json:async()=>data});
  try{
    dom.window.eval(await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8'));
    await dom.window.AdVisualUI.load();await dom.window.AdVisualUI.mountHome();const d=dom.window.document;
    const choices=[...d.querySelector('#ad-visual-section [data-av-brand]').options].map(x=>x.value);
    for(const brand of ['Nethouse','Kıbrıs Online','Yeni kaynak','Eski kapsam markası','Kuyruktaki kaynak','Telsim'])assert.ok(choices.includes(brand),brand+' missing');
    assert.match(d.querySelector('.av-coverage>summary').textContent,/3 sayfada görsel bekleniyor/);
    assert.equal(d.querySelector('.av-coverage').open,false);
    for(const source of directory.slice(0,2)){
      const filter=d.querySelector('#hiAdVisualMount [data-av-brand]');filter.value=source.brand;filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      for(const root of d.querySelectorAll('.av-root')){
        assert.equal(root.querySelectorAll('.av-card').length,0);
        assert.equal(root.querySelector('[data-av-brand]').value,source.brand);
        const focus=root.querySelector('.av-source-focus');assert.match(focus.textContent,/HTTP 403/);assert.match(focus.textContent,/Kaynağa erişilemiyor/);
        assert.equal(new URL(focus.querySelector('a').href).searchParams.get('view_all_page_id'),source.page_id);
        assert.doesNotMatch(focus.textContent,/Eski taramada reklam yok|Son taramada bu filtrede reklam bulunamadı|0 kayıt/);
        assert.match(root.querySelector('.av-empty').textContent,/reklam olmadığı anlamına gelmez/);
      }
    }
    const home=d.querySelector('#hiAdVisualMount [data-av-brand]');home.value='Yeni kaynak';home.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.match(d.querySelector('#hiAdVisualMount .av-source-focus').textContent,/Henüz taranmadı/);
    home.value='all';home.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,1);
    assert.equal(d.querySelector('#hiAdVisualMount .av-source-focus').textContent,'');
  }finally{dom.window.close()}
});
test('source states distinguish a successful empty scan, retry and unpublished analysis while escaping source text',async()=>{
  const source_directory=['Boş sonuç','Yeniden denenecek','AI sonucu beklenen','<img src=x onerror=bad()>'].map((brand,i)=>({brand,page_id:'12345678'+i,ad_library_url:i===3?'javascript:bad()':'https://www.facebook.com/ads/library/?view_all_page_id=12345678'+i}));
  const sources=[{brand:'Boş sonuç',status:'no_ads',captured:0,finished_at:iso(0)},{brand:'Yeniden denenecek',status:'retry',captured:0,available_at:iso(3),note:'Proxy bağlantısı kurulamadı.'},{brand:'AI sonucu beklenen',status:'partial',captured:2,finished_at:iso(0)},{brand:source_directory[3].brand,status:'blocked',captured:0,note:'<script>bad()</script>'}];
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'});
  dom.window.fetch=async()=>({ok:true,json:async()=>({rows:[],source_directory,cloud:{sources}})});
  try{
    dom.window.eval(await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8'));await dom.window.AdVisualUI.load();const d=dom.window.document;
    for(const [brand,pattern] of [['Boş sonuç',/Son taramada bu filtrede reklam bulunamadı/],['Yeniden denenecek',/Sonraki deneme/],['AI sonucu beklenen',/Görseller kaydedildi; analiz sonucu henüz yayınlanmadı/],[source_directory[3].brand,/<script>bad\(\)<\/script>/]]){
      const filter=d.querySelector('[data-av-brand]');filter.value=brand;filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      assert.match(d.querySelector('.av-source-focus').textContent,pattern);assert.equal(d.querySelectorAll('.av-card').length,0);
      if(brand==='Boş sonuç')assert.match(d.querySelector('.av-empty').textContent,/Yeni taramalarda sonuç değişebilir/);
    }
    assert.equal(d.querySelector('.av-source-focus a'),null);assert.equal(d.querySelectorAll('script,img').length,0);
  }finally{dom.window.close()}
});
