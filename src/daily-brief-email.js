import { buildDailyBrief } from './daily-brief.js';

const APP = 'https://www.marketspulse.cloud/';
const REPORTS = `${APP}#reports`;
const MEDIA = /^https:\/\/www\.marketspulse\.cloud\/report-media\/[a-f0-9]{64}\.jpg$/;
const COLORS = { navy:'#001484', ink:'#24344d', muted:'#53637a', cyan:'#007b9a', line:'#dce5f1' };
const EMAIL_BYTE_BUDGET = 90 * 1024;
const LONG_CHANGE_NOTE = 'Uzun alan metinleri e-postada gösterilmiyor. Önceki ve yeni koşulların tamamını değişiklik ayrıntılarında inceleyin.';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function list(value) { return Array.isArray(value) ? value : []; }
function clean(value) { return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim(); }
function safeUrl(value) {
  const raw = clean(value);
  if (!raw || raw.length>2048 || /[\r\n\t]/.test(raw)) return '';
  try {
    const url = new URL(raw);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function domainLabel(value) {
  const key = clean(value).toLowerCase();
  return ({gsm:'GSM',mnp:'Numara Taşıma',home:'Ev İnterneti',fixed:'Ev İnterneti',home_internet:'Ev İnterneti',fwa:'Superbox / Red Box',ads:'Reklam'})[key] || clean(value) || 'Pazar';
}
function detailUrl(item) {
  const supplied = safeUrl(item?.detail_url);
  if (supplied && new URL(supplied).origin === new URL(APP).origin) return supplied;
  const domain = clean(item?.domain).toLowerCase();
  return `${APP}#${item?.kind === 'ad' || domain === 'ads' ? 'ads' : /home|fixed|fwa|ev.internet/i.test(domain) ? 'home' : 'competitor'}`;
}
function date(value, time=false) {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {timeZone:'Asia/Famagusta',day:'2-digit',month:'long',...(time?{hour:'2-digit',minute:'2-digit'}:{year:'numeric'})}).format(parsed);
}
function money(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString('tr-TR',{maximumFractionDigits:2})} TL` : '';
}
function expiryDate(item) {
  if (item.date_only || item.expires_precision === 'date') {
    const text = date(item.expires_at).replace(/\s+\d{4}$/, '');
    return text ? `${text} (gün sonu)` : '';
  }
  return date(item.expires_at,true);
}
function comparisonDelta(comparison) {
  const difference = comparison.difference;
  if (difference === null || difference === undefined || !Number.isFinite(Number(difference))) return '';
  return Number(difference) === 0 ? 'Karşılaştırılan paket bedelleri eşit.'
    : `Turkcell paket bedeli ${money(Math.abs(Number(difference)))} daha ${Number(difference)>0?'yüksek':'düşük'}.`;
}
function sourceLinks(item, dashboardLabel='Ayrıntıları aç') {
  const source = safeUrl(item?.source_url);
  return `<div style="margin-top:14px;font-size:14px;line-height:1.6;">${source ? `<a href="${esc(source)}" style="color:${COLORS.cyan};text-decoration:underline;">Kaynağı aç</a><span style="color:#8793a5;"> &nbsp;·&nbsp; </span>` : ''}<a href="${esc(detailUrl(item))}" style="color:${COLORS.navy};text-decoration:underline;">${esc(dashboardLabel)}</a></div>`;
}
function flagsHtml(flags) {
  const values = [...new Set(list(flags).map(clean).filter(Boolean))];
  return values.length ? `<div style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#6b5100;">${values.map(flag=>`<span style="display:inline-block;margin:0 5px 5px 0;padding:3px 8px;background:#fff5c9;border:1px solid #e9d98b;border-radius:5px;">${esc(flag)}</span>`).join('')}</div>` : '';
}
function paragraph(label, value, className='') {
  return clean(value) ? `<div${className ? ` class="${className}"` : ''} style="margin-top:10px;font-size:15px;line-height:1.6;color:${COLORS.ink};"><b style="color:${COLORS.navy};">${esc(label)}:</b> ${esc(value)}</div>` : '';
}
function changePresentation(changes, compact=false) {
  const rows=list(changes);
  const bytes=Buffer.byteLength(rows.map(row=>esc(row.label)+esc(row.before)+esc(row.after)).join(''),'utf8');
  if (bytes<=(compact?1800:7000)) return {rows,compact:false};
  return {compact:true,rows:rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    if (!['before','after'].includes(key)) return [key,value];
    return [key,Buffer.byteLength(esc(value),'utf8')>(compact?250:700)?'Uzun metin · ayrıntıda':value];
  })))};
}
function changesHtml(changes, compact=false) {
  if (!list(changes).length) return '';
  const presentation=changePresentation(changes,compact);
  changes=presentation.rows;
  return `${presentation.compact ? `<p class="brief-long-changes" style="margin:12px 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">${LONG_CHANGE_NOTE}</p>` : ''}<table class="brief-change-table" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px;line-height:1.55;"><thead><tr><th align="left" scope="col" width="28%" style="padding:8px 7px;background:#f1f5fa;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;">Değişen</th><th align="left" scope="col" width="34%" style="padding:8px 7px;background:#f1f5fa;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;">Önce</th><th align="left" scope="col" width="38%" style="padding:8px 7px;background:#e9f7fa;border-bottom:1px solid ${COLORS.line};color:#005f76;font-size:14px;">Şimdi</th></tr></thead><tbody>${changes.map(change=>`<tr><th scope="row" align="left" style="vertical-align:top;padding:9px 7px;border-bottom:1px solid ${COLORS.line};font-size:14px;font-weight:600;overflow-wrap:anywhere;">${esc(change.label)}</th><td style="vertical-align:top;padding:9px 7px;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;overflow-wrap:anywhere;">${esc(change.before || '—')}</td><td style="vertical-align:top;padding:9px 7px;border-bottom:1px solid ${COLORS.line};color:#005f76;font-size:14px;font-weight:700;overflow-wrap:anywhere;">${esc(change.after || '—')}</td></tr>`).join('')}</tbody></table>`;
}
function comparisonHtml(comparison) {
  if (!comparison) return '';
  const price = money(comparison.price), rivalPrice = money(comparison.competitor_price);
  const delta = comparisonDelta(comparison);
  const source = safeUrl(comparison.source_url);
  return `<div class="brief-comparison" style="margin-top:14px;padding:14px;background:#eef5ff;border-left:3px solid #315aca;border-radius:6px;font-size:14px;line-height:1.6;"><div style="font-weight:700;color:${COLORS.navy};font-size:14px;">Bizim karşılığımız</div>${clean(comparison.period_label) ? `<div style="margin-top:4px;color:${COLORS.muted};font-size:14px;">${esc(comparison.period_label)}</div>` : ''}<div style="margin-top:5px;color:${COLORS.ink};font-size:15px;"><b>${esc(comparison.brand || 'Kuzey Kıbrıs Turkcell')} · ${esc(comparison.title)}</b>${price ? `<br>Turkcell: ${esc(price)}` : ''}${rivalPrice ? ` &nbsp;·&nbsp; Rakip: ${esc(rivalPrice)}` : ''}</div>${delta ? `<div style="margin-top:5px;font-size:14px;">${esc(delta)}</div>` : ''}${clean(comparison.terms) ? `<div style="margin-top:7px;font-size:14px;color:${COLORS.muted};">${esc(comparison.terms)}</div>` : ''}${source ? `<div style="margin-top:8px;font-size:14px;"><a href="${esc(source)}" style="color:${COLORS.navy};text-decoration:underline;">Turkcell teklifini aç</a></div>` : ''}</div>`;
}
function highlightHtml(item, index, compact=false) {
  const domain = domainLabel(item.domain), badge = clean(item.label) || domain;
  return `<table role="presentation" class="brief-highlight" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;table-layout:fixed;border:1px solid ${COLORS.line};border-radius:12px;border-collapse:separate;"><tr><td style="padding:18px;border-top:4px solid ${index === 0 ? '#00a3c7' : '#315aca'};border-radius:11px 11px 0 0;"><div style="font-size:14px;line-height:1.5;font-weight:700;color:${COLORS.cyan};">${index+1}. ${esc(badge)}${item.brand ? ` &nbsp;·&nbsp; ${esc(item.brand)}` : ''}</div><h2 style="margin:7px 0 0;font-size:20px;line-height:1.35;color:${COLORS.navy};">${esc(item.title)}</h2>${flagsHtml(item.flags)}${changesHtml(item.changes,compact)}${Number(item.omitted_change_count)>0 ? `<div style="margin-top:8px;font-size:14px;color:${COLORS.muted};">Bu paketteki ${esc(item.omitted_change_count)} ek değişiklik ayrıntı bağlantısında.</div>` : ''}${paragraph('Etkisi',item.why)}${comparisonHtml(item.comparison)}${!item.comparison && item.comparison_note ? paragraph('Karşılaştırma',item.comparison_note) : ''}${paragraph('Önerilen aksiyon',item.action,'brief-action')}${sourceLinks(item)}</td></tr></table>`;
}
function mismatchHtml(mismatch) {
  if (!mismatch || !list(mismatch.fields).length) return '';
  const ad = safeUrl(mismatch.ad_url), catalog = safeUrl(mismatch.catalog_url);
  return `<div class="brief-mismatch" style="margin-top:14px;padding:13px;background:#fff7e2;border:1px solid #ebd89a;border-radius:6px;font-size:14px;line-height:1.6;"><b>${esc(mismatch.title || 'Reklam ile paket sayfası arasında fark')}</b>${mismatch.fields.map(field=>`<div style="margin-top:6px;font-size:14px;">${esc(field.label)}: reklamda <b>${esc(field.ad_value)}</b>; paket sayfasında <b>${esc(field.catalog_value)}</b>.</div>`).join('')}${clean(mismatch.note) ? `<div style="margin-top:8px;font-size:14px;">${esc(mismatch.note)}</div>` : ''}${ad || catalog ? `<div style="margin-top:8px;font-size:14px;">${ad ? `<a href="${esc(ad)}" style="color:${COLORS.navy};">Reklam kaynağı</a>` : ''}${ad && catalog ? ' · ' : ''}${catalog ? `<a href="${esc(catalog)}" style="color:${COLORS.navy};">Paket kaynağı</a>` : ''}</div>` : ''}</div>`;
}
function adTerms(ad,compact=false) {
  const conditions=list(ad.conditions).map(clean).filter(Boolean),uncertainties=list(ad.uncertainties).map(clean).filter(Boolean);
  const text=[...conditions,...uncertainties].join(' ');
  return {conditions,uncertainties,compact:Boolean(text)&&(compact||text.length>1200||Buffer.byteLength(esc(text),'utf8')>6000),
    note:`${conditions.length} kampanya koşulu ve ${uncertainties.length} doğrulama notu var. E-postayı kısa tutmak için tam metin burada gösterilmedi; teklif tüm koşullarıyla değerlendirilmelidir.`};
}
function adTermsHtml(ad,compact=false) {
  const terms=adTerms(ad,compact);
  if (terms.compact) {
    const url=safeUrl(ad.source_url)||detailUrl({...ad,kind:'ad'});
    return `<div class="brief-conditions brief-conditions-compact" style="margin-top:10px;padding:10px;background:#fff7e2;border-radius:6px;font-size:14px;line-height:1.6;color:#614b08;"><b>Uzun kampanya koşulları</b><div style="margin-top:5px;font-size:14px;">${esc(terms.note)}</div><a href="${esc(url)}" style="display:inline-block;margin-top:8px;color:${COLORS.navy};font-size:14px;">Tüm koşulları ve belirsizlikleri inceleyin</a></div>`;
  }
  return (terms.conditions.length?`<div class="brief-conditions" style="margin-top:10px;font-size:14px;line-height:1.6;color:${COLORS.muted};"><b>Koşullar:</b><ul style="margin:5px 0 0;padding-left:20px;">${terms.conditions.map(condition=>`<li style="margin:3px 0;font-size:14px;">${esc(condition)}</li>`).join('')}</ul></div>`:'')+
    (terms.uncertainties.length?paragraph('Doğrulanması gerekenler',terms.uncertainties.join(' ')):'');
}
function adHtml(ad, highlighted, compact=false) {
  const image = MEDIA.test(clean(ad.image_url)) ? clean(ad.image_url) : '';
  const source = safeUrl(ad.source_url);
  const imageHtml = image ? `<img class="brief-ad-image" src="${esc(image)}" alt="${esc(`${ad.brand || 'Rakip'} · ${ad.title || 'Reklam görseli'}`)}" width="214" style="display:block;width:214px;max-width:100%;height:auto;border:0;border-radius:8px;background:#f4f7fb;">` : '';
  const details = `<div style="font-size:14px;line-height:1.5;color:${COLORS.cyan};font-weight:700;">${esc(domainLabel(ad.domain))}${ad.brand ? ` &nbsp;·&nbsp; ${esc(ad.brand)}` : ''}</div><h3 class="brief-ad-title" style="margin:6px 0 0;font-size:19px;line-height:1.4;color:${COLORS.navy};">${esc(ad.title)}</h3>${flagsHtml(ad.flags)}${Number(ad.variant_count)>1 ? `<div style="margin-top:7px;font-size:14px;color:${COLORS.muted};">${esc(ad.variant_count)} görsel varyantı tek kampanyada toplandı.</div>` : ''}${paragraph('Ana vaat',ad.offer || ad.summary)}${ad.offer && ad.summary && clean(ad.offer)!==clean(ad.summary) ? paragraph('İletişim',ad.summary) : ''}${adTermsHtml(ad,compact)}${!highlighted ? paragraph('Etkisi',ad.why)+paragraph('Önerilen aksiyon',ad.action,'brief-action') : ''}${mismatchHtml(ad.mismatch)}${sourceLinks({...ad,kind:'ad'},'Reklam analizini aç')}`;
  return `<table role="presentation" class="brief-ad" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;table-layout:fixed;border:1px solid ${COLORS.line};border-radius:12px;border-collapse:separate;"><tr><td style="padding:18px;"><table role="presentation" class="brief-ad-layout" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;"><tr>${imageHtml ? `<td class="brief-ad-image-cell" width="230" style="width:230px;padding:0 16px 0 0;vertical-align:top;box-sizing:border-box;">${source ? `<a href="${esc(source)}" style="text-decoration:none;">${imageHtml}</a>` : imageHtml}</td>` : ''}<td class="brief-ad-details" style="vertical-align:top;font-size:14px;">${details}</td></tr></table></td></tr></table>`;
}
function expiryHtml(item) {
  return `<tr class="brief-expiry"><td style="padding:12px 0;border-bottom:1px solid ${COLORS.line};font-size:15px;line-height:1.6;"><b style="color:${COLORS.navy};">${esc(item.brand ? `${item.brand} · ` : '')}${esc(item.title)}</b><div style="font-size:14px;color:#805500;">Bitiş: ${esc(expiryDate(item))}</div>${sourceLinks(item,'Kampanya ayrıntıları')}</td></tr>`;
}
function sectionTitle(title, description='') {
  return `<h2 style="margin:10px 0 8px;font-size:21px;line-height:1.4;color:${COLORS.navy};">${esc(title)}</h2>${description ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${COLORS.muted};">${esc(description)}</p>` : ''}`;
}
function coverageHtml(coverage) {
  if (coverage.state === 'complete') return '';
  const domainNotes = list(coverage.domains).filter(domain=>domain.state!=='complete' && clean(domain.message)).map(domain=>clean(domain.message));
  return `<div class="brief-coverage" role="note" style="margin:0 0 20px;padding:14px 16px;background:#fff6d8;border-left:4px solid #e3af18;border-radius:7px;color:#614b08;font-size:14px;line-height:1.6;"><b>${coverage.state === 'unknown' ? 'Güncel görünüm henüz doğrulanamadı' : 'Bazı kaynaklarda güncel kontrol eksik'}</b><div style="margin-top:5px;font-size:14px;">${esc(coverage.message || 'Erişilemeyen kaynaklarda değişiklik olmadığı sonucuna varılamaz.')}</div>${domainNotes.length ? `<div style="margin-top:7px;font-size:14px;">${domainNotes.map(esc).join('<br>')}</div>` : ''}</div>`;
}

function renderDailyBrief(brief, attachments=[], compact=false) {
  const highlights = list(brief.highlights).slice(0,3), ads = list(brief.ads).slice(0,3), expiring = list(brief.expiring);
  const coverage = brief.coverage || {state:'unknown'};
  const highlighted = new Set(highlights.filter(item=>item.kind==='ad').map(item=>String(item.id)));
  const start = date(brief.period_start,true), end = date(brief.period_end,true);
  const period = [start,end].filter(Boolean).join(' – ');
  const quiet = brief.quiet && coverage.state === 'complete';
  const attachmentList = list(attachments).map(attachment=>clean(attachment.filename)).filter(Boolean);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markets Pulse · Günlük Yönetici Özeti</title><style>body{margin:0;padding:0}table{max-width:100%}td,th{overflow-wrap:anywhere;word-break:normal}.mp-wrap{table-layout:fixed}a{overflow-wrap:anywhere}@media only screen and (max-width:620px){.mp-wrap{width:100%!important}.mp-pad{padding-left:16px!important;padding-right:16px!important}.brief-highlight>tbody>tr>td,.brief-ad>tbody>tr>td{padding:14px!important}.brief-ad-layout,.brief-ad-layout>tbody,.brief-ad-layout>tbody>tr,.brief-ad-image-cell,.brief-ad-details{display:block!important;width:100%!important;box-sizing:border-box}.brief-ad-image-cell{padding:0 0 14px!important}.brief-ad-image{margin:0 auto;width:auto!important;max-width:100%!important}.brief-change-table th,.brief-change-table td{padding-left:5px!important;padding-right:5px!important}.brief-cta{display:block!important;margin:8px 0!important}}</style></head><body style="margin:0;padding:0;background:#f1f5fa;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${COLORS.ink};"><div class="brief-preheader" style="display:none!important;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:14px;line-height:1px;">${esc(brief.summary)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f1f5fa;"><tr><td align="center" style="padding:24px 10px;"><table role="presentation" class="mp-wrap" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;table-layout:fixed;border-radius:16px;overflow:hidden;"><tr><td class="mp-pad" style="padding:24px 28px;background:#000f64;border-bottom:4px solid #ffca00;"><div style="font-size:27px;line-height:1.25;font-weight:800;color:#ffffff;">Markets <span style="color:#00c2ff;">Pulse</span></div><div style="margin-top:8px;font-size:14px;line-height:1.5;color:#d1e4ff;">Günlük Yönetici Özeti · ${esc(date(brief.period_end))}</div></td></tr><tr><td class="mp-pad" style="padding:24px 28px 8px;">${coverageHtml(coverage)}${compact ? `<p class="brief-compact-note" style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${COLORS.muted};">Kısa e-posta görünümü: uzun koşulların ve değişiklik metinlerinin tamamı ayrıntı bağlantılarında yer alıyor.</p>` : ''}<h1 style="margin:0;font-size:25px;line-height:1.35;color:${COLORS.navy};">${esc(brief.headline || 'Günün pazar görünümü')}</h1><p class="${quiet ? 'brief-quiet' : 'brief-summary'}" style="margin:12px 0 0;font-size:16px;line-height:1.65;color:${COLORS.ink};">${esc(brief.summary)}</p>${period ? `<p style="margin:9px 0 16px;font-size:14px;line-height:1.5;color:${COLORS.muted};">İncelenen dönem: ${esc(period)} (KKTC)</p>` : ''}</td></tr><tr><td class="mp-pad" style="padding:0 28px 12px;">${highlights.length ? sectionTitle('Bugünün önemli gelişmeleri','Ne değişti, etkisi ne, hangi aksiyon değerlendirilebilir?')+highlights.map((item,index)=>highlightHtml(item,index,compact)).join('') : ''}${ads.length ? sectionTitle('Reklam radarı','Öne çıkan yeni iletişimler ve kampanya koşulları.')+ads.map(ad=>adHtml(ad,highlighted.has(String(ad.id)),compact)).join('') : ''}${expiring.length ? sectionTitle('Önümüzdeki 72 saatte sona erenler','Bitiş tarihi kaynakta belirtilen kampanyalar.')+`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;">${expiring.map(expiryHtml).join('')}</table>` : ''}</td></tr><tr><td class="mp-pad" style="padding:6px 28px 24px;">${attachmentList.length ? `<div style="margin:0 0 18px;padding:14px;background:#f3f7fc;border:1px solid ${COLORS.line};border-radius:8px;font-size:14px;line-height:1.6;"><b style="color:${COLORS.navy};">Ekli raporlar</b>${attachmentList.map(name=>`<div style="margin-top:5px;font-size:14px;">${esc(name)}</div>`).join('')}</div>` : ''}<a class="brief-cta" href="${APP}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:7px;background:${COLORS.navy};color:#ffffff;text-align:center;text-decoration:none;font-size:15px;font-weight:700;">Dashboard’u aç</a><a class="brief-cta" href="${REPORTS}" style="display:inline-block;margin:0 0 8px;padding:12px 18px;border:1px solid ${COLORS.line};border-radius:7px;color:${COLORS.navy};text-align:center;text-decoration:none;font-size:15px;font-weight:700;">Raporlara git</a><p${coverage.state === 'complete' ? ' class="brief-coverage"' : ''} style="margin:15px 0 0;color:${COLORS.muted};font-size:14px;line-height:1.6;">${coverage.state === 'complete' ? esc(coverage.message || 'İzlenen kaynakların güncel kontrolleri tamamlandı.')+' ' : ''}Aksiyonlar değerlendirme önerisidir; kampanya koşullarının ayrıntıları kaynak bağlantılarındadır.</p></td></tr></table></td></tr></table></body></html>`;
}

