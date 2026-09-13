import nodemailer from 'nodemailer';
import { REPORT_NAMES, REPORT_TZ } from './report-data.js';
import { generateReportPdf } from './report-render.js';
import { generateEvidencePack } from './evidence-pack.js';

function parseList(v){return String(v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean);}
function localDate(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

export function getReportEmailStatus(){
  const recipients=parseList(process.env.REPORT_EMAIL_TO);
  const configured=Boolean(process.env.SMTP_HOST&&process.env.REPORT_EMAIL_FROM&&recipients.length);
  return {
    configured,recipients,from:process.env.REPORT_EMAIL_FROM||null,smtp_host:process.env.SMTP_HOST||null,
    daily_cron:process.env.REPORT_DAILY_CRON||'0 8 * * *',
    weekly_cron:process.env.REPORT_WEEKLY_CRON||'15 8 * * 1',
    timezone:REPORT_TZ,max_attachment_mb:Number(process.env.REPORT_EMAIL_MAX_MB||18)
  };
}
function transportConfig(){
  const status=getReportEmailStatus();
  if(!status.configured){const e=new Error('E-posta yapılandırılmadı. SMTP_HOST, REPORT_EMAIL_FROM ve REPORT_EMAIL_TO gerekli.');e.code='EMAIL_NOT_CONFIGURED';throw e;}
  const port=Number(process.env.SMTP_PORT||587);
  const cfg={host:process.env.SMTP_HOST,port,secure:String(process.env.SMTP_SECURE||'').toLowerCase()==='true'||port===465,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,requireTLS:port===587};
  if(process.env.SMTP_USER)cfg.auth={user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''};
  return {status,transport:nodemailer.createTransport(cfg)};
}
function emailHtml(type,ctx){
  const title=REPORT_NAMES[type]||'Markets Pulse Raporu',top=(ctx.market.top_threats||[])[0];
  return '<div style="font-family:Arial,sans-serif;color:#001484"><h2 style="margin-bottom:4px">'+esc(title)+'</h2><p style="color:#667399">Markets Pulse by Turkcell</p><p><b>Competitive Pressure:</b> '+esc(ctx.market.pressure_index)+'/100 • <b>Competitive Position:</b> '+esc(ctx.benchmark.overall_score&&ctx.benchmark.overall_score.score!=null?ctx.benchmark.overall_score.score+'/100':'—')+'</p><p>'+esc(ctx.market.executive_summary)+'</p>'+(top?'<p><b>Öncelikli hamle:</b> '+esc(top.product_name)+' ('+esc(top.threat)+'/100)<br><b>Öneri:</b> '+esc(top.action)+'</p>':'')+'<p style="color:#667399;font-size:12px">Detaylı rapor ektedir.</p></div>';
}
export async function sendReportEmail(pool,type,options={}){
  const mail=transportConfig();
  let attachments=[],ctx,totalBytes=0;
  if(type==='evidence'){
    const pack=await generateEvidencePack(pool,{days:options.days||7});ctx=pack.ctx;
    attachments.push({filename:pack.fileName,content:pack.buffer,contentType:pack.contentType});totalBytes+=pack.buffer.length;
  }else if(type==='weekly'){
    const weekly=await generateReportPdf(pool,'weekly',{days:7}),seven=await generateReportPdf(pool,'telsim7',{days:7});
    ctx=weekly.ctx;
    attachments.push({filename:weekly.fileName,content:weekly.buffer,contentType:weekly.contentType});
    attachments.push({filename:seven.fileName,content:seven.buffer,contentType:seven.contentType});
    totalBytes+=weekly.buffer.length+seven.buffer.length;
  }else{
    const pdf=await generateReportPdf(pool,type,{days:options.days||(type==='daily'?1:7)});ctx=pdf.ctx;
    attachments.push({filename:pdf.fileName,content:pdf.buffer,contentType:pdf.contentType});totalBytes+=pdf.buffer.length;
  }
  const maxBytes=mail.status.max_attachment_mb*1024*1024;
  if(totalBytes>maxBytes){const e=new Error('E-posta eki '+(totalBytes/1024/1024).toFixed(1)+' MB; limit '+mail.status.max_attachment_mb+' MB.');e.code='ATTACHMENT_TOO_LARGE';throw e;}
  const subject='Markets Pulse - '+(REPORT_NAMES[type]||type)+' - '+localDate(ctx.period_end);
  console.log('[report-email] connecting',JSON.stringify({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),from:mail.status.from,recipients:mail.status.recipients.length,subject,total_bytes:totalBytes}));
  const info=await mail.transport.sendMail({
    from:mail.status.from,to:mail.status.recipients.join(', '),subject,
    text:ctx.market.executive_summary,html:emailHtml(type,ctx),attachments
  });
  console.log('[report-email] accepted',JSON.stringify({message_id:info.messageId,accepted:info.accepted,rejected:info.rejected,response:info.response}));
  return {message_id:info.messageId,recipients:mail.status.recipients,subject,total_bytes:totalBytes,ctx};
}
