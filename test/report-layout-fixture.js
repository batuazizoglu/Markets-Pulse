// Synthetic, offline reports. No production data, scans, API calls or email delivery.
import sharp from 'sharp';
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
  const categories={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma','auto-cihazlar':'Cihazlar'};
  const rows=Object.entries(categories).map(([category,label],i)=>({
    event_type:i%2?'changed':'first_seen',observed_at:at,
    report_image:{cid:`fixture-${i}@markets-pulse`,width:[960,1200,720,960][i],height:[960,628,1280,960][i],mime_type:'image/jpeg'},
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
    daily_home:{fixed,fwa},ad_analysis_html:emailAdHtml,ad_analysis_html_pdf:adHtml
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
