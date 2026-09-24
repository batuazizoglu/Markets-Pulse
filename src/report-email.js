import nodemailer from 'nodemailer';
import { REPORT_NAMES, REPORT_TZ, reportDays } from './report-data.js';
import { monthlyOverviewHtml, monthlyPlainText } from './monthly-report-content.js';
import { generateReportPdf } from './report-render.js';
import { generateEvidencePack } from './evidence-pack.js';
import { pool as dbPool } from './db.js';

function parseList(v){return String(v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean);}
function localDate(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));}

let dynamicRecipients=[];
let recipientSource='environment-fallback';
function uniqueEmails(list){
  const seen=new Set(),out=[];
  for(const raw of list||[]){const email=String(raw||'').trim().toLowerCase();if(!email||!/@/.test(email)||seen.has(email))continue;seen.add(email);out.push(email)}
  return out;
}
export async function refreshReportRecipients(pool=dbPool){
  try{
    const r=await pool.query("SELECT email FROM app_users WHERE active=TRUE AND email IS NOT NULL AND length(trim(email))>3 ORDER BY id");
    const users=uniqueEmails(r.rows.map(x=>x.email));
    if(users.length){dynamicRecipients=users;recipientSource='active-app-users'}
    else{dynamicRecipients=uniqueEmails(parseList(process.env.REPORT_EMAIL_TO));recipientSource='environment-fallback'}
  }catch(e){
    dynamicRecipients=uniqueEmails(parseList(process.env.REPORT_EMAIL_TO));recipientSource='environment-fallback';
    console.error('[report-email] dynamic recipient refresh failed',e?.message||String(e));
  }
  return [...dynamicRecipients];
}
function recipientDisplay(count){
  return {length:count,join:()=>count+' kişi',toJSON:()=>[count+' kişi']};
}
export function getReportEmailStatus(){
  const actual=dynamicRecipients.length?dynamicRecipients:uniqueEmails(parseList(process.env.REPORT_EMAIL_TO));
  const count=actual.length;
  const apiConfigured=Boolean(process.env.BREVO_API_KEY&&process.env.REPORT_EMAIL_FROM&&count);
  const smtpConfigured=Boolean(process.env.SMTP_HOST&&process.env.REPORT_EMAIL_FROM&&count);
  const configured=apiConfigured||smtpConfigured;
  const status={
    configured,api_configured:apiConfigured,smtp_configured:smtpConfigured,
    delivery_mode:apiConfigured?'brevo-api':smtpConfigured?'smtp':'none',
    recipients:recipientDisplay(count),recipient_count:count,recipient_source:recipientSource,
    from:process.env.REPORT_EMAIL_FROM||null,smtp_host:process.env.SMTP_HOST||null,
    daily_cron:process.env.REPORT_DAILY_CRON||'0 8 * * *',
    weekly_cron:process.env.REPORT_WEEKLY_CRON||'15 8 * * 1',
    timezone:REPORT_TZ,max_attachment_mb:Number(process.env.REPORT_EMAIL_MAX_MB||18)
  };
  Object.defineProperty(status,'recipient_emails',{value:actual,enumerable:false,writable:false});
  return status;
}
function transportConfig(){
  const status=getReportEmailStatus();
  if(!status.configured){const e=new Error('E-posta yapılandırılmadı. Aktif Markets Pulse kullanıcısı ve REPORT_EMAIL_FROM ile BREVO_API_KEY (önerilen) veya SMTP ayarları gerekli.');e.code='EMAIL_NOT_CONFIGURED';throw e;}
  if(status.api_configured) return {status,transport:null};
  const port=Number(process.env.SMTP_PORT||587);
  const cfg={host:process.env.SMTP_HOST,port,secure:String(process.env.SMTP_SECURE||'').toLowerCase()==='true'||port===465,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,requireTLS:port===587};
  if(process.env.SMTP_USER)cfg.auth={user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''};
  return {status,transport:nodemailer.createTransport(cfg)};
}
async function maskStoredReportRecipients(pool=dbPool){
  try{
    await pool.query(`UPDATE report_runs
      SET recipients=ARRAY[cardinality(recipients)::text || ' kişi']
      WHERE recipients IS NOT NULL AND cardinality(recipients)>0
      AND NOT (cardinality(recipients)=1 AND recipients[1] ~ '^[0-9]+ kişi$')`);
  }catch(e){console.error('[report-email] recipient history masking failed',e?.message||String(e))}
}
setTimeout(()=>{refreshReportRecipients().catch(()=>{});maskStoredReportRecipients().catch(()=>{})},8000).unref?.();
setInterval(()=>refreshReportRecipients().catch(()=>{}),30000).unref?.();

