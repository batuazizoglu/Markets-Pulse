import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {adVisualReportHtml} from '../src/ad-visual-report.js';

const script=await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8');
const at='2026-09-21T06:00:00Z';
function ad(category,category_label,brand='Telsim'){
  return {key:category+':'+brand,brand,category,category_label,title:category+' reklamı',ad_id:'12345678',source_url:'https://www.facebook.com/ads/library/?id=12345678',observed_at:at,first_seen_at:at,ad_status:'active',category_evidence:'Görselde doğrulanan konu',offer:{price_try:null},conditions:[],uncertainties:[],images:[]};
}
async function dashboard(getData){
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'}),requests=[];
  dom.window.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>getData(new URL(url,'https://www.marketspulse.cloud'))}};
  dom.window.MarketPulseAccess={ready:Promise.resolve({role:'admin'}),isAdmin:()=>true};
  dom.window.eval(script);await dom.window.AdVisualUI.load();
  return {dom,requests,d:dom.window.document};
}
const tabs=d=>[...d.querySelectorAll('#ad-visual-section [data-av-category]')].map(button=>button.dataset.avCategory);
const title=(d,root='#ad-visual-section')=>d.querySelector(root+' .av-card h3')?.textContent;

test('dynamic categories use server filtering and stay isolated from the home embed',async()=>{
  const rows=[ad('home','Ev İnterneti'),ad('auto-cihazlar','Cihazlar'),ad('auto-cihazlar','Cihazlar','Xrealnet'),ad('review','Diğer / Belirsiz')];
  const data={rows:rows.slice(0,1),categories:{'auto-cihazlar':'Cihazlar','auto-etkinlikler':'Etkinlikler'},groups:{home:1,gsm:0,mnp:0,review:1,'auto-cihazlar':2,'auto-etkinlikler':0},brand_groups:{Telsim:{home:1,review:1,'auto-cihazlar':1},Xrealnet:{'auto-cihazlar':1}},pagination:{has_more:true}};
  const {dom,d,requests}=await dashboard(url=>{
    const category=url.searchParams.get('category'),brand=url.searchParams.get('brand');
    if(!category)return data;
    const selected=rows.filter(row=>row.category===category&&(!brand||row.brand===brand));
    return {rows:selected,pagination:{total:selected.length,has_more:false,next_cursor:null}};
  });
  try{
    assert.deepEqual(tabs(d),['home','gsm','mnp','review','auto-cihazlar']);
    await dom.window.AdVisualUI.mountHome();await dom.window.AdVisualUI.setCategory('auto-cihazlar');
    assert.match(requests.at(-1),/category=auto-cihazlar/);
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,2);
    assert.match(d.querySelector('#ad-visual-section .av-brand').textContent,/Cihazlar/);
    assert.equal(title(d,'#hiAdVisualMount'),'home reklamı');assert.equal(d.querySelector('#hiAdVisualMount .av-tabs'),null);
    const filter=d.querySelector('#ad-visual-section [data-av-brand]');filter.value='Xrealnet';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    await dom.window.AdVisualUI.load();
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,0);
    assert.ok(requests.some(url=>url.includes('category=auto-cihazlar')&&url.includes('brand=Xrealnet')));
    await dom.window.AdVisualUI.setCategory('review');
    assert.match(d.querySelector('#ad-visual-section .av-review-info').textContent,/yeni kategori oluşturabilir/);
    assert.doesNotMatch(d.querySelector('#ad-visual-section .av-review-info').textContent,/Cihaz, marka ve hizmet duyuruları/);
  }finally{dom.window.close()}
});

test('refresh discovers new categories, invalidates cached pages and preserves a selected category until it becomes empty',async()=>{
  let revision=0;
  const {dom,d,requests}=await dashboard(url=>{
    const categories=revision?{'auto-cihazlar':'Cihazlar','auto-etkinlikler':'Etkinlikler'}:{'auto-cihazlar':'Cihazlar'};
    const groups={home:1,'auto-cihazlar':revision===2?0:1,'auto-etkinlikler':revision?1:0};
    const category=url.searchParams.get('category');
    if(category)return {rows:[{...ad(category,categories[category]),title:category+' v'+revision}],pagination:{total:1,has_more:false}};
    return {rows:[],categories,groups,pagination:{has_more:true}};
  });
  try{
    await dom.window.AdVisualUI.setCategory('auto-cihazlar');assert.equal(title(d),'auto-cihazlar v0');
    revision=1;await dom.window.AdVisualUI.load(true);
    assert.ok(tabs(d).includes('auto-etkinlikler'));assert.equal(title(d),'auto-cihazlar v1');
    assert.equal(d.querySelector('[data-av-category="auto-cihazlar"]').getAttribute('aria-pressed'),'true');
    await dom.window.AdVisualUI.setCategory('auto-etkinlikler');assert.equal(title(d),'auto-etkinlikler v1');
    await dom.window.AdVisualUI.setCategory('auto-cihazlar');revision=2;await dom.window.AdVisualUI.load(true);
    assert.ok(!tabs(d).includes('auto-cihazlar'));assert.equal(title(d),'home v2');
    const before=requests.length;await dom.window.AdVisualUI.setCategory('auto-cihazlar');assert.equal(requests.length,before);
  }finally{dom.window.close()}
});

