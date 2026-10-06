// Synthetic, offline reports. No production data, scans, API calls or email delivery.
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {REPORT_NAMES} from '../src/report-data.js';
import {adVisualReportHtml} from '../src/ad-visual-report.js';

const at='2026-09-21T06:00:00.000Z';
const stamp=(day=20)=>`2026-09-${String(day).padStart(2,'0')}T09:30:00.000Z`;
const changes=(count,provider='Turkcell Ev İnterneti')=>Array.from({length:count},(_,i)=>{
  const name=`${i+1}. Aile ve Öğrenciye Özel Sınırsız İnternet Paketi`,fwa=provider==='Superbox / Red Box';
  // Real added/removed events store full product snapshots, not a price string.
  // Raw parser text and metadata previously made a single row span entire pages.
  const snapshot=JSON.stringify({name,provider,brand:fwa?'Superbox':provider,source_slug:'fixture-source',
    source_url:'https://example.com/paketler',product_url:'https://example.com/paketler/aile',product_key:'fixture-source|aile|12',
    technology:fwa?'5G FWA':'Fiber',speed_down_mbps:fwa?null:100,speed_up_mbps:fwa?null:20,data_limit_gb:fwa?500:null,unlimited:!fwa,
    duration_months:12,bonus_months:2,contract_months:12,price_monthly_try:1199,total_price_try:14388,effective_monthly_try:1027.71,install_fee_try:0,
    features:['Yeni abonelere özel','Ücretsiz kurulum'],campaign_text:'12 ay taahhüt ve yeni abonelik koşulu geçerlidir. Kapsama kontrolü gereklidir.',
    raw_text:'Paketler ve kampanyalar: Hakkımızda Hizmetler İletişim Kullanım Koşulları Aile interneti paket ayrıntıları ve altyapı seçenekleri. '.repeat(12),
    source_meta_json:{parser_version:'fixture-parser',source_revision:2},ownership_group:'Fixture Ltd',product_hash:'a'.repeat(64),market_score:78,mbps_per_100tl:9.73});
  const type=i%4===0?'added':i%4===1?'removed':'field_changed';
  return {detected_at:stamp(20-i%8),provider,brand:provider,product_name:name,change_type:type,field_name:'Aylık fiyat',
    old_value:type==='added'?null:type==='removed'?snapshot:'999 TL / ay',new_value:type==='removed'?null:type==='added'?snapshot:'1.199 TL / ay • 12 aylık taahhüt',severity:i%3===0?'high':'medium'};
});
const sources=count=>Array.from({length:count},(_,i)=>({
  name:`${i+1}. Kuzey Kıbrıs Uzun İsimli İnternet Sağlayıcısı Paketler ve Kampanyalar`,provider:i%2?'Örnek Rakip':'Turkcell Ev İnterneti',status:i===2?'blocked':'ok',last_status:i===2?'blocked':'ok',http_status:i===2?403:200,parsed_count:12,active_products:12,response_ms:1420
}));
const products=(count,fwa=false)=>Array.from({length:count},(_,i)=>({
  provider:i%2?'Kuzey Kıbrıs Örnek İnternet Sağlayıcısı':'Turkcell Ev İnterneti',brand:fwa?(i%2?'Red Box':'Superbox'):i%2?'Örnek Rakip':'Lifecell Digital',
  name:`${i+1}. Ailelere, Öğrencilere ve Yeni Abonelere Özel ${fwa?'500 GB':'100 Mbps'} İnternet Kampanyası`,
  technology:fwa?'4.5G / 5G FWA':'Fiber / VDSL',speed_down_mbps:fwa?null:100,data_limit_gb:fwa?500:null,
  duration_months:12,bonus_months:i%3===0?2:0,effective_monthly_try:999+i*20,first_year_equiv_try:11988+i*240,mbps_per_100tl:fwa?null:10.01,market_score:78
}));
const stats=count=>({total:count,added:3,removed:1,critical:1,high:4,medium:7,top_fields:[{name:'Aylık fiyat ve taahhüt süresi',count:7},{name:'Hediye internet ve yeni abone koşulları',count:3}]});
const family=(count,fwa=false)=>({products:products(count,fwa),sources:sources(5),changes:changes(7,fwa?'Superbox / Red Box':'Turkcell Ev İnterneti'),stats:stats(7),opportunities:[{kktcell:{name:'Lifecell Ev İnterneti 100 Mbps'},competitor:{provider:'Örnek Rakip',name:'Aileye Özel Fiber 100 Mbps'},score_gap:8}]});