function parseSender(v){
  const raw=String(v||'').trim();
  const m=raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if(m) return {name:m[1].replace(/^["']|["']$/g,'').trim()||'Markets Pulse',email:m[2].trim()};
  return {name:'Markets Pulse',email:raw};
}

async function sendViaBrevoApi({status,subject,textContent,htmlContent,attachments}){
  const sender=parseSender(status.from);
  const recipients=status.recipient_emails||[];
  const body={
    sender,
    to:recipients.map(email=>({email})),
    subject,
    htmlContent,
    textContent,
    attachment:attachments.map(a=>({name:a.filename,content:Buffer.from(a.content).toString('base64')}))
  };
  console.log('[report-email] brevo-api connecting',JSON.stringify({from:sender.email,recipients:recipients.length,subject,attachments:attachments.length}));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  let response;
  try{
    response=await fetch('https://api.brevo.com/v3/smtp/email',{
      method:'POST',
      headers:{'accept':'application/json','content-type':'application/json','api-key':process.env.BREVO_API_KEY},
      body:JSON.stringify(body),
      signal:controller.signal
    });
  }catch(e){
    const err=new Error('Brevo API bağlantı hatası: '+(e?.message||String(e)));
    err.code='BREVO_API_CONNECTION_ERROR';
    throw err;
  }finally{clearTimeout(timer)}
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error('Brevo API gönderim hatası ('+response.status+'): '+(payload?.message||JSON.stringify(payload)));
    err.code='BREVO_API_ERROR';
    err.httpStatus=response.status;
    throw err;
  }
  console.log('[report-email] brevo-api accepted',JSON.stringify({message_id:payload.messageId||null}));
  return {messageId:payload.messageId||null,accepted_count:recipients.length,rejected:[],response:'Brevo API '+response.status};
}
function signed(v){
  if(v==null||Number.isNaN(Number(v)))return '—';
  const n=Number(v);return (n>0?'+':'')+n;
}
function pctColor(v){
  if(v==null)return '#667399';
  return Number(v)>=0?'#00835f':'#c7342d';
}
function emailStyles(){
  return '<style>table{max-width:100%}td,th{overflow-wrap:anywhere}.mp-wrap{table-layout:fixed}.ad-report-card{box-sizing:border-box;max-width:100%}@media only screen and (max-width:620px){.mp-wrap{width:100%!important}.mp-pad{padding-left:16px!important;padding-right:16px!important}.mp-kpi{display:block!important;box-sizing:border-box;width:100%!important;padding:0 0 8px!important}.mp-two{display:block!important;width:100%!important}.mp-hide-mobile{display:none!important}.ad-report-layout,.ad-report-layout tbody,.ad-report-layout tr,.ad-report-image-cell,.ad-report-details{display:block!important;box-sizing:border-box;width:100%!important}.ad-report-image-cell{padding:0 0 14px!important}.ad-report-image{width:auto!important;max-width:100%!important;max-height:360px!important;margin:0 auto}.ad-report-details{font-size:14px!important}.ad-report-card{padding:12px!important}}</style>';
}
function homeEmailHtml(type,ctx,attachments=[]){
  const h=ctx.home||{},isFwa=type==='fwa',products=h.products||[];
  const money=v=>v==null||Number.isNaN(Number(v))?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL';
  const turkcell=products.filter(x=>x.provider==='Turkcell Ev İnterneti');
  const rivals=products.filter(x=>x.provider!=='Turkcell Ev İnterneti');
  const sb=products.filter(x=>x.brand==='Superbox');
  const rb=products.filter(x=>x.brand==='Red Box');
  const cheap=arr=>[...arr].filter(x=>x.effective_monthly_try!=null).sort((a,b)=>a.effective_monthly_try-b.effective_monthly_try)[0]||null;
  const cards=isFwa?[
    ['Superbox',sb.length+' SKU'],['Red Box',rb.length+' SKU'],['Superbox başlangıç',money(cheap(sb)?.effective_monthly_try)],['Red Box başlangıç',money(cheap(rb)?.effective_monthly_try)]
  ]:[
    ['Turkcell Ev İnterneti',turkcell.length+' SKU'],['Rakip teklif',rivals.length+' SKU'],['Resmi kaynak',(h.sources||[]).length],['7 günlük değişiklik',(h.changes||[]).filter(x=>new Date(x.detected_at)>Date.now()-7*86400000).length]
  ];
  const attachmentList=attachments.map(a=>'<div style="padding:4px 0;font-size:12px;color:#42526e;">📎 '+esc(a.filename)+'</div>').join('');
  const rows=[...products].sort((a,b)=>(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity)).slice(0,8).map(x=>
    '<tr><td style="padding:8px;border-bottom:1px solid #e7edf6;font-size:11px;"><b>'+esc(x.brand||x.provider)+'</b></td><td style="padding:8px;border-bottom:1px solid #e7edf6;font-size:11px;">'+esc(x.name)+'</td><td style="padding:8px;border-bottom:1px solid #e7edf6;font-size:11px;">'+esc(x.speed_down_mbps?x.speed_down_mbps+' Mbps':x.data_limit_gb?x.data_limit_gb+' GB':'—')+'</td><td style="padding:8px;border-bottom:1px solid #e7edf6;font-size:11px;text-align:right;"><b>'+esc(money(x.effective_monthly_try))+'</b></td></tr>'
  ).join('');
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+emailStyles()+'</head><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#001484;">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" class="mp-wrap" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#fff;border-radius:16px;overflow:hidden;">'+
    '<tr><td style="background:#000f64;padding:22px 28px;"><div style="font-size:26px;font-weight:900;color:#fff;">Markets <span style="color:#00c2ff;">Pulse</span></div><div style="margin-top:6px;font-size:9px;letter-spacing:.18em;color:#b9ccff;font-weight:700;">BY TURKCELL • '+(isFwa?'FWA INTELLIGENCE':'HOME INTERNET INTELLIGENCE')+'</div></td></tr>'+
    '<tr><td class="mp-pad" style="padding:24px 28px 10px;"><div style="font-size:20px;font-weight:900;color:#001484;">'+esc(REPORT_NAMES[type])+'</div><div style="margin-top:7px;color:#42526e;font-size:13px;line-height:1.6;">'+(isFwa?'Superbox ve Telsim Red Box ayrı FWA ürün ailesi olarak karşılaştırılmıştır.':'KKTCELL ve Lifecell Digital sabit internet katalogları tek Turkcell Ev İnterneti ürün ailesinde birleştirilmiştir.')+'</div></td></tr>'+
    '<tr><td class="mp-pad" style="padding:10px 28px 18px;"><table role="presentation" width="100%"><tr>'+cards.map(x=>'<td class="mp-kpi" width="25%" style="padding:4px;vertical-align:top;"><div style="border:1px solid #dde7f6;border-radius:10px;background:#f6f9ff;padding:11px;"><div style="font-size:9px;color:#667399;font-weight:800;text-transform:uppercase;">'+esc(x[0])+'</div><div style="margin-top:5px;font-size:17px;font-weight:900;color:#001484;">'+esc(x[1])+'</div></div></td>').join('')+'</tr></table></td></tr>'+
    '<tr><td class="mp-pad" style="padding:0 28px 18px;"><div style="font-size:12px;font-weight:800;margin-bottom:8px;">Öne Çıkan Teklifler</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border:1px solid #e1e8f2;border-radius:10px;border-collapse:separate;border-spacing:0;"><tr style="background:#001484;"><th align="left" style="padding:8px;color:#fff;font-size:10px;">Marka</th><th align="left" style="padding:8px;color:#fff;font-size:10px;">Ürün</th><th align="left" style="padding:8px;color:#fff;font-size:10px;">Hız/Kota</th><th align="right" style="padding:8px;color:#fff;font-size:10px;">Efektif Aylık</th></tr>'+rows+'</table></td></tr>'+
    (ctx.ad_analysis_html?'<tr><td class="mp-pad" style="padding:0 28px 18px">'+ctx.ad_analysis_html+'</td></tr>':'')+
    '<tr><td class="mp-pad" style="padding:0 28px 20px;"><div style="background:#f7f9fc;border:1px solid #e2e8f1;border-radius:10px;padding:13px;"><b style="font-size:11px;">Ekli rapor</b>'+attachmentList+'</div></td></tr>'+
    '<tr><td align="center" style="padding:0 28px 26px;"><a href="https://www.marketspulse.cloud/#home" style="display:inline-block;background:#0014f2;color:#fff;text-decoration:none;font-size:12px;font-weight:800;padding:12px 20px;border-radius:9px;">Ev İnterneti Dashboard’unu Aç</a></td></tr>'+
    '</table></td></tr></table></body></html>';
}

function dailyHomeEmailBlocks(ctx){
  const d=ctx.daily_home;if(!d)return '';
  const weekly=ctx.type==='weekly';
  const periodLabel=ctx.type==='monthly'?'30 Günlük':weekly?'7 Günlük':'Günlük';
  const changeLabel=ctx.type==='monthly'?'30 Gün Değişiklik':weekly?'7 Gün Değişiklik':'24 Saat Değişiklik';
  const periodText=ctx.type==='monthly'?'Son 30 gün':weekly?'Son 7 gün':'Son 24 saat';
  const money=v=>v==null||Number.isNaN(Number(v))?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL';
  const fixed=d.fixed||{},fwa=d.fwa||{},fp=fixed.products||[],fw=fwa.products||[];
  const turkcell=fp.filter(x=>x.provider==='Turkcell Ev İnterneti');
  const rivals=fp.filter(x=>x.provider!=='Turkcell Ev İnterneti');
  const superbox=fw.filter(x=>x.brand==='Superbox');
  const redbox=fw.filter(x=>x.brand==='Red Box');
  const cheap=arr=>[...arr].filter(x=>x.effective_monthly_try!=null).sort((a,b)=>Number(a.effective_monthly_try)-Number(b.effective_monthly_try))[0]||null;
  const best=arr=>[...arr].filter(x=>x.mbps_per_100tl!=null).sort((a,b)=>Number(b.mbps_per_100tl)-Number(a.mbps_per_100tl))[0]||null;
  const tcBest=best(turkcell),rivalBest=best(rivals),sb=cheap(superbox),rb=cheap(redbox),op=(fixed.opportunities||[])[0];
  const fixedSignal=op
    ?((op.kktcell?.name||'Turkcell Ev İnterneti')+' ↔ '+(op.competitor?.provider||'Rakip')+' '+(op.competitor?.name||'')+' • skor farkı '+((Number(op.score_gap||0)>0?'+':'')+Number(op.score_gap||0)))
    :(periodText+' içinde yeni bir sabit internet rekabet sinyali oluşmadı.');

  return '<tr><td class="mp-pad" style="padding:0 28px 18px;">'+
    '<div style="font-size:12px;color:#001484;font-weight:900;margin-bottom:8px;">Turkcell Ev İnterneti • '+periodLabel+' Özet</div>'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+
      '<td class="mp-kpi" width="25%" style="padding-right:5px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#667399;font-weight:800;text-transform:uppercase;">Turkcell SKU</div><div style="margin-top:4px;font-size:19px;font-weight:900;color:#001484;">'+esc(turkcell.length)+'</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding:0 3px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#667399;font-weight:800;text-transform:uppercase;">Rakip SKU</div><div style="margin-top:4px;font-size:19px;font-weight:900;color:#001484;">'+esc(rivals.length)+'</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding:0 3px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#667399;font-weight:800;text-transform:uppercase;">'+esc(changeLabel)+'</div><div style="margin-top:4px;font-size:19px;font-weight:900;color:#001484;">'+esc(fixed.stats?.total||0)+'</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding-left:5px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#667399;font-weight:800;text-transform:uppercase;">En İyi Değer</div><div style="margin-top:4px;font-size:17px;font-weight:900;color:#0014f2;">'+esc(tcBest?Number(tcBest.mbps_per_100tl).toLocaleString('tr-TR',{maximumFractionDigits:2}):'—')+'</div><div style="font-size:8px;color:#667399;">Mbps / 100 TL</div></div></td>'+
    '</tr></table>'+
    '<div style="margin-top:9px;padding:11px 13px;background:#f4f8ff;border-left:4px solid #1d5aff;border-radius:9px;font-size:11px;line-height:1.55;color:#42526e;"><b style="color:#001484;">Sabit internet sinyali:</b> '+esc(fixedSignal)+
      (rivalBest?'<br>Rakip en iyi değer: <b>'+esc(rivalBest.provider+' • '+rivalBest.name)+'</b>':'')+
      (tcBest?'<br>Turkcell öne çıkan teklif: <b>'+esc(tcBest.name)+'</b> • '+esc(Number(tcBest.speed_down_mbps||0).toLocaleString('tr-TR'))+' Mbps • '+esc(money(tcBest.effective_monthly_try)):'')+
    '</div>'+
  '</td></tr>'+
  '<tr><td class="mp-pad" style="padding:0 28px 18px;">'+
    '<div style="font-size:12px;color:#001484;font-weight:900;margin-bottom:8px;">Superbox / Red Box • '+periodLabel+' Özet</div>'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+
      '<td class="mp-kpi" width="25%" style="padding-right:5px;vertical-align:top;"><div style="background:#fff9df;border:1px solid #f0df99;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#806700;font-weight:800;text-transform:uppercase;">Superbox</div><div style="margin-top:4px;font-size:19px;font-weight:900;color:#001484;">'+esc(superbox.length)+'</div><div style="font-size:8px;color:#667399;">SKU</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding:0 3px;vertical-align:top;"><div style="background:#fff9df;border:1px solid #f0df99;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#806700;font-weight:800;text-transform:uppercase;">Red Box</div><div style="margin-top:4px;font-size:19px;font-weight:900;color:#001484;">'+esc(redbox.length)+'</div><div style="font-size:8px;color:#667399;">SKU</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding:0 3px;vertical-align:top;"><div style="background:#fff9df;border:1px solid #f0df99;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#806700;font-weight:800;text-transform:uppercase;">Superbox Başlangıç</div><div style="margin-top:4px;font-size:15px;font-weight:900;color:#001484;">'+esc(sb?money(sb.effective_monthly_try):'—')+'</div></div></td>'+
      '<td class="mp-kpi" width="25%" style="padding-left:5px;vertical-align:top;"><div style="background:#fff9df;border:1px solid #f0df99;border-radius:10px;padding:10px;"><div style="font-size:8px;color:#806700;font-weight:800;text-transform:uppercase;">Red Box Başlangıç</div><div style="margin-top:4px;font-size:15px;font-weight:900;color:#001484;">'+esc(rb?money(rb.effective_monthly_try):'—')+'</div></div></td>'+
    '</tr></table>'+
    '<div style="margin-top:9px;padding:11px 13px;background:#fff8de;border-left:4px solid #ffca00;border-radius:9px;font-size:11px;line-height:1.55;color:#5d510f;"><b style="color:#001484;">FWA sinyali:</b> '+esc(periodText)+' değişiklik: <b>'+esc(fwa.stats?.total||0)+'</b>.'+
      (sb&&rb?' Efektif aylık fiyat farkı <b>'+esc(money(Number(sb.effective_monthly_try)-Number(rb.effective_monthly_try)))+'</b> (Superbox − Red Box).':'')+
      (sb?'<br>Superbox öne çıkan: <b>'+esc(sb.name)+'</b> • '+esc(money(sb.effective_monthly_try)):'')+
      (rb?'<br>Red Box öne çıkan: <b>'+esc(rb.name)+'</b> • '+esc(money(rb.effective_monthly_try)):'')+
    '</div>'+
  '</td></tr>';
}

function emailHtml(type,ctx,attachments=[]){
  if(type==='home'||type==='fwa')return homeEmailHtml(type,ctx,attachments);
  const title=REPORT_NAMES[type]||'Markets Pulse Raporu';
  const m=ctx.market||{},b=ctx.benchmark||{},s=ctx.stats||{};
  const top=(m.top_threats||[])[0];
  const scoreRows=(ctx.score_deltas||[]);
  const healthy=(ctx.sources||[]).filter(x=>String(x.last_status||'').toLowerCase()==='ok' && (!x.http_status||Number(x.http_status)<400)).length;
  const sourceCount=(ctx.sources||[]).length;
  const position=b.overall_score&&b.overall_score.score!=null?b.overall_score.score:'—';
  const pressure=m.pressure_index!=null?m.pressure_index:'—';
  const range=ctx.days===1?localDate(ctx.period_end):(localDate(ctx.period_start)+' – '+localDate(ctx.period_end));
  const attachmentList=attachments.map(a=>'<tr><td style="padding:5px 0;color:#42526e;font-size:12px;">📎 '+esc(a.filename)+'</td></tr>').join('');
  const segmentRows=scoreRows.map(x=>{
    const d=signed(x.delta),dc=pctColor(x.delta);
    return '<tr>'+
      '<td style="padding:9px 8px;border-bottom:1px solid #e7edf6;font-weight:700;color:#001484;font-size:12px;">'+esc(x.segment)+'</td>'+
      '<td style="padding:9px 8px;border-bottom:1px solid #e7edf6;text-align:center;color:#001484;font-size:12px;">'+esc(x.current==null?'—':x.current+'/100')+'</td>'+
      '<td style="padding:9px 8px;border-bottom:1px solid #e7edf6;text-align:center;font-weight:800;color:'+dc+';font-size:12px;">'+esc(d)+'</td>'+
      '<td style="padding:9px 8px;border-bottom:1px solid #e7edf6;color:#667399;font-size:11px;">'+esc(x.level||'—')+(x.current==null&&x.rationale?'<br><span style="display:block;margin-top:4px;font-size:10px;font-weight:400;line-height:1.5;">'+esc(x.rationale)+'</span>':'')+'</td>'+
    '</tr>';
  }).join('');
  const threatBlock=top?(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:#fff8de;border:1px solid #f6dc72;border-radius:12px;">'+
      '<tr><td style="padding:15px 16px;">'+
        '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8b6b00;font-weight:800;margin-bottom:5px;">ÖNCELİKLİ RAKİP HAMLESİ</div>'+
        '<div style="font-size:17px;line-height:1.3;color:#001484;font-weight:800;">'+esc(top.product_name||'Telsim hamlesi')+'</div>'+
        '<div style="margin-top:7px;font-size:12px;color:#42526e;line-height:1.55;">Tehdit skoru: <b style="color:#c7342d;">'+esc(top.threat)+'/100</b>'+
        (top.segment?' &nbsp;•&nbsp; Segment: <b>'+esc(top.segment)+'</b>':'')+
        (top.intent?' &nbsp;•&nbsp; Niyet: <b>'+esc(top.intent)+'</b>':'')+'</div>'+
        ((top.reasons||[]).length?'<div style="margin-top:7px;font-size:12px;color:#667399;">'+esc((top.reasons||[]).join(' • '))+'</div>':'')+
        '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eedb8d;font-size:12px;color:#001484;line-height:1.55;"><b>Önerilen aksiyon:</b> '+esc(top.action||'İzlemeye devam et.')+'</div>'+
      '</td></tr>'+
    '</table>'
  ):(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf9f5;border:1px solid #b9e7d7;border-radius:12px;"><tr><td style="padding:14px 16px;color:#176a54;font-size:12px;"><b>Kritik rakip hamlesi yok.</b> Dönem içinde yüksek öncelikli yeni bir Telsim hareketi tespit edilmedi.</td></tr></table>'
  );
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    emailStyles()+'</head>'+
    '<body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#001484;">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;"><tr><td align="center" style="padding:24px 12px;">'+
    '<table role="presentation" class="mp-wrap" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(0,20,132,.08);">'+
      '<tr><td style="background:#000f64;padding:0;">'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+
          '<td style="padding:22px 28px;">'+
            '<div style="font-size:26px;line-height:1;font-weight:900;letter-spacing:-1px;color:#ffffff;">Markets <span style="color:#00c2ff;">Pulse</span></div>'+
            '<div style="margin-top:6px;font-size:9px;letter-spacing:.22em;color:#b9ccff;font-weight:700;">BY TURKCELL • COMPETITIVE INTELLIGENCE</div>'+
          '</td>'+
          '<td align="right" class="mp-hide-mobile" style="padding:22px 28px;color:#dbe6ff;font-size:11px;line-height:1.5;"><b style="color:#ffffff;">'+esc(title)+'</b><br>'+esc(range)+'</td>'+
        '</tr></table>'+
        '<div style="height:4px;background:linear-gradient(90deg,#0014f2,#00c2ff,#ffca00);font-size:0;line-height:0;">&nbsp;</div>'+
      '</td></tr>'+
      '<tr><td class="mp-pad" style="padding:25px 28px 8px;">'+
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#667399;font-weight:800;">YÖNETİCİ ÖZETİ</div>'+
        '<div style="margin-top:7px;font-size:20px;line-height:1.35;color:#001484;font-weight:800;">'+esc(title)+'</div>'+
        '<div style="margin-top:8px;font-size:13px;line-height:1.65;color:#42526e;">'+esc(m.executive_summary||'Markets Pulse raporu hazırlandı.')+'</div>'+
      '</td></tr>'+
      '<tr><td class="mp-pad" style="padding:14px 28px 18px;">'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+
          '<td class="mp-kpi" width="25%" style="padding-right:6px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:12px;padding:12px;"><div style="font-size:9px;color:#667399;font-weight:800;text-transform:uppercase;">Pressure</div><div style="margin-top:4px;font-size:22px;font-weight:900;color:#0014f2;">'+esc(pressure)+'</div><div style="font-size:10px;color:#667399;">/100 • '+esc(m.pressure_level||'—')+'</div></div></td>'+
          '<td class="mp-kpi" width="25%" style="padding:0 4px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:12px;padding:12px;"><div style="font-size:9px;color:#667399;font-weight:800;text-transform:uppercase;">Position</div><div style="margin-top:4px;font-size:22px;font-weight:900;color:#001484;">'+esc(position)+'</div><div style="font-size:10px;color:#667399;">/100 • '+esc(b.overall_score?.level||'—')+'</div></div></td>'+
          '<td class="mp-kpi" width="25%" style="padding:0 4px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:12px;padding:12px;"><div style="font-size:9px;color:#667399;font-weight:800;text-transform:uppercase;">Değişiklik</div><div style="margin-top:4px;font-size:22px;font-weight:900;color:#001484;">'+esc(s.total||0)+'</div><div style="font-size:10px;color:#667399;">'+esc(s.added||0)+' yeni • '+esc(s.removed||0)+' kaldırılan</div></div></td>'+
          '<td class="mp-kpi" width="25%" style="padding-left:6px;vertical-align:top;"><div style="background:#f6f9ff;border:1px solid #dde7f6;border-radius:12px;padding:12px;"><div style="font-size:9px;color:#667399;font-weight:800;text-transform:uppercase;">Kaynak</div><div style="margin-top:4px;font-size:22px;font-weight:900;color:#00835f;">'+esc(healthy)+'</div><div style="font-size:10px;color:#667399;">'+esc(sourceCount)+' kaynaktan sağlıklı</div></div></td>'+
        '</tr></table>'+
      '</td></tr>'+
      '<tr><td class="mp-pad" style="padding:0 28px 18px;">'+threatBlock+'</td></tr>'+
      '<tr><td class="mp-pad" style="padding:0 28px 18px;">'+
        '<div style="font-size:12px;color:#001484;font-weight:800;margin-bottom:8px;">Segment Bazlı Rekabet Pozisyonu</div>'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e1e8f2;border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">'+
          '<tr style="background:#001484;"><th align="left" style="padding:9px 8px;color:#fff;font-size:10px;">Segment</th><th style="padding:9px 8px;color:#fff;font-size:10px;">Skor</th><th style="padding:9px 8px;color:#fff;font-size:10px;">Delta</th><th align="left" style="padding:9px 8px;color:#fff;font-size:10px;">Durum</th></tr>'+
          (segmentRows||'<tr><td colspan="4" style="padding:12px;color:#667399;font-size:12px;">Segment verisi bulunamadı.</td></tr>')+
        '</table><p style="font-size:11px;color:#667399">'+esc(b.methodology||'')+' '+esc(b.score_methodology||'')+' '+esc(b.history_note||'')+'</p>'+
      '</td></tr>'+
      (['daily','weekly','monthly'].includes(type)?dailyHomeEmailBlocks(ctx):'')+
      (ctx.ad_analysis_html?'<tr><td class="mp-pad" style="padding:0 28px 18px">'+ctx.ad_analysis_html+'</td></tr>':'')+
      (type==='monthly'?'<tr><td class="mp-pad" style="padding:0 28px 18px">'+monthlyOverviewHtml(ctx,{compact:true})+'</td></tr>':'')+
      '<tr><td class="mp-pad" style="padding:0 28px 18px;">'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e2e8f1;border-radius:12px;"><tr><td style="padding:14px 16px;">'+
          '<div style="font-size:11px;font-weight:800;color:#001484;margin-bottom:6px;">Ekli dosyalar</div>'+
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+(attachmentList||'<tr><td style="font-size:12px;color:#667399;">Ek bulunmuyor.</td></tr>')+'</table>'+
        '</td></tr></table>'+
      '</td></tr>'+
      '<tr><td align="center" class="mp-pad" style="padding:2px 28px 26px;">'+
        '<a href="https://www.marketspulse.cloud/#reports" style="display:inline-block;background:#0014f2;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;padding:12px 20px;border-radius:9px;">Markets Pulse Dashboard’u Aç</a>'+
        '<div style="margin-top:10px;font-size:10px;color:#8a96ad;">Detaylı PDF raporu bu e-postanın ekinde bulabilirsiniz.</div>'+
      '</td></tr>'+
      '<tr><td style="background:#f4f7fb;border-top:1px solid #e3e9f2;padding:16px 28px;">'+
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:10px;line-height:1.5;color:#7b89a5;">Bu e-posta Markets Pulse tarafından otomatik oluşturulmuştur.<br><span style="color:#001484;font-weight:700;">Daha fazla veri • Daha güçlü kararlar</span></td><td align="right" class="mp-hide-mobile" style="font-size:10px;color:#7b89a5;">noreply@marketspulse.cloud</td></tr></table>'+
      '</td></tr>'+
    '</table></td></tr></table></body></html>';
}
export async function sendReportEmail(pool,type,options={}){
  await refreshReportRecipients(pool);
  const mail=transportConfig();
  const recipientEmails=mail.status.recipient_emails||[];
  let attachments=[],ctx,totalBytes=0;
  if(type==='evidence'){
    const [pack,summary]=await Promise.all([
      generateEvidencePack(pool,{days:options.days||7}),
      generateReportPdf(pool,'telsim7',{days:options.days||7})
    ]);
    ctx=pack.ctx;
    attachments.push({filename:summary.fileName,content:summary.buffer,contentType:summary.contentType});
    attachments.push({filename:pack.fileName,content:pack.buffer,contentType:pack.contentType});
    totalBytes+=summary.buffer.length+pack.buffer.length;
  }else if(type==='weekly'){
    const weekly=await generateReportPdf(pool,'weekly',{days:7}),seven=await generateReportPdf(pool,'telsim7',{days:7});
    ctx=weekly.ctx;
    attachments.push({filename:weekly.fileName,content:weekly.buffer,contentType:weekly.contentType});
    attachments.push({filename:seven.fileName,content:seven.buffer,contentType:seven.contentType});
    totalBytes+=weekly.buffer.length+seven.buffer.length;
  }else{
    const pdf=await generateReportPdf(pool,type,{days:reportDays(type,options.days)});ctx=pdf.ctx;
    attachments.push({filename:pdf.fileName,content:pdf.buffer,contentType:pdf.contentType});totalBytes+=pdf.buffer.length;
  }
  const maxBytes=mail.status.max_attachment_mb*1024*1024;
  if(totalBytes>maxBytes){const e=new Error('E-posta eki '+(totalBytes/1024/1024).toFixed(1)+' MB; limit '+mail.status.max_attachment_mb+' MB.');e.code='ATTACHMENT_TOO_LARGE';throw e;}
  const subject='Markets Pulse | '+(REPORT_NAMES[type]||type)+' | '+localDate(ctx.period_end);
  let info;
  if(mail.status.api_configured){
    info=await sendViaBrevoApi({
      status:mail.status,subject,
      textContent:type==='monthly'?monthlyPlainText(ctx):(ctx.market?.executive_summary||(type==='fwa'?'Markets Pulse Superbox / Red Box rekabet raporu':'Markets Pulse Turkcell Ev İnterneti rekabet raporu')),
      htmlContent:emailHtml(type,ctx,attachments),
      attachments
    });
  }else{
    console.log('[report-email] smtp connecting',JSON.stringify({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),from:mail.status.from,recipients:recipientEmails.length,subject,total_bytes:totalBytes}));
    info=await mail.transport.sendMail({
      from:mail.status.from,to:recipientEmails.join(', '),subject,
      text:type==='monthly'?monthlyPlainText(ctx):(ctx.market?.executive_summary||(type==='fwa'?'Markets Pulse Superbox / Red Box rekabet raporu':'Markets Pulse Turkcell Ev İnterneti rekabet raporu')),html:emailHtml(type,ctx,attachments),attachments
    });
    console.log('[report-email] smtp accepted',JSON.stringify({message_id:info.messageId,accepted_count:Array.isArray(info.accepted)?info.accepted.length:null,rejected_count:Array.isArray(info.rejected)?info.rejected.length:null,response:info.response}));
  }
  const count=recipientEmails.length;
  return {message_id:info.messageId,recipients:[count+' kişi'],recipient_count:count,subject,total_bytes:totalBytes,ctx,delivery_mode:mail.status.delivery_mode};
}
