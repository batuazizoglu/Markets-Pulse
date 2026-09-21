import {AD_CATEGORIES} from './ad-visual.js';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const customCategory=key=>typeof key==='string'&&key.length<=80&&/^auto-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
const categoryName=value=>typeof value==='string'&&value.trim()&&value.length<=60?value.trim():null;
function reportCategories(data,rows){
  const categories=Object.assign(Object.create(null),AD_CATEGORIES);
  if(data.categories&&typeof data.categories==='object'&&!Array.isArray(data.categories))for(const [key,label] of Object.entries(data.categories))if(customCategory(key)&&categoryName(label))categories[key]=categoryName(label);
  for(const row of rows){const analysis=row.analysis_json||{},label=categoryName(analysis.category_label)||categoryName(row.category_label);if(customCategory(analysis.category)&&!Object.hasOwn(categories,analysis.category)&&label)categories[analysis.category]=label}
  return Object.entries(categories).filter(([key])=>Object.hasOwn(AD_CATEGORIES,key)||rows.some(row=>row.analysis_json?.category===key));
}
export function adVisualReportHtml(data){
  if(!data)return '';
  const stale=!data.checked_at||Date.now()-+new Date(data.checked_at)>48*3600000;
  const stamp=data.checked_at?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(data.checked_at)):'Henüz inceleme yok';
  const rows=data.rows||[];
  let html='<section style="margin:20px 0;font-size:12px;line-height:1.6"><h2>Reklam Görsel Analizi</h2><p>Son kontrol: '+esc(stamp)+'. '+(stale?'İnceleme güncel değil. ':data.status!=='ok'?'Kapsam kısmi; kaynak durumunu kontrol edin. ':'')+(data.last_error?'Son veri aktarımı başarısız. ':'')+'Dönemde '+rows.filter(x=>x.event_type==='first_seen').length+' ilk gözlem, '+rows.filter(x=>x.event_type==='changed').length+' teklif / durum değişikliği. İlk gözlem reklamın o gün yayına başladığı anlamına gelmez.</p>';
  for(const [key,label] of reportCategories(data,rows)){
    const group=rows.filter(x=>x.analysis_json.category===key);
    html+='<h3>'+esc(label)+' • '+group.length+' kayıt</h3>';
    if(!group.length){html+='<p>Dönemde kaydedilmiş yeni analiz veya değişiklik yok. Bu, reklam olmadığı anlamına gelmez.</p>';continue}
    html+='<table style="width:100%;border-collapse:collapse"><thead><tr><th>Reklam</th><th>Görseldeki teklif</th><th>Koşul / belirsizlik</th></tr></thead><tbody>';
    for(const x of group.slice(0,12)){
      const a=x.analysis_json,o=a.offer,details=[o.price_try==null?'Fiyat okunamadı':o.price_try+' TL'+(o.billing_period==='monthly'?' / ay':o.billing_period==='unknown'?' (dönem doğrulanmadı)':''),o.data_gb==null?null:o.data_gb+' GB',o.bonus_data_gb==null?null:'+'+o.bonus_data_gb+' GB',o.speed_mbps==null?null:o.speed_mbps+' Mbps'].filter(Boolean).join(' • ');
      html+='<tr><td style="padding:8px;border:1px solid #ddd">'+esc(a.brand)+' • '+esc(a.title)+'<br><a href="'+esc(a.source_url)+'">Kaynak • '+esc(a.ad_id)+'</a></td><td style="padding:8px;border:1px solid #ddd">'+esc(details)+'</td><td style="padding:8px;border:1px solid #ddd">'+esc([...a.conditions,...a.uncertainties].join(' · '))+'</td></tr>';
    }
    html+='</tbody></table>'+(group.length>12?'<p>İlk 12 / '+group.length+' kayıt gösterildi.</p>':'');
  }
  return html+'<p>Reklamda görülen tekliflerdir; paket kataloğunu veya karşılaştırma skorunu otomatik değiştirmez. Görsel kanıt ve geçmiş sürümler Markets Pulse → Reklam Analizi ekranındadır.</p></section>';
}
