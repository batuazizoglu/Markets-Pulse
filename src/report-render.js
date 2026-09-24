import puppeteer from 'puppeteer';
import { REPORT_TZ, REPORT_NAMES, buildReportContext } from './report-data.js';
import { monthlyOverviewHtml } from './monthly-report-content.js';
import { reportChangeValue, reportChangeProduct } from './report-change-value.js';

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
  return `
    @page{size:A4;margin:14mm 14mm 19mm}
    *{box-sizing:border-box}
    html{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#172b4d;background:#fff;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
    .header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #00b7e9;padding-bottom:12px;margin-bottom:20px;break-inside:avoid}
    .header svg{width:210px;height:48px;flex-shrink:0}
    .meta{text-align:right;color:#53627b;font-size:12px;line-height:1.45;max-width:55%}
    .meta b{display:block;color:#001484;font-size:13px;margin-bottom:3px}
    h1{font-size:28px;line-height:1.18;margin:0 0 7px;color:#001484;break-after:avoid}
    h2{font-size:19px;line-height:1.3;margin:24px 0 10px;color:#001484;break-after:avoid}
    h3{font-size:15px;line-height:1.4;margin:0 0 6px;color:#001484;break-after:avoid}
    p{margin:8px 0 12px;orphans:3;widows:3}
    .sub{color:#53627b;font-size:12px;margin-bottom:19px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0;break-inside:avoid}
    .kpi{border:1px solid #dce5f2;border-radius:7px;padding:11px 13px;background:#f6f9fe;min-height:86px;break-inside:avoid}
    .kpi span{display:block;font-size:12px;color:#53627b;font-weight:700}
    .kpi strong{display:block;font-size:23px;line-height:1.25;margin:5px 0;color:#001484}
    .kpi small{display:block;color:#53627b;font-size:12px;line-height:1.4}
    .callout{border-left:4px solid #1d5aff;background:#f3f7ff;padding:12px 14px;border-radius:5px;margin:12px 0;orphans:3;widows:3;break-inside:avoid}
    .callout.yellow{border-left-color:#e3b900;background:#fff9e2}
    table{width:100%;border-collapse:collapse;table-layout:fixed;margin:8px 0 18px;font-size:12px;line-height:1.45}
    thead{display:table-header-group;break-inside:avoid;break-after:avoid}tfoot{display:table-footer-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    th{background:#001484;color:#fff;text-align:left;font-weight:700;padding:8px;vertical-align:top}
    td{border-bottom:1px solid #dce5f2;padding:8px;vertical-align:top;overflow-wrap:anywhere;word-break:normal}
    tbody tr:nth-child(even){background:#f7f9fc}
    td small,.detail-line{display:block;font-size:12px;color:#53627b;margin-top:4px}
    .home-products .product-name{width:32%}.home-products .product-specs{width:19%}.home-products .product-price{width:18%}.home-products .product-year{width:17%}.home-products .product-value{width:14%}
    .source-health th:nth-child(1){width:42%}.source-health th:nth-child(2){width:12%}.source-health th:nth-child(3){width:9%}.source-health th:nth-child(4){width:10%}.source-health th:nth-child(5){width:9%}.source-health th:nth-child(6){width:18%}
    .source-health-home th:nth-child(1){width:32%}.source-health-home th:nth-child(2){width:23%}.source-health-home th:nth-child(3){width:12%}.source-health-home th:nth-child(4){width:9%}.source-health-home th:nth-child(5){width:9%}.source-health-home th:nth-child(6){width:15%}
    .source-health th,.source-health td{padding:6px 8px}.source-health{margin-bottom:10px}
    .change-table th:nth-child(1){width:18%}.change-table th:nth-child(2){width:24%}.change-table th:nth-child(3),.change-table th:nth-child(4){width:29%}
    .good{color:#007653;font-weight:700}.bad{color:#b32d29;font-weight:700}.muted{color:#53627b}
    .two{display:block}.two>div{margin-bottom:18px}
    .pill{display:inline-block;padding:2px 7px;border-radius:9px;background:#eaf1ff;color:#173a9e;font-size:11px;font-weight:700;margin:2px 3px 2px 0}
    .item{border-bottom:1px solid #dce5f2;padding:11px 0;break-inside:avoid}.item:last-child{border-bottom:0}
    .score{font-size:21px;font-weight:800;color:#174de0}
    .section-start{margin-top:24px;break-before:auto;page-break-before:auto}
    .evidence{display:block}.evidence-card{margin:0 0 16px;border:1px solid #dce5f2;border-radius:6px;overflow:hidden;break-inside:avoid}
    .evidence-card img{width:100%;height:220px;object-fit:contain;object-position:top;background:#f7f9fc;display:block}
    .evidence-card div{padding:8px 10px;color:#53627b;font-size:12px}
    .monthly-overview table{font-size:12px!important}.monthly-overview .report-note{font-size:12px!important;color:#53627b}
    .ad-report{font-family:Arial,Helvetica,sans-serif!important;font-size:14px!important;line-height:1.5!important;break-inside:auto!important}
    .ad-report h2:first-child{margin-top:0}
    .ad-report-header{break-inside:avoid;break-after:avoid}
    .ad-report h2,.ad-report h3,.ad-report h4{break-after:avoid}
    .ad-report-card{break-inside:avoid;page-break-inside:avoid;margin:0 0 18px!important}
    .ad-report-image{display:block;max-width:100%!important;max-height:75mm!important;width:100%!important;height:auto!important;object-fit:contain!important;object-position:top center!important;margin:0 auto 6px!important}
    .ad-report-layout{margin:0!important}.ad-report-layout td{border:0!important;background:#fff!important}
    .ad-report-image-cell{width:42%!important;padding:10px 14px 0 0!important}
    .ad-report-card-title{font-size:16px!important;line-height:1.4!important;margin:0!important}
    .ad-report-details{font-size:12px!important;line-height:1.5!important;overflow-wrap:anywhere;padding:10px 0 0!important}
    .ad-report-details p{margin:0 0 7px!important}
    .ad-report-source{font-size:11px!important;line-height:1.4!important}
    .ad-report-continuation{font-size:12px;line-height:1.5;break-inside:auto;orphans:3;widows:3;margin:8px 0 20px}
    .ad-report-continuation p{break-inside:auto}
    .ad-report table{font-size:12px!important}.ad-report td,.ad-report th{font-size:12px!important}
    a{color:#1748a3;text-decoration:none}small{font-size:12px}
  `;
}
function evidenceHtml(ctx,limit=4){
  const rows=(ctx.evidence||[]).filter(x=>x.focused_screenshot_png||x.screenshot_png).slice(0,limit);
  if(!rows.length)return '';
  return '<h2>Seçilmiş Görsel Kanıtlar</h2><div class="evidence">'+rows.map(x=>{const b=x.focused_screenshot_png||x.screenshot_png;const uri='data:image/png;base64,'+Buffer.from(b).toString('base64');return '<div class="evidence-card"><img alt="'+esc(x.source_name)+' görsel kanıtı" src="'+uri+'"><div><b>'+esc(x.source_name)+'</b> • '+esc(localStamp(x.captured_at))+' • '+esc(x.kind)+'</div></div>';}).join('')+'</div>';
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
    return '<tr><td><b>'+esc(x.brand||x.provider)+'</b><span class="detail-line">'+esc(x.name)+'</span></td><td>'+esc(speed)+'<span class="detail-line">'+esc(x.technology||'—')+'<br>'+esc(duration)+'</span></td><td><b>'+esc(money(x.effective_monthly_try))+'</b><span class="detail-line">aylık eşdeğer</span></td><td>'+esc(money(x.first_year_equiv_try))+'</td><td>'+esc(x.mbps_per_100tl==null?'—':nfmt(x.mbps_per_100tl,2))+'<span class="detail-line">Skor: '+esc(x.market_score==null?'—':x.market_score+'/100')+'</span></td></tr>';
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

  const changeRows=changes.slice(0,35).map(x=>'<tr><td>'+esc(localStamp(x.detected_at))+'<span class="detail-line">'+esc(x.provider||'—')+'</span></td><td><b>'+esc(reportChangeProduct(x))+'</b><span class="detail-line">'+esc(changeLabel(x))+'</span></td><td>'+esc(reportChangeValue(x.old_value))+'</td><td>'+esc(reportChangeValue(x.new_value))+'</td></tr>').join('');
  const sourceRows=sources.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.provider||'—')+'</td><td>'+esc(x.status||'—')+'</td><td>'+esc(x.http_status||'—')+'</td><td>'+esc(x.parsed_count||0)+'</td><td>'+esc(x.response_ms?x.response_ms+' ms':'—')+'</td></tr>').join('');

  return '<div class="grid">'+kpiHtml+'</div>'+insight+
    '<h2>'+(isFwa?'Superbox / Red Box Ürünleri':'Turkcell Ev İnterneti ve Pazar Benchmark')+'</h2>'+
    '<table class="home-products"><colgroup><col class="product-name"><col class="product-specs"><col class="product-price"><col class="product-year"><col class="product-value"></colgroup><thead><tr><th>Marka / Ürün</th><th>Hız, Kota ve Süre</th><th>Efektif Aylık</th><th>12 Ay Eşdeğer</th><th>Mbps / 100 TL</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5">Güncel ürün kaydı bulunmuyor.</td></tr>')+'</tbody></table>'+
    '<div class="pagebreak"></div><h2>Son '+esc(ctx.days)+' Günlük Değişiklikler</h2>'+
    '<table class="change-table"><thead><tr><th>Tarih / Sağlayıcı</th><th>Ürün / Hareket</th><th>Önce</th><th>Sonra</th></tr></thead><tbody>'+(changeRows||'<tr><td colspan="4">Anlamlı değişiklik yok.</td></tr>')+'</tbody></table>'+
    '<h2>Kaynak Sağlığı</h2><table class="source-health source-health-home"><thead><tr><th>Kaynak</th><th>Sağlayıcı</th><th>Durum</th><th>HTTP</th><th>Okunan</th><th>Yanıt</th></tr></thead><tbody>'+sourceRows+'</tbody></table>';
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
  const m=ctx.market||{},b=ctx.benchmark||{},s=ctx.stats||{};
  const scoreTable=(ctx.score_deltas||[]).map(x=>{const d=x.delta==null?'—':(x.delta>0?'+':'')+x.delta;const cls=x.delta==null?'':x.delta>=0?'good':'bad';return '<tr><td><b>'+esc(x.segment)+'</b></td><td>'+esc(x.current==null?'—':x.current+'/100')+'</td><td>'+esc(x.baseline==null?'—':x.baseline+'/100')+'</td><td class="'+cls+'">'+esc(d)+'</td><td>'+esc(x.level||'—')+(x.current==null&&x.rationale?'<br><small>'+esc(x.rationale)+'</small>':'')+'</td><td>'+esc(x.confidence||'—')+'</td></tr>';}).join('');
  const top=(m.top_threats||[]).slice(0,8);
  const threats=top.length?top.map(x=>'<div class="item"><h3>'+esc(x.product_name)+' <span class="pill">'+esc(x.segment)+'</span><span class="pill">'+esc(x.intent)+'</span></h3><div><span class="score">'+esc(x.threat)+'/100</span> • '+esc((x.reasons||[]).join(' • '))+'</div><div class="muted"><b>Öneri:</b> '+esc(x.action)+'</div></div>').join(''):'<div class="muted">Anlamlı rakip hareketi yok.</div>';
  const sourceRows=(ctx.sources||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.last_status||'—')+'</td><td>'+esc(x.http_status||'—')+'</td><td>'+esc(x.parsed_count||'—')+'</td><td>'+esc(x.active_products||0)+'</td><td>'+esc(x.response_ms?x.response_ms+' ms':'—')+'</td></tr>').join('');
  const changes=(ctx.changes||[]).slice(0,40).map(c=>'<tr><td>'+esc(localStamp(c.detected_at))+'<span class="detail-line">Önem: '+esc(c.severity||'—')+'</span></td><td><b>'+esc(reportChangeProduct(c))+'</b><span class="detail-line">'+esc(changeLabel(c))+'</span></td><td>'+esc(reportChangeValue(c.old_value))+'</td><td>'+esc(reportChangeValue(c.new_value))+'</td></tr>').join('');
  let html='<div class="grid"><div class="kpi"><span>Competitive Pressure</span><strong>'+esc(m.pressure_index)+'/100</strong><small>'+esc(m.pressure_level)+'</small></div><div class="kpi"><span>Competitive Position</span><strong>'+esc(b.overall_score&&b.overall_score.score!=null?b.overall_score.score+'/100':'—')+'</strong><small>'+esc(b.overall_score?b.overall_score.level:'—')+'</small></div><div class="kpi"><span>Rakip Hamlesi</span><strong>'+esc(m.move_count||0)+'</strong><small>'+esc(ctx.days)+' günlük pencere</small></div><div class="kpi"><span>Değişiklik</span><strong>'+esc(s.total)+'</strong><small>'+esc(s.added)+' yeni • '+esc(s.removed)+' kaldırılan</small></div></div><div class="callout"><b>Yönetici Özeti</b><br>'+esc(m.executive_summary)+'</div><h2>Segment Bazlı Rekabet Pozisyonu</h2><table><thead><tr><th>Segment</th><th>Güncel</th><th>Dönem Başı</th><th>Delta</th><th>Durum</th><th>Güven</th></tr></thead><tbody>'+scoreTable+'</tbody></table><p class="muted">'+esc(b.methodology||'')+' '+esc(b.score_methodology||'')+' '+esc(b.history_note||'')+'</p><div class="two"><div><h2>Öncelikli Rakip Hamleleri</h2>'+threats+'</div><div><h2>Değişiklik Özeti</h2><div class="callout yellow"><b>'+esc(s.total)+' değişiklik</b><br>'+esc(s.critical)+' kritik • '+esc(s.high)+' yüksek • '+esc(s.medium)+' orta</div>'+(s.top_fields||[]).map(x=>'<div class="item"><b>'+esc(x.name)+'</b><span style="float:right">'+esc(x.count)+'</span></div>').join('')+'</div></div>';
  if(ctx.type!=='daily'){
    html+='<div class="pagebreak"></div><h2>Son '+esc(ctx.days)+' Günde Telsim Ne Yaptı?</h2><table class="change-table"><thead><tr><th>Tarih / Önem</th><th>Paket / Hareket</th><th>Önce</th><th>Sonra</th></tr></thead><tbody>'+changes+'</tbody></table>'+evidenceHtml(ctx,ctx.type==='weekly'?4:6);
  }
  if(ctx.type==='daily'||ctx.type==='weekly')html+=dailyHomeSummaryHtml(ctx);
  html+='<h2>Kaynak Sağlığı</h2><table class="source-health"><thead><tr><th>Kaynak</th><th>Durum</th><th>HTTP</th><th>Okunan</th><th>Aktif</th><th>Yanıt</th></tr></thead><tbody>'+sourceRows+'</tbody></table>';
  return html;
}
export function renderReportHtml(ctx){
  const range=ctx.type==='daily'?localDate(ctx.period_end):localDate(ctx.period_start)+' - '+localDate(ctx.period_end);
  const isHome=ctx.type==='home'||ctx.type==='fwa';
  const subtitle=isHome?(ctx.type==='fwa'?'FWA competitive intelligence • Superbox / Red Box':'Sabit internet competitive intelligence • Turkcell Ev İnterneti'):'Competitive intelligence • Kuzey Kıbrıs Turkcell karar destek raporu';
  let content=isHome?homeBodyHtml(ctx):bodyHtml(ctx);
  if(ctx.type==='monthly'){
    content=monthlyOverviewHtml(ctx)+'<div class="pagebreak"></div><h2>Mobil Rekabet ve Paket Hareketleri</h2>'+content+
      '<p>Mobil değişiklik tablosu son '+Math.min(40,(ctx.changes||[]).length)+' / '+(ctx.changes||[]).length+' kaydı gösterir. Yönetici özetindeki sayılar dönemdeki tüm kayıtları kapsar.</p>';
    for(const [family,title] of [['fixed','Turkcell Ev İnterneti • Aylık Detay'],['fwa','Superbox / Red Box • Aylık Detay']]){
      const section=ctx.daily_home?.[family]||{products:[],changes:[],sources:[]};
      content+=(family==='fixed'?'<div class="pagebreak"></div>':'')+'<h2>'+title+'</h2>'+homeBodyHtml({...ctx,type:family==='fixed'?'home':'fwa',home:section})+
        '<p>Seçilmiş ürünler ve son '+Math.min(35,section.changes.length)+' / '+section.changes.length+' değişiklik gösterilir. Ürün tablosu güncel katalogdan ilk '+Math.min(family==='fixed'?55:30,section.products.length)+' / '+section.products.length+' teklifi içerir.</p>';
    }
  }
  content+=ctx.ad_analysis_html_pdf??ctx.ad_analysis_html??'';
  // Let sections flow naturally; forcing a new page can isolate a trailing note or source row.
  content=content.replace(/<div class="pagebreak"><\/div><h2>/g,'<h2 class="section-start">');
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>'+esc(ctx.title)+'</title><style>'+css()+'</style></head><body><div class="header"><div>'+logoSvg()+'</div><div class="meta"><b>'+esc(ctx.title)+'</b>'+esc(range)+'<br>Üretim: '+esc(localStamp(ctx.generated_at))+'</div></div><h1>'+esc(ctx.title)+'</h1><div class="sub">'+esc(subtitle)+'</div>'+content+'</body></html>';
}
function launchBrowser(executablePath){
  return puppeteer.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
}
async function getBrowser(){
  if(!reportBrowserPromise)reportBrowserPromise=launchBrowser().catch(e=>{reportBrowserPromise=null;throw e;});
  return reportBrowserPromise;
}

