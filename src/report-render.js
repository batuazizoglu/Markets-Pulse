import puppeteer from 'puppeteer';
import { REPORT_TZ, REPORT_NAMES, buildReportContext } from './report-data.js';

let reportBrowserPromise = null;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function localDate(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function localStamp(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,dateStyle:'short',timeStyle:'short'}).format(new Date(v));}
function slugStamp(v=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)).replace(/-/g,'');}
function changeLabel(c){if(c.change_type==='added')return 'Yeni paket';if(c.change_type==='removed')return 'Paket kaldırıldı';return c.field_name||'Alan değişikliği';}
function money(v){return v==null||Number.isNaN(Number(v))?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL';}
function nfmt(v,d=0){return v==null||Number.isNaN(Number(v))?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:d});}

function logoSvg(){
  return '<svg width="210" height="48" viewBox="0 0 420 82" xmlns="http://www.w3.org/2000/svg"><g transform="translate(4 13)"><circle cx="7" cy="45" r="6" fill="#0014F2"/><rect x="20" y="31" width="13" height="20" rx="6.5" fill="#1D5AFF"/><rect x="39" y="19" width="13" height="32" rx="6.5" fill="#1D5AFF"/><rect x="58" y="5" width="13" height="46" rx="6.5" fill="#00C2FF"/><circle cx="82" cy="45" r="7" fill="#FFCA00"/></g><text x="106" y="48" font-family="Arial,sans-serif" font-size="34" font-weight="800" letter-spacing="-1.5" fill="#001484">Markets</text><text x="217" y="48" font-family="Arial,sans-serif" font-size="34" font-weight="800" letter-spacing="-1.5" fill="#00C2FF">Pulse</text><text x="218" y="68" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" letter-spacing="4.8" fill="#001484">BY TURKCELL</text></svg>';
}
function css(){
  return '@page{size:A4;margin:14mm 13mm 15mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#001484;background:#fff;font-size:10px;line-height:1.42}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #00C2FF;padding-bottom:9px;margin-bottom:14px}.meta{text-align:right;color:#667399;font-size:8.5px}.meta b{display:block;color:#001484;font-size:10px}h1{font-size:22px;margin:0 0 4px;color:#001484}h2{font-size:13px;margin:17px 0 8px;color:#001484}h3{font-size:10px;margin:0 0 4px}.sub{color:#667399;margin-bottom:8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.kpi{border:1px solid #dce5f2;border-radius:8px;padding:8px;background:#f7f9fc;min-height:58px}.kpi span{display:block;font-size:7.5px;text-transform:uppercase;color:#667399;font-weight:700}.kpi strong{display:block;font-size:17px;margin-top:3px;color:#001484}.kpi small{color:#667399;font-size:7px}.callout{border-left:4px solid #1D5AFF;background:#f4f8ff;padding:9px 10px;border-radius:6px;margin:9px 0}.callout.yellow{border-left-color:#FFCA00;background:#fff9df}table{width:100%;border-collapse:collapse;margin:5px 0 11px;font-size:8px}th{background:#001484;color:#fff;text-align:left;padding:5px 6px}td{border-bottom:1px solid #e3e9f2;padding:5px 6px;vertical-align:top}.good{color:#00835f;font-weight:700}.bad{color:#c7342d;font-weight:700}.muted{color:#667399}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pill{display:inline-block;padding:2px 5px;border-radius:999px;background:#eef4ff;color:#0014F2;font-size:7px;font-weight:700;margin-right:3px}.item{border-bottom:1px solid #e5eaf1;padding:6px 0}.item:last-child{border-bottom:0}.score{font-size:16px;font-weight:800;color:#0014F2}.pagebreak{break-before:page}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:8px}.evidence-card{border:1px solid #dce5f2;border-radius:7px;overflow:hidden}.evidence-card img{width:100%;height:150px;object-fit:cover;object-position:top;display:block}.evidence-card div{padding:5px 7px;color:#667399;font-size:7.5px}.footer{position:fixed;bottom:5mm;left:13mm;right:13mm;font-size:7px;color:#8190ad;display:flex;justify-content:space-between;border-top:1px solid #e5eaf1;padding-top:3px}';
}
function evidenceHtml(ctx,limit=4){
  const rows=(ctx.evidence||[]).filter(x=>x.focused_screenshot_png||x.screenshot_png).slice(0,limit);
  if(!rows.length)return '';
  return '<h2>Seçilmiş Görsel Kanıtlar</h2><div class="evidence">'+rows.map(x=>{const b=x.focused_screenshot_png||x.screenshot_png;const uri='data:image/png;base64,'+Buffer.from(b).toString('base64');return '<div class="evidence-card"><img src="'+uri+'"><div><b>'+esc(x.source_name)+'</b> • '+esc(localStamp(x.captured_at))+' • '+esc(x.kind)+'</div></div>';}).join('')+'</div>';
}
function homeBodyHtml(ctx){
  const h=ctx.home||{},products=h.products||[],sources=h.sources||[],changes=h.changes||[],isFwa=ctx.type==='fwa';
  const priced=products.filter(x=>x.effective_monthly_try!=null);
  const turkcell=products.filter(x=>x.provider==='Turkcell Ev İnterneti');
  const competitors=products.filter(x=>x.provider!=='Turkcell Ev İnterneti');
  const superbox=products.filter(x=>x.brand==='Superbox');
  const redbox=products.filter(x=>x.brand==='Red Box');
  const cheapest=arr=>[...arr].filter(x=>x.effective_monthly_try!=null).sort((a,b)=>a.effective_monthly_try-b.effective_monthly_try)[0]||null;
  const bestValue=arr=>[...arr].filter(x=>x.mbps_per_100tl!=null).sort((a,b)=>b.mbps_per_100tl-a.mbps_per_100tl)[0]||null;
  const tcBest=bestValue(turkcell),rivalBest=bestValue(competitors);
  const sbCheap=cheapest(superbox),rbCheap=cheapest(redbox);
  const kpis=isFwa?[
    ['Superbox',superbox.length+' SKU','KKTCELL 4.5G FWA'],
    ['Red Box',redbox.length+' SKU','Telsim 5G FWA'],
    ['En Uygun Superbox',sbCheap?money(sbCheap.effective_monthly_try):'—',sbCheap?.name||'Veri bekleniyor'],
    ['En Uygun Red Box',rbCheap?money(rbCheap.effective_monthly_try):'—',rbCheap?.name||'Veri bekleniyor']
  ]:[
    ['Turkcell Ev İnterneti',turkcell.length+' SKU','KKTCELL + Lifecell Digital birleşik katalog'],
    ['Rakip Teklif',competitors.length+' SKU','Sabit internet sağlayıcıları'],
    ['Turkcell En İyi Değer',tcBest?nfmt(tcBest.mbps_per_100tl,2):'—',tcBest?.name||'Veri bekleniyor'],
    ['Rakip En İyi Değer',rivalBest?nfmt(rivalBest.mbps_per_100tl,2):'—',rivalBest?(rivalBest.provider+' • '+rivalBest.name):'Veri bekleniyor']
  ];
  const kpiHtml=kpis.map(x=>'<div class="kpi"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></div>').join('');

  const rows=[...products].sort((a,b)=>{
    if(isFwa)return (a.brand==='Superbox'?0:1)-(b.brand==='Superbox'?0:1)||(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity);
    return (a.provider==='Turkcell Ev İnterneti'?0:1)-(b.provider==='Turkcell Ev İnterneti'?0:1)||(b.market_score||0)-(a.market_score||0);
  }).slice(0,isFwa?30:55).map(x=>{
    const speed=x.speed_down_mbps?nfmt(x.speed_down_mbps)+' Mbps':(x.data_limit_gb?nfmt(x.data_limit_gb)+' GB':'—');
    const duration=(x.duration_months||1)+(x.bonus_months?(' + '+x.bonus_months+' hediye'):'')+' ay';
    return '<tr><td><b>'+esc(x.brand||x.provider)+'</b></td><td>'+esc(x.name)+'</td><td>'+esc(x.technology||'—')+'</td><td>'+esc(speed)+'</td><td>'+esc(duration)+'</td><td>'+esc(money(x.effective_monthly_try))+'</td><td>'+esc(money(x.first_year_equiv_try))+'</td><td>'+esc(x.mbps_per_100tl==null?'—':nfmt(x.mbps_per_100tl,2))+'</td><td>'+esc(x.market_score==null?'—':x.market_score+'/100')+'</td></tr>';
  }).join('');

  let insight='';
  if(isFwa){
    insight='<div class="callout yellow"><b>FWA ürünleri ayrı izleniyor.</b><br>Superbox, sabit genişbant kataloğundan ayrılmıştır. Telsim Red Box aynı FWA rekabet kümesinde karşılaştırılır.'+
      (sbCheap&&rbCheap?'<br><b>Efektif aylık fiyat farkı:</b> '+esc(money(Number(sbCheap.effective_monthly_try)-Number(rbCheap.effective_monthly_try)))+' (Superbox − Red Box)':'')+'</div>';
  }else{
    const o=(h.opportunities||[])[0];
    insight='<div class="callout"><b>Turkcell Ev İnterneti birleşik katalog</b><br>KKTCELL ve Lifecell Digital sabit internet ürünleri tek ürün ailesinde değerlendirilir.'+
      (o?'<br><b>Öncelikli eşleşme:</b> '+esc(o.kktcell?.name)+' ↔ '+esc((o.competitor?.provider||'')+' '+(o.competitor?.name||''))+' • Home Value Score farkı '+esc((o.score_gap>0?'+':'')+o.score_gap):'')+'</div>';
  }

  const changeRows=changes.slice(0,35).map(x=>'<tr><td>'+esc(localStamp(x.detected_at))+'</td><td>'+esc(x.provider||'—')+'</td><td>'+esc(x.product_name||'Paket')+'</td><td>'+esc(changeLabel(x))+'</td><td>'+esc(x.old_value||'—')+'</td><td>'+esc(x.new_value||'—')+'</td></tr>').join('');
  const sourceRows=sources.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.provider||'—')+'</td><td>'+esc(x.status||'—')+'</td><td>'+esc(x.http_status||'—')+'</td><td>'+esc(x.parsed_count||0)+'</td><td>'+esc(x.response_ms?x.response_ms+' ms':'—')+'</td></tr>').join('');

  return '<div class="grid">'+kpiHtml+'</div>'+insight+
    '<h2>'+(isFwa?'Superbox / Red Box Ürünleri':'Turkcell Ev İnterneti ve Pazar Benchmark')+'</h2>'+
    '<table><thead><tr><th>Marka</th><th>Ürün</th><th>Teknoloji</th><th>Hız/Kota</th><th>Süre</th><th>Efektif Aylık</th><th>12 Ay Eşdeğer</th><th>Mbps/100 TL</th><th>Skor</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="pagebreak"></div><h2>Son '+esc(ctx.days)+' Günlük Değişiklikler</h2>'+
    '<table><thead><tr><th>Tarih</th><th>Sağlayıcı</th><th>Ürün</th><th>Hareket</th><th>Önce</th><th>Sonra</th></tr></thead><tbody>'+(changeRows||'<tr><td colspan="6">Anlamlı değişiklik yok.</td></tr>')+'</tbody></table>'+
    '<h2>Kaynak Sağlığı</h2><table><thead><tr><th>Kaynak</th><th>Sağlayıcı</th><th>Durum</th><th>HTTP</th><th>Okunan</th><th>Yanıt</th></tr></thead><tbody>'+sourceRows+'</tbody></table>';
}

