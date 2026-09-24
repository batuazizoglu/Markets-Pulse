import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const [adScript,homeScript]=await Promise.all(['ad-visual','home-internet'].map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
const at='2026-09-24T06:00:00Z';
const library='https://www.facebook.com/ads/library/?country=CY&view_all_page_id=127496543986832';
const technical='ADMIN_TECHNICAL_NOTE';
const nextTick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(check,label){for(let i=0;i<30;i++){if(check())return;await nextTick()}assert.fail(label)}
function ad(category){return {key:category,brand:'KKTCELL',category,title:category+' kampanyası',ad_id:'123456789',page_id:'127496543986832',source_url:library,observed_at:at,first_seen_at:at,ad_status:'active',visual_summary:'Yeni teklif',category_evidence:'Görseldeki hizmet',offer:{price_try:499,billing_period:'monthly'},conditions:['12 ay geçerli'],uncertainties:[],images:[{sha256:'a'.repeat(64),captured_at:at}]}}
function adData(){return {
  rows:['home','gsm','mnp','review'].map(ad),groups:{home:1,gsm:1,mnp:1,review:1},brand_groups:{KKTCELL:{home:1,gsm:1,mnp:1,review:1}},
  pending_media:{total:1,brand_totals:{KKTCELL:1}},
  source_directory:[{brand:'KKTCELL',page_id:'127496543986832',ad_library_url:library,facebook:'https://www.facebook.com/kktcell',research_note:technical}],
  monitoring:{status:'ok',checked_at:at,imported_at:at,last_error:technical},
  cloud:{worker_online:true,vision_configured:true,message:technical,candidates:{pending:1},sources:[{brand:'KKTCELL',status:'partial',note:technical,finished_at:at,captured:1}],capture_provider:{enabled:true,configured:true,provider:'apify',message:technical,runs:[]}}
}}
function homeData(){return {
  products:[1,2].map(i=>({product_key:'plan-'+i,provider:'Test ISP',name:'Paket '+i,technology:'WDSL',product_family:'fixed',market_segment:'residential',speed_down_mbps:i*20,speed_up_mbps:10,duration_months:12,total_price_try:1200*i,effective_monthly_try:100*i,source_url:'https://isp.example/packages',verified_at:at,features:[]})),
  metrics:{tracked_companies:1,changes_7d:1},
  sources:[{slug:'test-home',provider:'Test ISP',name:'Paket kaynağı',url:'https://isp.example/packages',status:'ok',parsed_count:2,captured_at:at,error:technical}],
  companies:[{legal_name:'Test ISP Ltd',brands:['Test ISP'],website:'https://isp.example',sources:[],status:'tracked',current_products:2,priced_products:2}],
  changes:[{source_slug:'test-home',provider:'Test ISP',product_name:'Paket 1',change_type:'changed',field_name:'Fiyat',old_value:'90',new_value:'100',detected_at:at}],
  campaigns:[{provider:'Test ISP',name:'Sonbahar kampanyası',availability:'active',campaign_text:'İlk ay hediye',verified_at:at,url:'https://isp.example/campaign'}],
  social:[{brand:'KKTCELL',ad_library_url:library,ad_library_type:'verified_page',facebook:'https://www.facebook.com/kktcell',instagram:'https://www.instagram.com/kktcell',research_note:technical}],
  scope:{note:technical}
}}
function fixture(module,role='standard',{deferred=false,helper=true,projected=false}={}){
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://www.marketspulse.cloud/#'+(module==='ads'?'ads':'home'),runScripts:'outside-only'}),requests=[];
  let user=deferred?null:{id:1,role},resolveReady;
  const ready=deferred?new Promise(resolve=>{resolveReady=resolve}):Promise.resolve(user);
  if(helper)dom.window.MarketPulseAccess={ready,isAdmin:()=>user?.role==='admin',getUser:()=>user,subscribe:()=>()=>{}};
  dom.window.fetch=async (url,options={})=>{
    requests.push({url:String(url),method:options.method||'GET'});
    const path=new URL(url,dom.window.location.href).pathname;
    let data;
    if(path==='/api/ad-visuals'){
      data=adData();
      if(projected){
        for(const key of ['cloud','monitoring','pending_media'])delete data[key];
        data.source_directory=data.source_directory.map(({research_note,...source})=>source);
        data.display_status={incomplete:true,updated_at:at};
      }
    }
    else if(path==='/api/home-internet')data=homeData();
    else if(path==='/api/ad-visuals/pending')data={rows:[],pagination:{total:1,has_more:false}};
    else if(path==='/api/home-internet/social-observations')data={rows:[],mode:'manual'};
    else if(['/api/ad-visuals/scan','/api/ad-visuals/analyze'].includes(path))data={message:'Test işlemi'};
    else throw new Error('Unexpected request: '+url);
    return {ok:true,json:async()=>data};
  };
  dom.window.eval(module==='ads'?adScript:homeScript);
  return {dom,d:dom.window.document,requests,resolve:()=>{user={id:1,role};resolveReady(user)},load:()=>module==='ads'?dom.window.AdVisualUI.load():dom.window.HomeInternetUI.load()};
}
function noAdminPanels(d,selector){for(const element of d.querySelectorAll(selector))assert.ok(element.hidden&&!element.textContent.trim(),'Admin panel must be absent or empty and hidden')}

test('standard ads retain published filters, evidence and review without technical panels or writable actions',async()=>{
  for(const projected of [false,true]){
  const f=fixture('ads','standard',{projected});const {dom,d,requests}=f;
  try{
    await f.load();
    assert.deepEqual([...d.querySelectorAll('[data-av-category]')].map(x=>x.dataset.avCategory),['home','gsm','mnp','review']);
    assert.match(d.querySelector('[data-av-brand]').textContent,/KKTCELL/);
    assert.match(d.querySelector('.av-card').textContent,/home kampanyası/);
    assert.match(d.querySelector('.av-card').textContent,/499/);
    assert.match(d.querySelector('.av-card').textContent,/24\.09\.2026|24\.09\.26/);
    assert.ok(d.querySelector('.av-card a[href*="view_all_page_id=127496543986832"]'));
    assert.ok(d.querySelector('.av-card img[src*="/api/ad-visuals/evidence/"]'));
    assert.match(d.querySelector('.av-status').textContent,/Bazı reklamlar henüz hazır değil/);
    assert.match(d.querySelector('.av-status').textContent,/Son güncelleme:.*24\.09\.2026|Son güncelleme:.*24\.09\.26/);
    noAdminPanels(d,'.av-pending,.av-cloud,.av-coverage');
    assert.equal(d.querySelector('[data-av-scan],[data-av-analyze],[data-av-provider-status]'),null);
    assert.doesNotMatch(d.body.textContent,new RegExp('Apify|'+technical));
    await dom.window.AdVisualUI.setCategory('review');
    assert.match(d.querySelector('.av-card').textContent,/review kampanyası/);
    assert.equal(d.querySelector('[data-av-analyze]'),null);
    const brand=d.querySelector('[data-av-brand]');brand.value='KKTCELL';brand.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,new RegExp('Apify|'+technical));
    const before=requests.length,root=d.querySelector('.av-root');
    for(const attr of ['data-av-scan','data-av-analyze','data-av-pending-more']){const b=d.createElement('button');b.setAttribute(attr,'');root.append(b);b.click();b.remove()}
    await nextTick();
    assert.equal(requests.length,before,'Injected controls cannot invoke restricted requests');
    assert.ok(requests.every(x=>x.method==='GET'&&!x.url.includes('/pending')));
  }finally{dom.window.close()}
  }
});

