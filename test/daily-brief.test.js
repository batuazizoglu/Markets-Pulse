import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyBrief,dailyBriefSubject} from '../src/daily-brief.js';

const start='2026-10-05T06:00:00.000Z',end='2026-10-06T06:00:00.000Z',at='2026-10-06T05:00:00.000Z';
const source=()=>({status:'ok',last_status:'ok',captured_at:at,last_checked_at:at});
function context(){return {type:'daily',period_start:start,period_end:end,changes:[],sources:[source()],daily_home:{fixed:{products:[],campaigns:[],sources:[source()],changes:[]},fwa:{products:[],campaigns:[],sources:[source()],changes:[]}},ad_report_data:{status:'ok',checked_at:at,coverage:[{brand:'Telsim',status:'no_ads',checked_at:at}],rows:[]},benchmark:{generated_at:at,matches:[]}}}
const change=(extra={})=>({id:1,scan_id:20,product_id:7,product_name:'Süper 50',brand:'Telsim',detected_at:at,change_type:'field_changed',field_name:'Fiyat',old_value:'999',new_value:'899',severity:'high',source_url:'https://www.telsim.com.tr/paketler',...extra});
const ad=(extra={})=>({event_type:'first_seen',observed_at:at,report_image:{sha256:'a'.repeat(64),selection:'creative'},analysis_json:{ad_id:'100000',page_id:'200000',brand:'Telsim',title:'Süper 50',category:'gsm',source_url:'https://www.facebook.com/ads/library/?id=100000',offer:{price_try:899,billing_period:'monthly',data_gb:50,commitment_months:12},visual_summary:'50 GB internet, aylık 899 TL',conditions:['Yeni abonelere özel'],uncertainties:[],...extra}});

test('daily brief groups exact product + scan, filters the period, and counts fields without duplicate rows',()=>{
  const ctx=context();ctx.changes=[change(),change({id:2,field_name:'Data',old_value:'40',new_value:'50'}),change(),change({id:3,scan_id:21}),change({id:4,detected_at:end}),change({id:5,detected_at:'2026-10-05T05:59:59Z'})];
  const before=JSON.stringify(ctx),brief=buildDailyBrief(ctx);
  assert.equal(brief.counts.moves,2);assert.equal(brief.counts.fields,3);assert.ok(brief.highlights.some(x=>x.changes.length===2));assert.equal(brief.highlights[0].changes[0].before,'999 TL');assert.equal(JSON.stringify(ctx),before);
  assert.equal(brief.watchlist.length,0);assert.match(dailyBriefSubject(ctx,brief),/06[./]10.*Telsim: Fiyat/);
});

test('top three priorities are selected across GSM, MNP, fixed, FWA and ads, without making own offers rival threats',()=>{
  const ctx=context();ctx.changes=[change({severity:'low'}),change({id:2,product_id:8,product_name:'Numara taşı 80 GB',severity:'high'})];
  ctx.daily_home.fixed.changes=[change({id:3,product_id:undefined,product_key:'fiber|100',product_name:'Fiber 100',provider:'ISP',brand:'ISP',severity:'critical'})];
  ctx.daily_home.fwa.changes=[change({id:4,product_id:undefined,product_key:'superbox|100',brand:'Superbox',product_name:'Superbox 100',severity:'critical'})];
  ctx.ad_report_data.rows=[ad({ad_id:'100001',brand:'Nethouse',category:'home',title:'Nethouse Fiber'})];
  const brief=buildDailyBrief(ctx);
  assert.equal(brief.highlights.length,3);assert.deepEqual(brief.highlights.map(x=>x.domain),['fixed','mnp','fixed']);
  assert.ok(brief.highlights.every(x=>!x.owned));assert.equal(brief.counts.moves,4);assert.equal(brief.counts.ads,1);
});

