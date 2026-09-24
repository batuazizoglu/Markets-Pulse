import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reportChangeValue,reportChangeProduct} from '../src/report-change-value.js';
import {renderReportHtml} from '../src/report-render.js';
import {createReportLayoutFixtures} from './report-layout-fixture.js';

test('home snapshots retain commercial terms while omitting raw parser text and metadata',()=>{
  const snapshot={name:'Aile Fiber',technology:'Fiber',speed_down_mbps:100,speed_up_mbps:20,unlimited:true,
    duration_months:12,bonus_months:2,contract_months:12,price_monthly_try:1200,total_price_try:14400,effective_monthly_try:1028.57,install_fee_try:0,
    features:['Ücretsiz modem'],campaign_text:'Yalnızca yeni aboneler için geçerlidir.',
    raw_text:'DO_NOT_PRINT_RAW '.repeat(400),source_slug:'DO_NOT_PRINT_SOURCE',source_url:'https://example.com/internal',product_key:'DO_NOT_PRINT_KEY',source_meta_json:{parser:'DO_NOT_PRINT_META'}};
  const result=reportChangeValue(JSON.stringify(snapshot));
  for(const term of ['Aile Fiber','Fiber','100 Mbps / 20 Mbps yükleme','Sınırsız internet','12 ay','+2 ay hediye','12 ay taahhüt','1.200 TL / ay','Toplam: 14.400 TL','Efektif: 1.028,57 TL / ay','Kurulum: 0 TL','Ücretsiz modem','Yalnızca yeni aboneler'])assert.ok(result.includes(term),term);
  assert.doesNotMatch(result,/DO_NOT_PRINT|raw_text|source_slug|product_key|source_meta_json|https:\/\//);
  assert.ok(result.length<450,'a snapshot must fit a normal report row');
  assert.equal(reportChangeValue(snapshot),result);
});

test('FWA and prepaid snapshots keep quota, payment period and full-period price semantics',()=>{
  const fwa=reportChangeValue({name:'Superbox 5G Evinde',data_limit_gb:500,duration_months:12,price_monthly_try:1700});
  assert.match(fwa,/500 GB/);assert.match(fwa,/12 ay/);assert.match(fwa,/1\.700 TL \/ ay/);
  const prepaid=reportChangeValue({name:'Turist Paketi',data_gb:20,bonus_data_gb:5,validity_days:15,price_try:499,local_tr_minutes:100,sms:0});
  for(const term of ['20 GB','+5 GB hediye','15 gün','Paket fiyatı: 499 TL','100 dk ada içi / TR','0 SMS'])assert.ok(prepaid.includes(term),term);
  assert.doesNotMatch(prepaid,/499 TL \/ ay/);
  assert.match(reportChangeValue({name:'Ücretsiz deneme',effective_monthly_try:0,price_monthly_try:null}),/Efektif: 0 TL \/ ay/);
});

test('ordinary scalar field changes, zero, false and bracketed campaign text are preserved',()=>{
  for(const value of [0,'0',false,'false','999 TL / ay','[kampanya] Yeni abone koşulu','{uyarı: eksik kaynak}','Uzun koşul '.repeat(50)])assert.equal(reportChangeValue(value),String(value));
  for(const value of [null,undefined,''])assert.equal(reportChangeValue(value),'—');
  assert.equal(reportChangeValue('["Ücretsiz kurulum","12 ay taahhüt"]'),'Ücretsiz kurulum • 12 ay taahhüt');
  assert.equal(reportChangeValue({raw_text:'secret',source_slug:'secret'}),'Ürün ayrıntısı kaynak kaydında');
});

test('long campaign terms are explicitly summarized with salient conditions and retained expiry',()=>{
  const campaign='Yeni abonelere özel 12 ay taahhüt. '+('Paket kapsaması adres kontrolünden sonra doğrulanır. '.repeat(25))+'Kurulum ücretsizdir.';
  const value=reportChangeValue({name:'Fiber Fırsatı',contract_months:12,campaign_text:campaign,features:['Kurulum ücretsizdir.'],availability:'active',expires_at:'2026-10-31'});
  for(const term of ['12 ay taahhüt','Yeni abonelere özel','Kurulum ücretsizdir.','Kampanya aktif','Bitiş: 2026-10-31','koşul özeti; ayrıntılar kaynak kaydında'])assert.ok(value.includes(term),term);
  assert.ok(value.length<550);
});

test('snapshot product fallback uses the name rather than JSON or scalar field values',()=>{
  assert.equal(reportChangeProduct({change_type:'added',new_value:JSON.stringify({name:'Yeni Fiber',raw_text:'DO_NOT_PRINT'})}),'Yeni Fiber');
  assert.equal(reportChangeProduct({change_type:'removed',old_value:'Eski Paket'}),'Eski Paket');
  assert.equal(reportChangeProduct({change_type:'field_changed',old_value:0,new_value:100}),'Paket');
});

test('PDF change tables format realistic added/removed snapshots in four readable columns',async()=>{
  const fixtures=await createReportLayoutFixtures();
  for(const name of ['monthly','home','fwa']){
    const ctx=fixtures[name],dom=new JSDOM(renderReportHtml(ctx));
    try{
      const tables=[...dom.window.document.querySelectorAll('.change-table')];assert.ok(tables.length,name);
      for(const table of tables){
        assert.equal(table.querySelectorAll('thead th').length,4);
        assert.doesNotMatch(table.textContent,/raw_text|source_slug|product_key|source_meta_json|fixture-parser|Hakkımızda|\{"/);
        assert.ok(table.textContent.includes('Kurulum: 0 TL'));assert.ok(table.textContent.includes('12 ay taahhüt'));
        for(const td of table.querySelectorAll('td'))assert.ok(td.textContent.length<700,'snapshot values remain concise');
      }
    }finally{dom.window.close()}
  }
  const source={...fixtures.home.home,changes:[{detected_at:fixtures.home.generated_at,provider:'Örnek',change_type:'field_changed',field_name:'Kurulum',old_value:100,new_value:0,product_name:'<img src=x onerror=unsafe()>'}]};
  const dom=new JSDOM(renderReportHtml({...fixtures.home,home:source}));
  try{assert.equal(dom.window.document.querySelector('img[onerror]'),null);assert.equal(dom.window.document.querySelector('.change-table tbody tr td:last-child').textContent,'0')}finally{dom.window.close()}
});
