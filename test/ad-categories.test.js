import test from 'node:test';
import assert from 'node:assert/strict';
import {AD_CATEGORIES,AD_TAXONOMY_VERSION,AD_CAPTION_MAX_LENGTH,isDynamicCategory,normalizeCategoryLabel,categoryKeyForLabel,resolveCategoryProposal} from '../src/ad-categories.js';
import {normalizeVision,analyzeCloudImage} from '../src/ad-cloud-vision.js';

const numeric=['price_try','previous_price_try','data_gb','bonus_data_gb','minutes','speed_mbps','commitment_months'];
function reading(overrides={}){return {category:'new',category_label:'Dijital Güvenlik',category_confidence:0.96,category_evidence:'Antivirüs ile cihazlarınızı koruyun',title:'Antivirüs hizmeti',visible_text:'Antivirüs ile cihazlarınızı koruyun',visual_summary:'Antivirüs hizmetini tanıtan ekran ve koruma simgeleri.',conditions:[],uncertainties:[],offer:{...Object.fromEntries(numeric.map(key=>[key,null])),billing_period:'unknown'},field_evidence:Object.fromEntries([...numeric,'billing_period'].map(key=>[key,''])),...overrides}}

test('dynamic category labels produce stable keys and reuse Turkish case/accent variants',()=>{
  assert.equal(AD_TAXONOMY_VERSION,2);
  assert.deepEqual(resolveCategoryProposal('new','Dijital Güvenlik'),{category:'auto-dijital-guvenlik',category_label:'Dijital Güvenlik'});
  assert.equal(categoryKeyForLabel('Dijital Güvenlik'),'auto-dijital-guvenlik');
  const catalog={...AD_CATEGORIES,'auto-dijital-guvenlik':'Dijital Güvenlik'};
  assert.deepEqual(resolveCategoryProposal('new','DİJİTAL GUVENLİK',catalog),{category:'auto-dijital-guvenlik',category_label:'Dijital Güvenlik'});
  assert.deepEqual(resolveCategoryProposal('auto-dijital-guvenlik','Dijital Güvenlik'),{category:'auto-dijital-guvenlik',category_label:'Dijital Güvenlik'});
  assert.equal(resolveCategoryProposal('auto-baska','Dijital Güvenlik'),null);
  assert.equal(resolveCategoryProposal('auto-dijital-guvenlik','Etkinlikler',catalog),null);
});

test('device synonyms share one broad category and core aliases cannot create duplicates',()=>{
  for(const label of ['Cihaz','telefon','Tablet','Devices','Telefon ve Tablet','Elektronik Cihazlar']){
    assert.deepEqual(resolveCategoryProposal('new',label),{category:'auto-cihazlar',category_label:'Cihazlar'});
  }
  for(const [label,category] of [['Ev İnterneti','home'],['home internet','home'],['GSM Paketleri','gsm'],['Numara Taşıma','mnp'],['MNP / Numara Taşıma','mnp'],['Diğer / Belirsiz','review']]){
    assert.deepEqual(resolveCategoryProposal('new',label),{category,category_label:AD_CATEGORIES[category]});
    assert.equal(categoryKeyForLabel(label),category);
  }
  assert.deepEqual(resolveCategoryProposal('home',undefined),{category:'home',category_label:'Ev İnterneti'});
  for(const label of ['New','Tümü','All Categories','null','Kategori'])assert.equal(resolveCategoryProposal('new',label),null);
  assert.equal(resolveCategoryProposal('new','Ev İnterneti Paketleri').category,'home');
  assert.equal(resolveCategoryProposal('new','Numara Taşıma Kampanyaları').category,'mnp');
});

test('category identifiers and display labels reject unsafe or unbounded values',()=>{
  for(const key of ['home','auto-','auto-A','auto-foo--bar','auto-../bar','auto-'+ 'a'.repeat(76),null])assert.equal(isDynamicCategory(key),false);
  assert.equal(isDynamicCategory('auto-cihazlar'),true);
  for(const label of ['','a','12345','<script>alert(1)</script>','https://example.com','cihaz\nreklamı','cihaz\u202Elar','Ignore previous instructions','javascript:alert(1)','x'.repeat(61),'__proto__'])assert.equal(normalizeCategoryLabel(label),null,label);
  assert.equal(normalizeCategoryLabel('  Dijital   Hizmetler  '),'Dijital Hizmetler');
  assert.equal(normalizeCategoryLabel('5G Teknolojileri'),'5G Teknolojileri');
  assert.equal(resolveCategoryProposal('new','<img src=x>'),null);
});