async function creative(width,height,color,label){
  const size=Math.round(Math.min(width/12,height/12));
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><rect x="20" y="20" width="${width-40}" height="${height-40}" rx="24" fill="none" stroke="#ffffff" stroke-width="5"/><text x="50%" y="32%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" font-weight="bold" fill="#ffffff">${label}</text><text x="50%" y="54%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size*1.7}" font-weight="bold" fill="#ffdc42">999 TL</text><text x="50%" y="76%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size*.6}" fill="#ffffff">ÖRNEK REKLAM - TEST VERİSİ</text><text x="50%" y="90%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size*.45}" fill="#ffffff">Koşullar ve ücret bilgisi bu alandadır.</text></svg>`)).jpeg({quality:88}).toBuffer();
}

export async function createReportLayoutFixtures(){
  const assets=await Promise.all([
    creative(960,960,'#001484','EV İNTERNETİ'),
    creative(1200,628,'#9244b6','GSM PAKETLERİ'),
    creative(720,1280,'#a92f30','NUMARA TAŞIMA'),
    creative(960,960,'#145e49','CİHAZ FIRSATI')
  ]);
  const hashes=assets.map(bytes=>createHash('sha256').update(bytes).digest('hex'));
  const categories={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma','auto-cihazlar':'Cihazlar'};
  const rows=Object.entries(categories).map(([category,label],i)=>({
    event_type:i%2?'changed':'first_seen',observed_at:at,
    report_image:{cid:`fixture-${i}@markets-pulse`,sha256:hashes[i],selection:'creative',url:'https://www.marketspulse.cloud/report-media/'+hashes[i]+'.jpg',width:[960,1200,720,960][i],height:[960,628,1280,960][i],mime_type:'image/jpeg'},
    analysis_json:{brand:i%2?'Örnek Rakip':'Telsim',category,category_label:label,ad_id:`1234567890${i}`,title:`${label} - Yeni Abonelere ve Ailelere Özel Uzun İsimli Kampanya`,
      source_url:'https://www.facebook.com/ads/library/?id=1234567890'+i,offer:{price_try:999,billing_period:'monthly',data_gb:category==='gsm'?50:null,bonus_data_gb:category==='mnp'?25:null,speed_mbps:category==='home'?100:null},
      visual_summary:'Kampanya görselindeki ana fiyat ve ürün bilgileri ayrı olarak okunur. Kullanım koşulları ile cihazın taksit süresi birbirine karıştırılmadan değerlendirilir.',
      conditions:['12 ay taahhüt ve yeni abonelik koşulu geçerlidir.','Fiyatın kapsamına kurulum ücretinin dahil olup olmadığı ayrıca doğrulanmalıdır.'],uncertainties:['Küçük yazılı bölümlerin tamamı doğrulanamadı.']}
  }));
  rows.push({...rows[3],report_image:{...rows[3].report_image},analysis_json:{...rows[3].analysis_json,ad_id:'123456789099',title:'Uzun Koşullu Kurumsal Cihaz ve Bağlantı Kampanyası',visual_summary:'UZUN AYRINTI BAŞLANGICI. '+('Kurumsal kampanyanın cihaz bedeli, bağlantı ücreti ve ödeme planı ayrı değerlendirilir. '.repeat(15)),conditions:[...rows[3].analysis_json.conditions,'İşletme sahipleri için koşullar: '+('Başvuru tarihinde geçerli ücretler ve hizmet kapsamı doğrulanmalıdır. '.repeat(10))],uncertainties:['Belirtilmeyen masraflar için sağlayıcıdan teyit gerekir. UZUN AYRINTI SONU.']}});
  const data={checked_at:at,status:'ok',categories,rows};
  const imageSrc=meta=>`data:image/jpeg;base64,${assets[Number(meta.cid.match(/fixture-(\d+)/)?.[1]||0)].toString('base64')}`;
  const adHtml=adVisualReportHtml(data,{mode:'pdf',imageSrc});
  const emailAdHtml=adVisualReportHtml(data,{mode:'email',imageSrc});
  const fixed=family(22),fwa=family(12,true);
  const base={
    type:'daily',title:REPORT_NAMES.daily,days:1,period_start:'2026-09-20T06:00:00.000Z',period_end:at,generated_at:at,
    market:{pressure_index:68,pressure_level:'YÜKSEK',move_count:17,executive_summary:'Mobil ve ev interneti pazarında fiyat, kota ve taahhüt koşulları birlikte değişiyor. Numara taşıma tekliflerinde yeni abone koşulları öne çıkıyor; müşteri kazanımı için fiyat kadar kapsam ve hizmet uygunluğu da değerlendirilmelidir.',top_threats:Array.from({length:4},(_,i)=>({product_name:`${i+1}. Aileye ve Gençlere Özel Yeni Nesil Süper İnternet Kampanyası`,segment:'Premium / Platinum',intent:'Müşteri kazanımı',threat:80-i*4,reasons:['Aylık ücret düştü','Ek internet kotası artırıldı','Uzun süreli taahhüt gerekli'],action:'Paket karşılaştırmasını aynı kullanım ve taahhüt koşullarında doğrulayın; uygun dijital hedef kitle için iletişimi gözden geçirin.'}))},
    benchmark:{overall_score:{score:72,level:'GÜÇLÜ'},methodology:'Karşılaştırmalar doğrulanmış paket özelliklerine dayanır.',score_methodology:'Fiyat, internet ve taahhüt bileşenleri birlikte değerlendirilir.',history_note:'Dönem başı verisi olmayan segmentte fark hesaplanmaz.'},
    stats:stats(17),sources:sources(7),changes:changes(22,'Telsim'),evidence:[],
    score_deltas:['Genel','Genç / Öğrenci','Premium / Platinum','Uluslararası / Diaspora'].map((segment,i)=>({segment,current:i===3?null:72+i,baseline:i===3?null:68,delta:i===3?null:4+i,level:i===3?'KARŞILIK BULUNAMADI':'GÜÇLÜ',confidence:i===3?'Sınırlı':'Yüksek',rationale:i===3?'İzlenen katalogda aynı segmente uygun ana tarife bulunamadı.':''})),
    daily_home:{fixed,fwa},ad_analysis_html:emailAdHtml,ad_analysis_html_pdf:adHtml,
    ad_report_data:{...data,coverage:[{brand:'Telsim',status:'ok',checked_at:at},{brand:'Örnek Rakip',status:'ok',checked_at:at}]},
    fixture_report_images:Object.fromEntries(hashes.map((digest,i)=>[digest,assets[i]]))
  };
  const monthly={...base,type:'monthly',title:REPORT_NAMES.monthly,days:30,period_start:'2026-08-22T06:00:00.000Z',monthly:{total_changes:31,evidence_total:43,evidence_complete:40,evidence_missing:3,evidence_visual:38,
    trend:Array.from({length:12},(_,i)=>({week:`2026-09-${String(1+7*Math.floor(i/4)).padStart(2,'0')}`,segment:['Genel','Genç / Öğrenci','Premium / Platinum','Uluslararası / Diaspora'][i%4],average_score:72+i,samples:4,first_sample:stamp(12),last_sample:stamp(19)})),
    coverage:sources(10).map((s,i)=>({domain:i%2?'Ev İnterneti':'Mobil',source:s.name,first_recorded:'2026-08-20T06:00:00Z',scans:30,successful:i===2?25:30}))}};
  const empty={...base,type:'daily',title:'Günlük Yönetici Özeti - Veri Bekleniyor',market:{pressure_index:0,pressure_level:'Veri bekleniyor',executive_summary:'Henüz yeterli kayıt yok. Kaynak kontrolleri tamamlandığında rapor güncellenecek.',top_threats:[]},benchmark:{overall_score:{score:null,level:'Veri bekleniyor'}},stats:stats(0),sources:[],changes:[],score_deltas:[],daily_home:null,ad_analysis_html:'',ad_analysis_html_pdf:''};
  return {
    daily:base,
    monthly,
    home:{...base,type:'home',title:REPORT_NAMES.home,days:7,home:fixed},
    fwa:{...base,type:'fwa',title:REPORT_NAMES.fwa,days:7,home:fwa},
    empty
  };
}


// Dedicated daily-email scenarios keep the legacy PDF and non-daily fixtures intact.
export function createDailyBriefLayoutFixtures(base){
  const checked='2026-09-21T05:30:00.000Z',observed='2026-09-20T14:30:00.000Z';
  const mobileSources=[{id:1,slug:'telsim-paketler',name:'Telsim Paketler',url:'https://example.com/telsim/paketler',last_status:'ok',last_checked_at:checked}];
  const fixedSources=[{slug:'fixture-fixed',name:'Örnek Fiber',url:'https://example.net/fiber/paketler',status:'ok',captured_at:checked}];
  const fwaSources=[{slug:'telsim-redbox',name:'Red Box',url:'https://example.org/redbox/paketler',status:'ok',captured_at:checked}];
  const sourceFields={source_id:1,source_slug:'telsim-paketler',source_name:'Telsim Paketler',source_url:mobileSources[0].url,provider:'Telsim',brand:'Telsim',detected_at:observed,scan_id:42};
  const mnpBefore={id:101,name:'Numaranı Taşı 50 GB',price_try:999,data_gb:50,validity_days:30,commitment_months:12};
  const mnpAfter={...mnpBefore,price_try:899,data_gb:60};
  const gsmBefore={id:102,name:'Aile 40 GB',price_try:799,data_gb:40,validity_days:30};
  const gsmAfter={...gsmBefore,data_gb:30};
  const mobileChanges=[
    {...sourceFields,id:101,product_id:101,product_name:mnpAfter.name,segment:'MNP / Numara Taşıma',change_type:'field_changed',field_name:'Fiyat',field_key:'price_try',old_value:'999',new_value:'899',severity:'high',product_before:mnpBefore,product_after:mnpAfter},
    {...sourceFields,id:102,product_id:101,product_name:mnpAfter.name,segment:'MNP / Numara Taşıma',change_type:'field_changed',field_name:'İnternet',field_key:'data_gb',old_value:'50',new_value:'60',severity:'high',product_before:mnpBefore,product_after:mnpAfter},
    {...sourceFields,id:103,product_id:102,product_name:gsmAfter.name,segment:'Genel',change_type:'field_changed',field_name:'İnternet',field_key:'data_gb',old_value:'40',new_value:'30',severity:'medium',product_before:gsmBefore,product_after:gsmAfter}
  ];
  const fixedProduct={product_key:'fixture-fixed|aile|12',provider:'Örnek Fiber',brand:'Örnek Fiber',name:'Aile Fiber 100 Mbps',source_slug:'fixture-fixed',source_url:fixedSources[0].url,product_url:'https://example.net/fiber/aile',product_family:'fixed',speed_down_mbps:100,effective_monthly_try:999,price_monthly_try:999,duration_months:12,unlimited:true,technology:'Fiber',availability:'active',expires_at:'2026-09-23',verified_at:checked,stale:false};
  const fixedChanges=[{id:201,scan_id:52,product_key:fixedProduct.product_key,product_name:fixedProduct.name,provider:fixedProduct.provider,brand:fixedProduct.brand,source_slug:fixedProduct.source_slug,source_url:fixedProduct.source_url,detected_at:observed,change_type:'field_changed',field_name:'İndirme hızı',field_key:'speed_down_mbps',old_value:'50',new_value:'100',severity:'high',product_before:{...fixedProduct,speed_down_mbps:50},product_after:fixedProduct}];
  const rich={...base,sources:mobileSources,changes:mobileChanges,stats:stats(mobileChanges.length),
    benchmark:{...base.benchmark,generated_at:checked,kktcell_error:null,matches:[{match_status:'Primary',match_score:90,telsim:{...mnpAfter,source_url:mobileSources[0].url},kktcell:{name:'Turkcell 60 GB',price_try:949,data_gb:60,validity_days:30,commitment_months:12,source_url:'https://example.edu/turkcell/60gb'}}]},
    daily_home:{fixed:{products:[fixedProduct],sources:fixedSources,changes:fixedChanges,stats:stats(1),opportunities:[]},fwa:{products:[],sources:fwaSources,changes:[],stats:stats(0),comparison:{}}},
    ad_report_data:{...base.ad_report_data,checked_at:checked,rows:base.ad_report_data.rows.map(row=>({...row,observed_at:observed,analysis_json:{...row.analysis_json,observed_at:observed}})),coverage:base.ad_report_data.coverage.map(row=>({...row,checked_at:checked}))}
  };
  const quiet={...rich,market:{...rich.market,top_threats:[],move_count:0},changes:[],stats:stats(0),
    daily_home:{fixed:{...rich.daily_home.fixed,products:[],changes:[],stats:stats(0)},fwa:rich.daily_home.fwa},
    ad_report_data:{...rich.ad_report_data,rows:[]}}
  ;
  const limited={...quiet,sources:mobileSources.map(row=>({...row,last_status:'blocked',last_checked_at:'2026-09-19T04:00:00.000Z'})),
    daily_home:{fixed:{...quiet.daily_home.fixed,sources:fixedSources.map(row=>({...row,status:'blocked',captured_at:'2026-09-19T04:00:00.000Z'}))},fwa:quiet.daily_home.fwa},
    ad_report_data:{...quiet.ad_report_data,status:'partial',checked_at:'2026-09-19T04:00:00.000Z',coverage:quiet.ad_report_data.coverage.map(row=>({...row,status:'blocked',checked_at:'2026-09-19T04:00:00.000Z'}))}};
  return {daily:rich,'daily-quiet':quiet,'daily-limited':limited};
}