function dailyHomeSummaryHtml(ctx){
  const d=ctx.daily_home;if(!d)return '';
  const fixed=d.fixed||{},fwa=d.fwa||{};
  const fp=fixed.products||[],fw=fwa.products||[];
  const turkcell=fp.filter(x=>x.provider==='Turkcell Ev İnterneti');
  const rivals=fp.filter(x=>x.provider!=='Turkcell Ev İnterneti');
  const superbox=fw.filter(x=>x.brand==='Superbox');
  const redbox=fw.filter(x=>x.brand==='Red Box');
  const cheapest=arr=>[...arr].filter(x=>x.effective_monthly_try!=null).sort((a,b)=>Number(a.effective_monthly_try)-Number(b.effective_monthly_try))[0]||null;
  const bestValue=arr=>[...arr].filter(x=>x.mbps_per_100tl!=null).sort((a,b)=>Number(b.mbps_per_100tl)-Number(a.mbps_per_100tl))[0]||null;
  const tcBest=bestValue(turkcell),rivalBest=bestValue(rivals),sbCheap=cheapest(superbox),rbCheap=cheapest(redbox);
  const fixedChangeRows=(fixed.changes||[]).slice(0,5).map(x=>'<tr><td>'+esc(localStamp(x.detected_at))+'</td><td>'+esc(x.provider||'—')+'</td><td>'+esc(x.product_name||'Paket')+'</td><td>'+esc(changeLabel(x))+'</td></tr>').join('');
  const fwaChangeRows=(fwa.changes||[]).slice(0,5).map(x=>'<tr><td>'+esc(localStamp(x.detected_at))+'</td><td>'+esc(x.brand||x.provider||'—')+'</td><td>'+esc(x.product_name||'Paket')+'</td><td>'+esc(changeLabel(x))+'</td></tr>').join('');
  const opportunity=(fixed.opportunities||[])[0];
  const sbPrice=sbCheap?money(sbCheap.effective_monthly_try):'—',rbPrice=rbCheap?money(rbCheap.effective_monthly_try):'—';
  return '<div class="pagebreak"></div>'+
    '<h2>Turkcell Ev İnterneti • Günlük Özet</h2>'+
    '<div class="grid">'+
      '<div class="kpi"><span>Turkcell Ev İnterneti</span><strong>'+esc(turkcell.length)+'</strong><small>güncel SKU</small></div>'+
      '<div class="kpi"><span>Rakip Sabit İnternet</span><strong>'+esc(rivals.length)+'</strong><small>güncel SKU</small></div>'+
      '<div class="kpi"><span>24 Saat Değişiklik</span><strong>'+esc(fixed.stats?.total||0)+'</strong><small>'+esc(fixed.stats?.high||0)+' yüksek • '+esc(fixed.stats?.critical||0)+' kritik</small></div>'+
      '<div class="kpi"><span>Turkcell En İyi Değer</span><strong>'+esc(tcBest?nfmt(tcBest.mbps_per_100tl,2):'—')+'</strong><small>'+esc(tcBest?.name||'Mbps / 100 TL')+'</small></div>'+
    '</div>'+
    '<div class="callout"><b>Sabit İnternet Sinyali</b><br>'+
      (opportunity?esc((opportunity.kktcell?.name||'Turkcell Ev İnterneti')+' ↔ '+(opportunity.competitor?.provider||'Rakip')+' '+(opportunity.competitor?.name||'')+' • Home Value Score farkı '+((opportunity.score_gap>0?'+':'')+(opportunity.score_gap??0))):'Bugün karşılaştırılabilir yeni bir sabit internet sinyali oluşmadı.')+
      (rivalBest?'<br><span class="muted">Rakip en iyi değer: '+esc(rivalBest.provider+' • '+rivalBest.name+' • '+nfmt(rivalBest.mbps_per_100tl,2)+' Mbps/100 TL')+'</span>':'')+
    '</div>'+
    '<table><thead><tr><th>Tarih</th><th>Sağlayıcı</th><th>Ürün</th><th>Hareket</th></tr></thead><tbody>'+(fixedChangeRows||'<tr><td colspan="4">Son 24 saatte sabit internet tarafında anlamlı değişiklik yok.</td></tr>')+'</tbody></table>'+
    '<h2>Superbox / Red Box • Günlük Özet</h2>'+
    '<div class="grid">'+
      '<div class="kpi"><span>Superbox</span><strong>'+esc(superbox.length)+'</strong><small>KKTCELL FWA SKU</small></div>'+
      '<div class="kpi"><span>Red Box</span><strong>'+esc(redbox.length)+'</strong><small>Telsim FWA SKU</small></div>'+
      '<div class="kpi"><span>24 Saat Değişiklik</span><strong>'+esc(fwa.stats?.total||0)+'</strong><small>'+esc(fwa.stats?.high||0)+' yüksek • '+esc(fwa.stats?.critical||0)+' kritik</small></div>'+
      '<div class="kpi"><span>Başlangıç Fiyatı</span><strong>'+esc(sbPrice)+'</strong><small>Superbox • Red Box '+esc(rbPrice)+'</small></div>'+
    '</div>'+
    '<div class="callout yellow"><b>FWA Sinyali</b><br>Superbox ve Red Box mobil tarifelerden ve sabit genişbanttan ayrı rekabet kümesinde izlenir.'+
      (sbCheap&&rbCheap?'<br><span class="muted">Efektif aylık fiyat farkı: '+esc(money(Number(sbCheap.effective_monthly_try)-Number(rbCheap.effective_monthly_try)))+' (Superbox − Red Box)</span>':'')+
    '</div>'+
    '<table><thead><tr><th>Tarih</th><th>Marka</th><th>Ürün</th><th>Hareket</th></tr></thead><tbody>'+(fwaChangeRows||'<tr><td colspan="4">Son 24 saatte Superbox / Red Box tarafında anlamlı değişiklik yok.</td></tr>')+'</tbody></table>';
}

