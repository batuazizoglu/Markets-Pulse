import {AD_CATEGORIES} from './ad-visual.js';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const customCategory=key=>typeof key==='string'&&key.length<=80&&/^auto-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
const categoryName=value=>typeof value==='string'&&value.trim()&&value.length<=60?value.trim():null;
export function reportCategories(data,rows=data?.rows||[]){
  const categories=Object.assign(Object.create(null),AD_CATEGORIES);
  if(data.categories&&typeof data.categories==='object'&&!Array.isArray(data.categories))for(const [key,label] of Object.entries(data.categories))if(customCategory(key)&&categoryName(label))categories[key]=categoryName(label);
  for(const row of rows){const analysis=row.analysis_json||{},label=categoryName(analysis.category_label)||categoryName(row.category_label);if(customCategory(analysis.category)&&!Object.hasOwn(categories,analysis.category)&&label)categories[analysis.category]=label}
  return Object.entries(categories).filter(([key])=>Object.hasOwn(AD_CATEGORIES,key)||rows.some(row=>row.analysis_json?.category===key));
}
export const AD_REPORT_ROWS_PER_CATEGORY=12;
export function displayedAdReportRows(data){
  const rows=data?.rows||[];
  return reportCategories(data,rows).flatMap(([key])=>rows.filter(row=>row.analysis_json?.category===key).slice(0,AD_REPORT_ROWS_PER_CATEGORY));
}
function sourceLink(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&/(^|\.)(facebook\.com|instagram\.com)$/.test(url.hostname)?url.href:null}catch{return null}
}
function imageSource(value){
  return typeof value==='string'&&(/^cid:ad-[a-f0-9]{64}\.jpg$/.test(value)||/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)||/^https:\/\/www\.marketspulse\.cloud\/report-media\/[a-f0-9]{64}\.jpg$/.test(value))?value:null;
}
function dateLabel(value){
  const date=new Date(value);return value&&Number.isFinite(+date)?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(date):'Tarih doğrulanmadı';
}
function offerDetails(offer={}){
  return [offer.price_try==null?'Fiyat okunamadı':offer.price_try+' TL'+(offer.billing_period==='monthly'?' / ay':offer.billing_period==='one_time'?' / tek sefer':' (dönem doğrulanmadı)'),
    offer.previous_price_try==null?null:'Önceki fiyat: '+offer.previous_price_try+' TL',offer.data_gb==null?null:offer.data_gb+' GB',offer.bonus_data_gb==null?null:'+'+offer.bonus_data_gb+' GB',
    offer.speed_mbps==null?null:offer.speed_mbps+' Mbps',offer.minutes==null?null:offer.minutes+' dakika',offer.commitment_months==null?null:offer.commitment_months+' ay taahhüt'].filter(Boolean).join(' • ');
}
function paragraphChunks(value,limit=550){
  let remaining=String(value||'');const chunks=[];
  while(remaining.length>limit){let end=remaining.lastIndexOf(' ',limit);if(end<limit/2)end=limit;chunks.push(remaining.slice(0,end));remaining=remaining.slice(end).trimStart()}
  if(remaining)chunks.push(remaining);return chunks;
}
export function adVisualReportHtml(data,{mode='email',imageSrc=image=>'cid:'+image.cid}={}){
  if(!data)return '';
  const stale=!data.checked_at||Date.now()-+new Date(data.checked_at)>48*3600000;
  const stamp=data.checked_at?dateLabel(data.checked_at):'Henüz inceleme yok';
  const rows=data.rows||[];
  let html='<section class="ad-report" data-report-mode="'+(mode==='pdf'?'pdf':'email')+'" style="margin:24px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#172d3c"><div class="ad-report-header"><h2 style="font-size:22px;margin:0 0 10px">Reklam Görsel Analizi</h2><p style="margin:0 0 16px;color:#526572">Son kontrol: '+esc(stamp)+'. '+(stale?'İnceleme güncel değil. ':data.status!=='ok'?'Kapsam kısmi; kaynak durumunu kontrol edin. ':'')+(data.last_error?'Son veri aktarımı başarısız. ':'')+'Dönemde '+rows.filter(x=>x.event_type==='first_seen').length+' ilk gözlem, '+rows.filter(x=>x.event_type==='changed').length+' teklif / durum değişikliği. İlk gözlem reklamın o gün yayına başladığı anlamına gelmez.</p></div>';
  if(data.image_summary){const summary=data.image_summary;html+='<p class="ad-report-image-summary" style="margin:0 0 16px;color:#526572">'+esc(summary.prepared)+' kayıtta reklam görseli kullanıldı. '+(summary.limited?esc(summary.limited)+' kayıt, rapor boyutunu sınırlamak için metin olarak gösterildi. ':'')+(summary.unavailable?esc(summary.unavailable)+' kaydın görseli hazırlanamadı; analiz ve kaynak bağlantısı korundu. ':'')+'Görselin oranı ve teklif koşulları korunur; tam kanıt arşivde saklanır.</p>'}
  for(const [key,label] of reportCategories(data,rows)){
    const group=rows.filter(x=>x.analysis_json?.category===key);
    html+='<h3 class="ad-report-category" style="font-size:18px;line-height:1.35;margin:22px 0 12px">'+esc(label)+' • '+group.length+' kayıt</h3>';
    if(!group.length){html+='<p>Dönemde kaydedilmiş yeni analiz veya değişiklik yok. Bu, reklam olmadığı anlamına gelmez.</p>';continue}
    for(const x of group.slice(0,AD_REPORT_ROWS_PER_CATEGORY)){
      const a=x.analysis_json,source=sourceLink(a.source_url),image=x.report_image;
      const src=image?imageSource(imageSrc(image,x)):null;
      const longPdf=mode==='pdf'&&[a.visual_summary,...(a.conditions||[]),...(a.uncertainties||[])].join(' ').length>800;
      const summaryChunks=longPdf?paragraphChunks(a.visual_summary,400):[a.visual_summary];
      html+='<article class="ad-report-card" style="margin:0 0 16px;padding:16px;border:1px solid #dce5ea;border-radius:8px;background:#ffffff"><h4 class="ad-report-card-title" style="font-size:16px;line-height:1.4;margin:0 0 12px">'+esc(a.brand)+' • '+esc(a.title)+'</h4><table class="ad-report-layout" role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody><tr>';
      if(src)html+='<td class="ad-report-image-cell" style="width:42%;vertical-align:top;padding:0 16px 0 0"><img class="ad-report-image" src="'+esc(src)+'" alt="'+esc(a.brand+' — '+a.title)+'" width="220" style="display:block;width:100%;max-width:260px;height:auto;max-height:340px;object-fit:contain;object-position:top left;border:0"><p class="ad-report-image-caption" style="font-size:11px;line-height:1.4;color:#687c88;margin:6px 0 0">'+(a.media_kind==='video_preview'?'Video önizleme karesi':image.selection==='creative'||image.selection==='browser_creative'?'Reklam görseli': 'Arşivdeki görsel kanıt')+(image.cropped?' • Boş kenarlar kırpıldı':'')+'</p></td>';
      html+='<td class="ad-report-details" style="vertical-align:top;font-size:13px;line-height:1.55;overflow-wrap:anywhere"><p class="ad-report-offer" style="font-weight:bold;font-size:15px;line-height:1.4;margin:0 0 10px">'+esc(offerDetails(a.offer))+'</p>';
      if(summaryChunks[0])html+='<p class="ad-report-summary" style="margin:0 0 10px">'+esc(summaryChunks[0])+'</p>';
      if(!longPdf&&a.conditions?.length)html+='<p class="ad-report-conditions" style="margin:0 0 10px"><strong>Koşullar:</strong> '+esc(a.conditions.join(' · '))+'</p>';
      if(!longPdf&&a.uncertainties?.length)html+='<p class="ad-report-uncertainties" style="margin:0 0 10px;color:#6e521f"><strong>Belirsizlikler:</strong> '+esc(a.uncertainties.join(' · '))+'</p>';
      html+='</td></tr></tbody></table><footer class="ad-report-source" style="border-top:1px solid #e8edf0;padding-top:10px;margin-top:12px;font-size:11px;line-height:1.5;color:#687c88">'+esc(x.event_type==='changed'?'Teklif / durum değişikliği':'İlk gözlem')+' • '+esc(dateLabel(x.observed_at||a.observed_at))+'<br>'+(source?'<a href="'+esc(source)+'" style="color:#176775">Kaynak • '+esc(a.ad_id)+'</a>':'Kaynak bağlantısı doğrulanamadı')+' • <a href="https://www.marketspulse.cloud/#ads" style="color:#176775">Tam görsel kanıt</a></footer></article>';
      if(longPdf){
        html+='<div class="ad-report-continuation" style="margin:0 0 20px;font-size:13px;line-height:1.55"><h4 style="font-size:14px;margin:0 0 8px">'+esc(a.brand)+' • '+esc(a.ad_id)+' — Reklam ayrıntıları (devam)</h4>';
        for(const text of summaryChunks.slice(1))html+='<p>'+esc(text)+'</p>';
        for(const [label,values] of [['Koşullar',a.conditions],['Belirsizlikler',a.uncertainties]])if(values?.length){html+='<p><strong>'+label+'</strong></p>';for(const value of values)for(const text of paragraphChunks(value))html+='<p>'+esc(text)+'</p>'}
        html+='</div>';
      }
    }
    if(group.length>AD_REPORT_ROWS_PER_CATEGORY)html+='<p class="ad-report-sampling">İlk '+AD_REPORT_ROWS_PER_CATEGORY+' / '+group.length+' kayıt gösterildi. Diğer kayıtlar Reklam Analizi arşivindedir.</p>';
  }
  return html+'<p>Reklamda görülen tekliflerdir; paket kataloğunu veya karşılaştırma skorunu otomatik değiştirmez. Görsel kanıt ve geçmiş sürümler Markets Pulse → Reklam Analizi ekranındadır.</p></section>';
}
