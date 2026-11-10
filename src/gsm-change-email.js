import {createHash} from 'crypto';
import {loadCompetitiveChanges} from './competitive-changes.js';
import {REPORT_TZ} from './report-data.js';

const APP_URL='https://www.marketspulse.cloud/#competitor';
const MAX_ATTEMPTS=6;

const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
const esc=value=>clean(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clip=(value,max=150)=>{const text=clean(value);return text.length>max?text.slice(0,max-1)+'…':text};
const localTime=value=>new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const localDateTime=value=>new Intl.DateTimeFormat('tr-TR',{timeZone:REPORT_TZ,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));

function numeric(value){
  const number=Number(String(value??'').replace(',','.'));
  return Number.isFinite(number)?number:null;
}
function terms(value){
  if(value==null||value==='')return '—';
  try{
    const parsed=typeof value==='string'?JSON.parse(value):value;
    if(Array.isArray(parsed))return clip(parsed.map(clean).filter(Boolean).join(' · '));
    if(parsed&&typeof parsed==='object')return clip(Object.values(parsed).map(clean).filter(Boolean).join(' · '));
  }catch{}
  return clip(value);
}
export function gsmChangeValue(row,value){
  if(value==null||value==='')return '—';
  const field=clean(row?.field_name),number=numeric(value);
  if(field==='Ek Fayda / Koşul')return terms(value);
  if(number!=null&&field==='Fiyat')return number.toLocaleString('tr-TR',{maximumFractionDigits:2})+' TL';
  if(number!=null&&['Data','Bonus Data'].includes(field))return number.toLocaleString('tr-TR',{maximumFractionDigits:2})+' GB';
  if(number!=null&&['Ada İçi + TR Dakika','Uluslararası Dakika'].includes(field))return number.toLocaleString('tr-TR',{maximumFractionDigits:0})+' dk';
  if(number!=null&&field==='SMS')return number.toLocaleString('tr-TR',{maximumFractionDigits:0})+' SMS';
  if(number!=null&&['Geçerlilik (gün)','Red Pasaport (gün)'].includes(field))return number.toLocaleString('tr-TR',{maximumFractionDigits:0})+' gün';
  return clip(value);
}
export function gsmChangePresentation(row){
  if(row.change_type==='added')return {label:'Yeni paket',before:'—',after:clip(row.product_name||row.new_value||'Paket yayına alındı')};
  if(row.change_type==='removed')return {label:'Paket kaldırıldı',before:clip(row.product_name||row.old_value||'Paket'),after:'Yayında değil'};
  return {label:clip(row.field_name||'Paket bilgisi'),before:gsmChangeValue(row,row.old_value),after:gsmChangeValue(row,row.new_value)};
}
function summary(rows){
  return {
    changes:rows.length,
    products:new Set(rows.map(row=>row.product_id==null?'event:'+row.id:'product:'+row.product_id)).size,
    sources:new Set(rows.map(row=>row.source_id)).size
  };
}
export function gsmChangeSubject(rows){
  const counts=summary(rows),stamp=localTime(rows.at(-1)?.detected_at||new Date());
  return `Markets Pulse | GSM | ${counts.changes} değişiklik | ${stamp}`;
}
export function gsmChangeEmailHtml(rows){
  const counts=summary(rows),latest=rows.at(-1)?.detected_at||new Date();
  const body=rows.map(row=>{
    const view=gsmChangePresentation(row);
    const color=row.severity==='critical'?'#c7342d':row.severity==='high'?'#8a5200':'#315aca';
    const severity=row.severity==='critical'?'Kritik':row.severity==='high'?'Önemli':'Bilgi';
    const mobileLabel=label=>`<span class="gsm-mobile-label" style="display:none;font-size:12px;line-height:1.4;font-weight:700;text-transform:uppercase;color:#667399;">${label}</span>`;
    return `<tr class="gsm-change-row"><td class="gsm-time" style="padding:12px 8px;border-bottom:1px solid #e5eaf2;border-left:4px solid ${color};vertical-align:top;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:#001484;">${mobileLabel('Saat')}${esc(localTime(row.detected_at))}</td><td style="padding:12px 8px;border-bottom:1px solid #e5eaf2;vertical-align:top;font-size:12px;line-height:1.5;color:#13213c;">${mobileLabel('Paket')}<b>${esc(row.product_name||'Paket')}</b><br><span style="color:#667399;">${esc(row.source_name||'Kaynak')}</span></td><td style="padding:12px 8px;border-bottom:1px solid #e5eaf2;vertical-align:top;font-size:12px;line-height:1.5;color:#13213c;">${mobileLabel('Değişiklik')}${esc(view.label)}<br><span style="color:${color};font-size:12px;font-weight:700;">${severity}</span></td><td style="padding:12px 8px;border-bottom:1px solid #e5eaf2;vertical-align:top;font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;color:#13213c;">${mobileLabel('Önce → Sonra')}<span style="color:#667399;">${esc(view.before)}</span><br><b style="color:#001484;">→ ${esc(view.after)}</b></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GSM değişiklik bildirimi</title><style>body{margin:0;padding:0}table{max-width:100%}td,th{overflow-wrap:anywhere}@media only screen and (max-width:520px){.mp-wrap{width:100%!important}.mp-pad{padding-left:14px!important;padding-right:14px!important}.gsm-table{border:0!important}.gsm-table thead{display:none!important}.gsm-table tbody,.gsm-change-row,.gsm-change-row td{display:block!important;width:100%!important;box-sizing:border-box!important}.gsm-change-row{margin:0 0 12px!important;border:1px solid #dfe6f0!important;border-radius:9px!important;overflow:hidden!important}.gsm-change-row td{padding:9px 12px!important;border-bottom:0!important}.gsm-change-row .gsm-time{padding-top:11px!important;background:#f6f9ff!important}.gsm-mobile-label{display:block!important;margin-bottom:3px!important}}</style></head><body style="margin:0;padding:0;background:#f1f5fa;font-family:Arial,Helvetica,sans-serif;color:#13213c;"><div style="display:none!important;max-height:0;overflow:hidden;opacity:0;">${esc(`${counts.changes} doğrulanmış GSM değişikliği kaydedildi.`)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f1f5fa;"><tr><td align="center" style="padding:20px 8px;"><table role="presentation" class="mp-wrap" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#fff;border-radius:14px;overflow:hidden;table-layout:fixed;"><tr><td class="mp-pad" style="padding:22px 26px;background:#000f64;border-bottom:4px solid #00c2ff;"><div style="font-size:24px;font-weight:800;color:#fff;">Markets <span style="color:#00c2ff;">Pulse</span></div><div style="margin-top:7px;font-size:13px;color:#d1e4ff;">GSM Değişiklik Bildirimi</div></td></tr><tr><td class="mp-pad" style="padding:22px 26px 14px;"><h1 style="margin:0;font-size:22px;line-height:1.35;color:#001484;">${esc(`${counts.changes} doğrulanmış değişiklik`)}</h1><p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:#42526e;">${esc(`${counts.products} paket · ${counts.sources} kaynak · ${localDateTime(latest)} (KKTC)`)}</p></td></tr><tr><td class="mp-pad" style="padding:0 26px 20px;"><table role="table" aria-label="GSM değişiklik zaman çizelgesi" class="gsm-table" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border:1px solid #dfe6f0;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;"><thead><tr style="background:#eef4ff;"><th scope="col" width="12%" align="left" style="padding:9px 8px;font-size:12px;color:#52627d;">Saat</th><th scope="col" width="29%" align="left" style="padding:9px 8px;font-size:12px;color:#52627d;">Paket</th><th scope="col" width="22%" align="left" style="padding:9px 8px;font-size:12px;color:#52627d;">Değişiklik</th><th scope="col" width="37%" align="left" style="padding:9px 8px;font-size:12px;color:#52627d;">Önce → Sonra</th></tr></thead><tbody>${body}</tbody></table></td></tr><tr><td class="mp-pad" style="padding:0 26px 22px;"><a href="${APP_URL}" style="display:inline-block;padding:13px 18px;background:#0014f2;border-radius:7px;color:#fff;text-decoration:none;font-size:13px;font-weight:700;">GSM timeline’ını aç</a><p style="margin:14px 0 0;font-size:12px;line-height:1.55;color:#667399;">Bu bildirim tarama tamamlanır tamamlanmaz gönderildi. Erişim veya parser hataları değişiklik sayılmaz; kaldırılan paketler iki ardışık kontrolden sonra bildirilir.</p></td></tr></table></td></tr></table></body></html>`;
}
export function gsmChangePlainText(rows){
  const counts=summary(rows),latest=rows.at(-1)?.detected_at||new Date();
  const lines=['Markets Pulse · GSM Değişiklik Bildirimi',`${counts.changes} doğrulanmış değişiklik · ${counts.products} paket · ${counts.sources} kaynak`,`${localDateTime(latest)} (KKTC)`,'','SAAT | PAKET | DEĞİŞİKLİK | ÖNCE → SONRA'];
  for(const row of rows){const view=gsmChangePresentation(row);lines.push(`${localTime(row.detected_at)} | ${clean(row.source_name)} · ${clean(row.product_name||'Paket')} | ${view.label} | ${view.before} → ${view.after}`)}
  lines.push('','Erişim veya parser hataları değişiklik sayılmaz; kaldırılan paketler iki ardışık kontrolden sonra bildirilir.',`GSM timeline: ${APP_URL}`);
  return lines.join('\n');
}
function batchKey(rows){
  const ids=rows.map(row=>String(row.id)).sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
  return 'gsm-'+createHash('sha256').update(ids.join(',')).digest('hex').slice(0,32);
}
function ids(values){return [...new Set((values||[]).map(value=>String(value)).filter(value=>/^\d+$/.test(value)))];}

export async function queueGsmChangeNotification(pool,scanIds,{trigger='scheduled',now=new Date()}={}){
  const scans=ids(scanIds);
  if(!scans.length)return {status:'no_scans',queued:false,change_count:0};
  const rows=await loadCompetitiveChanges(pool,{scanIds:scans,end:new Date(+new Date(now)+60000)});
  if(!rows.length)return {status:'no_changes',queued:false,change_count:0,scan_ids:scans};
  const key=batchKey(rows),changeIds=rows.map(row=>String(row.id));
  const inserted=await pool.query(`INSERT INTO gsm_change_notifications(batch_key,scan_ids,change_ids,trigger_type,status,next_attempt_at)
    VALUES($1,$2::bigint[],$3::bigint[],$4,'pending',$5)
    ON CONFLICT(batch_key) DO NOTHING RETURNING batch_key,status`,[key,scans,changeIds,trigger,new Date(now).toISOString()]);
  if(inserted.rows.length)return {status:'pending',queued:true,batch_key:key,change_count:rows.length,scan_ids:scans};
  const existing=(await pool.query('SELECT status FROM gsm_change_notifications WHERE batch_key=$1',[key])).rows[0];
  return {status:existing?.status||'existing',queued:false,batch_key:key,change_count:rows.length,scan_ids:scans};
}

export async function queueUnnotifiedGsmChanges(pool,{trigger='recovery',now=new Date(),limit=100}={}){
  const at=new Date(now),result=await pool.query(`SELECT DISTINCT c.scan_id
    FROM changes c CROSS JOIN gsm_change_notification_state state
    WHERE state.id=1 AND c.detected_at>=state.reconcile_after AND c.detected_at<$1
      AND NOT EXISTS (SELECT 1 FROM gsm_change_notifications notification WHERE c.id=ANY(notification.change_ids))
    ORDER BY c.scan_id LIMIT $2`,[new Date(+at+60000).toISOString(),Math.max(1,Math.min(500,Number(limit)||100))]);
  const scanIds=result.rows.map(row=>row.scan_id);
  return scanIds.length?queueGsmChangeNotification(pool,scanIds,{trigger,now:at}):{status:'no_changes',queued:false,change_count:0,scan_ids:[]};
}

async function notificationRows(pool,notification,now){
  const rows=await loadCompetitiveChanges(pool,{scanIds:notification.scan_ids,end:new Date(+new Date(now)+60000)}),wanted=new Set(notification.change_ids.map(String));
  return rows.filter(row=>wanted.has(String(row.id))).sort((a,b)=>{
    const time=+new Date(a.detected_at)-+new Date(b.detected_at);
    if(time)return time;
    return BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
  });
}
export async function deliverGsmChangeNotification(pool,key,{sendEmail,now=new Date()}={}){
  if(typeof sendEmail!=='function')throw new TypeError('sendEmail is required');
  const claimed=(await pool.query(`UPDATE gsm_change_notifications SET status='sending',claimed_at=$2,attempt_count=attempt_count+1,updated_at=$2
    WHERE batch_key=$1 AND status='pending' AND next_attempt_at<=$2 RETURNING *`,[key,new Date(now).toISOString()])).rows[0];
  if(!claimed){
    const current=(await pool.query('SELECT status,attempt_count,sent_at,last_error FROM gsm_change_notifications WHERE batch_key=$1',[key])).rows[0];
    return current?{batch_key:key,...current,delivered:false}:{batch_key:key,status:'missing',delivered:false};
  }
  let rows=[],subject,htmlContent,textContent,sent;
  try{
    rows=await notificationRows(pool,claimed,now);
    if(!rows.length){const error=new Error('CHANGE_ROWS_MISSING');error.code='CHANGE_ROWS_MISSING';throw error;}
    subject=gsmChangeSubject(rows);htmlContent=gsmChangeEmailHtml(rows);textContent=gsmChangePlainText(rows);
    sent=await sendEmail(pool,{subject,textContent,htmlContent,headers:{'X-Markets-Pulse-Type':'gsm-change','X-Markets-Pulse-Batch':key}});
  }catch(error){
    const attempts=Number(claimed.attempt_count)||1,terminal=attempts>=MAX_ATTEMPTS;
    const retrySeconds=Math.min(1800,60*2**Math.max(0,attempts-1)),next=new Date(+new Date(now)+retrySeconds*1000);
    await pool.query(`UPDATE gsm_change_notifications SET status=$2,next_attempt_at=$3,last_error=$4,updated_at=$5 WHERE batch_key=$1`,[key,terminal?'failed':'pending',next.toISOString(),clip(error?.message||String(error),500),new Date(now).toISOString()]);
    const periodStart=rows[0]?.detected_at||claimed.created_at,periodEnd=rows.at(-1)?.detected_at||claimed.created_at;
    if(terminal)await pool.query(`INSERT INTO report_runs(report_type,period_start,period_end,trigger_type,delivery_status,error,meta_json)
      VALUES('gsm-change',$1,$2,$3,'error',$4,$5::jsonb)`,[periodStart,periodEnd,claimed.trigger_type,clip(error?.message||String(error),500),JSON.stringify({batch_key:key,scan_ids:claimed.scan_ids,change_count:claimed.change_ids.length,attempts})]);
    return {batch_key:key,status:terminal?'failed':'pending',delivered:false,attempt_count:attempts,next_attempt_at:next.toISOString(),error:clip(error?.message||String(error),500)};
  }
  const sentAt=new Date(now).toISOString();
  await pool.query(`UPDATE gsm_change_notifications SET status='sent',sent_at=$2,recipient_count=$3,subject=$4,message_id=$5,last_error=NULL,updated_at=$2
    WHERE batch_key=$1`,[key,sentAt,sent.recipient_count||0,sent.subject||subject,sent.message_id||null]);
  const periodStart=rows[0].detected_at,periodEnd=rows.at(-1).detected_at;
  try{
    await pool.query(`INSERT INTO report_runs(report_type,period_start,period_end,trigger_type,delivery_status,recipients,sent_at,file_size_bytes,meta_json)
      VALUES('gsm-change',$1,$2,$3,'sent',$4,$5,$6,$7::jsonb)`,[periodStart,periodEnd,claimed.trigger_type,sent.recipients||[(sent.recipient_count||0)+' kişi'],sentAt,sent.total_bytes||null,JSON.stringify({batch_key:key,scan_ids:claimed.scan_ids,change_count:rows.length,subject:sent.subject||subject,message_id:sent.message_id||null})]);
  }catch(error){console.error('[gsm-change-email] delivery history logging failed',error?.message||String(error))}
  return {batch_key:key,status:'sent',delivered:true,change_count:rows.length,recipient_count:sent.recipient_count||0,subject:sent.subject||subject,message_id:sent.message_id||null};
}

// A confirmed HTTP 400 empty-attachment rejection was never accepted by Brevo.
// Repair only that failure once; do not replay sent, ambiguous or unrelated failures.
export async function recoverEmptyAttachmentNotifications(pool,{now=new Date()}={}){
  const result=await pool.query(`UPDATE gsm_change_notifications
    SET status='pending',attempt_count=0,next_attempt_at=$1,claimed_at=NULL,
      attachment_repair_applied=TRUE,updated_at=$1
    WHERE status IN ('failed','pending') AND attachment_repair_applied=FALSE
      AND sent_at IS NULL AND message_id IS NULL
      AND last_error LIKE 'Brevo API gönderim hatası (400):%'
      AND last_error ILIKE '%attachment%' AND last_error ILIKE '%empty%'
    RETURNING batch_key,change_ids`,[new Date(now).toISOString()]);
  return result.rows.map(row=>({batch_key:row.batch_key,change_count:row.change_ids.length}));
}

export async function deliverPendingGsmChangeNotifications(pool,{sendEmail,now=new Date(),limit=3}={}){
  const at=new Date(now),stale=new Date(+at-20*60000);
  await pool.query(`UPDATE gsm_change_notifications SET status='pending',next_attempt_at=$1,updated_at=$1
    WHERE status='sending' AND claimed_at<$2`,[at.toISOString(),stale.toISOString()]);
  const pending=(await pool.query(`SELECT batch_key FROM gsm_change_notifications
    WHERE status='pending' AND next_attempt_at<=$1 ORDER BY created_at LIMIT $2`,[at.toISOString(),Math.max(1,Math.min(10,Number(limit)||3))])).rows;
  const results=[];
  for(const row of pending)results.push(await deliverGsmChangeNotification(pool,row.batch_key,{sendEmail,now:at}));
  return results;
}