test('same-price flags require two explicit snapshots, not a missing price field or null-coerced zero',()=>{
  const ctx=context();const base=change({field_name:'Data',old_value:'50',new_value:'40'});
  ctx.changes=[base];assert.equal(buildDailyBrief(ctx).highlights[0].flags.length,0);
  ctx.changes=[{...base,product_before:{price_try:null},product_after:{price_try:0}}];assert.equal(buildDailyBrief(ctx).highlights[0].flags.length,0);
  ctx.changes=[{...base,product_before:{price_try:'899'},product_after:{price_try:899}}];assert.ok(buildDailyBrief(ctx).highlights[0].flags.includes('Fiyat aynı, teklif değişti'));
  ctx.changes=[{...ctx.changes[0]},change({id:2,old_value:'899',new_value:'999'})];assert.ok(!buildDailyBrief(ctx).highlights[0].flags.includes('Fiyat aynı, teklif değişti'));
});

test('daily-only enriched rows provide snapshot signals without modifying canonical dashboard changes',()=>{
  const ctx=context();ctx.changes=[Object.freeze(change({field_name:'Data',old_value:'50',new_value:'40'}))];
  const canonical=JSON.stringify(ctx.changes);ctx.market={changes:ctx.changes};
  assert.ok(!buildDailyBrief(ctx).highlights[0].flags.includes('Fiyat aynı, teklif değişti'));
  ctx.daily_changes=[{...ctx.changes[0],product_before:{price_try:899,data_gb:50},product_after:{price_try:899,data_gb:40}}];
  const brief=buildDailyBrief(ctx);
  assert.ok(brief.highlights[0].flags.includes('Fiyat aynı, teklif değişti'));
  assert.equal(brief.counts.moves,1);assert.equal(brief.counts.fields,1);
  assert.equal(JSON.stringify(ctx.changes),canonical);assert.equal(JSON.stringify(ctx.market.changes),canonical);
  assert.equal(ctx.changes[0].product_after,undefined);
  ctx.daily_changes=[];assert.equal(buildDailyBrief(ctx).counts.moves,0,'an explicitly empty daily selection does not fall back to raw changes');
});

test('null, boolean and malformed numeric values never become numeric comparison or directional claims',()=>{
  const ctx=context();ctx.changes=[change({old_value:null,new_value:false})];
  ctx.benchmark.matches=[{match_status:'Primary',match_score:99,telsim:{id:7,name:'Süper 50',price_try:null,data_gb:50,validity_days:30},kktcell:{name:'GO 60',price_try:0,data_gb:60,validity_days:30}}];
  const brief=buildDailyBrief(ctx);assert.equal(brief.highlights[0].comparison,undefined);assert.equal(brief.highlights[0].changes[0].before,'—');assert.ok(!brief.highlights[0].changes[0].after.includes(' TL'));
});

test('Turkcell response uses only exact-id approved primary matches with equal validity and good catalogue health',()=>{
  const ctx=context();ctx.changes=[change()];
  ctx.benchmark.matches=[{match_status:'Primary',match_score:90,telsim:{id:7,name:'Süper 50',price_try:899,data_gb:50,validity_days:30},kktcell:{name:'GO 60',price_try:950,data_gb:60,validity_days:30,source_url:'https://www.kktcell.com/go'}}];
  let brief=buildDailyBrief(ctx);assert.equal(brief.highlights[0].comparison.difference,51);assert.match(brief.highlights[0].comparison.terms,/Turkcell 60 GB \/ rakip 50 GB/);
  ctx.benchmark.matches[0].kktcell.validity_days=28;assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);
  ctx.benchmark.matches[0].kktcell.validity_days=30;ctx.benchmark.matches[0].telsim.id=8;assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);
  ctx.benchmark.matches[0].telsim.id=7;ctx.benchmark.matches[0].match_status='Secondary';assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);
  ctx.benchmark.matches[0].match_status='Primary';ctx.benchmark.kktcell_error='failed';assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);
});

