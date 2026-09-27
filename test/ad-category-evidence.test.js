import test from 'node:test';
import assert from 'node:assert/strict';
import {AD_STORED_CLASSIFICATION_VERSION,recoverSourceQuote,proposeStoredCategory} from '../src/ad-category-evidence.js';

const row=(text,patch={})=>({category:'review',page_id:'123456789',visible_text:text,ad_text:'',...patch});
const fixed={verifiedFixedIspPageId:'123456789'};
test('quote recovery retains the original source span across Turkish case and whitespace changes',()=>{
  const ad={visible_text:'Başlık: YENİ TABLET\n  Modelleri! İŞLEMLER',ad_text:'Dijital Hizmetler'};
  assert.deepEqual(recoverSourceQuote('yeni tablet modelleri',ad),{source:'visible_text',quote:'YENİ TABLET\n  Modelleri'});
  assert.deepEqual(recoverSourceQuote('işlemler',ad),{source:'visible_text',quote:'İŞLEMLER'});
  assert.deepEqual(recoverSourceQuote('dijital hizmetler',ad),{source:'ad_text',quote:'Dijital Hizmetler'});
  for(const quote of ['Yeni telefon modelleri','Yeni tablet, modelleri','',null])assert.equal(recoverSourceQuote(quote,ad),null);
  assert.equal(recoverSourceQuote('799 TL',{visible_text:'899 TL'}),null);
  assert.equal(recoverSourceQuote('Tablet modelleri',{visible_text:'Tablet',ad_text:'modelleri'}),null);
  assert.equal(recoverSourceQuote('Antivirüs',{ad_text:'A'.repeat(8000)+'Antivirüs'}),null);
});
test('fixed ISP speed plans require matching verified source context and complete offer evidence',()=>{
  const ad=row('30 Mbps\nAylık 600 TL\n12+2 ay internet keyfi');
  const before=structuredClone(ad),result=proposeStoredCategory(ad,fixed);
  assert.equal(result.category,'home');assert.equal(result.classification_rule,'home_fixed_plan');
  assert.equal(result.category_evidence,ad.visible_text);assert.deepEqual(ad,before);
  assert.equal(proposeStoredCategory(ad),null);
  assert.equal(proposeStoredCategory(ad,{verifiedFixedIspPageId:'987654321'}),null);
  for(const text of ['30 Mbps hızlı internet','30 Mbps 600 TL','Aylık 600 TL internet','500 GB aylık 600 TL'])assert.equal(proposeStoredCategory(row(text),fixed),null);
  assert.equal(proposeStoredCategory(row('30 Mbps',{ad_text:'Aylık 600 TL'}),fixed),null);
  assert.equal(proposeStoredCategory(row('20Mbps799TL/AY9AY3TAKSİT'),fixed)?.category,'home');
  for(const text of ['BE FASTEST WITH THE POWER OF BROADMAX! 12+2 MONTHS 30Mbps 1196 TL/month','30 Mbps 1196 TL monthly','30 Mbps 1196 TL per month']){
    assert.equal(proposeStoredCategory(row(text),fixed)?.category,'home');
    assert.equal(proposeStoredCategory(row(text)),null,'English plans also need verified ISP page context');
  }
});
test('explicit fixed and mobile offers retain strict distinctions and MNP takes priority',()=>{
  assert.equal(proposeStoredCategory(row('Evde internet ile bağlantıda kalın')).category,'home');
  const result=proposeStoredCategory(row('40 GB 500 DK',{ad_text:'Numaranız değişmeden Turkcell kalitesiyle tanışın!'}));
  assert.equal(result.category,'mnp');assert.equal(result.evidence_source,'ad_text');
  assert.equal(proposeStoredCategory(row('Faturasız tarife 40 GB 500 DK 799 TL')).category,'gsm');
  for(const text of ['40 GB 500 DK','Numaranızı güncelleyin','My Vodafone ile GB kazanın']){
    const result=proposeStoredCategory(row(text));
    assert.notEqual(result?.category,'gsm');assert.notEqual(result?.category,'mnp');
  }
});
test('digital services classify explicit app, streaming and online payment actions',()=>{
  for(const text of ['My Vodafone uygulamasını indir, hediyeni kazan!','My Vodafone, size özel fırsatlarıyla 7/24 hizmetinizde :) · vfcyp.co','My Vodafone, faturasız hat işlemleriniz için 7/24 hizmetinizde :)','TV+ ile HBO Max dizilerini izleyin','Faturanızı online ödeme ile kolayca ödeyin','Online Öde. Keyfine Bak.']){
    const result=proposeStoredCategory(row(text));assert.equal(result.category,'auto-dijital-hizmetler');assert.equal(result.category_label,'Dijital Hizmetler');
  }
  assert.equal(proposeStoredCategory(row('My Vodafone')),null);
  assert.equal(proposeStoredCategory(row('Online fırsatlar sizi bekliyor')),null);
  for(const text of ['İnternet faturanız 600 TL','İnternet faturalarında %20 indirim'])assert.equal(proposeStoredCategory(row(text)),null);
  for(const text of ['Faturanızı internetten ödeyin','İnternet üzerinden fatura ödeme'])assert.equal(proposeStoredCategory(row(text)).category,'auto-dijital-hizmetler');
});
test('device retail and corporate notices require actual content, not branding or prior summaries',()=>{
  for(const text of ['Online mağaza: Cep Telefonu, TV & Ses Sistemleri, Bilgisayar','Elektronik ürünler için e-ticaret mağazamızı ziyaret edin'])assert.equal(proposeStoredCategory(row(text)).category,'auto-cihazlar');
  for(const text of ['Yeni ofis adresimize taşındık. Bizi ziyaret edin.','7/24 teknik destek ekibimize ulaşabilirsiniz.','Güvenli internet için şifrelerinizi kimseyle paylaşmayın.',"The internet is fun when it's safe 🥰 Call Now 👉 0548 888 66 29",'24/7 Support - Fast solutions! 🥰 Call Now 👉 0548 888 66 29'])assert.equal(proposeStoredCategory(row(text)).category,'auto-kurumsal-iletisim');
  for(const text of ['Kaliteli internetin adresi','Kesintisiz bağlantı, güçlü marka','Online mağazamıza hoş geldiniz','Tablet'])assert.equal(proposeStoredCategory(row(text)),null);
  assert.equal(proposeStoredCategory(row('TAM',{title:'Cep telefonu mağazası',visual_summary:'Telefon ve tablet görselleri',offer:{price_try:799}})),null);
});
test('stored corrections are auditable, reuse catalog labels and never create AI confidence or mutate offers',()=>{
  const ad=row('My Vodafone uygulamasını indir.',{offer:{price_try:null,data_gb:25},observed_at:'2026-09-27T10:00:00Z',images:[{sha256:'retained'}],ai_analysis:{pass:2}});
  const before=structuredClone(ad),result=proposeStoredCategory(ad,{categories:{'auto-dijital':'Dijital Hizmetler'}});
  assert.equal(result.category,'auto-dijital');assert.equal(result.classification_method,'stored_evidence');
  assert.equal(result.classification_version,AD_STORED_CLASSIFICATION_VERSION);assert.equal(AD_STORED_CLASSIFICATION_VERSION,1);
  for(const key of ['offer','observed_at','images','ai_analysis','category_confidence'])assert.equal(Object.hasOwn(result,key),false);
  assert.deepEqual(ad,before);assert.equal(proposeStoredCategory({...ad,...result}),null);
  assert.equal(proposeStoredCategory({...ad,category:'gsm'}),null);
});
test('long OCR uses a bounded genuine source span and ignores distant unrelated offer terms',()=>{
  const ad=row('Ön bilgi '.repeat(350)+' My Vodafone uygulamasını indir. '+'Devam '.repeat(350));
  const result=proposeStoredCategory(ad);assert.equal(result.category,'auto-dijital-hizmetler');
  assert.ok(result.category_evidence.length<=2000);assert.ok(ad.visible_text.includes(result.category_evidence));
  assert.equal(proposeStoredCategory(row('30 Mbps '+ 'Açıklama '.repeat(350)+' Aylık 600 TL'),fixed),null);
});
test('visual device retail requires explicit observed shop copy and distinct clearly described devices',()=>{
  const caption='Kuzey Kıbrıs Turkcell’in online alışveriş mağazası Tam – Turkcell Alışveriş Merkezi';
  const summary="Reklamda, Kuzey Kıbrıs Turkcell'in online alışveriş mağazası 'Tam' tanıtılmakta. Gözlük, akıllı saat, kulaklık, kamera, oyun kontrol cihazı, cep telefonu ve dizüstü bilgisayar gibi çeşitli teknoloji ve elektronik cihazlar laptop ekranından çıkan kadın ile birlikte sergileniyor. Alt kısımda alışverişe başlamak için web sitesi adresi ve ücretsiz hızlı kargo ibaresi bulunuyor. Kampanya, teknoloji ve elektronik cihazların online satışı amacı taşıyor.";
  const ad=row(caption,{visual_summary:summary,category_confidence:0.95,offer:{price_try:null,data_gb:null},images:[{sha256:'retained'}],observed_at:'2026-09-27T10:00:00Z'});
  const before=structuredClone(ad),result=proposeStoredCategory(ad);
  assert.equal(result.category,'auto-cihazlar');assert.equal(result.category_label,'Cihazlar');
  assert.equal(result.classification_rule,'devices_visual_retail');assert.equal(result.evidence_source,'visual_summary');
  assert.equal(result.category_evidence,summary);assert.equal(result.classification_method,'stored_evidence');
  assert.equal(result.classification_version,1);assert.deepEqual(ad,before);
  assert.equal(Object.hasOwn(result,'category_confidence'),false);assert.equal(Object.hasOwn(result,'offer'),false);
  assert.equal(recoverSourceQuote(summary,ad),null,'visual description must never masquerade as OCR or caption');
  assert.equal(proposeStoredCategory({...ad,visible_text:'',ad_text:caption}).category,'auto-cihazlar');
  assert.equal(proposeStoredCategory({...ad,category_confidence:null}).category,'auto-cihazlar');
  for(const category_confidence of [0.79,-1,1.5,NaN,'0.95'])assert.equal(proposeStoredCategory({...ad,category_confidence}),null);
  for(const visual_summary of [
    'Online alışveriş mağazası reklamında cep telefonu sergileniyor.',
    'Online alışveriş mağazası reklamında cep telefonu ve akıllı telefon sergileniyor.',
    'Online alışveriş mağazası reklamında cep telefonu ve laptop olabilir; cihazlar net değil.',
    'Online alışveriş mağazası reklamında cep telefonu ve laptop gösterilmiyor.',
    'Online alışveriş mağazası reklamında cep telefonu ve laptop bulunmuyor.',
    'Online alışveriş mağazası reklamında cep telefonu gösteriliyor ancak laptop yok.',
    'Online alışveriş mağazası için varsayımsal cep telefonu ve laptop sergileniyor.',
    'Aile evde cep telefonu ve laptop kullanıyor.',
    'Online alışveriş mağazasında cep telefonu ve laptop kategorilerinden bahsediliyor; yalnızca mağaza logosu gösteriliyor.',
    'Online alışveriş mağazasında cep telefonu ve laptop kategorilerinden bahsediliyor ve mağaza logosu gösteriliyor.',
    'Online alışveriş mağazası, cep telefonu ve laptop kategorilerinden bahsediyor.'
  ])assert.equal(proposeStoredCategory({...ad,visual_summary}),null,visual_summary);
  for(const visual_summary of [
    'Online alışveriş mağazası reklamında cep telefonu ve laptop açıkça gösteriliyor; ancak fiyat görünmüyor.',
    'Online alışveriş mağazası reklamında cep telefonu ve laptop gösterilmekte. Fiyat ve taksit koşulları belirsiz.'
  ])assert.equal(proposeStoredCategory({...ad,visual_summary}).category,'auto-cihazlar',visual_summary);
  for(const visible_text of ['Kaliteli bağlantı','Yeni kampanya 999 TL','Online mağazamıza hoş geldiniz'])assert.equal(proposeStoredCategory({...ad,visible_text}),null);
  assert.equal(proposeStoredCategory({...ad,visible_text:'Evde internet kampanyası'}).category,'home');
  assert.equal(proposeStoredCategory({...ad,category:'gsm'}),null);
});
