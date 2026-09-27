import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVision,analyzeCloudImage} from '../src/ad-cloud-vision.js';
import {AD_CATEGORIES,AD_TAXONOMY_VERSION} from '../src/ad-categories.js';

const numeric=['price_try','previous_price_try','data_gb','bonus_data_gb','minutes','speed_mbps','commitment_months'];
function reading(patch={}){
  return {category:'review',category_label:AD_CATEGORIES.review,category_confidence:0.55,category_evidence:'Paket fiyatı görünmüyor',title:'Reklam',visible_text:'',visual_summary:'Reklamın görünen içeriği.',conditions:[],uncertainties:[],
    offer:{...Object.fromEntries(numeric.map(key=>[key,null])),billing_period:'unknown'},field_evidence:Object.fromEntries([...numeric,'billing_period'].map(key=>[key,''])),...patch};
}

function assertStoredAssignment(result,category,source){
  assert.equal(result.category,category);
  assert.equal(result.category_confidence,0.55,'deterministic assignment must not invent higher model confidence');
  assert.equal(result.taxonomy_version,AD_TAXONOMY_VERSION);
  assert.equal(result.category_assignment.method,'stored_evidence');
  assert.equal(result.category_assignment.version,1);
  assert.equal(result.category_assignment.previous_category,'review');
  assert.equal(result.category_assignment.evidence_source,source);
  assert.ok(Number.isFinite(Date.parse(result.category_assignment.reviewed_at)));
}

test('clear digital services are classified without requiring tariff prices, including a logo-only video frame',()=>{
  for(const caption of ['My Vodafone, gerçek zamanlı kullanım takibi ve fatura detaylarınıza hızlı erişimle 7/24 hizmetinizde :)',
    'My Vodafone, size özel fırsatlarıyla 7/24 hizmetinizde :)',
    'TV+ ile HBO Max şimdi tüm içerikleriyle!',
    'Ödemeni Nethouse konforuyla dilediğin yerden online öde.']){
    const result=normalizeVision(reading({visible_text:'Vodafone'}),{ad_text:caption,has_video:true});
    assertStoredAssignment(result,'auto-dijital-hizmetler','ad_text');
    assert.ok(caption.includes(result.category_evidence));
    assert.equal(result.offer.price_try,null);
    assert.match(result.uncertainties.join(' '),/yalnız yakalanan karesi/);
  }
});

test('office moves, round-the-clock support and internet safety retain useful communication categories',()=>{
  for(const visible_text of ['Ön ofisimiz Küçük Kaymaklı şubesine taşındı.',
    '24/7 Support Fast Solutions!',
    "THE INTERNET IS FUN WHEN IT'S SAFE"]){
    const result=normalizeVision(reading({visible_text}),{ad_text:''});
    assertStoredAssignment(result,'auto-kurumsal-iletisim','visible_text');
    assert.equal(result.category_evidence,visible_text);
  }
});

test('Mbps plans need independently verified fixed ISP page identity and never brand-name inference',()=>{
  const candidate={page_id:'159064954156749',brand:'Broadmax',ad_text:'Öğrencilere 9 ay 20 Mbps internet 799 TL/AY!'};
  const withoutContext=normalizeVision(reading(),candidate);
  assert.equal(withoutContext.category,'review');assert.equal(withoutContext.category_assignment,undefined);
  const spoofed=normalizeVision(reading(),{...candidate,verifiedFixedIspPageId:candidate.page_id,fixed_internet_provider_verified:true});
  assert.equal(spoofed.category,'review');
  const wrongContext=normalizeVision(reading(),candidate,{verifiedFixedIspPageId:'164143610515'});
  assert.equal(wrongContext.category,'review');
  const verified=normalizeVision(reading(),candidate,{verifiedFixedIspPageId:candidate.page_id});
  assertStoredAssignment(verified,'home','ad_text');
  assert.equal(verified.category_assignment.rule,'home_fixed_plan');
  assert.equal(verified.offer.speed_mbps,null,'classification must not invent numeric facts');
});

test('explicit number portability repairs Review without changing numerical validation',()=>{
  const model=reading({visible_text:'40 GB 500 DK 659 TL',conditions:['İlk 6 ay fiyatı'],uncertainties:['Küçük yazılar okunamadı.']});
  model.offer.data_gb=80;model.field_evidence.data_gb='40 GB';
  model.offer.price_try=659;model.field_evidence.price_try='659 TL';
  const result=normalizeVision(model,{ad_text:'Numaranız değişmeden 1 yıl boyunca kafanız rahat etsin!'});
  assertStoredAssignment(result,'mnp','ad_text');
  assert.equal(result.offer.price_try,659);assert.equal(result.offer.data_gb,null);
  assert.deepEqual(result.conditions,model.conditions);
  assert.ok(result.uncertainties.includes('Küçük yazılar okunamadı.'));
});

