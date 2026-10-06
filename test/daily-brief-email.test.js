import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {dailyBriefEmailHtml,dailyBriefPlainText} from '../src/daily-brief-email.js';

const start='2026-10-05T05:00:00.000Z',end='2026-10-06T05:00:00.000Z',at='2026-10-06T03:00:00.000Z';
const media=hash=>`https://www.marketspulse.cloud/report-media/${hash}.jpg`;
function context(){
  return {period_start:start,period_end:end,sources:[{last_status:'ok',last_checked_at:at}],changes:[],
    daily_home:{fixed:{sources:[{status:'ok',captured_at:at}],changes:[],products:[],campaigns:[]},fwa:{sources:[{status:'ok',captured_at:at}],changes:[],products:[],campaigns:[]}},
    ad_report_data:{status:'ok',checked_at:at,rows:[]}};
}
function change(overrides={}){
  return {id:1,scan_id:10,product_id:20,source_slug:'faturali',source_url:'https://www.telsim.com.tr/paket',product_name:'Numaranı Taşı 50 GB',brand:'Telsim',detected_at:at,change_type:'field_changed',field_name:'Fiyat',field_key:'price_try',old_value:'999',new_value:'899',severity:'high',...overrides};
}
function ad(index=1,overrides={}){
  return {event_type:'first_seen',observed_at:at,report_image:{selection:'creative',sha256:String(index).repeat(64)},analysis_json:{ad_id:String(1000+index),brand:'Telsim',category:'gsm',title:`Reklam ${index}`,source_url:`https://www.facebook.com/ads/library/?id=${1000+index}`,offer:{price_try:899+index,billing_period:'monthly',data_gb:50,commitment_months:12},conditions:['12 ay taahhüt. Yeni aboneler için geçerlidir.'],visual_summary:'İnternet kotası ve fiyat vaadi.'},...overrides};
}

