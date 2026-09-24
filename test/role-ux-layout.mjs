// Full production UI, synthetic local API data, no external services or mutations.
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import {marketPulseFromRows} from '../src/intelligence.js';
import {buildBenchmark} from '../src/kktcell-benchmark.js';
import {HOME_INTERNET_SOURCES,marketPayload} from '../src/home-internet.js';
import {normalizeOffer} from '../src/isp-economics.js';

const now=new Date(),at=now.toISOString(),hash='a'.repeat(64),output='test-output/roles';
const source={id:1,name:'Telsim Faturasız',slug:'faturasiz',url:'https://www.kktctelsim.com/paketler',last_status:'ok',last_checked_at:at,parsed_count:3,active_products:3,http_status:200,response_ms:142};
const packages=['Super Databol Medium','Super Databol Large','Super Databol Extra'].map((name,i)=>({id:i+1,name,current_name:name,source_id:1,source_name:source.name,source_slug:source.slug,source_url:source.url,active:true,data_gb:20+i*10,bonus_data_gb:5,local_tr_minutes:1000,international_minutes:0,sms:1000,validity_days:30,price_try:500+i*100,captured_at:at}));
const changes=packages.map((p,i)=>({id:i+1,scan_id:1,product_id:p.id,detected_at:new Date(+now-60000).toISOString(),source_name:source.name,source_slug:source.slug,source_url:source.url,product_name:p.name,identity_base:p.name,severity:'high',change_type:'field_changed',field_name:'Fiyat',old_value:String(p.price_try+100),new_value:String(p.price_try),extras_json:{}}));
const kSource={name:'KKTCELL Faturasız',slug:'kktcell-faturasiz',type:'prepaid',url:'https://www.kktcell.com/faturasiz',ok:true,parsed_count:3,core_count:3,response_ms:97};
const benchmark={...buildBenchmark(packages,packages.map((p,i)=>({name:['Yeni GO M','Yeni GO L','Yeni GO XL'][i],source_slug:kSource.slug,source_url:kSource.url,product_url:'/go-'+i,type:'prepaid',is_core:true,data_gb:p.data_gb,bonus_data_gb:5,local_tr_minutes:1000,sms:1000,validity_days:30,price_try:p.price_try-20})),[],{sources:[kSource]}),kktcell_sources:[kSource]};
const trend={series:[{day:'2026-09-16',score:52},{day:'2026-09-23',score:57}],deltas:{'7d':5},latest:{score:57},baselines:{'7d':{score:52}}};
const homeSource=HOME_INTERNET_SOURCES.find(s=>s.slug==='kibrisonline-home');
const offers=[10,20,30].map((speed,i)=>normalizeOffer({source_slug:homeSource.slug,provider:homeSource.provider,name:'Ev Paketi '+(i+1),technology:'WDSL',speed_down_mbps:speed,duration_months:12,bonus_months:2,total_price_try:8400+i*1400,product_key:'role-home-'+i,source_url:homeSource.url}));
const home=marketPayload([{source_slug:homeSource.slug,status:'ok',captured_at:at,payload_json:offers,parsed_count:offers.length,source_meta_json:{parser_version:'home-isp-2'}}],[]);
const categories={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'Diğer / Belirsiz'};
const ads=['home','gsm'].map((category,i)=>({key:'role-ad-'+i,ad_id:'123456'+i,brand:'Telsim',category,category_label:categories[category],title:i?'Gençlere Özel 25 GB':'Ev İnterneti 20 Mbps',category_evidence:'Görsel teklif başlığı',ad_status:'active',observed_at:at,first_seen_at:at,ai_queue_status:'analyzed',ai_analysis:{status:'completed',analyzed_at:at,pass:1},source_url:'https://www.facebook.com/kktctelsim',offer:{price_try:779,previous_price_try:995,speed_mbps:i?null:20,data_gb:i?25:null},conditions:['12 aylık kullanım koşulu geçerlidir.'],uncertainties:[],visual_summary:'779 TL karşılığında kampanya teklifi.',images:[{sha256:hash,captured_at:at}]}));
const adData={rows:ads,categories,groups:{home:1,gsm:1,mnp:0,review:0},source_directory:[{brand:'Telsim',page_id:'164143610515',verified:true,country:'CY',ad_library_type:'page',ad_library_url:'https://www.facebook.com/ads/library/?country=CY&view_all_page_id=164143610515'}],monitoring:{status:'ok',checked_at:at,imported_at:at,schedule:{enabled:true,description:'Günlük tarama'},coverage:[]},cloud:{vision_configured:true,worker_online:true,worker_heartbeat:at,message:'Sunucu kuyruğu hazır',candidates:{analyzed:2,pending:1},capture_provider:{enabled:true,provider:'apify',configured:true,message:'Provider bağlantısı hazır'},sources:[]}};
const record={id:1,source_id:1,source_name:source.name,source_slug:source.slug,source_url:source.url,captured_at:at,kind:'change',parsed_count:3,change_count:3,package_names:packages.map(p=>p.name),has_focus:true,has_screenshot:true,has_html:true,has_json:true};
const evidence={items:[record],page:1,page_size:24,total:1,summary:{total:1,changed:1,complete:1,missing:0,newest:at},sources:[{slug:source.slug,name:source.name,count:1}]};
const jpeg=await sharp(Buffer.from('<svg width="720" height="420" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="420" fill="#001c72"/><text x="45" y="125" fill="white" font-size="40">Telsim kampanya</text><text x="45" y="230" fill="#ffd500" font-size="66">779 TL / 20 Mbps</text></svg>')).jpeg({quality:75}).toBuffer();
const cases=new Map(),requests=[],unknown=[],app=express();
app.use((req,res,next)=>{const key=/role_ux_case=([^;]+)/.exec(req.headers.cookie||'')?.[1];req.previewCase=cases.get(key);next()});
app.use('/api',(req,res,next)=>{
  requests.push({caseId:req.previewCase?.id,role:req.previewCase?.role,method:req.method,path:req.path,query:{...req.query}});
  if(req.method!=='GET')return res.status(405).json({error:'Read-only layout fixture'});
  next();
});
app.get('/api/auth/me',async(req,res)=>{await req.previewCase.gate;res.json({user:{id:1,first_name:'Deniz',last_name:'Örnek',username:'demo',role:req.previewCase.role,email:'demo@example.test'}})});
app.get('/api/summary',(_,res)=>res.json({active_products:3,changes_today:3,changes_24h:3,sources:[source]}));
app.get('/api/packages',(_,res)=>res.json(packages));
app.get('/api/comparison',(_,res)=>res.json({rows:packages.map(p=>({...p,current_name_version:p.name,current_data_gb:p.data_gb,previous_data_gb:p.data_gb,current_price_try:p.price_try,previous_price_try:p.price_try+100,previous_version_id:1,changed:true}))}));
app.get('/api/value-index',(_,res)=>res.json(packages.map((p,i)=>({...p,rank:i+1,gb_per_100tl:p.data_gb/p.price_try*100}))));
app.get('/api/market-pulse',(req,res)=>res.json(marketPulseFromRows(changes,Number(req.query.days)||30,now)));
app.get('/api/product/:id/history',(req,res)=>res.json([packages.find(p=>p.id===Number(req.params.id))]));
app.get('/api/benchmark',(_,res)=>res.json(benchmark));
app.get('/api/benchmark-history',(_,res)=>res.json({trends:{Toplam:trend,Genel:trend},first_recorded_at:at}));
app.get('/api/home-internet',(_,res)=>res.json(home));
app.get('/api/home-internet/social-observations',(_,res)=>res.json({rows:[]}));
app.get('/api/ad-visuals',(req,res)=>res.json(req.query.category?{...adData,rows:ads.filter(a=>a.category===req.query.category),pagination:{total:ads.filter(a=>a.category===req.query.category).length,has_more:false}}:adData));
app.get('/api/ad-visuals/pending',(_,res)=>res.json({rows:[],pagination:{total:0,has_more:false}}));
app.get('/api/ad-visuals/history',(_,res)=>res.json({rows:[{observed_at:at,event_type:'first_seen',analysis_json:ads[0]}]}));
app.get('/api/ad-visuals/evidence/:hash',(_,res)=>res.type('jpeg').send(jpeg));
app.get('/api/evidence',(_,res)=>res.json(evidence));
app.get('/api/evidence/:id',(_,res)=>res.json({...record,packages,changes,previous:null}));
app.get('/api/snapshots/:id/:kind',(_,res)=>res.type('jpeg').send(jpeg));
app.get('/api/reports/status',(_,res)=>res.json({email:{configured:true,daily_cron:'0 8 * * *',weekly_cron:'0 8 * * 1',timezone:'Asia/Famagusta',recipients:['demo@example.test'],from:'reports@example.test'},recent_runs:[{generated_at:at,report_type:'daily',trigger_type:'cron',delivery_status:'sent',recipients:['demo@example.test'],file_size_bytes:120000}]}));
app.get('/api/admin/match-review',(_,res)=>res.json({effective_counts:{Primary:3,Secondary:1,Review:1,Reject:1},override_count:1}));
app.get('/api/admin/users',(_,res)=>res.json({users:[{id:1,first_name:'Deniz',last_name:'Örnek',username:'demo',email:'demo@example.test',role:'admin',active:true}]}));
app.use('/api',(req,res)=>{unknown.push(req.originalUrl);res.status(404).json({error:'Unexpected fixture API'})});
app.get('/',async(_,res)=>res.type('html').send(await readFile('public/index.html','utf8')));
app.use(express.static('public'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const technical=/Comparable Product Engine|Competitive Position Score|\bPrimary\b|\bSecondary\b|\bReject\b|override|shadow|\bmotor\b|metodoloji|baseline|kaynak sağlığı|tarama|bulutta tara|şimdi tara|provider|reklam sağlayıcısı|kuyru|queue|worker|proxy|apify|\bHTTP\b|parser|PostgreSQL|SMTP|\bcron\b|\bJSON\b|\bHTML\b|\bPNG\b|AI inceleme|AI sonucu beklenen/i;
let browser;
async function check(page,role,label){
  const text=await page.evaluate(()=>document.body.innerText);
  if(role==='standard')assert.doesNotMatch(text,technical,label+' exposes operational text');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' horizontal overflow');
  assert.deepEqual(await page.evaluate(()=>window.__roleFlashes),[],label+' exposed an admin element before authorization');
}
async function go(page,route){
  await page.locator('[data-route="'+route+'"]').click();
  await page.waitForFunction(route=>document.body.dataset.view===route,{},route);
}
async function screenshot(page,role,width,route){
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${output}/${role}-${route}-${width}.jpg`,type:'jpeg',quality:75,fullPage:false});
}
try{
  const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  await mkdir(output,{recursive:true});
  for(const role of ['standard','admin'])for(const width of [1440,390]){
    const id=role+'-'+width;let release;
    cases.set(id,{id,role,gate:new Promise(resolve=>{release=resolve})});
    const page=await browser.newPage(),errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:960});
    await page.setCookie({name:'role_ux_case',value:id,url:origin});
    await page.setRequestInterception(true);
    page.on('request',request=>{if(!request.url().startsWith(origin+'/')&&!request.url().startsWith('data:')){external.push(request.url());request.abort()}else request.continue()});
    await page.evaluateOnNewDocument(()=>{
      localStorage.setItem('marketPulseThemeMode','light');window.__roleFlashes=[];
      const inspect=()=>{
        if(document.documentElement.dataset.userRole!=='admin')for(const el of document.querySelectorAll('[data-admin-only]'))if(el.checkVisibility({checkVisibilityCSS:true}))window.__roleFlashes.push(el.id||el.textContent.slice(0,80));
        requestAnimationFrame(inspect);
      };document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(inspect),{once:true});
    });
    try{
      await page.goto(origin+'/#dashboard',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.MarketPulseAccess&&document.documentElement.dataset.userRole==='pending');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await check(page,'standard',id+' pending');
      assert.ok(requests.filter(r=>r.caseId===id).every(r=>r.path==='/auth/me'),'data requests must wait for authentication');
      release();
      await page.waitForFunction(role=>document.documentElement.dataset.userRole===role&&document.body.dataset.view==='dashboard',{},role);
      await page.waitForSelector('.mp-move');await page.waitForSelector('.bm-score-card');
      assert.match(await page.$eval('#executiveInsights',el=>el.textContent),/Genel/);
      await check(page,role,id+' dashboard');await screenshot(page,role,width,'dashboard');

      await go(page,'competitor');await page.waitForSelector('.tl',{visible:true});
      assert.match(await page.$eval('#timeline',el=>el.innerText),/600.*500/s);
      assert.match(await page.$eval('#packageRows',el=>el.textContent),/Super Databol/);
      if(role==='admin')assert.match(await page.evaluate(()=>document.body.innerText),/Kaynak Sağlığı/);
      await page.type('#packages-section .search','Medium');
      assert.equal(await page.$$eval('#packageRows tr',els=>els.length),1);
      await page.$eval('#packages-section .search',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))});
      await check(page,role,id+' competitor');await screenshot(page,role,width,'competitor');

      await go(page,'ads');await page.waitForSelector('#ad-visual-section .av-card');
      await page.locator('#ad-visual-section [data-av-category="gsm"]').click();
      await page.waitForFunction(()=>document.querySelector('#ad-visual-section .av-card h3')?.textContent.includes('25 GB'));
      await page.locator('#ad-visual-section .av-card details summary').click();
      assert.match(await page.$eval('#ad-visual-section .av-card',el=>el.innerText),/779|12 aylık/);
      if(role==='admin')assert.match(await page.evaluate(()=>document.body.innerText),/Bulut taraması ve analiz kuyruğu/);
      await check(page,role,id+' ads');await screenshot(page,role,width,'ads');

      await go(page,'home');await page.waitForSelector('#hiProducts [data-pick]');
      await page.locator('#hiProducts [data-pick="role-home-0"]').click();
      await page.locator('#hiProducts [data-pick="role-home-1"]').click();
      await page.locator('#home-internet-section [data-view="compare"]').click();
      assert.equal(await page.$$eval('#hiCompareResult .hi-comparison thead th',els=>els.length),3);
      await check(page,role,id+' home compare');
      await page.locator('#home-internet-section [data-view="tracking"]').click();
      await check(page,role,id+' home');await screenshot(page,role,width,'home');

      await go(page,'compare');await page.waitForSelector('.bm-table tbody tr');
      assert.match(await page.$eval('#bmBox',el=>el.innerText),/Super Databol|Yeni GO/);
      assert.equal(await page.$$eval('.bm-table th',els=>els.length),role==='admin'?12:6);
      if(role==='admin')assert.match(await page.evaluate(()=>document.body.innerText),/Comparable Product Engine/);
      await go(page,'trends');
      await page.locator('.bm-horizon:nth-child(2)').click();
      assert.equal(await page.$eval('.bm-horizon.active',el=>el.textContent),'30 Gün');
      await check(page,role,id+' trends');await go(page,'compare');
      await check(page,role,id+' benchmark');await screenshot(page,role,width,'benchmark');

      await go(page,'evidence');await page.waitForSelector('.ev-card');
      await page.locator('.ev-card .ev-open').click();await page.waitForSelector('#evDetailImage');
      await page.waitForFunction(()=>document.querySelector('#evDetailImage')?.complete&&document.querySelector('#evDetailImage').naturalWidth>0);
      assert.match(await page.$eval('#evDetailTitle',el=>el.textContent),/Telsim/);
      await check(page,role,id+' evidence detail');
      await page.locator('#evClose').click();await screenshot(page,role,width,'evidence');

      await go(page,'reports');await page.waitForFunction(()=>document.querySelector('#reportEmailBadge')?.textContent.includes('gönderilebilir'));
      assert.ok(await page.$$eval('#reports-section .report-card .btn.primary',els=>els.filter(el=>el.checkVisibility()).length)>=6);
      assert.ok(await page.$$eval('#reports-section [data-report-email]',els=>els.filter(el=>el.checkVisibility()).every(el=>!el.disabled)));
      if(role==='admin')assert.match(await page.evaluate(()=>document.body.innerText),/E-posta altyapısı/);
      await check(page,role,id+' reports');await screenshot(page,role,width,'reports');
      if(role==='standard'){
        await page.evaluate(async()=>{await scanNow();await loadBenchmark(true);await HomeInternetUI.scan();await MarketPulseAdminTools.refreshMatchReviewStatus()});
        const audit=requests.filter(r=>r.caseId===id);
        assert.ok(audit.every(r=>r.method==='GET'&&r.query.refresh!=='1'&&!r.path.startsWith('/admin/')&&!r.path.includes('/pending')&&!r.path.includes('/scan')&&!r.path.includes('/analyze')),JSON.stringify(audit));
      }
      assert.deepEqual(errors,[],id+' browser errors');assert.deepEqual(external,[],id+' external requests');
      console.log('ROLE_UX_LAYOUT '+id+' OK');
    }catch(error){await page.screenshot({path:`${output}/${id}-failure.jpg`,type:'jpeg',quality:75,fullPage:false}).catch(()=>{});throw error}
    finally{release();await page.close()}
  }
  assert.deepEqual(unknown,[],'all production API requests need explicit fixtures');
  const files=(await readdir(output)).filter(name=>name.endsWith('.jpg'));
  assert.equal(files.length,28);
  const bytes=(await Promise.all(files.map(file=>stat(output+'/'+file)))).reduce((total,file)=>total+file.size,0);
  assert.ok(bytes<5*1024*1024,'viewport JPEG artifact should stay below 5 MiB');
  console.log('ROLE_UX_SCREENSHOTS '+files.length+' JPEGs, '+bytes+' bytes');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
