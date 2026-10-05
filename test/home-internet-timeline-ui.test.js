import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const script=await readFile(new URL('../public/home-internet.js',import.meta.url),'utf8');
const end='2026-10-06T00:00:00Z';
const changes=Array.from({length:125},(_,i)=>({id:i+1,provider:i%2?'Beta':'Alpha',source_slug:'retired-source',product_family:'fixed',product_name:'Paket '+i,product_key:'plan'+i,change_type:'field_changed',field_name:'Efektif Aylık Ücret',old_value:'0',new_value:'499',detected_at:new Date(+new Date(end)-(i+1)*60000).toISOString(),source_url:'https://isp.example/packages',source_name:'Paket kaynağı'}));
changes.push({id:900,provider:'FWA',source_slug:'deleted-source',product_family:'fwa',product_name:'Red Box',change_type:'removed',old_value:JSON.stringify({technology:'4.5G FWA',effective_monthly_try:399}),detected_at:'2026-10-05T23:59:30Z'});
function payload(days=30,rows=changes){return {window_days:days,window_end:end,generated_at:end,products:[],sources:[],companies:[],social:[],campaigns:[],metrics:{},changes:rows}}
async function fixture(role='admin',rows=changes){
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://marketspulse.cloud/#home',runScripts:'outside-only'}),requests=[];
  dom.window.MarketPulseAccess={ready:Promise.resolve(),isAdmin:()=>role==='admin'};
  let handler=async url=>({ok:true,json:async()=>payload(Number(new URL(url,dom.window.location).searchParams.get('days')),rows)});
  dom.window.fetch=(url,opts)=>{requests.push({url,opts});return handler(url)};
  dom.window.eval(script);await dom.window.HomeInternetUI.load();
  return {dom,d:dom.window.document,ui:dom.window.HomeInternetUI,requests,setHandler:fn=>{handler=fn}};
}
const ids=(d,selector)=>[...d.querySelectorAll(selector+' [data-change-id]')].map(x=>x.dataset.changeId);
test('both history views use the same newest-first complete records, retaining unknown sources and expanding all pages',async()=>{
  const f=await fixture();try{
    assert.equal(ids(f.d,'#hiChanges').length,40);assert.deepEqual(ids(f.d,'#hiChanges'),ids(f.d,'#hiChangeFeed'));
    assert.equal(ids(f.d,'#hiChanges')[0],'1');
    for(let i=0;i<3;i++){f.d.querySelector('#hiTimelineMore').click();f.d.querySelector('#hiFeedMore').click()}
    assert.equal(ids(f.d,'#hiChanges').length,125);assert.deepEqual(ids(f.d,'#hiChanges'),ids(f.d,'#hiChangeFeed'));
    assert.equal(f.d.querySelector('#hiTimelineMore').hidden,true);assert.match(f.d.querySelector('#hiTimelineCount').textContent,/125 \/ 125/);
    assert.match(f.d.querySelector('#hiChanges').textContent,/0 TL → 499 TL/);
    assert.match(f.d.querySelector('#hiChangeFeed').textContent,/Önce0 TL→Sonra499 TL/);
    await f.ui.load();assert.equal(ids(f.d,'#hiChanges').length,125,'refresh preserves expanded rows');
  }finally{f.dom.window.close()}
});
test('family, provider and type filters affect both views and counts, while standard users can switch views',async()=>{
  const f=await fixture('standard');try{
    assert.equal(f.d.querySelector('#hiTimelinePanel').hidden,false);assert.equal(f.d.querySelector('#hiFeedPanel').hidden,true);
    f.d.querySelector('[data-hi-change-view="feed"]').click();assert.equal(f.d.querySelector('#hiFeedPanel').hidden,false);assert.equal(f.d.querySelector('#hiTimelinePanel').hidden,true);
    const provider=f.d.querySelector('#hiChangeProvider');provider.value='Beta';provider.dispatchEvent(new f.dom.window.Event('change'));
    assert.match(f.d.querySelector('#hiTimelineCount').textContent,/40 \/ 62/);assert.deepEqual(ids(f.d,'#hiChanges'),ids(f.d,'#hiChangeFeed'));
    f.ui.setFamily('fwa');assert.deepEqual(ids(f.d,'#hiChanges'),['900']);assert.match(f.d.querySelector('#hiKpis').textContent,/7 günlük değişiklik1/);
    assert.match(f.d.querySelector('#hiChangeFeed').textContent,/Paket kaldırıldı/);assert.doesNotMatch(f.d.querySelector('#hiChangeFeed').textContent,/effective_monthly_try/);
    const type=f.d.querySelector('#hiChangeType');type.value='added';type.dispatchEvent(new f.dom.window.Event('change'));
    assert.equal(ids(f.d,'#hiChanges').length,0);assert.match(f.d.querySelector('#hiChanges').textContent,/filtrelere uygun/);
    assert.equal(f.d.querySelector('#hiSources'),null);
  }finally{f.dom.window.close()}
});
test('period changes are read-only and latest request wins; failed refresh retains the visible period and history',async()=>{
  const f=await fixture('standard');try{
    const resolvers=new Map();f.setHandler(url=>new Promise(resolve=>resolvers.set(Number(new URL(url,'https://example.com').searchParams.get('days')),resolve)));
    const seven=f.ui.selectDays(7);await new Promise(setImmediate);const ninety=f.ui.selectDays(90);await new Promise(setImmediate);
    resolvers.get(90)({ok:true,json:async()=>payload(90,[{...changes[0],id:90}])});await ninety;
    resolvers.get(7)({ok:true,json:async()=>payload(7,[{...changes[0],id:7}])});await seven;
    assert.deepEqual(ids(f.d,'#hiChanges'),['90']);assert.match(f.d.querySelector('#hiChangeStatus').textContent,/Son 90 gün/);
    f.setHandler(async()=>({ok:false,status:500}));await f.ui.selectDays(7);
    assert.deepEqual(ids(f.d,'#hiChanges'),['90']);assert.match(f.d.querySelector('#hiMessage').textContent,/Önceki 90 günlük/);
    assert.equal(f.d.querySelector('[data-hi-days="90"]').getAttribute('aria-pressed'),'true');
    assert.ok(f.requests.every(r=>r.opts.cache==='no-store'&&!r.url.includes('refresh=')));
    f.ui.setView('compare');assert.equal(f.d.querySelector('#hiTrackingTop').hidden,true);f.ui.setView('tracking');assert.deepEqual(ids(f.d,'#hiChanges'),['90']);
  }finally{f.dom.window.close()}
});
test('history escapes external values and rejects executable source links',async()=>{
  const f=await fixture('admin',[{...changes[0],product_name:'<img src=x onerror=alert(1)>',provider:'<script>alert(1)</script>',old_value:'<svg onload=alert(1)>',new_value:'<iframe>',source_url:'javascript:alert(1)'}]);
  try{assert.equal(f.d.querySelectorAll('#hiTrackingTop img,#hiTrackingTop script,#hiTrackingTop svg,#hiTrackingTop iframe,#hiTrackingTop a').length,0);assert.match(f.d.querySelector('#hiChanges').textContent,/<img/)}finally{f.dom.window.close()}
});