test('standard home retains catalog, comparison, campaigns and social links with read-only refresh',async()=>{
  const f=fixture('home');const {dom,d,requests}=f;
  try{
    await f.load();await settled(()=>d.querySelectorAll('[data-pick]').length===2,'Products should render');
    assert.match(d.querySelector('#hiChanges').textContent,/90 → 100/);
    assert.match(d.querySelector('#hiCampaigns').textContent,/Sonbahar kampanyası/);
    noAdminPanels(d,'#hiCompanies,#hiSources,#hiObservationForm,#hiObservations');
    assert.doesNotMatch(d.body.textContent,new RegExp('BTHK şirket kapsamı|Kaynak Sağlığı|Gözlem kaydet|'+technical));
    for(const pick of d.querySelectorAll('[data-pick]')){pick.checked=true;pick.dispatchEvent(new dom.window.Event('change',{bubbles:true}))}
    dom.window.HomeInternetUI.setView('compare');
    assert.equal(d.querySelector('#hiCompareView').hidden,false);
    assert.equal(d.querySelectorAll('.hi-comparison thead th').length,3);
    dom.window.HomeInternetUI.setView('social');await nextTick();
    assert.ok(d.querySelector('#hiSocialCards a[href*="view_all_page_id=127496543986832"]'));
    assert.ok(d.querySelector('#hiSocialCards a[href="https://www.instagram.com/kktcell"]'));
    assert.equal(d.querySelector('[data-observe]'),null);
    const button=d.createElement('button');button.dataset.observe='KKTCELL';d.querySelector('#home-internet-section').append(button);button.click();button.remove();
    await dom.window.HomeInternetUI.scan();
    d.querySelector('#hiScanBtn').click();await nextTick();
    assert.ok(requests.every(x=>x.method==='GET'&&!x.url.includes('social-observations')&&!new URL(x.url,'https://example.com').searchParams.has('refresh')));
  }finally{dom.window.close()}
});