test('home comparisons require known equal technology, quota and period, fresh products and an unambiguous pair',()=>{
  const ctx=context();ctx.daily_home.fixed.changes=[change({product_id:undefined,product_key:'isp|100',brand:'ISP'})];
  const ours={product_key:'turkcell|100',name:'Turkcell 100',provider:'Turkcell Ev İnterneti',technology:'Fiber',unlimited:true,duration_months:12,effective_monthly_try:999,speed_down_mbps:100,verified_at:at};
  const theirs={...ours,product_key:'isp|100',name:'Fiber 100',provider:'ISP',effective_monthly_try:899};
  ctx.daily_home.fixed.opportunities=[{kktcell:ours,competitor:theirs}];assert.equal(buildDailyBrief(ctx).highlights[0].comparison.difference,100);
  theirs.stale=true;assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);theirs.stale=false;
  delete ours.duration_months;delete theirs.duration_months;assert.equal(buildDailyBrief(ctx).highlights[0].comparison,undefined);
});

test('quiet days require fresh successful checks in every domain; stale, partial and failed scopes remain explicit',()=>{
  const ctx=context();let brief=buildDailyBrief(ctx);assert.equal(brief.quiet,true);assert.equal(brief.coverage.state,'complete');assert.match(dailyBriefSubject(ctx,brief),/Yeni değişiklik yok/);
  ctx.sources.push({enabled:false,last_status:'error'});assert.equal(buildDailyBrief(ctx).quiet,true);
  ctx.daily_home.fixed.sources[0].status='blocked';brief=buildDailyBrief(ctx);assert.equal(brief.quiet,false);assert.equal(brief.coverage.state,'partial');assert.match(brief.summary,/sonucuna varılamaz/);assert.match(brief.coverage.domains.find(x=>x.domain==='fixed').message,/tamamlanamadı/);
  ctx.daily_home.fixed.sources[0].status='ok';ctx.sources[0].last_checked_at='2026-10-04T05:00:00Z';assert.equal(buildDailyBrief(ctx).quiet,false);
  ctx.sources[0].last_checked_at=at;ctx.ad_report_data.status='partial';assert.equal(buildDailyBrief(ctx).quiet,false);
  ctx.ad_report_data.status='ok';ctx.ad_report_data.last_error='latest attempt failed';assert.equal(buildDailyBrief(ctx).quiet,false);
});

test('ad radar omits analysis-only updates, deduplicates equal campaigns and uses only prepared creative images',()=>{
  const ctx=context();ctx.ad_report_data.rows=[ad(),ad({ad_id:'100002',variant_id:'2'}),{...ad({ad_id:'100003'}),event_type:'analysis_updated'},{...ad({ad_id:'100004'}),observed_at:end},ad({ad_id:'100005',category:'review'})];
  let brief=buildDailyBrief(ctx);assert.equal(brief.counts.ads,1);assert.equal(brief.ads[0].variant_count,2);assert.match(brief.ads[0].image_url,/report-media\/[a-f0-9]{64}\.jpg$/);assert.match(brief.ads[0].offer,/899 TL \/ ay/);assert.deepEqual(brief.ads[0].conditions,['Yeni abonelere özel']);
  ctx.ad_report_data.rows=[{...ad(),report_image:{sha256:'a'.repeat(64),selection:'full_page'}}];assert.equal(buildDailyBrief(ctx).ads[0].image_url,null);
  ctx.ad_report_data.rows=[ad({source_url:'javascript:alert(1)'})];assert.equal(buildDailyBrief(ctx).ads[0].source_url,null);
});

test('ad radar excludes review-required and inactive records, retains full conditions and does not mutate the source',()=>{
  const ctx=context(),longCondition='Koşullar. '.repeat(100)+'Kurulum bedeli ayrıca alınır.';
  ctx.ad_report_data.rows=[{...ad({ad_id:'100001',conditions:[longCondition],uncertainties:['Küçük yazı teyit bekliyor']}),event_type:'changed'},ad({ad_id:'100002',review_required:true}),ad({ad_id:'100003',ad_status:'inactive'})];
  const before=JSON.stringify(ctx),brief=buildDailyBrief(ctx);
  assert.equal(brief.counts.ads,1);assert.equal(brief.ads[0].conditions[0],longCondition);assert.match(brief.ads[0].why,/veya yayın durumu/);assert.ok(brief.ads[0].flags.includes('Bazı koşullar teyit bekliyor'));assert.equal(JSON.stringify(ctx),before);
});

