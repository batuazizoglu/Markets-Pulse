import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {buildBenchmark} from '../src/kktcell-benchmark.js';

const script=await readFile(new URL('../public/benchmark.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function benchmark(){
  const source={name:'KKTCELL Faturasız',url:'https://www.kktcell.com/faturasiz',ok:true,parsed_count:17,core_count:12,response_ms:41};
  const base={source_slug:'faturasiz',active:true,data_gb:20,local_tr_minutes:1000,sms:1000,validity_days:30,price_try:500,source_url:'https://www.kktctelsim.com/paketler'};
  return {...buildBenchmark([
    {...base,id:1,current_name:'Super Databol Medium'},
    {...base,id:2,current_name:'Super Databol <img src=x onerror=bad()>'}
  ],[{name:'Yeni GO M',product_url:'/go-m',source_url:source.url,source_slug:'kktcell-faturasiz',type:'prepaid',is_core:true,data_gb:20,local_tr_minutes:1000,sms:1000,validity_days:30,price_try:500}]),kktcell_sources:[source]};
}
async function fixture({role='standard',helper=true,deferred=false,data=benchmark()}={}){
  const dom=new JSDOM('<nav class="section-nav"></nav><section id="overview"></section>',{url:'https://marketspulse.cloud',runScripts:'outside-only'});
  const requests=[],subscribers=[];let currentRole=role,resolveReady;
  const history={trends:{Toplam:{series:[{day:'2026-09-16',score:45},{day:'2026-09-23',score:50}],deltas:{'7d':5},latest:{score:50},baselines:{'7d':{score:45}}}}};
  if(helper)dom.window.MarketPulseAccess={ready:deferred?new Promise(resolve=>{resolveReady=resolve}):Promise.resolve({role}),isAdmin:()=>currentRole==='admin',subscribe:fn=>subscribers.push(fn)};
  dom.window.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('benchmark-history')?history:data}};
  dom.window.eval(script);await tick();
  return {dom,w:dom.window,d:dom.window.document,requests,data,resolve:()=>resolveReady?.({role:currentRole}),setRole(next){currentRole=next;subscribers.forEach(fn=>fn({role:next}))}};
}

test('standard benchmark retains comparisons, prices, evidence and trends without engine diagnostics',async()=>{
  const f=await fixture();try{
    const text=f.d.body.textContent;
    assert.equal(f.d.querySelector('.bm-headline h2').textContent,'Ürün karşılaştırma');
    assert.equal(f.d.querySelector('.bm-score-title b').textContent,'Rekabet skoru');
    assert.doesNotMatch(text,/Comparable Product Engine|Competitive Position Score|Primary|Secondary|Reject|motor|Baseline|Kaynak Sağlığı|Metodoloji|Benzerlik|Yönetici kararı|GB\/100TL|çekirdek|41 ms/i);
    assert.doesNotMatch(f.d.querySelector('#bmBox').innerHTML,/Ortalama relatif|SKU|PRIMARY EŞLEŞME YOK/);
    assert.equal(f.d.querySelectorAll('.bm-table th').length,6);
    assert.equal(f.d.querySelectorAll('.bm-table tbody tr').length,f.data.matches.length+f.data.secondary_matches.length);
    assert.equal(f.d.querySelectorAll('.bm-card').length,2);
    assert.match(text,/500 TL/);assert.match(text,/20 GB/);assert.match(text,/1.000 dk/);assert.match(text,/1.000 SMS/);assert.match(text,/30 gün/);
    assert.match(text,/Güven DÜŞÜK/);assert.match(text,/sınırlı sayıda karşılaştırmaya/);
    assert.match(text,/Super Databol <img/);assert.equal(f.d.querySelector('img'),null);
    assert.equal(f.d.querySelector('.bm-trend-stat strong').textContent,'+5 puan');
    assert.equal(f.d.querySelectorAll('.bm-chart circle').length,2);
    assert.ok(f.d.querySelector('a[href="https://www.kktcell.com/go-m"]'));
    assert.ok(f.d.querySelector('a[href="https://www.kktctelsim.com/paketler"]'));
    assert.equal(f.d.querySelector('.bm-kpis article:nth-child(3) strong').textContent,String(f.data.counts.PARITY));
    assert.equal(f.d.querySelector('.bm-kpis article:nth-child(4) strong').textContent,f.data.overall_score.score+'/100');
    f.w.setBmSegment('Asker');
    assert.match(f.d.querySelector('#bmBox').textContent,/Skor için yeterli karşılaştırılabilir ürün yok/);
    assert.match(f.d.querySelector('.bm-table tbody').textContent,/karşılaştırılabilir ürün yok/);
  }finally{f.dom.window.close()}
});

test('standard users cannot force catalog refresh, including direct calls and missing access helper',async()=>{
  for(const helper of [true,false]){
    const f=await fixture({helper});try{
      await f.w.loadBenchmark(true);
      f.d.querySelector('.bm-refresh').click();await tick();
      assert.ok(f.requests.filter(url=>url==='/api/benchmark').length>=3);
      assert.ok(f.requests.every(url=>!url.includes('refresh=1')));
      assert.equal(f.d.querySelector('.bm-headline h2').textContent,'Ürün karşılaştırma');
    }finally{f.dom.window.close()}
  }
});

test('admin benchmark retains full diagnostics and forced refresh after role resolution',async()=>{
  const f=await fixture({role:'admin',deferred:true});try{
    assert.equal(f.requests.length,0);assert.equal(f.d.querySelector('#benchmark-section'),null);
    f.resolve();await tick();
    const text=f.d.body.textContent;
    assert.match(text,/Comparable Product Engine/);assert.match(text,/Primary/);assert.match(text,/Secondary/);
    assert.match(text,/Metodoloji/);assert.match(text,/Kaynak Sağlığı/);assert.match(text,/41 ms/);
    assert.equal(f.d.querySelectorAll('.bm-table th').length,12);
    f.d.querySelector('.bm-refresh').click();await tick();
    assert.ok(f.requests.includes('/api/benchmark?refresh=1'));
    f.setRole('standard');
    assert.equal(f.d.querySelector('.bm-headline h2').textContent,'Ürün karşılaştırma');
    assert.doesNotMatch(f.d.body.textContent,/Primary|Secondary|Metodoloji|Kaynak Sağlığı/);
    const forced=f.requests.filter(url=>url.includes('refresh=1')).length;
    await f.w.loadBenchmark(true);
    assert.equal(f.requests.filter(url=>url.includes('refresh=1')).length,forced);
  }finally{f.dom.window.close()}
});

test('standard empty-score states hide backend operational reasons in text and tooltips',async()=>{
  const f=await fixture();try{
    for(const level of ['KAYNAK ERİŞİM SORUNU','KARAR GÜNCELLENMELİ','PRIMARY EŞLEŞME YOK','EŞLEŞME İNCELENMELİ']){
      const score={segment:'Genel',score:null,level,confidence:'DÜŞÜK',rationale:'Primary Secondary Reject override motor source_error'};
      f.w.renderBenchmark({...f.data,overall_score:score,segment_scores:[score]});
      const html=f.d.querySelector('#bmBox').innerHTML;
      assert.doesNotMatch(html,/Primary|Secondary|Reject|override|motor|source_error|KARAR GÜNCELLENMELİ|KAYNAK ERİŞİM SORUNU|PRIMARY EŞLEŞME YOK|EŞLEŞME İNCELENMELİ/);
      assert.match(f.d.querySelector('#bmBox').textContent,/VERİ YETERSİZ/);
    }
  }finally{f.dom.window.close()}
});