test('row category labels support responses without a category catalog',async()=>{
  const {dom,d}=await dashboard(()=>({rows:[ad('home','Ev İnterneti'),ad('auto-cihazlar','Cihazlar')],groups:{home:1,'auto-cihazlar':1}}));
  try{
    assert.ok(tabs(d).includes('auto-cihazlar'));d.querySelector('[data-av-category="auto-cihazlar"]').click();
    assert.equal(title(d),'auto-cihazlar reklamı');assert.match(d.querySelector('.av-brand').textContent,/Cihazlar/);
  }finally{dom.window.close()}
});

test('category labels are escaped, reserved keys are rejected and counts require own API groups',async()=>{
  const hostile='<img src=x onerror=bad()>',categories=JSON.parse('{"__proto__":"Bad","constructor":"Bad","auto-cihazlar":"'+hostile+'","auto-unused":"Unused","auto-inherited":"Inherited","home":"Changed core","auto-\\\" onclick=bad()":"Bad"}');
  const groups=Object.assign(Object.create({'auto-inherited':99}),{home:1,'auto-cihazlar':1,'auto-unused':0,constructor:99,'auto-" onclick=bad()':99});
  const {dom,d,requests}=await dashboard(()=>({rows:[ad('home','Ev İnterneti'),ad('auto-cihazlar',hostile)],categories,groups}));
  try{
    assert.deepEqual(tabs(d),['home','gsm','mnp','auto-cihazlar']);assert.match(d.querySelector('[data-av-category="home"]').textContent,/Ev İnterneti/);
    assert.match(d.querySelector('[data-av-category="auto-cihazlar"]').textContent,/<img/);assert.equal(d.querySelector('img,script,[onclick]'),null);
    await dom.window.AdVisualUI.setCategory('auto-cihazlar');assert.match(d.querySelector('.av-brand').textContent,/<img/);assert.equal(d.querySelector('img,script,[onerror]'),null);
    const before=requests.length;
    for(const category of ['__proto__','constructor','auto-inherited','auto-unused','auto-" onclick=bad()'])await dom.window.AdVisualUI.setCategory(category);
    assert.equal(requests.length,before);assert.equal(title(d),'auto-cihazlar reklamı');
  }finally{dom.window.close()}
});

test('reports render populated dynamic categories with escaped catalog headings and legacy row-label fallback',()=>{
  for(const catalog of [true,false]){
    const hostile='<img src=x onerror=bad()>',row={event_type:'first_seen',analysis_json:ad('auto-cihazlar',catalog?'Row label':hostile)};
    const data={checked_at:at,status:'ok',rows:[row],...(catalog?{categories:{'auto-cihazlar':hostile,'auto-empty':'Empty'}}:{})};
    const dom=new JSDOM(adVisualReportHtml(data));
    try{
      const d=dom.window.document,headings=[...d.querySelectorAll('h3')].map(el=>el.textContent);
      assert.ok(headings.includes(hostile+' • 1 kayıt'));assert.ok(!headings.some(value=>value.startsWith('Empty')));
      assert.equal(d.querySelector('img,script,[onerror]'),null);assert.match(d.body.textContent,/auto-cihazlar reklamı/);
      for(const label of ['Ev İnterneti','GSM Paketleri','MNP / Numara Taşıma'])assert.ok(headings.some(value=>value.startsWith(label)));
    }finally{dom.window.close()}
  }
  const row={event_type:'first_seen',category_label:'Etkinlikler',analysis_json:ad('auto-etkinlikler',undefined)};
  assert.match(adVisualReportHtml({checked_at:at,rows:[row]}),/Etkinlikler • 1 kayıt/);
});