test('unverified or ended ad observations never imply no change, and older published versions cannot resurface',()=>{
  const ctx=context();ctx.ad_report_data.rows=[ad({category:'review',review_required:true})];
  let brief=buildDailyBrief(ctx);assert.equal(brief.quiet,false);assert.equal(brief.ads.length,0);assert.equal(brief.counts.unverified_ads,1);assert.match(brief.headline,/henüz doğrulanamadı/);assert.match(dailyBriefSubject(ctx),/teyit bekliyor/);
  ctx.ad_report_data.rows.push({...ad(),observed_at:'2026-10-06T04:00:00Z'});brief=buildDailyBrief(ctx);assert.equal(brief.counts.observed_ads,1);assert.equal(brief.ads.length,0);
  ctx.ad_report_data.rows[0]=ad({ad_status:'inactive'});brief=buildDailyBrief(ctx);assert.equal(brief.quiet,false);assert.equal(brief.counts.status_updates,1);assert.equal(brief.ads.length,0);assert.match(brief.summary,/aktif görünmüyor/);assert.match(dailyBriefSubject(ctx),/yayın durumu/);
});

test('campaign deduplication compares complete terms and titles, including material suffixes beyond display limits',()=>{
  const ctx=context(),prefix='Ortak ticari koşul. '.repeat(40),titlePrefix='Uzun kampanya adı '.repeat(12);
  ctx.ad_report_data.rows=[ad({ad_id:'100001',conditions:[prefix+'Kurulum ücretsizdir.']}),ad({ad_id:'100002',conditions:[prefix+'Kurulum 500 TL.']})];
  assert.equal(buildDailyBrief(ctx).counts.ads,2);
  ctx.ad_report_data.rows=[ad({ad_id:'100001',title:titlePrefix+'A seçeneği'}),ad({ad_id:'100002',title:titlePrefix+'B seçeneği'})];
  assert.equal(buildDailyBrief(ctx).counts.ads,2);
});

test('owned Turkcell home brands remain owned with Turkish dotted uppercase characters',()=>{
  const ctx=context();ctx.daily_home.fixed.changes=[change({product_id:undefined,product_key:'ours',brand:'Turkcell Ev İnterneti'})];
  const item=buildDailyBrief(ctx).highlights[0];assert.equal(item.owned,true);assert.ok(item.flags.includes('Kendi markamız'));assert.equal(item.comparison_note,undefined);
});

test('ad/catalog differences need exact brand, title, billing, known matching commitment and contemporaneous evidence',()=>{
  const ctx=context();ctx.ad_report_data.rows=[ad({category:'home',title:'Fiber 100',brand:'ISP',offer:{price_try:899,billing_period:'monthly',speed_mbps:100,commitment_months:12}})];
  const product={product_key:'isp|100',name:'Fiber 100',brand:'ISP',price_monthly_try:999,speed_down_mbps:100,contract_months:12,verified_at:at,source_url:'https://isp.example/fiber'};
  ctx.daily_home.fixed.products=[product];let mismatch=buildDailyBrief(ctx).ads[0].mismatch;assert.equal(mismatch.fields[0].ad_value,'899 TL / ay');assert.equal(mismatch.fields[0].catalog_value,'999 TL / ay');assert.equal(mismatch.ad_at,at);assert.ok(mismatch.catalog_url);
  product.name='Fiber 100 Plus';assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);product.name='Fiber 100';
  product.brand='Different ISP';assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);product.brand='ISP';
  product.contract_months=null;assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);product.contract_months=12;
  product.verified_at='2026-10-04T06:00:00Z';assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);product.verified_at=at;
  ctx.ad_report_data.rows[0].analysis_json.uncertainties=['Taahhüt doğrulanamadı'];assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);
});

