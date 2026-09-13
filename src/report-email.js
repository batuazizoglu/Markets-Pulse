import nodemailer from 'nodemailer';
import { REPORT_NAMES, REPORT_TZ } from './report-data.js';
import { generateReportPdf } from './report-render.js';
import { generateEvidencePack } from './evidence-pack.js';

function parseList(v){return String(v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean);}
function localDate(v=new Date()){return new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

export function getReportEmailStatus(){
  const recipients=parseList(process.env.REPORT_EMAIL_TO);
  const apiConfigured=Boolean(process.env.BREVO_API_KEY&&process.env.REPORT_EMAIL_FROM&&recipients.length);
  const smtpConfigured=Boolean(process.env.SMTP_HOST&&process.env.REPORT_EMAIL_FROM&&recipients.length);
  const configured=apiConfigured||smtpConfigured;
  return {
    configured,api_configured:apiConfigured,smtp_configured:smtpConfigured,
    delivery_mode:apiConfigured?'brevo-api':smtpConfigured?'smtp':'none',
    recipients,from:process.env.REPORT_EMAIL_FROM||null,smtp_host:process.env.SMTP_HOST||null,
    daily_cron:process.env.REPORT_DAILY_CRON||'0 8 * * *',
    weekly_cron:process.env.REPORT_WEEKLY_CRON||'15 8 * * 1',
    timezone:REPORT_TZ,max_attachment_mb:Number(process.env.REPORT_EMAIL_MAX_MB||18)
  };
}
function transportConfig(){
  const status=getReportEmailStatus();
  if(!status.configured){const e=new Error('E-posta yapılandırılmadı. REPORT_EMAIL_FROM, REPORT_EMAIL_TO ve BREVO_API_KEY (önerilen) veya SMTP ayarları gerekli.');e.code='EMAIL_NOT_CONFIGURED';throw e;}
  if(status.api_configured) return {status,transport:null};
  const port=Number(process.env.SMTP_PORT||587);
  const cfg={host:process.env.SMTP_HOST,port,secure:String(process.env.SMTP_SECURE||'').toLowerCase()==='true'||port===465,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,requireTLS:port===587};
  if(process.env.SMTP_USER)cfg.auth={user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''};
  return {status,transport:nodemailer.createTransport(cfg)};
}

function parseSender(v){
  const raw=String(v||'').trim();
  const m=raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if(m) return {name:m[1].replace(/^["']|["']$/g,'').trim()||'Markets Pulse',email:m[2].trim()};
  return {name:'Markets Pulse',email:raw};
}

async function sendViaBrevoApi({status,subject,textContent,htmlContent,attachments}){
  const sender=parseSender(status.from);
  const body={
    sender,
    to:status.recipients.map(email=>({email})),
    subject,
    htmlContent,
    textContent,
    attachment:attachments.map(a=>({name:a.filename,content:Buffer.from(a.content).toString('base64')}))
  };
  console.log('[report-email] brevo-api connecting',JSON.stringify({from:sender.email,recipients:status.recipients.length,subject,attachments:attachments.length}));
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
  return {messageId:payload.messageId||null,accepted:status.recipients,rejected:[],response:'Brevo API '+response.status};
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
  let info;
  if(mail.status.api_configured){
    info=await sendViaBrevoApi({
      status:mail.status,subject,
      textContent:ctx.market.executive_summary,
      htmlContent:emailHtml(type,ctx),
      attachments
    });
  }else{
    console.log('[report-email] smtp connecting',JSON.stringify({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),from:mail.status.from,recipients:mail.status.recipients.length,subject,total_bytes:totalBytes}));
    info=await mail.transport.sendMail({
      from:mail.status.from,to:mail.status.recipients.join(', '),subject,
      text:ctx.market.executive_summary,html:emailHtml(type,ctx),attachments
    });
    console.log('[report-email] smtp accepted',JSON.stringify({message_id:info.messageId,accepted:info.accepted,rejected:info.rejected,response:info.response}));
  }
  return {message_id:info.messageId,recipients:mail.status.recipients,subject,total_bytes:totalBytes,ctx,delivery_mode:mail.status.delivery_mode};
}
