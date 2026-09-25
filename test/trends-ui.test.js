import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const scripts=await Promise.all(['market-state','trends'].map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
const end='2026-09-24T12:00:00.000Z',dayMs=86400000;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(condition){
  const deadline=Date.now()+2000;
  while(!condition()){if(Date.now()>deadline)assert.fail('Expected trend state was not reached');await new Promise(resolve=>setTimeout(resolve,5));}
}
function snapshot(days,at=end){return {window_days:days,window_start:new Date(+new Date(at)-days*dayMs).toISOString(),window_end:at,generated_at:at,changes:[],moves:[]}}
function data(days=30,at=end){
  const current=snapshot(days,at),start=current.window_start;
  return {...current,previous_start:new Date(+new Date(start)-days*dayMs).toISOString(),previous_end:start,
    coverage:{current:{observed_days:days-2,expected_days:days,complete:false},previous:{observed_days:days,expected_days:days,complete:true},comparable:false,first_observed_at:new Date(+new Date(start)-days*dayMs).toISOString(),last_observed_at:at},
    summary:{move_count:12,previous_move_count:8,affected_packages:4,added_count:3,removed_count:1,priority_count:2,change_pct:null},
    activity:Array.from({length:days},(_,i)=>({date:new Date(+new Date(start)+i*dayMs).toISOString().slice(0,10),move_count:i<2?null:i%4,observed:i>=2,partial:false})),
    directions:[{key:'added',label:'Yeni paket',count:3},{key:'price_decrease',label:'Fiyat indirimi',count:4},{key:'data_increase',label:'İnternet artışı',count:2}],
    price:{increases:1,reductions:4,median_change_pct:-20,sample_size:5},
    segments:[{name:'Genel',current:8,previous:5,priority_count:1},{name:'Öğrenci / Genç',current:4,previous:3,priority_count:1}],
    values:{rows:[{product_id:1,name:'Genç Paket',source_url:'https://example.test/package',from_at:start,to_at:at,from_value:4,to_value:5,change_pct:25,from_price:500,to_price:400,validity_days:30}],eligible_count:2,excluded_count:1,unchanged_count:1,changed_count:1},
    insights:[{title:'Fiyat indirimleri öne çıktı',body:'Beş fiyat hareketinin dördü indirim yönündeydi.',tone:'info'}]};
}
async function fixture({getTrends=data,ready,role='standard',user={role}}={}){
  const dom=new JSDOM('<!doctype html><html><body data-view="trends"><main class="shell"><header class="topbar"></header><nav id="competitorViews"></nav></main></body></html>',{url:'https://www.marketspulse.cloud/#competitor/trends',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[],timers=[];
  w.scrollTo=()=>{};w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length};w.console.error=()=>{};
  w.MarketPulseAccess={ready:ready||Promise.resolve(user),isAdmin:()=>user?.role==='admin',getUser:()=>user,subscribe:()=>()=>{}};
  w.fetch=async(raw,options={})=>{
    const url=new URL(raw,w.location.href);requests.push({url,options});
    assert.equal(options.method||'GET','GET');
    const days=Number(url.searchParams.get('days'));
    if(url.pathname==='/api/market-pulse')return {ok:true,json:async()=>snapshot(days)};
    assert.equal(url.pathname,'/api/competitive-trends','Only cached market and trend endpoints are allowed');
    const body=await getTrends(days,url.searchParams.get('end'));
    return {ok:true,json:async()=>body};
  };
  for(const script of scripts)w.eval(script);
  return {dom,w,d,requests,timers};
}
const trendRequests=f=>f.requests.filter(({url})=>url.pathname==='/api/competitive-trends');
const content=f=>f.d.getElementById('trendContent');
async function start(f){await f.w.MarketPulseData.ensure();await f.w.MarketPulseTrends.activate();await until(()=>content(f)?.dataset.windowDays==='30'&&content(f).getAttribute('aria-busy')==='false')}
async function select(f,days){f.d.querySelector('#trend-analysis-section [data-market-days="'+days+'"]').click();await until(()=>content(f)?.dataset.windowDays===String(days)&&content(f).getAttribute('aria-busy')==='false')}

test('trend analysis waits for authorization and activation, then reuses one cached period without polling',async()=>{
  let release;const ready=new Promise(resolve=>{release=resolve});
  const f=await fixture({ready});try{
    await tick();assert.equal(trendRequests(f).length,0);
    await f.w.MarketPulseData.ensure();const active=f.w.MarketPulseTrends.activate();
    await tick();assert.equal(trendRequests(f).length,0,'activation cannot bypass pending authorization');
    release({role:'standard'});await active;
    await until(()=>content(f)?.dataset.windowDays==='30');
    await Promise.all([f.w.MarketPulseTrends.activate(),f.w.MarketPulseTrends.activate()]);
    assert.equal(trendRequests(f).length,1);
    assert.equal(trendRequests(f)[0].url.searchParams.get('end'),end);
    assert.equal(f.timers.length,0,'trends follow the shared snapshot instead of starting another polling timer');
    f.d.body.dataset.view='competitor';await f.w.MarketPulseData.selectDays(7);await tick();
    assert.equal(trendRequests(f).length,1,'inactive trends do not fetch on another page');
    f.d.body.dataset.view='trends';await f.w.MarketPulseTrends.activate();
    await until(()=>content(f).dataset.windowDays==='7');assert.equal(trendRequests(f).length,2);
  }finally{f.dom.window.close()}
});

test('7/30/90-day controls update shared state and display meaningful graphs and incomplete coverage',async()=>{
  const f=await fixture();try{
    await start(f);
    for(const days of [7,30,90]){
      await select(f,days);
      assert.equal(f.w.MarketPulseData.getState().snapshot.window_days,days);
      assert.equal(f.d.querySelector('#trend-analysis-section [aria-pressed="true"]').dataset.marketDays,String(days));
      assert.match(f.d.getElementById('trendPeriod').textContent,new RegExp('Son '+days+' gün'));
      assert.equal(content(f).dataset.windowEnd,end);
    }
    for(const key of ['activity','value'])assert.ok(f.d.querySelector('[data-trend-chart="'+key+'"] svg'),'numeric '+key+' chart');
    assert.equal(f.d.querySelectorAll('[data-trend-chart]').length,4);
    assert.match(f.d.getElementById('trendCoverage').textContent,/88|90/);
    assert.match(f.d.getElementById('trendCoverage').textContent,/eksik|sınırlı|kayıt|izlen/i);
    assert.match(content(f).textContent,/Genç Paket|25/);
    assert.doesNotMatch(content(f).innerHTML,/NaN|Infinity/);
    assert.equal(f.d.querySelector('.tl,.bm-score-card'),null,'trend graphs contain no timeline or score panel');
  }finally{f.dom.window.close()}
});

test('a late response for 7 days cannot replace the selected 90-day trend data',async()=>{
  let held=false,resolve7,resolve90;
  const f=await fixture({getTrends:(days,at)=>!held?data(days,at):new Promise(resolve=>{if(days===7)resolve7=resolve;else if(days===90)resolve90=resolve})});
  try{
    await start(f);held=true;
    await f.w.MarketPulseData.selectDays(7);await until(()=>resolve7);
    await f.w.MarketPulseData.selectDays(90);await until(()=>resolve90);
    resolve90(data(90));await until(()=>content(f).dataset.windowDays==='90');
    resolve7(data(7));await tick();await tick();
    assert.equal(content(f).dataset.windowDays,'90');
    assert.match(f.d.getElementById('trendPeriod').textContent,/Son 90 gün/);
    assert.equal(f.d.querySelector('#trend-analysis-section [aria-pressed="true"]').dataset.marketDays,'90');
  }finally{f.dom.window.close()}
});

test('failed period refresh keeps the successful graph and its observed period, then retry updates it',async()=>{
  let fail=false;const f=await fixture({getTrends:(days,at)=>{if(fail)throw new Error('synthetic unavailable');return data(days,at)}});
  try{
    await start(f);const previousGraph=f.d.querySelector('[data-trend-chart="activity"] svg').outerHTML;
    fail=true;await f.w.MarketPulseData.selectDays(7);await until(()=>f.d.getElementById('trendRetry')?.hidden===false);
    assert.equal(f.w.MarketPulseData.getState().days,7);assert.equal(content(f).dataset.windowDays,'30');
    assert.equal(f.d.querySelector('[data-trend-chart="activity"] svg').outerHTML,previousGraph);
    assert.match(f.d.getElementById('trendPeriod').textContent,/Son 30 gün/);
    assert.match(f.d.getElementById('trendStatus').textContent,/yenilenemedi|alınamadı|güncellenemedi|tekrar|yeniden/i);
    assert.doesNotMatch(content(f).textContent,/Bu dönemde.*(?:hamle|değişiklik) yok/);
    fail=false;f.d.getElementById('trendRetry').click();
    await until(()=>content(f).dataset.windowDays==='7'&&content(f).getAttribute('aria-busy')==='false');
    assert.equal(f.d.getElementById('trendRetry')?.hidden,true);
    assert.match(f.d.getElementById('trendPeriod').textContent,/Son 7 gün/);
  }finally{f.dom.window.close()}
});

test('missing or unrecognized authorization never requests trend data, including explicit retry',async()=>{
  for(const user of [null,{role:'unknown'}]){
    const f=await fixture({user});try{
      await f.w.MarketPulseData.ensure();await f.w.MarketPulseTrends.activate();await f.w.MarketPulseTrends.retry();await tick();
      assert.equal(trendRequests(f).length,0);
      assert.equal(f.d.querySelector('[data-trend-chart]'),null);
    }finally{f.dom.window.close()}
  }
});

test('a response with the wrong snapshot end is rejected instead of publishing mismatched periods',async()=>{
  const f=await fixture({getTrends:days=>data(days,'2026-09-23T12:00:00.000Z')});
  try{
    await f.w.MarketPulseData.ensure();await f.w.MarketPulseTrends.activate();
    await until(()=>f.d.getElementById('trendRetry')?.hidden===false);
    assert.equal(content(f).dataset.windowEnd,undefined);
    assert.equal(content(f).querySelector('svg'),null);
    assert.match(f.d.getElementById('trendStatus').textContent,/alınamıyor|yeniden|yenilenemedi/i);
  }finally{f.dom.window.close()}
});

test('unobserved days are gaps, while successfully observed days with no moves are honest zeros',async()=>{
  let observed=false;
  const f=await fixture({getTrends:(days,at)=>{
    const result=data(days,at);result.coverage.current={observed_days:observed?days:0,expected_days:days,complete:observed};
    result.summary={move_count:observed?0:null,previous_move_count:null,affected_packages:observed?0:null,added_count:observed?0:null,removed_count:observed?0:null,priority_count:observed?0:null,change_pct:null};
    result.activity=result.activity.map(point=>({...point,observed,move_count:observed?0:null}));
    result.directions=result.directions.map(row=>({...row,count:observed?0:null}));result.segments=[{name:'Genel',current:observed?0:null,previous:null,priority_count:null}];return result;
  }});
  try{
    await start(f);assert.equal(content(f).querySelectorAll('.ta-zero').length,0);
    assert.match(f.d.getElementById('trendCoverage').textContent,/henüz kayıt yok|kayıt bulunmuyor/i);
    assert.doesNotMatch(f.d.querySelector('[data-trend-chart="segments"]').textContent,/0\s*bu dönem/);
    observed=true;await select(f,7);
    assert.equal(content(f).querySelectorAll('.ta-zero').length,7);
    assert.match(content(f).textContent,/7 gün kayıt var, değişiklik yok/);
  }finally{f.dom.window.close()}
});

test('persisted changes remain visible when their scan completion record is missing',async()=>{
  const f=await fixture({getTrends:(days,at)=>{
    const result=data(days,at);result.summary.move_count=3;
    result.activity=[
      {date:'2026-09-21',move_count:3,observed:false,observed_change:true,partial:true},
      {date:'2026-09-22',move_count:0,observed:true,partial:false},
      {date:'2026-09-23',move_count:null,observed:false,partial:false}
    ];result.coverage.current={observed_days:1,expected_days:3,complete:false};return result;
  }});
  try{
    await start(f);
    const chart=f.d.querySelector('[data-trend-chart="activity"]');
    assert.equal(chart.querySelectorAll('.ta-activity-bar').length,1,'known positive changes are not drawn as a missing day');
    assert.equal(chart.querySelectorAll('.ta-zero').length,1,'only the successfully observed zero is drawn as zero');
    assert.equal(chart.querySelectorAll('rect[fill="url(#ta-unobserved)"]').length,1,'the unknown day remains a gap');
    assert.match(chart.querySelector('desc').textContent,/toplam 3 paket hamlesi/);
    const rows=[...f.d.querySelectorAll('.ta-daily-table tbody tr')];
    assert.equal(rows.length,3);assert.equal(rows[0].querySelector('td').textContent,'3');
    assert.match(rows[0].textContent,/eksik|kısmi/i);assert.doesNotMatch(rows[0].textContent,/Kayıt yok/);
    assert.equal(rows.reduce((sum,row)=>sum+(Number(row.querySelector('td').textContent)||0),0),3);
  }finally{f.dom.window.close()}
});

test('missing history is distinct from unchanged value observations and emits no invented numeric graph',async()=>{
  let unchanged=false;
  const f=await fixture({getTrends:(days,at)=>{
    const result=data(days,at);result.summary={move_count:0,previous_move_count:0,affected_packages:0,added_count:0,removed_count:0,priority_count:0,change_pct:null};
    result.activity=result.activity.map(point=>({...point,move_count:null,observed:false}));
    result.coverage.current={observed_days:0,expected_days:days,complete:false};result.directions=[];result.segments=[];result.insights=[];
    result.values={rows:[],eligible_count:unchanged?3:0,excluded_count:2,unchanged_count:unchanged?3:0,changed_count:0};return result;
  }});
  try{
    await start(f);const before=f.d.querySelector('[data-trend-chart="value"]').textContent;
    assert.equal(f.d.querySelector('[data-trend-chart="value"] svg'),null);
    assert.match(before,/veri|kayıt|geçmiş|karşılaştır/i);
    unchanged=true;await select(f,7);
    const after=f.d.querySelector('[data-trend-chart="value"]').textContent;
    assert.notEqual(after,before);assert.match(after,/değişmedi|değişiklik|aynı|korundu|sabit/i);
    assert.doesNotMatch(after,/internet miktarı ve fiyatı değişmedi/,'unchanged GB/100 TL does not prove unchanged GB and price');
    assert.equal(f.d.querySelector('[data-trend-chart="value"] svg'),null);
    assert.doesNotMatch(content(f).innerHTML,/NaN|Infinity/);
  }finally{f.dom.window.close()}
});

test('product names and trend explanations are escaped and unsafe evidence links are omitted',async()=>{
  const hostile='<img src=x onerror=bad()>',f=await fixture({getTrends:(days,at)=>{
    const result=data(days,at);result.values.rows[0].name=hostile;result.values.rows[0].source_url='javascript:bad()';
    result.segments[0].name=hostile;result.directions[0].label=hostile;result.insights[0]={title:hostile,body:'<script>bad()</script>',tone:'info'};return result;
  }});
  try{
    await start(f);assert.equal(content(f).querySelector('img,script,[onerror],a[href^="javascript:"]'),null);
    assert.match(content(f).textContent,/<img/);assert.match(content(f).textContent,/<script>/);
  }finally{f.dom.window.close()}
});