function bodyHtml(ctx){
  const m=ctx.market,b=ctx.benchmark,s=ctx.stats;
  const scoreTable=(ctx.score_deltas||[]).map(x=>{const d=x.delta==null?'—':(x.delta>0?'+':'')+x.delta;const cls=x.delta==null?'':x.delta>=0?'good':'bad';return '<tr><td><b>'+esc(x.segment)+'</b></td><td>'+esc(x.current==null?'—':x.current+'/100')+'</td><td>'+esc(x.baseline==null?'—':x.baseline+'/100')+'</td><td class="'+cls+'">'+esc(d)+'</td><td>'+esc(x.level||'—')+'</td><td>'+esc(x.confidence||'—')+'</td></tr>';}).join('');
  const top=(m.top_threats||[]).slice(0,8);
  const threats=top.length?top.map(x=>'<div class="item"><h3>'+esc(x.product_name)+' <span class="pill">'+esc(x.segment)+'</span><span class="pill">'+esc(x.intent)+'</span></h3><div><span class="score">'+esc(x.threat)+'/100</span> • '+esc((x.reasons||[]).join(' • '))+'</div><div class="muted"><b>Öneri:</b> '+esc(x.action)+'</div></div>').join(''):'<div class="muted">Anlamlı rakip hareketi yok.</div>';
  const sourceRows=(ctx.sources||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.last_status||'—')+'</td><td>'+esc(x.http_status||'—')+'</td><td>'+esc(x.parsed_count||'—')+'</td><td>'+esc(x.active_products||0)+'</td><td>'+esc(x.response_ms?x.response_ms+' ms':'—')+'</td></tr>').join('');
  const changes=(ctx.changes||[]).slice(0,40).map(c=>'<tr><td>'+esc(localStamp(c.detected_at))+'</td><td>'+esc(c.product_name||c.new_value||c.old_value||'Paket')+'</td><td>'+esc(changeLabel(c))+'</td><td>'+esc(c.old_value||'—')+'</td><td>'+esc(c.new_value||'—')+'</td><td>'+esc(c.severity)+'</td></tr>').join('');
  let html='<div class="grid"><div class="kpi"><span>Competitive Pressure</span><strong>'+esc(m.pressure_index)+'/100</strong><small>'+esc(m.pressure_level)+'</small></div><div class="kpi"><span>Competitive Position</span><strong>'+esc(b.overall_score&&b.overall_score.score!=null?b.overall_score.score+'/100':'—')+'</strong><small>'+esc(b.overall_score?b.overall_score.level:'—')+'</small></div><div class="kpi"><span>Rakip Hamlesi</span><strong>'+esc(m.move_count||0)+'</strong><small>'+esc(ctx.days)+' günlük pencere</small></div><div class="kpi"><span>Değişiklik</span><strong>'+esc(s.total)+'</strong><small>'+esc(s.added)+' yeni • '+esc(s.removed)+' kaldırılan</small></div></div><div class="callout"><b>Yönetici Özeti</b><br>'+esc(m.executive_summary)+'</div><h2>Segment Bazlı Rekabet Pozisyonu</h2><table><thead><tr><th>Segment</th><th>Güncel</th><th>Dönem Başı</th><th>Delta</th><th>Durum</th><th>Güven</th></tr></thead><tbody>'+scoreTable+'</tbody></table><div class="two"><div><h2>Öncelikli Rakip Hamleleri</h2>'+threats+'</div><div><h2>Değişiklik Özeti</h2><div class="callout yellow"><b>'+esc(s.total)+' değişiklik</b><br>'+esc(s.critical)+' kritik • '+esc(s.high)+' yüksek • '+esc(s.medium)+' orta</div>'+(s.top_fields||[]).map(x=>'<div class="item"><b>'+esc(x.name)+'</b><span style="float:right">'+esc(x.count)+'</span></div>').join('')+'</div></div>';
  if(ctx.type!=='daily'){
    html+='<div class="pagebreak"></div><h2>Son '+esc(ctx.days)+' Günde Telsim Ne Yaptı?</h2><table><thead><tr><th>Tarih</th><th>Paket</th><th>Hareket</th><th>Önce</th><th>Sonra</th><th>Önem</th></tr></thead><tbody>'+changes+'</tbody></table>'+evidenceHtml(ctx,ctx.type==='weekly'?4:6);
  }
  if(ctx.type==='daily')html+=dailyHomeSummaryHtml(ctx);
  html+='<h2>Kaynak Sağlığı</h2><table><thead><tr><th>Kaynak</th><th>Durum</th><th>HTTP</th><th>Okunan</th><th>Aktif</th><th>Yanıt</th></tr></thead><tbody>'+sourceRows+'</tbody></table>';
  return html;
}
export function renderReportHtml(ctx){
  const range=ctx.type==='daily'?localDate(ctx.period_end):localDate(ctx.period_start)+' - '+localDate(ctx.period_end);
  const isHome=ctx.type==='home'||ctx.type==='fwa';
  const subtitle=isHome?(ctx.type==='fwa'?'FWA competitive intelligence • Superbox / Red Box':'Sabit internet competitive intelligence • Turkcell Ev İnterneti'):'Competitive intelligence • Kuzey Kıbrıs Turkcell karar destek raporu';
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>'+css()+'</style></head><body><div class="header"><div>'+logoSvg()+'</div><div class="meta"><b>'+esc(ctx.title)+'</b>'+esc(range)+'<br>Üretim: '+esc(localStamp(ctx.generated_at))+'</div></div><h1>'+esc(ctx.title)+'</h1><div class="sub">'+esc(subtitle)+'</div>'+(isHome?homeBodyHtml(ctx):bodyHtml(ctx))+'<div class="footer"><span>Markets Pulse by Turkcell</span><span>Daha fazla veri • Daha güçlü kararlar</span></div></body></html>';
}
async function getBrowser(){
  if(!reportBrowserPromise)reportBrowserPromise=puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']}).catch(e=>{reportBrowserPromise=null;throw e;});
  return reportBrowserPromise;
}
export async function generateReportPdf(pool,type,options={}){
  const ctx=await buildReportContext(pool,type,options),html=renderReportHtml(ctx),browser=await getBrowser(),page=await browser.newPage();
  try{
    await page.setContent(html,{waitUntil:'networkidle0',timeout:60000});
    await page.emulateMediaType('screen');
    await page.evaluate(async()=>{if(document.fonts&&document.fonts.ready)await document.fonts.ready});
    const metrics=await page.evaluate(()=>({
      textLength:(document.body?.innerText||'').trim().length,
      htmlLength:(document.body?.innerHTML||'').length,
      height:document.documentElement?.scrollHeight||0
    }));
    if(metrics.textLength<80 || metrics.htmlLength<200){
      throw new Error('PDF render content is unexpectedly empty: '+JSON.stringify(metrics));
    }
    const pdfBytes=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'0',right:'0',bottom:'0',left:'0'}});
    const buffer=Buffer.isBuffer(pdfBytes)?pdfBytes:Buffer.from(pdfBytes);
    if(buffer.length<5000) throw new Error('Generated PDF is unexpectedly small: '+buffer.length+' bytes');
    console.log('[report-pdf]',JSON.stringify({type,file_size_bytes:buffer.length,...metrics}));
    return {buffer,ctx,fileName:'markets-pulse-'+type+'-'+slugStamp(ctx.period_end)+'.pdf',contentType:'application/pdf'};
  }finally{await page.close().catch(()=>{});}
}
