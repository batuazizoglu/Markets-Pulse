import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {parseAmount,normalizeOffer} from '../src/isp-economics.js';
import {parseISP,parseAlemPackages} from '../src/isp-parsers.js';
import {HOME_INTERNET_SOURCES,parserFor,scanHomeInternet,marketPayload} from '../src/home-internet.js';
import {ISP_COMPANIES,companyCoverage,socialDirectory} from '../src/isp-registry.js';
import {SCHEMA_SQL} from '../src/schema.js';

const source=slug=>HOME_INTERNET_SOURCES.find(x=>x.slug===slug);
test('all 29 BTHK legal companies remain visible including unverified websites',()=>{
  assert.equal(ISP_COMPANIES.length,29);assert.equal(new Set(ISP_COMPANIES.map(x=>x.id)).size,29);
  const companies=companyCoverage(HOME_INTERNET_SOURCES,[]);
  assert.equal(companies.filter(x=>x.website_status==='unverified').length,2);
  for(const company of companies.filter(x=>x.website))assert.ok(company.sources.length,company.id);
  assert.deepEqual(source('kibrisonline-home').company_ids,['netonline']);
  assert.deepEqual(source('extend-wdsl').company_ids,['arinet']);
});
test('Turkish and English thousands separators never become decimal prices',()=>{
  for(const [raw,want] of [['1,145',1145],['1.145',1145],['11,700',11700],['699,90',699.9],['1.199,90',1199.9],['1,199.90',1199.9],['',null],['Teklif al',null],[1.145,1.145]])assert.equal(parseAmount(raw),want,raw);
});
test('gift days, gift months and undisclosed terms have distinct economics',()=>{
  const a=normalizeOffer({total_price_try:1145,duration_days:30,bonus_days:7});
  assert.equal(a.duration_months,null);assert.equal(a.effective_monthly_try,928.38);
  const b=normalizeOffer({total_price_try:9995,duration_months:12,bonus_months:2});
  assert.equal(b.effective_monthly_try,713.93);assert.equal(b.service_months,14);
  const c=normalizeOffer({price_status:'quote'});assert.equal(c.effective_monthly_try,null);assert.equal(c.duration_months,null);
});
test('Kıbrıs Online public embedded JSON retains native service IDs and day units',()=>{
  const record={i_internet_service_id:7101,srvname:'Premium 10Mbit',s_type_service:'wdsl',i_speed:10,i_time_without_campaign:30,i_time_without_campaign_diff:7,i_rms_day_type:1,i_internet_service_price:1145};
  const html="<script>const o_services = JSON.parse('"+JSON.stringify({wdsl:[record]})+"');</script>";
  const [p]=parserFor(source('kibrisonline-home'),html).products;
  assert.equal(p.name,'Premium 10Mbit');assert.equal(p.total_price_try,1145);assert.equal(p.duration_days,30);
  assert.equal(p.bonus_days,7);assert.equal(p.product_key,'kibrisonline-home|7101');
  assert.throws(()=>parseISP("<script>const o_services = JSON.parse('{broken}');</script>",source('kibrisonline-home')));
});
test('Broadmax grouped packages and Nethouse direct JSON are decoded without evaluating code',()=>{
  const record={i_internet_service_id:11,s_internet_service_name:'Premium5',i_month_without_campaign:6,i_month_without_campaign_diff:1,i_internet_service_price:4200};
  const grouped={i_result:1,a_data:{a_services:[{i_speed:6,s_service_type_ask:['wdsl'],a_packages:[record]}]}};
  const [p]=parserFor(source('broadmax-wdsl'),'<script>const a_wdsl_hizmet = '+JSON.stringify(grouped)+'; throw "must not execute";</script>').products;
  assert.equal(p.speed_down_mbps,6);assert.equal(p.effective_monthly_try,600);
  const [q]=parserFor(source('nethouse-home'),'<script>const a_all_services = '+JSON.stringify({wdsl:[{...record,i_speed:6,srvname:'Premium'}]})+';</script>').products;
  assert.equal(q.total_price_try,4200);
});
test('ADSL blank columns never shift annual totals into three-month offers',()=>{
  const html='<table><tr><th>hız</th><th>1 ay</th><th>3 ay</th><th>6 ay</th><th>12 ay</th></tr><tr><td>10 Mbit</td><td>600 TL</td><td></td><td></td><td>6000 TL</td></tr></table>';
  const p=parserFor(source('enson-adsl'),html).products;
  assert.deepEqual(p.map(x=>x.duration_months),[1,12]);assert.equal(p[1].effective_monthly_try,500);
});
test('Haypem paid and quote-only plans do not invent a price',()=>{
  const html='<section><h2>WDSL Paketler</h2><div class="card"><h3>15 Mbps</h3><li>12+3 Ay – 11,700₺</li></div></section><section><h2>Fiber Paketler</h2><div class="card"><h3>Fiber 200</h3>Fiyat için iletişime geçin</div></section>';
  const [a,b]=parserFor(source('haypem-home'),html).products;
  assert.equal(a.effective_monthly_try,780);assert.equal(b.speed_down_mbps,200);assert.equal(b.price_status,'quote');assert.equal(b.market_score,undefined);
});
test('Surface reads actual speed from package choice, Primenet reads upfront price',()=>{
  const html='<table><tr onclick="showCustomConfirmation(\'5mbps\', \'6month\')"><td>6 months + 1</td><td>3700 TL</td></tr></table>';
  const [p]=parserFor(source('surface-home'),html).products;
  assert.equal(p.speed_down_mbps,5);assert.equal(p.bonus_months,1);
  const prime='<div class="w-pricing-item"><div class="w-pricing-item-title">PRIME 6 MBIT WDSL</div><div>6499₺/12 Aylık + 2 Ay Hediye</div><li>5 MBIT UPLOAD</li><li>Ücretsiz Kurulum</li></div>';
  const [q]=parserFor(source('primenet-home'),prime).products;
  assert.equal(q.total_price_try,6499);assert.equal(q.duration_months,12);assert.equal(q.bonus_months,2);assert.equal(q.speed_up_mbps,5);
});
test('scan failures retain last verified data, create no false removals, next price change is recorded',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const s=source('kibrisonline-home');
    const row=normalizeOffer({source_slug:s.slug,provider:s.provider,product_key:s.slug+'|1',name:'Premium',technology:'WDSL',duration_months:1,total_price_try:1000,speed_down_mbps:10});
    const ok=async()=>({ok:true,products:[row],meta:{},http_status:200,response_ms:1});
    await scanHomeInternet(db,{sources:[s],fetcher:ok});
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>({ok:true,products:[],meta:{},http_status:200,response_ms:1})});
    assert.equal((await db.query('SELECT * FROM home_internet_changes')).rows.length,0);
    const all=(await db.query('SELECT * FROM home_internet_scans ORDER BY id DESC')).rows;
    const market=marketPayload([all[0]],[],[all[1]]);
    assert.equal(market.products.length,1);assert.equal(market.products[0].stale,true);assert.equal(market.products[0].market_score,null);
    assert.equal(market.metrics.priced_products,0);
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>({...await ok(),products:[normalizeOffer({...row,total_price_try:1100,price_monthly_try:1100})]})});
    const changes=(await db.query('SELECT * FROM home_internet_changes')).rows;
    assert.ok(changes.some(x=>x.field_name==='Toplam Ücret'));assert.ok(changes.every(x=>x.change_type==='field_changed'));
  }finally{await db.close()}
});
test('Meta search shortcuts never imply connected automation or zero ads',()=>{
  const rows=socialDirectory(HOME_INTERNET_SOURCES);
  const telsim=rows.find(x=>x.brand==='Telsim');
  assert.match(telsim.ad_library_url,/164143610515/);assert.equal(telsim.automatic_status,'connection_required');
  assert.equal(rows.find(x=>x.brand==='Kıbrıs Online').ad_library_type,'brand_search');
  assert.ok(rows.every(x=>x.ad_count===undefined));
});

