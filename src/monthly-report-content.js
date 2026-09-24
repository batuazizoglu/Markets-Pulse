const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short'}).format(new Date(v)):'Kayıt yok';
const table=(heads,rows)=>'<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>'+heads.map(h=>'<th style="padding:7px;text-align:left;background:#001484;color:white">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td style="padding:7px;border-bottom:1px solid #dce5f2;overflow-wrap:anywhere">'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';

export function monthlyPlainText(ctx){
  return `${ctx.title}\nSon 30 gün: ${date(ctx.period_start)} – ${date(ctx.period_end)} (takvim ayı kapanışı değildir).\n`+
    `Mobil: ${ctx.stats?.total??0} değişiklik. Ev İnterneti: ${ctx.daily_home?.fixed?.stats?.total??0}. Superbox / Red Box: ${ctx.daily_home?.fwa?.stats?.total??0}.\n`+
    `Kanıt Arşivi: ${ctx.monthly?.evidence_total??0} kayıt; ${ctx.monthly?.evidence_missing??0} eksik dosyalı.\n`+
    `${ctx.market?.executive_summary||'Yönetici özeti için ekli raporu inceleyin.'}\n`+
    'Paket karşılaştırmaları güncel kataloğu gösterir; aylık ortalama değildir. Haftalık skor seyri, kaynak/veri kapsamı ve önerilen aksiyonlar ekli birleşik PDF raporundadır.';
}

export function monthlyOverviewHtml(ctx,{compact=false}={}){
  const m=ctx.monthly||{},fixed=ctx.daily_home?.fixed||{},fwa=ctx.daily_home?.fwa||{};
  const priorities=(ctx.market?.top_threats||[]).filter(x=>x.action).slice(0,3).map(x=>['Mobil',x.product_name,x.action]);
  const opportunity=fixed.opportunities?.[0];
  if(opportunity)priorities.push(['Ev İnterneti',(opportunity.kktcell?.name||'Turkcell')+' / '+(opportunity.competitor?.name||'Rakip'),'Hız, kapsama ve toplam maliyeti birlikte doğrulayarak dijital teklif ve lead önceliğini değerlendirin.']);
  if((fwa.products||[]).length)priorities.push(['Superbox / Red Box','FWA teklifleri','Kota, teknoloji, kapsama ve kontrat koşullarını eşitleyerek fiyat farkını değerlendirin.']);
  const limited=(m.coverage||[]).filter(x=>!x.first_recorded||new Date(x.first_recorded)>new Date(ctx.period_start)).length;
  let html='<section class="monthly-overview" style="color:#001484;font-family:Arial,sans-serif;line-height:1.5"><h2>Birleşik Aylık Yönetici Özeti</h2>'+
    '<p><b>Dönem: son 30 gün ('+esc(date(ctx.period_start))+' – '+esc(date(ctx.period_end))+').</b> Kapanmış takvim ayı raporu değildir. Günlük/haftalık raporların ortak kayıtları tekrar sayılmadan, kaynak olayları üzerinden derlenir.</p>'+
    table(['İzleme alanı','Dönem değişikliği','Güncel ürün'],[
      ['Mobil',ctx.stats?.total??0,'Karşılaştırma ve segment bölümünde'],
      ['Turkcell Ev İnterneti ve rakipler',fixed.stats?.total??0,(fixed.products||[]).length],
      ['Superbox / Red Box',fwa.stats?.total??0,(fwa.products||[]).length],
      ['Toplam kayıtlı değişiklik',m.total_changes??0,'Ürün adedi değil, değişiklik olayı']
    ])+
    '<p><b>Okuma notu:</b> Paket fiyatları, ürün karşılaştırmaları ve kaynak durumları rapor üretim anını gösterir; aylık ortalama değildir. Skor farkı yalnızca dönem başı kaydı varsa hesaplanır. Geçmişi dönem başlangıcına ulaşmayan kaynak: '+esc(limited)+'. Veri olmayan günler “değişiklik yok” anlamına gelmez.</p>'+
    '<h2>Gelecek 30 Gün İçin Önerilen Aksiyonlar</h2>'+table(['Alan','Dayanak','Öneri'],priorities.length?priorities:[['Veri kalitesi','Yeterli rekabet sinyali yok','Kaynak erişimini ve geçmiş birikimini doğrulayın; doğrulanmamış veriden ticari karar üretmeyin.']])+
    '<p class="report-note" style="font-size:12px;color:#667399">Aksiyonlar mevcut sinyallerden türetilmiş önerilerdir; satış sonucu veya gerçekleşmiş işlem değildir.</p>'+
    '<h2>Kanıt Arşivi • 30 Günlük Kapsam</h2><p>'+esc(m.evidence_total??0)+' kayıt • '+esc(m.evidence_complete??0)+' eksiksiz • '+esc(m.evidence_missing??0)+' eksik dosyalı • '+esc(m.evidence_visual??0)+' görselli.</p>'+
    '<p>PDF seçilmiş kanıtları içerir. Ham HTML/JSON ve tüm görseller, platformda Kanıt Arşivi üzerinden kayıt bazında veya ZIP olarak indirilebilir.</p>';
  if(!compact){
    html+='<h2>Haftalık Rekabet Pozisyonu Seyri</h2><p>KKTC takvim haftası bazında mevcut skor kayıtlarının ortalaması. İlk/son hafta ve veri birikimi eksik olabilir; ölçüm tarihlerini dikkate alın.</p>'+
      table(['Hafta başlangıcı','Segment','Skor ort. /100','Ölçüm','İlk / son ölçüm'],(m.trend||[]).length?m.trend.map(x=>[x.week,x.segment,x.average_score,x.samples,date(x.first_sample)+' / '+date(x.last_sample)]):[['—','Skor geçmişi bulunmuyor','—','0','—']])+
      '<h2>Kaynak Bazında Veri Kapsamı</h2>'+table(['Alan','Kaynak','İlk kayıt','Dönem taraması','Başarılı'],(m.coverage||[]).map(x=>[x.domain,x.source,date(x.first_recorded),x.scans,x.successful]));
  }
  return html+'</section>';
}