/** Render a prepared report without database access or email side effects. */
export async function renderReportPdf(ctx,{executablePath}={}){
  const html=renderReportHtml(ctx),browser=executablePath?await launchBrowser(executablePath):await getBrowser(),page=await browser.newPage();
  try{
    await page.setViewport({width:794,height:1123,deviceScaleFactor:1});
    await page.emulateMediaType('print');
    await page.setContent(html,{waitUntil:'networkidle0',timeout:60000});
    const metrics=await page.evaluate(async()=>{
      if(document.fonts?.ready)await document.fonts.ready;
      await Promise.all(Array.from(document.images,image=>image.decode().catch(()=>{})));
      return {
        textLength:(document.body?.innerText||'').trim().length,
        htmlLength:(document.body?.innerHTML||'').length,
        height:document.documentElement?.scrollHeight||0,
        images:document.images.length,
        missingImages:Array.from(document.images).filter(image=>!image.complete||!image.naturalWidth).length
      };
    });
    if(metrics.textLength<80||metrics.htmlLength<200)throw new Error('PDF render content is unexpectedly empty: '+JSON.stringify(metrics));
    if(metrics.missingImages)throw new Error('PDF contains unloaded evidence images: '+metrics.missingImages);
    const pdfBytes=await page.pdf({
      format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,
      headerTemplate:'<span></span>',
      footerTemplate:'<div style="width:100%;margin:0 14mm;color:#53627b;font-family:Arial,sans-serif;font-size:8pt;line-height:1.3;border-top:1px solid #dce5f2;padding-top:5px;display:flex;justify-content:space-between"><span>Markets Pulse by Turkcell</span><span>Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin:{top:'14mm',right:'14mm',bottom:'19mm',left:'14mm'}
    });
    const buffer=Buffer.isBuffer(pdfBytes)?pdfBytes:Buffer.from(pdfBytes);
    if(buffer.length<5000)throw new Error('Generated PDF is unexpectedly small: '+buffer.length+' bytes');
    console.log('[report-pdf]',JSON.stringify({type:ctx.type,file_size_bytes:buffer.length,...metrics}));
    return {buffer,ctx,fileName:'markets-pulse-'+ctx.type+'-'+slugStamp(ctx.period_end)+'.pdf',contentType:'application/pdf'};
  }finally{
    await page.close().catch(()=>{});
    // An explicit binary is an isolated render (CI / local preview), not the server's shared browser.
    if(executablePath)await browser.close().catch(()=>{});
  }
}
export async function generateReportPdf(pool,type,options={}){
  return renderReportPdf(await buildReportContext(pool,type,options));
}