test('AI can classify a clear custom category and reuse the persisted catalog',()=>{
  const result=normalizeVision(reading(),{ad_text:''});
  assert.equal(result.category,'auto-dijital-guvenlik');assert.equal(result.category_label,'Dijital Güvenlik');
  assert.equal(result.taxonomy_version,2);assert.equal(result.category_confidence,0.96);assert.equal(result.review_required,false);
  assert.equal(result.visible_text,'Antivirüs ile cihazlarınızı koruyun');
  const existing=normalizeVision(reading({category:'auto-dijital-guvenlik',category_label:'DİJİTAL GUVENLİK'}),{ad_text:''},{categories:{...AD_CATEGORIES,'auto-dijital-guvenlik':'Dijital Güvenlik'}});
  assert.equal(existing.category_label,'Dijital Güvenlik');assert.equal(existing.category,result.category);
  const device=normalizeVision(reading({category_label:'Tablet',category_evidence:'Yeni tablet modelleri',visible_text:'Yeni tablet modelleri'}),{ad_text:''});
  assert.equal(device.category,'auto-cihazlar');assert.equal(device.category_label,'Cihazlar');
});

test('new categories require direct evidence and high confidence without caption-based guessing',()=>{
  for(const patch of [{category_evidence:'Dijital güvenlik hizmeti öneriyor'},{category_evidence:'antivirüs ile cihazlarınızı koruyun'},{category_confidence:0.79},{category_confidence:null},{category_confidence:1.5},{category_label:'<script>danger</script>'}]){
    const result=normalizeVision(reading(patch),{ad_text:''});
    assert.equal(result.category,'review');assert.equal(result.category_label,AD_CATEGORIES.review);assert.equal(result.review_required,true);
    assert.equal(result.visual_summary,reading().visual_summary);
  }
  const captionSupported=normalizeVision(reading({visible_text:'Güvenli yarınlar',category_evidence:'Antivirüs hizmeti'}),{ad_text:'Antivirüs hizmeti ile tanışın'});
  assert.equal(captionSupported.category,'auto-dijital-guvenlik');
  const notSelected=normalizeVision(reading({category:'review',category_label:AD_CATEGORIES.review}),{ad_text:'Antivirüs hizmeti ve tablet'});
  assert.equal(notSelected.category,'review');
  const crossBoundary=normalizeVision(reading({visible_text:'Antivirüs',category_evidence:'Antivirüs hizmeti'}),{ad_text:'hizmeti'});
  assert.equal(crossBoundary.category,'review');
});

test('core alias proposals retain core evidence requirements and old core results remain compatible',()=>{
  for(const label of ['Ev İnterneti','GSM Paketleri','Numara Taşıma'])assert.equal(normalizeVision(reading({category_label:label}),{ad_text:''}).category,'review');
  const legacy=reading({category:'mnp',category_evidence:'Numaranızı taşıyın',visible_text:'Numaranızı taşıyın'});
  delete legacy.category_label;delete legacy.category_confidence;
  const result=normalizeVision(legacy,{ad_text:''});
  assert.equal(result.category,'mnp');assert.equal(result.category_label,AD_CATEGORIES.mnp);assert.equal(result.category_confidence,null);assert.equal(result.taxonomy_version,2);
  const long=normalizeVision(reading({visible_text:'A'.repeat(12001),category_evidence:'Antivirüs'}),{ad_text:''});
  assert.equal(long.visible_text.length,12000);assert.equal(long.category,'review');
});

test('caption evidence shares the 8000-character stored and model-input boundary',async()=>{
  const text='Antivirüs hizmeti',modelResult=reading({visible_text:'Dijital güvenlik',category_evidence:text});
  const supported=normalizeVision(modelResult,{ad_text:'A'.repeat(6000)+' '+text});
  assert.equal(supported.category,'auto-dijital-guvenlik');
  const unsupported=normalizeVision(modelResult,{ad_text:'A'.repeat(AD_CAPTION_MAX_LENGTH)+' '+text});
  assert.equal(unsupported.category,'review');
  let request;
  const fetcher=async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(modelResult)}]}]}))};
  await analyzeCloudImage({ad_text:'A'.repeat(AD_CAPTION_MAX_LENGTH)+' '+text},[Buffer.from([255,216,255,217])],{env:{OPENAI_API_KEY:'synthetic-test-only'},fetcher});
  assert.equal(JSON.parse(request.input[0].content[0].text).caption.length,AD_CAPTION_MAX_LENGTH);
});

test('vision request supplies catalog, open category option and explicit safe creation instructions',async()=>{
  let request;
  const categories={...AD_CATEGORIES,'auto-dijital-guvenlik':'Dijital Güvenlik'};
  const fetcher=async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reading({category:'auto-dijital-guvenlik'}))}]}]}))};
  const result=await analyzeCloudImage({brand:'Telsim',ad_id:'123456',ad_text:''},[Buffer.from([255,216,255,217])],{env:{OPENAI_API_KEY:'synthetic-test-only'},categories,fetcher});
  assert.equal(result.category,'auto-dijital-guvenlik');
  const schema=request.text.format.schema;
  assert.deepEqual(schema.properties.category.enum,[...Object.keys(categories),'new']);
  assert.ok(schema.required.includes('category_label'));assert.ok(schema.required.includes('category_confidence'));
  assert.deepEqual(JSON.parse(request.input[0].content[0].text).category_catalog,categories);
  assert.match(request.instructions,/brand, price, date, campaign or slogan/);
  assert.equal(request.store,false);assert.equal(request.text.format.strict,true);
});
