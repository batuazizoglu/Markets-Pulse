import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validateAdFeed} from '../src/ad-visual.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';

const script=await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8');
const at='2026-09-19T12:00:00.000Z';
const directory=['Nethouse','Telsim'].map((brand,i)=>({brand,page_id:String(123456+i),country:'CY',ad_library_url:'https://www.facebook.com/ads/library/?view_all_page_id='+String(123456+i)}));
async function dashboard(data){
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'});
  dom.window.fetch=async()=>({ok:true,json:async()=>({rows:[],source_directory:directory,...data})});
  dom.window.MarketPulseAccess={ready:Promise.resolve({role:'admin'}),isAdmin:()=>true};
  dom.window.eval(script);await dom.window.AdVisualUI.load();return dom;
}

test('provider missing token or budget remains explicitly waiting without inventing an empty-source result',async()=>{
  for(const code of ['token_missing','budget_missing']){
    const dom=await dashboard({cloud:{capture_transport:{mode:'proxy',configured:true,message:'Eski bağlantı'},capture_provider:{provider:'apify',enabled:true,configured:false,code,message:code==='token_missing'?'Apify anahtarı bekleniyor.':'Günlük bütçe ayarı bekleniyor.',runs:[]},sources:[{brand:'Nethouse',status:'no_ads',captured:0}]}});
    try{
      const d=dom.window.document;assert.match(d.querySelector('[data-av-provider-status]').textContent,/Apify.*Sağlayıcı ayarları bekleniyor/);
      assert.doesNotMatch(d.querySelector('.av-status').textContent,/Birincil tarama: Proxy|Eski bağlantı/);
      const filter=d.querySelector('[data-av-brand]');filter.value='Nethouse';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      assert.match(d.querySelector('.av-source-focus').textContent,/Sağlayıcı ayarları bekleniyor/);
      assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/reklam bulunamadı/);
      assert.match(d.querySelector('.av-empty').textContent,/reklam olmadığı anlamına gelmez/);assert.equal(d.querySelectorAll('.av-card').length,0);
    }finally{dom.window.close()}
  }
});

test('latest provider counters describe persisted variants and pending media without creating analyzed cards',async()=>{
  const run={brand:'Nethouse',job_id:2,state:'partial',ads:5,assets:8,captured:3,pending:2,missing:2,errors:1,source_exhausted:true,coverage_complete:false,updated_at:at};
  const dom=await dashboard({cloud:{capture_provider:{provider:'apify',enabled:true,configured:true,message:'Sağlayıcı etkin.',runs:[{...run,job_id:1,ads:99,coverage_complete:true,updated_at:'2026-09-18T12:00:00Z'},run]}}});
  try{
    const d=dom.window.document,filter=d.querySelector('[data-av-brand]');filter.value='Nethouse';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    const text=d.querySelector('.av-source-focus').textContent;
    for(const value of ['Bulunan reklam: 5','Keşfedilen görsel / varyant: 8','Kaydedilen: 3','Bekleyen: 2','Medyası eksik: 2','İndirme hatası: 1','Kapsamın tam olduğu doğrulanmadı'])assert.ok(text.includes(value),value);
    assert.doesNotMatch(text,/Bulunan reklam: 99|Sağlayıcı kapsamı tam olarak doğruladı/);
    assert.equal(d.querySelectorAll('.av-card,.av-image').length,0);assert.match(d.querySelector('.av-cloud').textContent,/Bulunan reklam: 5/);
  }finally{dom.window.close()}
});

test('dataset exhaustion with zero rows stays unknown unless the supplier explicitly confirms completeness',async()=>{
  for(const coverage_complete of [false,true]){
    const run={brand:'Nethouse',state:'complete',ads:0,assets:0,captured:0,pending:0,missing:0,errors:0,source_exhausted:true,coverage_complete,updated_at:at};
    const dom=await dashboard({cloud:{capture_provider:{provider:'apify',enabled:true,configured:true,runs:[run]}}});
    try{
      const d=dom.window.document,filter=d.querySelector('[data-av-brand]');filter.value='Nethouse';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      if(coverage_complete){assert.match(d.querySelector('.av-source-focus').textContent,/Sağlayıcı kapsamı tam olarak doğruladı/);assert.match(d.querySelector('.av-empty').textContent,/Yeni taramalarda sonuç değişebilir/)}
      else{assert.match(d.querySelector('.av-source-focus').textContent,/Kapsamın tam olduğu doğrulanmadı/);assert.match(d.querySelector('.av-empty').textContent,/reklam olmadığı anlamına gelmez/);assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/reklam bulunamadı/)}
    }finally{dom.window.close()}
  }
});

test('disabled provider history cannot replace current blocking and archive counts survive an incomplete first page',async()=>{
  const dom=await dashboard({brand_groups:{Nethouse:{home:20}},cloud:{sources:[{brand:'Nethouse',status:'blocked',captured:3,note:'HTTP 403'}],capture_provider:{provider:'apify',enabled:false,configured:false,runs:[{brand:'Nethouse',state:'complete',ads:0,coverage_complete:true,updated_at:at}]}}});
  try{
    const d=dom.window.document,filter=d.querySelector('[data-av-brand]');filter.value='Nethouse';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.match(d.querySelector('.av-source-focus').textContent,/Kaynağa erişilemiyor/);assert.match(d.querySelector('.av-source-focus').textContent,/Arşivdeki analiz: 20/);
    assert.doesNotMatch(d.querySelector('.av-source-focus').textContent,/reklam bulunamadı|analiz sonucu henüz yayınlanmadı/);
  }finally{dom.window.close()}
});

test('video preview evidence is retained through feed validation and labeled as a preview in the card',async()=>{
  const feed={schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Her gün',timezone:'Asia/Famagusta'},run:{id:'video-preview-run',checked_at:at,status:'partial',coverage:[]},ads:[{
    brand:'Telsim',page_id:'164143610515',ad_id:'123456789',category:'home',category_evidence:'Evde internet',title:'Ev interneti',ad_status:'active',source_url:'https://www.facebook.com/ads/library/?id=123456789',observed_at:at,media_kind:'video_preview',offer:{price_try:null,previous_price_try:null,data_gb:null,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'},conditions:[],uncertainties:[],visual_summary:'Video önizleme görseli',images:[{sha256:'a'.repeat(64),path:'evidence/'+'a'.repeat(64)+'.jpg',captured_at:at}]
  }]};
  const ad=validateAdFeed(feed,HOME_INTERNET_SOURCES).ads[0];assert.equal(ad.media_kind,'video_preview');
  const dom=await dashboard({rows:[ad],groups:{home:1}});
  try{assert.match(dom.window.document.querySelector('.av-flags').textContent,/Video önizlemesi incelendi/)}finally{dom.window.close()}
});