test('both modules wait for role readiness and default to standard when access helper is absent',async()=>{
  for(const module of ['ads','home']){
    const f=fixture(module,'standard',{deferred:true});
    try{
      const loading=f.load();await nextTick();
      assert.equal(f.requests.length,0,module+' must wait for role readiness');
      assert.equal(f.d.querySelector('[data-av-scan],[data-av-analyze],#hiObservationForm'),null);
      f.resolve();await loading;await settled(()=>f.requests.length>0,module+' should load after resolution');
      assert.ok(f.requests.every(x=>x.method==='GET'&&!x.url.includes('/pending')&&!x.url.includes('social-observations')));
    }finally{f.dom.window.close()}
    const safe=fixture(module,'admin',{helper:false});
    try{await safe.load();assert.equal(safe.d.querySelector('[data-av-scan],[data-av-analyze],#hiObservationForm'),null)}finally{safe.dom.window.close()}
  }
});

test('admin keeps ad operations and home source coverage with observation access',async()=>{
  const ads=fixture('ads','admin');
  try{
    await ads.load();
    for(const selector of ['.av-pending','.av-cloud','.av-coverage','[data-av-scan]','[data-av-analyze]'])assert.ok(ads.d.querySelector(selector),selector+' should remain for admins');
    assert.match(ads.d.body.textContent,/Apify/);
    ads.d.querySelector('[data-av-scan]').click();await nextTick();
    ads.d.querySelector('[data-av-analyze]').click();await nextTick();
    assert.ok(ads.requests.some(x=>x.url==='/api/ad-visuals/scan'&&x.method==='POST'));
    assert.ok(ads.requests.some(x=>x.url==='/api/ad-visuals/analyze'&&x.method==='POST'));
    const pending=ads.d.querySelector('.av-pending');pending.open=true;pending.dispatchEvent(new ads.dom.window.Event('toggle'));await nextTick();
    assert.ok(ads.requests.some(x=>x.url.includes('/api/ad-visuals/pending')));
  }finally{ads.dom.window.close()}
  const home=fixture('home','admin');
  try{
    await home.load();await settled(()=>home.d.querySelector('#hiCompanies')?.textContent.includes('Test ISP Ltd'),'Admin coverage should render');
    assert.match(home.d.querySelector('#hiSources').textContent,new RegExp(technical));
    assert.ok(home.d.querySelector('#hiObservationForm'));
    home.dom.window.HomeInternetUI.setView('social');await nextTick();
    assert.ok(home.requests.some(x=>x.url.includes('/api/home-internet/social-observations')));
    await home.dom.window.HomeInternetUI.scan();
    assert.ok(home.requests.some(x=>new URL(x.url,'https://example.com').searchParams.get('refresh')==='1'));
  }finally{home.dom.window.close()}
});
