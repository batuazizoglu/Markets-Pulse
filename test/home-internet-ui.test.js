import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validateObservation} from '../src/social-watch.js';
import {HOME_INTERNET_SOURCES,marketPayload} from '../src/home-internet.js';
import {normalizeOffer} from '../src/isp-economics.js';

async function fixture(campaigns=[]){
  const source=HOME_INTERNET_SOURCES.find(x=>x.slug==='kibrisonline-home');
  const products=Array.from({length:5},(_,i)=>normalizeOffer({source_slug:source.slug,provider:source.provider,name:i===0?'<img src=x onerror=alert(1)>':'Plan '+i,technology:'WDSL',duration_months:12,bonus_months:2,total_price_try:1000+i*100,speed_down_mbps:10+i,product_key:'plan'+i,source_url:source.url}));
  const data=marketPayload([{source_slug:source.slug,captured_at:new Date().toISOString(),status:'ok',parsed_count:5,payload_json:products,source_meta_json:{parser_version:'home-isp-2'}}],[]);
  data.campaigns=campaigns;
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://marketspulse.cloud/#home',runScripts:'outside-only'});
  dom.window.fetch=async url=>({ok:true,json:async()=>url.includes('social-observations')?{rows:[{id:1,brand:'Telsim',kind:'ad',source_url:'https://www.facebook.com/kktctelsim',note:'<script>alert(1)</script>',created_at:new Date().toISOString()}]}:data});
  dom.window.MarketPulseAccess={ready:Promise.resolve({role:'admin'}),isAdmin:()=>true};
  dom.window.eval(await readFile(new URL('../public/home-internet.js',import.meta.url),'utf8'));
  await new Promise(r=>setTimeout(r,30));await dom.window.HomeInternetUI.load();
  return dom;
}
test('home views expose comparison, all BTHK companies and last source panel',async()=>{
  const dom=await fixture();try{
    const d=dom.window.document;
    assert.equal(d.querySelectorAll('#hiCompanies tr').length,29);
    assert.equal(d.querySelector('#hiTrackingBottom').lastElementChild.querySelector('strong').textContent,'Kaynak Sağlığı ve İzlenen Kaynaklar');
    assert.ok(d.querySelector('#hiTrackingTop').compareDocumentPosition(d.querySelector('#hiProducts'))&4);
    assert.equal(d.querySelectorAll('#hiProducts img').length,0);
    const picks=[...d.querySelectorAll('[data-pick]')];
    for(const p of picks){p.checked=true;p.dispatchEvent(new dom.window.Event('change',{bubbles:true}))}
    assert.match(d.querySelector('#hiMessage').textContent,/en fazla 4/);
    dom.window.HomeInternetUI.setView('compare');
    assert.equal(d.querySelector('#hiCompareView').hidden,false);
    assert.equal(d.querySelectorAll('.hi-comparison thead th').length,5);
    assert.match(d.querySelector('#hiCompareResult').textContent,/otomatik eşdeğerlik/);
    d.querySelector('[data-clear-selection]').click();assert.equal(d.querySelector('#hiSelectedCount').textContent,'');
  }finally{dom.window.close()}
});
test('social view distinguishes brand search, manual notes and separate visual analysis',async()=>{
  const dom=await fixture();try{
    const d=dom.window.document;dom.window.HomeInternetUI.setView('social');await new Promise(r=>setTimeout(r,30));
    assert.equal(d.querySelector('#hiMarketViews').hidden,true);
    assert.match(d.querySelector('#hiSocialView').textContent,/Reklam görselleri ayrı analiz ediliyor/);
    assert.match(d.querySelector('#hiSocialCards').textContent,/Marka araması/);
    assert.equal(d.querySelectorAll('#hiObservations script').length,0);
    const select=d.querySelector('#hiAdCountry');select.value='CY';select.dispatchEvent(new dom.window.Event('change'));
    const telsim=[...d.querySelectorAll('#hiSocialCards a')].find(a=>a.href.includes('164143610515'));
    assert.equal(new URL(telsim.href).searchParams.get('country'),'CY');
  }finally{dom.window.close()}
});
test('observation input accepts only known brands and official HTTPS social domains',()=>{
  const input={brand:'Telsim',kind:'ad',source_url:'https://www.facebook.com/ads/library/?id=123',note:'Yeni kampanya'};
  assert.equal(validateObservation(input,HOME_INTERNET_SOURCES).brand,'Telsim');
  for(const change of [{brand:'Unknown'},{kind:'email'},{source_url:'https://facebook.com.evil.example/a'},{source_url:'javascript:alert(1)'},{source_url:'https://user:pass@facebook.com/a'},{note:'x'}])assert.throws(()=>validateObservation({...input,...change},HOME_INTERNET_SOURCES));
});
test('campaigns show expiry separately from prices, escape content and hide in FWA view',async()=>{
  const dom=await fixture([{provider:'FixNet',name:'Eski hediye',availability:'expired',expires_at:'2025-07-30',campaign_text:'<img src=x onerror=alert(1)>',url:'https://www.fixnetbroadband.com/kampanyalar',verified_at:new Date().toISOString()}]);
  try{
    const d=dom.window.document;
    assert.match(d.querySelector('#hiCampaigns').textContent,/Süresi doldu/);
    assert.match(d.querySelector('#hiCampaignCount').textContent,/0 güncel aktif/);
    assert.equal(d.querySelectorAll('#hiCampaigns img').length,0);
    assert.doesNotMatch(d.querySelector('#hiProducts').textContent,/Eski hediye/);
    dom.window.HomeInternetUI.setFamily('fwa');assert.equal(d.querySelector('#hiCampaignPanel').hidden,true);
  }finally{dom.window.close()}
});

test('social observation endpoint persists validated notes and blocks cross-site writes',async()=>{
  const {default:express}=await import('express');
  const {PGlite}=await import('@electric-sql/pglite');
  const {SCHEMA_SQL}=await import('../src/schema.js');
  const {registerSocialWatchRoutes}=await import('../src/social-watch.js');
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.appUser={id:null};next()});
  registerSocialWatchRoutes(app,db,HOME_INTERNET_SOURCES);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port+'/api/home-internet/social-observations';
  const body={brand:'Telsim',kind:'ad',source_url:'https://www.facebook.com/kktctelsim',note:'Yeni kampanya'};
  try{
    const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(body)});assert.equal(bad.status,403);
    const saved=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(saved.status,201);
    const data=await (await fetch(url)).json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].note,body.note);assert.equal(data.mode,'manual');
  }finally{await new Promise(r=>server.close(r));await db.close()}
});
