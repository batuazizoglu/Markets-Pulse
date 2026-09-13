import puppeteer from 'puppeteer';
import { REPORT_TZ, REPORT_NAMES, buildReportContext } from './report-data.js';

let reportBrowserPromise = null;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function localDate(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function localStamp(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,dateStyle:'short',timeStyle:'short'}).format(new Date(v));}
function slugStamp(v=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)).replace(/-/g,'');}
function changeLabel(c){if(c.change_type==='added')return 'Yeni paket';if(c.change_type==='removed')return 'Paket kaldırıldı';return c.field_name||'Alan değişikliği';}

function logoSvg(){
  return '<svg width="210" height="48" viewBox="0 0 420 82" xmlns="http://www.w3.org/2000/svg"><g transform="translate(4 13)"><circle cx="7" cy="45" r="6" fill="#0014F2"/><rect x="20" y="31" width="13" height="20" rx="6.5" fill="#1D5AFF"/><rect x="39" y="19" width="13" height="32" rx="6.5" fill="#1D5AFF"/><rect x="58" y="5" width="13" height="46" rx="6.5" fill="#00C2FF"/><circle cx="82" cy="45" r="7" fill="#FFCA00"/></g><text x="106" y="48" font-family="Arial,sans-serif" font-size="34" font-weight="800" letter-spacing="-1.5" fill="#001484">Market</text><text x="217" y="48" font-family="Arial,sans-serif" font-size="34" font-weight="800" letter-spacing="-1.5" fill="#00C2FF">Pulse</text><text x="218" y="68" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" letter-spacing="4.8" fill="#001484">BY TURKCELL</text></svg>';
}
function css(){
  return '@page{size:A4;margin:14mm 13mm 15mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#001484;background:#fff;font-size:10px;line-height:1.42}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #00C2FF;padding-bottom:9px;margin-bottom:14px}.meta{text-align:right;color:#667399;font-size:8.5px}.meta b{display:block;color:#001484;font-size:10px}h1{font-size:22px;margin:0 0 4px;color:#001484}h2{font-size:13px;margin:17px 0 8px;color:#001484}h3{font-size:10px;margin:0 0 4px}.sub{color:#667399;margin-bottom:8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.kpi{border:1px solid #dce5f2;border-radius:8px;padding:8px;background:#f7f9fc;min-height:58px}.kpi span{display:block;font-size:7.5px;text-transform:uppercase;color:#667399;font-weight:700}.kpi strong{display:block;font-size:17px;margin-top:3px;color:#001484}.kpi small{color:#667399;font-size:7px}.callout{border-left:4px solid #1D5AFF;background:#f4f8ff;padding:9px 10px;border-radius:6px;margin:9px 0}.callout.yellow{border-left-color:#FFCA00;background:#fff9df}table{width:100%;border-collapse:collapse;margin:5px 0 11px;font-size:8px}th{background:#001484;color:#fff;text-align:left;padding:5px 6px}td{border-bottom:1px solid #e3e9f2;padding:5px 6px;vertical-align:top}.good{color:#00835f;font-weight:700}.bad{color:#c7342d;font-weight:700}.muted{color:#667399}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pill{display:inline-block;padding:2px 5px;border-radius:999px;background:#eef4ff;color:#0014F2;font-size:7px;font-weight:700;margin-right:3px}.item{border-bottom:1px solid #e5eaf1;padding:6px 0}.item:last-child{border-bottom:0}.score{font-size:16px;font-weight:800;color:#0014F2}.pagebreak{break-before:page}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:8px}.evidence-card{border:1px solid #dce5f2;border-radius:7px;overflow:hidden}.evidence-card img{width:100%;height:150px;object-fit:cover;object-position:top;display:block}.evidence-card div{padding:5px 7px;color:#667399;font-size:7.5px}.footer{position:fixed;bottom:5mm;left:13mm;right:13mm;font-size:7px;color:#8190ad;display:flex;justify-content:space-between;border-top:1px solid #e5eaf1;padding-top:3px}';
}
function evidenceHtml(ctx,limit=4){
  const rows=(ctx.evidence||[]).filter(x=>x.focused_screenshot_png||x.screenshot_png).slice(0,limit);
  if(!rows.length)return '';
  return '<h2>Seçilmiş Görsel Kanıtlar</h2><div class="evidence">'+rows.map(x=>{const b=x.focused_screenshot_png||x.screenshot_png;const uri='data:image/png;base64,'+Buffer.from(b).toString('base64');return '<div class="evidence-card"><img src="'+uri+'"><div><b>'+esc(x.source_name)+'</b> • '+esc(localStamp(x.captured_at))+' • '+esc(x.kind)+'</div></div>';}).join('')+'</div>';
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
  html+='<h2>Kaynak Sağlığı</h2><table><thead><tr><th>Kaynak</th><th>Durum</th><th>HTTP</th><th>Okunan</th><th>Aktif</th><th>Yanıt</th></tr></thead><tbody>'+sourceRows+'</tbody></table>';
  return html;
}
export function renderReportHtml(ctx){
  const range=ctx.type==='daily'?localDate(ctx.period_end):localDate(ctx.period_start)+' - '+localDate(ctx.period_end);
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>'+css()+'</style></head><body><div class="header"><div>'+logoSvg()+'</div><div class="meta"><b>'+esc(ctx.title)+'</b>'+esc(range)+'<br>Üretim: '+esc(localStamp(ctx.generated_at))+'</div></div><h1>'+esc(ctx.title)+'</h1><div class="sub">Competitive intelligence • Kuzey Kıbrıs Turkcell karar destek raporu</div>'+bodyHtml(ctx)+'<div class="footer"><span>Market Pulse by Turkcell</span><span>Daha fazla veri • Daha güçlü kararlar</span></div></body></html>';
}
async function getBrowser(){
  if(!reportBrowserPromise)reportBrowserPromise=puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']}).catch(e=>{reportBrowserPromise=null;throw e;});
  return reportBrowserPromise;
}
export async function generateReportPdf(pool,type,options={}){
  const ctx=await buildReportContext(pool,type,options),html=renderReportHtml(ctx),browser=await getBrowser(),page=await browser.newPage();
  try{
    await page.setContent(html,{waitUntil:'networkidle0',timeout:60000});
    const buffer=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'0',right:'0',bottom:'0',left:'0'}});
    return {buffer,ctx,fileName:'market-pulse-'+type+'-'+slugStamp(ctx.period_end)+'.pdf',contentType:'application/pdf'};
  }finally{await page.close().catch(()=>{});}
}