test('customer-visible speed overrides a different internal Netonline speed code',()=>{
  const d={a_data:{a_services:[{i_speed:6,s_service_type_ask:['wdsl'],a_packages:[{i_internet_service_id:1,s_internet_service_name:'Premium5',i_month_without_campaign:1,i_internet_service_price:900,i_speed:6,a_special_options:{s_speed_desc:'5 Mbps ye kadar hız'},a_service_options:['Sınırsız']}]}]}};
  const [p]=parserFor(source('broadmax-wdsl'),'<script>const a_wdsl_hizmet = '+JSON.stringify(d)+';</script>').products;
  assert.equal(p.speed_down_mbps,5);assert.equal(p.unlimited,true);
});

test('Cypking current prices retain gift periods and business off-peak conditions',()=>{
 const html='<p>APT 7 MB 7 MB D / 2 MB U 500 TL / 1 Month 2700 TL / 6+1 Months</p><p>CYP İŞ 12 MB 12 MB D / 6 MB Off-Peak / 10 MB U 3500 TL / 6 Months 6000 TL / 12 Months</p>';
 const rows=parserFor(source('cypking-home'),html).products;
 assert.equal(rows.length,4);assert.equal(rows[1].effective_monthly_try,385.71);assert.equal(rows[2].market_segment,'business');assert.match(rows[2].features[0],/6 Mbps/);
});
test('Alemnet uses public cached package data and displayed gift campaign',()=>{
 const rows=parseAlemPackages([{type:'eco',package_name:'10',price_one:900,price_three:2500,price_six:4800,price_twelve:9000}],source('alemnet-home'),'3 ay öde 1 ay bedava • 6 ay öde 2 ay bedava • 12 ay öde 3 ay bedava').map(normalizeOffer);
 assert.equal(rows.length,4);assert.equal(rows[1].bonus_months,1);assert.equal(rows[3].effective_monthly_try,600);
});