export function dailyBriefEmailHtml(ctx, attachments=[]) {
  const brief=buildDailyBrief(ctx),html=renderDailyBrief(brief,attachments);
  return Buffer.byteLength(html,'utf8')<=EMAIL_BYTE_BUDGET?html:renderDailyBrief(brief,attachments,true);
}

function plainLinks(item) {
  const source = safeUrl(item?.source_url);
  return [source ? `Kaynak: ${source}` : '', `Ayrıntılar: ${detailUrl(item)}`].filter(Boolean).join('\n');
}
function plainComparison(comparison) {
  if (!comparison) return [];
  const result = [`Bizim karşılığımız: ${comparison.brand || 'Kuzey Kıbrıs Turkcell'} · ${comparison.title}`];
  if (clean(comparison.period_label)) result.push(clean(comparison.period_label));
  if (money(comparison.price)) result.push(`Turkcell: ${money(comparison.price)}${money(comparison.competitor_price) ? ` · Rakip: ${money(comparison.competitor_price)}` : ''}`);
  if (comparisonDelta(comparison)) result.push(comparisonDelta(comparison));
  if (clean(comparison.terms)) result.push(clean(comparison.terms));
  if (safeUrl(comparison.source_url)) result.push(`Turkcell kaynağı: ${safeUrl(comparison.source_url)}`);
  return result;
}
export function dailyBriefPlainText(ctx) {
  const brief = buildDailyBrief(ctx), coverage = brief.coverage || {state:'unknown'};
  const highlights = list(brief.highlights).slice(0,3), ads = list(brief.ads).slice(0,3);
  const lines = ['Markets Pulse · Günlük Yönetici Özeti',date(brief.period_end),''];
  if (coverage.state !== 'complete') lines.push(coverage.state==='unknown'?'Güncel görünüm henüz doğrulanamadı':'Bazı kaynaklarda güncel kontrol eksik',clean(coverage.message),...list(coverage.domains).filter(domain=>domain.state!=='complete' && clean(domain.message)).map(domain=>clean(domain.message)),'');
  lines.push(clean(brief.headline),clean(brief.summary),`İncelenen dönem: ${date(brief.period_start,true)} – ${date(brief.period_end,true)} (KKTC)`,'');
  if (highlights.length) lines.push('BUGÜNÜN ÖNEMLİ GELİŞMELERİ');
  for (const [index,item] of highlights.entries()) {
    lines.push(`${index+1}. ${domainLabel(item.domain)} · ${item.brand || ''} · ${clean(item.title)}`,...list(item.flags).map(clean));
    const presentation=changePresentation(item.changes);
    if (presentation.compact) lines.push(LONG_CHANGE_NOTE);
    for (const change of presentation.rows) lines.push(`${clean(change.label)}: ${clean(change.before) || '—'} → ${clean(change.after) || '—'}`);
    if (Number(item.omitted_change_count)>0) lines.push(`Bu paketteki ${item.omitted_change_count} ek değişiklik ayrıntı bağlantısında.`);
    if (!item.comparison && clean(item.comparison_note)) lines.push(`Karşılaştırma: ${clean(item.comparison_note)}`);
    if (clean(item.why)) lines.push(`Etkisi: ${clean(item.why)}`);
    lines.push(...plainComparison(item.comparison));
    if (clean(item.action)) lines.push(`Önerilen aksiyon: ${clean(item.action)}`);
    lines.push(plainLinks(item),'');
  }
  const highlighted = new Set(highlights.filter(item=>item.kind==='ad').map(item=>String(item.id)));
  if (ads.length) lines.push('REKLAM RADARI');
  for (const ad of ads) {
    lines.push(`${domainLabel(ad.domain)} · ${ad.brand || ''} · ${clean(ad.title)}`,...list(ad.flags).map(clean));
    if (clean(ad.offer || ad.summary)) lines.push(`Ana vaat: ${clean(ad.offer || ad.summary)}`);
    if (ad.offer && ad.summary && clean(ad.offer)!==clean(ad.summary)) lines.push(`İletişim: ${clean(ad.summary)}`);
    const terms=adTerms(ad);
    if (terms.compact) lines.push('Uzun kampanya koşulları',terms.note,`Tüm koşulları ve belirsizlikleri inceleyin: ${safeUrl(ad.source_url)||detailUrl({...ad,kind:'ad'})}`);
    else {
      for (const condition of terms.conditions) lines.push(`Koşul: ${condition}`);
      if (terms.uncertainties.length) lines.push(`Doğrulanması gerekenler: ${terms.uncertainties.join(' ')}`);
    }
    if (Number(ad.variant_count)>1) lines.push(`${ad.variant_count} görsel varyantı tek kampanyada toplandı.`);
    if (!highlighted.has(String(ad.id))) {
      if (clean(ad.why)) lines.push(`Etkisi: ${clean(ad.why)}`);
      if (clean(ad.action)) lines.push(`Önerilen aksiyon: ${clean(ad.action)}`);
    }
    if (list(ad.mismatch?.fields).length) {
      lines.push(clean(ad.mismatch.title || 'Reklam ile paket sayfası arasında fark'));
      for (const field of ad.mismatch.fields) lines.push(`${clean(field.label)}: reklamda ${clean(field.ad_value)}; paket sayfasında ${clean(field.catalog_value)}.`);
      if (clean(ad.mismatch.note)) lines.push(clean(ad.mismatch.note));
      if (safeUrl(ad.mismatch.ad_url)) lines.push(`Reklam kaynağı: ${safeUrl(ad.mismatch.ad_url)}`);
      if (safeUrl(ad.mismatch.catalog_url)) lines.push(`Paket kaynağı: ${safeUrl(ad.mismatch.catalog_url)}`);
    }
    lines.push(plainLinks({...ad,kind:'ad'}),'');
  }
  if (list(brief.expiring).length) lines.push('ÖNÜMÜZDEKİ 72 SAATTE SONA ERENLER');
  for (const item of list(brief.expiring)) lines.push(`${item.brand || ''} · ${clean(item.title)}`,`Bitiş: ${expiryDate(item)}`,plainLinks(item),'');
  if (coverage.state === 'complete' && clean(coverage.message)) lines.push(clean(coverage.message),'');
  lines.push('Aksiyonlar değerlendirme önerisidir; kampanya koşullarının ayrıntıları kaynak bağlantılarındadır.',`Dashboard: ${APP}`,`Raporlar: ${REPORTS}`);
  return lines.join('\n');
}
