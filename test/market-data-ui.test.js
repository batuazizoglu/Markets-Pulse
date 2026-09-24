import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {marketPulseFromRows} from '../src/intelligence.js';

const now=new Date('2026-09-24T12:00:00Z');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const scripts=await Promise.all(['access-ui','market-state','app','market-pulse','brand-ui'].map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
function sampleRows(revision=''){
  return Array.from({length:18},(_,i)=>{
    const base={id:i*3+1,scan_id:i+1,product_id:i+1,product_name:(i===0?'Newest removed':i===1?'Recent low-score':'High-score '+i)+revision,detected_at:new Date(+now-(i+1)*86400000).toISOString(),source_name:'Official source',severity:i<2?'low':'high'};
    if(i===0)return [{...base,change_type:'removed',old_value:base.product_name}];
    if(i===1)return [{...base,change_type:'field_changed',field_name:'Ek Fayda / Koşul',old_value:'Before',new_value:'After'}];
    return [{...base,change_type:'added',new_value:base.product_name},...['Data','Fiyat'].map((field,index)=>({...base,id:base.id+index+1,change_type:'field_changed',field_name:field,old_value:field==='Fiyat'?'100':'10',new_value:field==='Fiyat'?'90':'20'}))];
  }).flat();
}
const snapshot=(days=30,revision='')=>marketPulseFromRows(sampleRows(revision),days,now);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(getMarket=days=>snapshot(days)){
  const dom=new JSDOM(html,{url:'https://www.marketspulse.cloud/#dashboard',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[],timers=[];
  w.scrollTo=()=>{};w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length};w.console.error=()=>{};
  w.fetch=async raw=>{
    const url=new URL(raw,'https://www.marketspulse.cloud');requests.push(url);
    if(url.pathname==='/api/market-pulse'){const data=await getMarket(Number(url.searchParams.get('days')));return {ok:true,json:async()=>data}}
    const data={
      '/api/auth/me':{user:{id:1,first_name:'Test',last_name:'Admin',role:'admin',username:'test'}},
      '/api/summary':{sources:[]},'/api/packages':[],'/api/comparison':{rows:[]},'/api/value-index':[],
      '/api/benchmark':{segment_scores:[],overall_score:{}},'/api/scan':{sources:[]}
    }[url.pathname];
    assert.notEqual(data,undefined,'Unexpected endpoint '+url.pathname);return {ok:true,json:async()=>data};
  };
  for(const script of scripts)w.eval(script);
  await w.loadAll();await tick();await tick();
  return {dom,w,d,requests,timers};
}
const marketRequests=f=>f.requests.filter(url=>url.pathname==='/api/market-pulse');
const selectOrder=(f,value)=>{const input=f.d.querySelector('#mpMoveOrder');input.value=value;input.dispatchEvent(new f.w.Event('change',{bubbles:true}))};
const states=f=>['mpSnapshotStatus','marketSnapshotStatus','executiveSnapshotStatus'].map(id=>f.d.getElementById(id).textContent);

test('one snapshot drives dashboard, timeline, feed and executive; newest and priority tails remain reachable',async()=>{
  const f=await fixture();try{
    const {d,w}=f;assert.equal(marketRequests(f).length,1);assert.equal(w.MarketPulseData.getState().days,30);
    assert.equal(d.querySelectorAll('.mp-move').length,6);assert.equal(d.querySelectorAll('.tl').length,40);assert.equal(d.querySelectorAll('.change').length,40);
    assert.match(d.querySelector('#mpMoveCount').textContent,/6 \/ 18 gruplanmış hamle • 50 alan değişikliği/);
    assert.ok(![...d.querySelectorAll('.mp-move')].some(row=>row.textContent.includes('Newest removed')));
    d.querySelector('[data-market-more="moves"]').click();d.querySelector('[data-market-more="moves"]').click();
    assert.equal(d.querySelectorAll('.mp-move').length,18);assert.equal(d.querySelector('[data-market-more="moves"]').hidden,true);
    assert.ok([...d.querySelectorAll('.mp-move')].some(row=>row.textContent.includes('Newest removed')));
    assert.match(d.querySelector('.mp-change-list').textContent,/100 → 90/);
    selectOrder(f,'recent');assert.match(d.querySelector('.mp-move').textContent,/Newest removed/);assert.match(d.querySelectorAll('.mp-move')[1].textContent,/Recent low-score.*İZLE/s);
    assert.equal(d.querySelector('#mpMoveOrder').value,'recent');assert.equal(d.querySelectorAll('.mp-move').length,18);
    for(const type of ['timeline','changes'])d.querySelector('[data-market-more="'+type+'"]').click();
    assert.equal(d.querySelectorAll('.tl').length,50);assert.deepEqual([...d.querySelectorAll('.tl')].map(row=>row.dataset.changeId),[...d.querySelectorAll('.change')].map(row=>row.dataset.changeId));
    assert.ok(states(f).every(text=>text===states(f)[0]));
    assert.equal(d.querySelector('[data-executive-move]').dataset.executiveMove,w.MarketPulseData.orderedMoves(w.MarketPulseData.getState().snapshot)[0].key);
    assert.ok(f.requests.every(url=>!['/api/timeline','/api/changes'].includes(url.pathname)));
  }finally{f.dom.window.close()}
});

test('period changes reject out-of-order responses and remain selected across header, background and scan refresh',async()=>{
  let held=false,revision='',resolve7,resolve90;
  const f=await fixture(days=>held?(days===7?new Promise(resolve=>{resolve7=resolve}):new Promise(resolve=>{resolve90=resolve})):snapshot(days,revision));
  try{
    const {w,d}=f;held=true;
    const seven=w.loadTimeline(7),ninety=w.loadMarketPulse(90);
    assert.equal(w.MarketPulseData.getState().days,90);
    resolve90(snapshot(90));await ninety;resolve7(snapshot(7));await seven;
    assert.equal(w.MarketPulseData.getState().snapshot.window_days,90);
    for(const root of ['#timelineTabs','.mp-window'])assert.equal(d.querySelector(root+' [aria-pressed="true"]').dataset.marketDays,'90');
    assert.equal(d.querySelector('[data-executive-move]').dataset.windowDays,'90');assert.ok(states(f).every(text=>text===states(f)[0]&&text.includes('90 gün')));
    held=false;selectOrder(f,'recent');d.querySelector('[data-market-more="moves"]').click();d.querySelector('[data-market-more="timeline"]').click();
    revision=' updated';await w.loadAll();assert.match(d.querySelector('.mp-move').textContent,/updated/);
    assert.equal(d.querySelectorAll('.mp-move').length,12);assert.equal(d.querySelectorAll('.tl').length,50);assert.equal(d.querySelector('#mpMoveOrder').value,'recent');
    const dataTimers=f.timers.filter(timer=>timer.ms===60000&&timer.fn.name==='loadAll');assert.equal(dataTimers.length,1);
    assert.equal(f.timers.filter(timer=>timer.ms===60000).length,2,'only app data refresh plus theme check, no separate market timer');
    await dataTimers[0].fn();await w.scanNow();
    assert.ok(marketRequests(f).slice(-3).every(url=>url.searchParams.get('days')==='90'));
    assert.equal(d.querySelector('#timelineTabs [aria-pressed="true"]').dataset.marketDays,'90');
    assert.equal(d.querySelectorAll('.mp-move').length,12);assert.equal(d.querySelectorAll('.tl').length,50);
  }finally{f.dom.window.close()}
});

test('failed shared refresh retains all successful content with consistent visible error and period labels',async()=>{
  let fail=false;const f=await fixture(days=>{if(fail)throw new Error('synthetic unavailable');return snapshot(days)});
  try{
    const before=f.d.querySelector('.mp-move').textContent,at=f.w.MarketPulseData.getState().snapshot.generated_at;
    fail=true;await f.w.loadAll();
    assert.equal(f.d.querySelector('.mp-move').textContent,before);assert.equal(f.w.MarketPulseData.getState().snapshot.generated_at,at);
    assert.ok(states(f).every(text=>text===states(f)[0]&&/yenilenemedi.*Son başarılı veriler/s.test(text)));
    assert.doesNotMatch(f.d.querySelector('.mp-list').textContent,/hamlesi yok/);
    assert.equal(f.d.querySelector('#liveText').textContent,'Rakip verileri güncellenemedi');
    assert.equal(f.d.querySelector('#heroMove').textContent,'Güncel veri alınamadı');
    await f.w.MarketPulseData.selectDays(7);
    assert.equal(f.w.MarketPulseData.getState().days,7);assert.equal(f.w.MarketPulseData.getState().snapshot.window_days,30);
    assert.match(f.d.querySelector('#marketSnapshotStatus').textContent,/Son 30 gün/);
    assert.equal(f.d.querySelector('#timelineTabs [aria-pressed="true"]').dataset.marketDays,'7');
  }finally{f.dom.window.close()}
});

test('a successful but previous-day snapshot never claims that today has no changes',async()=>{
  const old=new Date(Date.now()-3*86400000),data=marketPulseFromRows([],30,old);
  const f=await fixture(()=>data);try{
    assert.equal(f.w.MarketPulseData.getState().error,'');
    assert.equal(f.d.querySelector('#heroMove').textContent,'Güncel veri alınamadı');
    assert.match(f.d.querySelector('#heroSub').textContent,/Son başarılı güncelleme/);
    assert.doesNotMatch(f.d.querySelector('#heroMove').textContent,/değişiklik yok/);
  }finally{f.dom.window.close()}
});

test('tie ordering matches backend numeric descending keys and all shared change text is escaped',async()=>{
  const hostile='<img src=x onerror=bad()>',rows=[1,2,10].map((product_id,index)=>({id:index+1,scan_id:1,product_id,product_name:hostile+product_id,source_name:hostile,detected_at:'2026-09-23T12:00:00Z',change_type:'field_changed',field_name:'Ek Fayda / Koşul',old_value:hostile,new_value:'<script>bad()</script>',severity:'low'}));
  const data=marketPulseFromRows(rows,30,now);data.moves[0].action=hostile;
  const f=await fixture(()=>data);try{
    assert.deepEqual([...f.d.querySelectorAll('.mp-move')].map(row=>row.dataset.moveKey),['1:10','1:2','1:1']);
    assert.equal(f.d.querySelector('[data-executive-move]').dataset.executiveMove,data.top_threats[0].key);
    for(const selector of ['.mp-list','#timeline','#changeFeed','#executiveInsights']){
      assert.equal(f.d.querySelector(selector+' img,'+selector+' script,'+selector+' [onerror]'),null);
      assert.match(f.d.querySelector(selector).textContent,/<img/);
    }
    assert.match(f.d.querySelector('[data-executive-move]').textContent,/İzle • Tehdit skoru/);
  }finally{f.dom.window.close()}
});
