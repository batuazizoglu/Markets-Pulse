import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validateObservation} from '../src/social-watch.js';
import {HOME_INTERNET_SOURCES,marketPayload} from '../src/home-internet.js';
import {normalizeOffer} from '../src/isp-economics.js';

async function fixture(){
  const source=HOME_INTERNET_SOURCES.find(x=>x.slug==='kibrisonline-home');
  const products=Array.from({length:5},(_,i)=>normalizeOffer({source_slug:source.slug,provider:source.provider,name:i===0?'<img src=x onerror=alert(1)>':'Plan '+i,technology:'WDSL',duration_months:12,bonus_months:2,total_price_try:1000+i*100,speed_down_mbps:10+i,product_key:'plan'+i,source_url:source.url}));
  const data=marketPayload([{source_slug:source.slug,captured_at:new Date().toISOString(),status:'ok',parsed_count:5,payload_json:products,source_meta_json:{parser_version:'home-isp-2'}}],[]);
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://marketspulse.cloud/#home',runScripts:'outside-only'});
  dom.window.fetch=async url=>({ok:true,json:async()=>url.includes('social-observations')?{rows:[{id:1,brand:'Telsim',kind:'ad',source_url:'https://www.facebook.com/kktctelsim',note:'<script>alert(1)</script>',created_at:new Date().toISOString()}]}:data});
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
test('social view distinguishes brand search, manual notes and missing automation',async()=>{
  const dom=await fixture();try{
    const d=dom.window.document;dom.window.HomeInternetUI.setView('social');await new Promise(r=>setTimeout(r,30));
    assert.equal(d.querySelector('#hiMarketViews').hidden,true);
    assert.match(d.querySelector('#hiSocialView').textContent,/Otomatik veri bağlantısı kurulmadı/);
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
