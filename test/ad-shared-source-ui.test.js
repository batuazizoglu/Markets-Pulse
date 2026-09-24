import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const script=await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8');
const alias='Turkcell Ev İnterneti',at='2026-09-24T08:00:00Z';
const directory=[
  {brand:'KKTCELL',page_id:'127496543986832',ad_library_url:'https://www.facebook.com/ads/library/?view_all_page_id=127496543986832'},
  {brand:alias,page_id:'127496543986832',capture_brand:'KKTCELL',ad_library_url:'https://www.facebook.com/ads/library/?view_all_page_id=127496543986832'},
  {brand:'GNÇ Kıbrıs',page_id:'321385064564918',ad_library_url:'https://www.facebook.com/ads/library/?view_all_page_id=321385064564918'}
];
const ad=(key,brand='KKTCELL',category='home')=>({key,brand,category,title:key,offer:{},images:[],observed_at:at});
const pending=(key,brand='KKTCELL')=>({key,brand,ad_id:key,variant_id:'1',images:[],status:'pending',observed_at:at});
async function dashboard(getData){
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'}),requests=[];
  dom.window.fetch=async raw=>{const url=new URL(raw,'https://www.marketspulse.cloud');requests.push(url);return {ok:true,json:async()=>getData(url)}};
  dom.window.eval(script);await dom.window.AdVisualUI.load();
  const settled=async()=>{await new Promise(r=>setTimeout(r,0));await dom.window.AdVisualUI.load()};
  const select=async brand=>{const input=dom.window.document.querySelector('#ad-visual-section [data-av-brand]');input.value=brand;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settled()};
  return {dom,d:dom.window.document,requests,settled,select};
}

test('shared advertiser sources project canonical status and archive without duplicating records or provider totals',async()=>{
  const data={source_directory:directory,rows:[ad('Home'),ad('Mobile','KKTCELL','gsm'),ad('Youth','GNÇ Kıbrıs')],groups:{home:2,gsm:1},brand_groups:{KKTCELL:{home:1,gsm:1},'GNÇ Kıbrıs':{home:1}},pending_media:{total:0,brand_totals:{}},monitoring:{coverage:[{brand:alias,status:'unverified',stale:true,note:'Old unverified alias'}]},cloud:{sources:[{brand:'KKTCELL',status:'partial',captured:2,finished_at:at}],capture_provider:{enabled:true,configured:true,runs:[{brand:'KKTCELL',state:'complete',ads:2,captured:2,updated_at:at},{brand:'GNÇ Kıbrıs',state:'complete',ads:1,captured:1,updated_at:at}]}},pagination:{total:3,has_more:false}};
  const {dom,d,select}=await dashboard(()=>data);
  try{
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,2);
    assert.equal(d.querySelectorAll('#ad-visual-section .av-cloud [data-av-provider-counts]').length,2);
    const coverage=d.querySelector('[data-av-source="'+alias+'"]');
    assert.match(coverage.textContent,/Sağlayıcı işlemi tamamlandı/);assert.doesNotMatch(coverage.textContent,/Old unverified alias|Yeni inceleme bekleniyor|Sayfa kimliği doğrulanmadı/);
    await select(alias);await dom.window.AdVisualUI.mountHome();
    assert.equal(d.querySelector('#ad-visual-section .av-source-focus b').textContent,alias);
    assert.match(d.querySelector('.av-source-focus').textContent,/Ortak reklam hesabı: KKTCELL/);
    assert.match(d.querySelector('.av-source-focus').textContent,/Arşivdeki analiz: 2/);
    assert.equal(d.querySelector('#ad-visual-section .av-card h3').textContent,'Home');
    assert.equal(d.querySelector('#hiAdVisualMount .av-card h3').textContent,'Home');
    assert.match(d.querySelector('#ad-visual-section .av-pagination').textContent,/1 \/ 1/);
    await dom.window.AdVisualUI.setCategory('gsm');
    assert.equal(d.querySelector('#ad-visual-section .av-card h3').textContent,'Mobile');
    assert.equal(d.querySelector('#hiAdVisualMount .av-card h3').textContent,'Home');
    await select('GNÇ Kıbrıs');await dom.window.AdVisualUI.setCategory('home');
    assert.equal(d.querySelector('#ad-visual-section .av-card h3').textContent,'Youth');
    assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/Ortak reklam hesabı/);
    data.cloud.capture_provider.enabled=false;await dom.window.AdVisualUI.load(true);await select(alias);
    assert.match(d.querySelector('.av-source-focus').textContent,/Görseller kaydedildi/);
    assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/Old unverified alias|Yeni inceleme bekleniyor/);
  }finally{dom.window.close()}
});