test('ad/catalog commitment may come only from unambiguous explicit commercial terms, never payment duration or page prose',()=>{
  const ctx=context();ctx.ad_report_data.rows=[ad()];
  const product={id:7,name:'Süper 50',brand:'Telsim',price_try:999,data_gb:50,validity_days:30,verified_at:at,source_url:'https://www.telsim.com.tr/paketler'};
  ctx.catalog_products=[product];product.duration_months=12;assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);
  product.raw_text='12 ay taahhüt';assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);
  product.extras_json=['12 ay taahhüt gereklidir'];assert.ok(buildDailyBrief(ctx).ads[0].mismatch);
  product.extras_json=['12 ay taahhüt gerekmiyor'];assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);
  product.extras_json=['12 ay taahhüt veya 24 ay taahhüt'];assert.equal(buildDailyBrief(ctx).ads[0].mismatch,null);
  product.extras_json=['Taahhütsüz'];ctx.ad_report_data.rows[0].analysis_json.offer.commitment_months=0;assert.ok(buildDailyBrief(ctx).ads[0].mismatch);
  ctx.changes=[change({product_after:{...product,price_try:999}})];assert.ok(buildDailyBrief(ctx).ads[0].mismatch,'fresh catalog wins over same-id event snapshot without creating ambiguous duplicates');
});

test('72-hour reminders require fresh sourced expiry dates and interpret date-only values at KKTC end of day',()=>{
  const ctx=context();const campaign={name:'Son gün fırsatı',brand:'ISP',product_key:'isp|campaign',availability:'active',expires_at:'2026-10-08',verified_at:at,source_url:'https://isp.example/campaign'};
  ctx.daily_home.fixed.campaigns=[campaign];let brief=buildDailyBrief(ctx);assert.equal(brief.expiring.length,1);assert.equal(brief.expiring[0].expires_at,'2026-10-08T20:59:59.999Z');assert.equal(brief.expiring[0].date_only,true);
  campaign.expires_at='2026-10-09';assert.equal(buildDailyBrief(ctx).expiring.length,0);campaign.expires_at='2026-10-08';campaign.stale=true;assert.equal(buildDailyBrief(ctx).expiring.length,0);campaign.stale=false;
  campaign.expires_at='2026-02-30';assert.equal(buildDailyBrief(ctx).expiring.length,0);campaign.expires_at='2026-10-08';campaign.source_url='data:text/html,test';assert.equal(buildDailyBrief(ctx).expiring.length,0);
});

test('ongoing matters require a fresh material update and score deltas omit unchanged segments',()=>{
  const ctx=context();ctx.changes=[change({first_seen_at:'2026-09-20T00:00:00Z'})];ctx.score_deltas=[{segment:'Genel',current:64,baseline:60,delta:4},{segment:'Genç',current:50,baseline:50,delta:0},{segment:'Premium',current:null,baseline:null,delta:null}];
  const brief=buildDailyBrief(ctx);assert.equal(brief.watchlist.length,0,'featured moves are not duplicated in the watchlist');assert.ok(brief.highlights[0].flags.includes('Devam eden konuda yeni gelişme'));assert.deepEqual(brief.position_changes,[{segment:'Genel',current:64,baseline:60,delta:4}]);
  ctx.changes.push(...[8,9,10].map(product_id=>change({id:product_id,product_id,severity:'critical'})));assert.equal(buildDailyBrief(ctx).watchlist.length,1);
  ctx.changes[0].detected_at='2026-10-04T00:00:00Z';assert.equal(buildDailyBrief(ctx).watchlist.length,0);
  ctx.changes=[change({product_before:{verified_at:'2026-10-04T00:00:00Z'}})];assert.ok(buildDailyBrief(ctx).highlights[0].flags.includes('Devam eden konuda yeni gelişme'));
});

test('invalid report periods are rejected and subject cannot contain mail header control characters',()=>{
  assert.throws(()=>buildDailyBrief({}),/valid report period/);const ctx=context();ctx.changes=[change({product_name:'Test\r\nBcc: attacker@example.com'})];assert.ok(!/[\r\n]/.test(dailyBriefSubject(ctx)));
});