test('daily email distinguishes verified quiet day from incomplete checks, with the same meaning in plain text',()=>{
  const quiet=context(),html=dailyBriefEmailHtml(quiet),$=load(html),text=dailyBriefPlainText(quiet);
  assert.equal($('.brief-quiet').length,1);
  assert.equal($('.brief-highlight,.brief-ad,.brief-expiry').length,0);
  assert.equal($('.brief-coverage').length,1);
  assert.match($('.brief-coverage').text(),/güncel kontrolleri tamamlandı/);
  assert.doesNotMatch($('body').text(),/Reklam radarı|Bugünün önemli gelişmeleri|72 saatte/);
  assert.match(text,/yeni paket değişikliği veya reklam teklifi kaydedilmedi/);
  assert.match(text,/Raporlar: https:\/\/www.marketspulse.cloud\/#reports/);
  assert.equal($('.brief-preheader').attr('style').includes('display:none'),true);
  const limited=context();limited.sources[0].last_status='blocked';
  const limitedHtml=dailyBriefEmailHtml(limited),limitedDom=load(limitedHtml),limitedText=dailyBriefPlainText(limited);
  assert.equal(limitedDom('.brief-quiet').length,0);
  assert.match(limitedDom('.brief-coverage').text(),/kontrol eksik/);
  assert.match(limitedText,/piyasanın değişmediği sonucuna varılamaz/);
  assert.doesNotMatch(limitedText,/güncel kontrolleri tamamlandı/);
  assert.ok(limitedHtml.indexOf('class="brief-coverage"')<limitedHtml.indexOf('<h1'));
});

test('daily decision cards group package changes and preserve comparable billing periods, sources and suggested actions',()=>{
  const ctx=context();ctx.changes=[change(),change({id:2,field_name:'İnternet',field_key:'data_gb',old_value:'50',new_value:'60'})];
  ctx.benchmark={generated_at:at,kktcell_error:null,matches:[{match_status:'Primary',match_score:95,telsim:{id:20,name:'Numaranı Taşı 50 GB',price_try:899,data_gb:60,validity_days:28},kktcell:{name:'Turkcell 60 GB',price_try:949,data_gb:60,validity_days:28,source_url:'https://www.kktcell.com/paketler/60gb'}}]};
  ctx.market={executive_summary:'DO_NOT_RENDER legacy summary'};ctx.ad_analysis_html='<script>legacyUnsafe()</script>';ctx.score_deltas=[{segment:'Legacy segment table',current:75,baseline:75,delta:0}];
  const html=dailyBriefEmailHtml(ctx,[{filename:'Gunluk-Rapor.pdf'}]),$=load(html),text=dailyBriefPlainText(ctx);
  assert.equal($('.brief-highlight').length,1);
  assert.equal($('.brief-change-table tbody tr').length,2);
  assert.match($('.brief-change-table').text(),/999 TL/);assert.match($('.brief-change-table').text(),/899 TL/);
  assert.match($('.brief-comparison').text(),/28 günlük paket bedeli/);
  assert.match($('.brief-comparison').text(),/Turkcell paket bedeli 50 TL daha yüksek/);
  assert.doesNotMatch($('.brief-comparison').text(),/aylık|Aylık/);
  assert.match(text,/28 günlük paket bedeli/);assert.match(text,/Fiyat: 999 TL → 899 TL/);
  assert.match(text,/Önerilen aksiyon:/);assert.equal($('.brief-action').length,1);
  assert.equal($('a[href="https://www.telsim.com.tr/paket"]').length,1);
  assert.ok($('a[href="https://www.marketspulse.cloud/#competitor"]').length>0);
  assert.match($('body').text(),/Gunluk-Rapor.pdf/);
  assert.doesNotMatch(html,/DO_NOT_RENDER|legacyUnsafe|Legacy segment table|SKU|Apify|PostgreSQL|Bulut taraması|AI sonucu beklenen/);
});

test('daily email escapes content and attachment names and refuses executable links or arbitrary images',()=>{
  const ctx=context(),unsafe='<img src=x onerror="alert(1)"><script>alert(2)</script>';
  ctx.changes=[change({product_name:unsafe,source_url:'javascript:alert(3)',old_value:'<b>899</b>',new_value:'" onclick="alert(4)'})];
  const row=ad();row.analysis_json.title=unsafe;row.analysis_json.conditions=[unsafe];row.analysis_json.source_url='data:text/html,<script>alert(5)</script>';row.report_image={selection:'creative',sha256:'x',url:'https://evil.example/tracker.jpg'};ctx.ad_report_data.rows=[row];
  const html=dailyBriefEmailHtml(ctx,[{filename:unsafe}]),$=load(html);
  assert.equal($('script,svg,iframe').length,0);
  assert.equal($('[onerror],[onclick]').length,0);
  assert.equal($('img').length,0);
  assert.equal($('a[href^="javascript:"],a[href^="data:"]').length,0);
  assert.match($('body').text(),/<img src=x onerror="alert\(1\)">/);
  assert.ok($('a').toArray().every(a=>/^https?:\/\//.test($(a).attr('href'))));
  assert.doesNotMatch(html,/src="https:\/\/evil.example/);
});

test('ad radar has at most three campaign creatives, retains full conditions and uncertainty, and groups variants',()=>{
  const ctx=context(),longCondition='Geçerli müşteri koşulu. '.repeat(45)+' SON KOŞUL: aktivasyon ücreti ayrıca alınır.';
  const first=ad(1);first.event_type='changed';first.analysis_json.category='mnp';first.analysis_json.conditions=[longCondition];first.analysis_json.uncertainties=['Kurulum bedeli görselde doğrulanamadı.'];
  const variant=structuredClone(first);variant.analysis_json.ad_id='variant-1001';variant.analysis_json.variant_id='2';
  ctx.ad_report_data.rows=[first,variant,...[2,3,4,5,6].map(i=>ad(i))];
  const html=dailyBriefEmailHtml(ctx),$=load(html),text=dailyBriefPlainText(ctx);
  assert.equal($('.brief-ad').length,3);assert.equal($('.brief-ad-image').length,3);
  assert.ok($('.brief-ad-image').toArray().every(image=>/^https:\/\/www\.marketspulse\.cloud\/report-media\/[a-f0-9]{64}\.jpg$/.test($(image).attr('src'))));
  const firstCard=$('.brief-ad').filter((i,node)=>$(node).find('.brief-ad-title').text()==='Reklam 1');
  // Campaign order is deterministic; variants do not consume a second radar slot.
  assert.equal(firstCard.length,1);
  assert.match(firstCard.text(),/2 görsel varyantı tek kampanyada toplandı/);
  assert.match(firstCard.find('.brief-conditions').text(),/SON KOŞUL: aktivasyon ücreti ayrıca alınır/);
  assert.match(firstCard.text(),/Kurulum bedeli görselde doğrulanamadı/);
  assert.match(text,/SON KOŞUL: aktivasyon ücreti ayrıca alınır/);
  assert.match(text,/Doğrulanması gerekenler: Kurulum bedeli görselde doğrulanamadı/);
  assert.ok($('a[href="https://www.marketspulse.cloud/#ads"]').length>=3);
  assert.equal($('a[href="https://www.marketspulse.cloud/#ad-analysis"]').length,0);
});

test('date-only campaign expiry stays date-only in HTML and plain text',()=>{
  const ctx=context();ctx.daily_home.fixed.campaigns=[{product_key:'sample|campaign|oct',name:'Ekim Kampanyası',provider:'Örnek Fiber',verified_at:at,expires_at:'2026-10-07',source_url:'https://example.com/kampanya'}];
  const html=dailyBriefEmailHtml(ctx),$=load(html),text=dailyBriefPlainText(ctx);
  assert.equal($('.brief-expiry').length,1);
  assert.match($('.brief-expiry').text(),/07 Ekim \(gün sonu\)/);
  assert.doesNotMatch($('.brief-expiry').text(),/23:59/);
  assert.match(text,/07 Ekim \(gün sonu\)/);
  assert.equal($('.brief-quiet').length,0);
});

test('confirmed ad and catalogue differences retain both evidence links and the condition caveat',()=>{
  const ctx=context();ctx.ad_report_data.rows=[ad(1)];
  ctx.catalog_products=[{name:'Reklam 1',brand:'Telsim',verified_at:at,active:true,validity_days:30,commitment_months:12,price_try:950,data_gb:50,source_url:'https://www.telsim.com.tr/reklam-1'}];
  const html=dailyBriefEmailHtml(ctx),$=load(html),text=dailyBriefPlainText(ctx);
  assert.equal($('.brief-mismatch').length,1);
  assert.match($('.brief-mismatch').text(),/reklamda 900 TL \/ ay; paket sayfasında 950 TL \/ ay/);
  assert.match($('.brief-mismatch').text(),/Diğer müşteri koşullarını kaynaklardan teyit edin/);
  assert.equal($('.brief-mismatch a[href="https://www.telsim.com.tr/reklam-1"]').length,1);
  assert.equal($('.brief-mismatch a[href="https://www.facebook.com/ads/library/?id=1001"]').length,1);
  assert.match(text,/Paket kaynağı: https:\/\/www.telsim.com.tr\/reklam-1/);
  assert.match(text,/Reklam kaynağı: https:\/\/www.facebook.com\/ads\/library\/\?id=1001/);
});

test('large valid campaign conditions and multibyte change text use explicit detail references under the email byte budget',()=>{
  const ctx=context();
  ctx.ad_report_data.rows=[1,2,3].map(index=>{
    const row=ad(index);row.analysis_json.conditions=Array.from({length:20},(_,i)=>`${i+1}. koşul: `+'ç'.repeat(2000));
    row.analysis_json.uncertainties=Array.from({length:5},(_,i)=>`${i+1}. doğrulama: `+'ö'.repeat(2000));return row;
  });
  ctx.changes=[1,2,3].flatMap(product=>Array.from({length:6},(_,field)=>change({id:product*10+field,product_id:product,product_name:`Koşulları Güncellenen Paket ${product}`,field_key:`condition_${field}`,field_name:`Koşul ${field+1}`,old_value:'&'.repeat(600),new_value:'ğ'.repeat(600),severity:'critical'})));
  const html=dailyBriefEmailHtml(ctx,[{filename:'Gunluk-Rapor.pdf'}]),$=load(html),text=dailyBriefPlainText(ctx);
  assert.ok(Buffer.byteLength(html,'utf8')<90*1024,`HTML too large: ${Buffer.byteLength(html,'utf8')} bytes`);
  assert.equal($('.brief-ad').length,3);assert.equal($('.brief-conditions-compact').length,3);
  assert.equal($('.brief-long-changes').length,3);
  assert.match($('.brief-conditions-compact').first().text(),/20 kampanya koşulu ve 5 doğrulama notu/);
  assert.match($('.brief-conditions-compact').first().text(),/tam metin burada gösterilmedi/);
  assert.equal($('.brief-conditions-compact a').length,3);
  assert.match(text,/Uzun kampanya koşulları/);assert.match(text,/20 kampanya koşulu ve 5 doğrulama notu/);
  assert.match(text,/Önceki ve yeni koşulların tamamını değişiklik ayrıntılarında inceleyin/);
  assert.match(text,/Tüm koşulları ve belirsizlikleri inceleyin: https:\/\/www.facebook.com\/ads\/library\//);
  assert.doesNotMatch(html,/ç{100}/);assert.doesNotMatch(text,/ç{100}/);
});