test('alias archive and pending pagination share canonical requests, totals and caches',async()=>{
  const rows=[ad('Home 1'),ad('Home 2'),ad('Youth','GNÇ Kıbrıs')],pendingRows=[pending('Pending 1'),pending('Pending 2'),pending('Youth pending','GNÇ Kıbrıs')];
  const data={source_directory:directory,rows:[],groups:{home:3},brand_groups:{KKTCELL:{home:2},'GNÇ Kıbrıs':{home:1}},pending_media:{total:3,brand_totals:{KKTCELL:2,'GNÇ Kıbrıs':1}},pagination:{has_more:true}};
  const {dom,d,requests,select,settled}=await dashboard(url=>{
    const isPending=url.pathname.endsWith('/pending'),category=url.searchParams.get('category'),brand=url.searchParams.get('brand');
    if(!isPending&&!category)return data;
    const all=(isPending?pendingRows:rows).filter(row=>!brand||row.brand===brand),offset=url.searchParams.has('cursor')?1:0;
    const page=brand==='KKTCELL'?all.slice(offset,offset+1):all;
    return {rows:page,pagination:{total:all.length,has_more:brand==='KKTCELL'&&!offset,next_cursor:brand==='KKTCELL'&&!offset?'next':null}};
  });
  try{
    await select(alias);
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);assert.match(d.querySelector('.av-pagination').textContent,/1 \/ 2/);
    d.querySelector('#ad-visual-section [data-av-more]').click();await settled();
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,2);assert.match(d.querySelector('.av-pagination').textContent,/2 \/ 2/);
    assert.equal(d.querySelector('#ad-visual-section [data-av-more]'),null);
    await dom.window.AdVisualUI.mountHome();assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,2);
    d.querySelector('.av-pending').open=true;await settled();
    assert.equal(d.querySelectorAll('.av-pending-item').length,1);assert.match(d.querySelector('.av-pending>summary').textContent,/2/);
    d.querySelector('[data-av-pending-more]').click();await settled();assert.equal(d.querySelectorAll('.av-pending-item').length,2);
    const before=requests.length;await select('KKTCELL');assert.equal(requests.length,before,'same page aliases reuse canonical cursor caches');
    await select(alias);assert.equal(requests.length,before);assert.equal(d.querySelectorAll('.av-pending-item').length,2);
    assert.ok(requests.some(url=>url.pathname.endsWith('/pending')&&url.searchParams.get('brand')==='KKTCELL'&&url.searchParams.get('cursor')==='next'));
    assert.ok(requests.some(url=>url.searchParams.get('category')==='home'&&url.searchParams.get('brand')==='KKTCELL'&&url.searchParams.get('cursor')==='next'));
    assert.ok(requests.every(url=>url.searchParams.get('brand')!==alias));
    await select('GNÇ Kıbrıs');assert.equal(d.querySelectorAll('.av-pending-item').length,1);assert.match(d.querySelector('.av-pending-item').textContent,/Youth pending/);
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);assert.equal(d.querySelector('#ad-visual-section .av-card h3').textContent,'Youth');
  }finally{dom.window.close()}
});

test('shared-page mapping requires an explicit canonical brand and matching verified page IDs',async()=>{
  for(const changed of [{page_id:'999999999999999'},{page_id:null},{capture_brand:undefined}]){
    const sources=directory.map(source=>source.brand===alias?{...source,...changed}:source);
    const {dom,d,select}=await dashboard(()=>({source_directory:sources,rows:[ad('Canonical only')],groups:{home:1},brand_groups:{KKTCELL:{home:1}},pagination:{has_more:false}}));
    try{await select(alias);assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,0);assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/Ortak reklam hesabı/)}finally{dom.window.close()}
  }
  const {dom,d}=await dashboard(()=>({source_directory:directory,rows:[],groups:{},brand_groups:{},pagination:{has_more:false}}));
  try{assert.match(d.querySelector('.av-coverage>summary').textContent,/2 sayfada görsel bekleniyor/)}finally{dom.window.close()}
});