test('evidence recovery returns actual source typography and never combines OCR with caption fragments',()=>{
  const model=reading({category:'new',category_label:'Dijital Güvenlik',category_confidence:0.96,visible_text:'Antivirüs İLE\ncihazlarınızı koruyun',category_evidence:'antivirüs ile cihazlarınızı koruyun'});
  const result=normalizeVision(model,{ad_text:''});
  assert.equal(result.category,'auto-dijital-guvenlik');
  assert.equal(result.category_evidence,model.visible_text);
  assert.equal(result.category_assignment,undefined);
  const stitched=normalizeVision({...model,visible_text:'Antivirüs',category_evidence:'Antivirüs hizmeti'},{ad_text:'hizmeti'});
  assert.equal(stitched.category,'review');
  const stitchedMnp=normalizeVision(reading({category:'mnp',category_confidence:0.96,visible_text:'Numaranız',category_evidence:'Numaranız değişmeden'}),{ad_text:'değişmeden'});
  assert.equal(stitchedMnp.category,'review');
});

test('an ambiguous logo stays in Review and prior summaries do not become observed proof',()=>{
  const result=normalizeVision(reading({visible_text:'Vodafone',visual_summary:'My Vodafone uygulaması fatura ödeme hizmeti olabilir.'}),{brand:'Telsim',ad_text:'Hayata bağlan',previous_analysis:{category:'home',visible_text:'Ev interneti'}});
  assert.equal(result.category,'review');assert.equal(result.category_assignment,undefined);
});

test('vision request teaches service categories and receives verified fixed ISP context from the caller only',async()=>{
  let request;
  const candidate={page_id:'159064954156749',brand:'Broadmax',ad_text:'20 Mbps 799 TL/AY 9 ay',fixed_internet_provider_verified:true};
  const fetcher=async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reading())}]}]}))};
  const options={env:{OPENAI_API_KEY:'synthetic-test-only'},fetcher};
  await analyzeCloudImage(candidate,[Buffer.from([255,216,255,217])],options);
  assert.equal(JSON.parse(request.input[0].content[0].text).fixed_internet_provider_verified,false);
  const result=await analyzeCloudImage(candidate,[Buffer.from([255,216,255,217])],{...options,verifiedFixedIspPageId:candidate.page_id});
  assert.equal(JSON.parse(request.input[0].content[0].text).fixed_internet_provider_verified,true);
  assert.equal(result.category,'home');
  assert.match(request.instructions,/My Vodafone/);assert.match(request.instructions,/Kurumsal İletişim/);
  assert.match(request.instructions,/Brand identity alone never proves a category/);
});

test('retail classification uses current image recognition without treating visual summaries as general quote sources',()=>{
  const visual_summary='Online alışveriş mağazasının görselinde cep telefonu, dizüstü bilgisayar ve kulaklık ürünleri gösteriliyor.';
  const model=reading({category_confidence:0.96,visible_text:'Kuzey Kıbrıs Turkcell’in online alışveriş mağazası. Tıkla, alışverişe başla.',visual_summary});
  const result=normalizeVision(model,{ad_text:'Eksiklerini Tam’la tamamla!',visual_summary:'Önceki kare yalnız logo içeriyor.',category_confidence:0.2});
  assert.equal(result.category,'auto-cihazlar');
  assert.equal(result.category_confidence,0.96);
  assert.equal(result.category_assignment.rule,'devices_visual_retail');
  assert.equal(result.category_assignment.evidence_source,'visual_summary');
  assert.ok(visual_summary.includes(result.category_evidence));
  assert.equal(result.visual_summary,visual_summary);
  assert.equal(result.offer.price_try,null);
  const unsupported=normalizeVision(reading({category:'new',category_label:'Yeni Hizmet',category_confidence:0.96,category_evidence:'Antivirüs hizmeti',visible_text:'Marka',visual_summary:'Antivirüs hizmeti tanıtımı olabilir.'}),{ad_text:''});
  assert.equal(unsupported.category,'review','general quote recovery must not accept arbitrary summary prose');
});

test('a fresh logo-only analysis cannot inherit previous device recognition or confidence',()=>{
  const old={visual_summary:'Online alışveriş mağazasının görselinde cep telefonu, dizüstü bilgisayar ve kulaklık ürünleri gösteriliyor.',category_confidence:0.99};
  const candidate={ad_text:'Online alışveriş mağazamız. Tıkla, alışverişe başla.',...old,previous_analysis:old};
  const result=normalizeVision(reading({visible_text:'TAM',visual_summary:'Sadece TAM logosu görünüyor.',category_confidence:0.96}),candidate);
  assert.equal(result.category,'review');assert.equal(result.category_assignment,undefined);
  assert.equal(result.visual_summary,'Sadece TAM logosu görünüyor.');
  const currentClear=normalizeVision(reading({visible_text:'TAM',visual_summary:old.visual_summary,category_confidence:0.96}),candidate);
  assert.equal(currentClear.category,'auto-cihazlar');
  const lowConfidence=normalizeVision(reading({visible_text:'TAM',visual_summary:old.visual_summary,category_confidence:0.4}),candidate);
  assert.equal(lowConfidence.category,'review','old confidence cannot elevate fresh uncertain image recognition');
});