test('switching views during the first load preserves loading state and never invents an empty history',async()=>{
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://marketspulse.cloud/#home',runScripts:'outside-only'});
  let resolve;dom.window.fetch=()=>new Promise(r=>{resolve=r});
  const errors=[];dom.window.addEventListener('error',e=>errors.push(e.message));
  dom.window.eval(script);const loaded=dom.window.HomeInternetUI.load();await new Promise(setImmediate);
  try{
    dom.window.document.querySelector('[data-hi-change-view="feed"]').click();
    assert.equal(dom.window.document.querySelector('#hiFeedPanel').hidden,false);
    assert.match(dom.window.document.querySelector('#hiChangeFeed').textContent,/yükleniyor/);
    assert.doesNotMatch(dom.window.document.querySelector('#hiTrackingTop').textContent,/değişiklik yok/);
    assert.deepEqual(errors,[]);
    resolve({ok:true,json:async()=>payload()});await loaded;
    assert.equal(dom.window.document.querySelector('#hiFeedPanel').hidden,false);
    assert.equal(ids(dom.window.document,'#hiChangeFeed').length,40);
  }finally{dom.window.close()}
});

test('a manual source scan retains its period and publishes newly recorded changes before allowing another period',async()=>{
  const f=await fixture();let resolve;
  try{
    f.setHandler(()=>new Promise(r=>{resolve=r}));const scanned=f.ui.scan();await new Promise(setImmediate);
    const count=f.requests.length;
    assert.ok([...f.d.querySelectorAll('[data-hi-days]')].every(b=>b.disabled));
    await f.ui.selectDays(7);assert.equal(f.requests.length,count);assert.equal(f.d.querySelector('#hiScanBtn').disabled,true);
    resolve({ok:true,json:async()=>payload(30,[{...changes[0],id:999}])});await scanned;
    assert.deepEqual(ids(f.d,'#hiChanges'),['999']);assert.equal(f.d.querySelector('#hiScanBtn').disabled,false);
    assert.ok([...f.d.querySelectorAll('[data-hi-days]')].every(b=>!b.disabled));
  }finally{f.dom.window.close()}
});
