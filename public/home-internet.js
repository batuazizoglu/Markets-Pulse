(()=>{
const state={data:null,view:'tracking',family:'fixed',provider:'Tümü',tech:'Tümü',segment:'all',search:'',bestOnly:true,selected:new Set(),loading:false,observations:[],socialLoaded:false};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=(v,d=0)=>v==null?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:d});
const money=v=>v==null?'—':num(v,2)+' TL';
const dt=v=>v?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
function link(url,label){
  try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return esc(label);return '<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>'}catch{return esc(label)}
}
function term(x){return x.duration_days?x.duration_days+' gün'+(x.bonus_days?' + '+x.bonus_days+' gün hediye':''):x.duration_months?x.duration_months+' ay'+(x.bonus_months?' + '+x.bonus_months+' ay hediye':''):'Süre yayımlanmıyor'}
const price=x=>x.effective_monthly_try!=null?money(x.effective_monthly_try):x.price_status==='quote'?'Teklif ile':'Fiyat yayımlanmıyor';
const statusText={tracked:'İzleniyor',partial:'Kısmi kapsam',stale:'Son doğrulanmış veri',website_unverified:'Site doğrulanamadı',unavailable:'Erişim / ayrıştırma sorunu',discovery:'Paket doğrulaması gerekli',source_needed:'Kaynak gerekli',pending:'İlk tarama bekleniyor',ok:'Sağlıklı',error:'Erişim sorunu',parse_error:'Paket okunamadı'};
function ensure(){
  const shell=document.querySelector('main.shell');if(!shell||$('home-internet-section'))return;
  const section=document.createElement('section');section.id='home-internet-section';section.className='section hi-section';
  section.innerHTML=[
    '<div class="section-title hi-title"><div><h2>Ev İnterneti</h2><p>BTHK kapsamındaki ISP şirketleri, paketleri ve rekabet hareketleri</p></div><div class="hi-actions"><span id="hiUpdated" class="view-chip">Veri bekleniyor</span><button class="btn" id="hiScanBtn">Şimdi Tara</button></div></div>',
    '<nav class="hi-subnav" aria-label="Ev İnterneti görünümleri"><button data-view="tracking" aria-pressed="true">Rakip Takip</button><button data-view="compare" aria-pressed="false">Ürün Karşılaştırma <span id="hiSelectedCount"></span></button><button data-view="social" aria-pressed="false">Reklam &amp; Sayfalar</button></nav>',
    '<p id="hiMessage" role="status" aria-live="polite"></p>',
    '<div id="hiMarketViews">',
      '<div id="hiTrackingTop"><article class="hi-panel"><div class="panel-head"><strong>Değişiklikler</strong><span>Son 30 gün • ilk tarama başlangıç kaydıdır</span></div><div id="hiChanges" class="hi-change-list"></div></article></div>',
      '<div id="hiKpis" class="hi-kpis"></div>',
      '<div id="hiCompareView" hidden><article class="hi-panel"><div class="panel-head"><strong>Seçili ürünleri karşılaştır</strong><button class="btn" data-clear-selection>Seçimi temizle</button></div><div id="hiCompareResult"></div></article></div>',
      '<div class="hi-family-tabs"><button class="hi-family-tab" data-family="fixed">Sabit İnternet</button><button class="hi-family-tab" data-family="fwa">Superbox / Red Box</button></div>',
      '<div class="hi-toolbar hi-catalog-toolbar">',
        '<div class="hi-filter"><label for="hiProvider">Sağlayıcı</label><select id="hiProvider"><option>Tümü</option></select></div>',
        '<div class="hi-filter"><label for="hiTech">Teknoloji</label><select id="hiTech"><option>Tümü</option></select></div>',
        '<div class="hi-filter"><label for="hiSegment">Hizmet türü</label><select id="hiSegment"><option value="all">Tüm hizmetler</option value="residential">Bireysel</option><option value="business">Kurumsal</option></select></div>',
        '<div class="hi-filter"><label for="hiSearch">Paket ara</label><input id="hiSearch" type="search" placeholder="Paket adı veya hız"></div>',
        '<label class="hi-toggle"><input id="hiBestOnly" type="checkbox" checked>Her paketin en uygun dönemi</label>',
      '</div>',
      '<article class="hi-panel"><div class="panel-head"><strong>Paketler ve hizmetler</strong><span id="hiRowCount"></span></div><p class="hi-help">Karşılaştırmak için 2–4 teklif seçin. Efektif aylık tutar hediye süreyi içerir; kurulum, kablo ve modem ayrıca değerlendirilir.</p><div class="table-wrap"><table class="data-table hi-table"><thead><tr><th>Seç</th><th>Sağlayıcı / Ürün</th><th>Teknoloji</th><th>İndirme / Yükleme</th><th>Ödeme + Hediye</th><th>Toplam Paket</th><th>Efektif Aylık</th><th>Kurulum</th><th>Doğrulama</th></tr></thead><tbody id="hiProducts"><tr><td colspan="9">Yükleniyor…</td></tr></tbody></table></div></article>',
      '<div id="hiTrackingBottom"><article class="hi-panel"><div class="panel-head"><strong>BTHK şirket kapsamı</strong><span id="hiCoverageCount"></span></div><p class="hi-help" id="hiScopeNote"></p><div class="table-wrap"><table class="data-table hi-directory"><thead><tr><th>Şirket / Markalar</th><th>Web sitesi ve paketler</th><th>Kapsam</th><th>Teklif</th></tr></thead><tbody id="hiCompanies"></tbody></table></div></article>',
      '<article class="hi-panel"><div class="panel-head"><strong>Kaynak Sağlığı ve İzlenen Kaynaklar</strong><span id="hiSourceCount"></span></div><div id="hiSources" class="hi-source-list"></div></article></div>',
    '</div>',
    '<div id="hiSocialView" hidden>',
      '<article class="hi-panel hi-social-intro"><h3>Reklam ve sosyal sayfa takibi</h3><p>Resmî hesapları açın, gördüğünüz reklamı veya paylaşımı bağlantısı ve notuyla kaydedin. Gözlemler ekip içinde saklanır.</p><p><b>Otomatik veri bağlantısı kurulmadı.</b> Reklam sayısı ve paylaşım akışı henüz otomatik alınmıyor. Sayfa kimliği doğrulanmayan markalarda Ad Library bağlantısı marka araması açar; sonuçların markaya ait olduğunu kontrol edin.</p><label for="hiAdCountry">Ad Library ülke filtresi </label><select id="hiAdCountry"><option value="ALL">Tüm ülkeler</option><option value="CY">Kıbrıs (CY)</option><option value="TR">Türkiye (TR)</option></select><small>Ülke filtresi reklamın erişimini sınırlar; KKTC kapsamının tamamını garanti etmez.</small></article>',
      '<div id="hiSocialCards" class="hi-social-grid"></div>',
      '<article class="hi-panel hi-observation"><h3>Gözlem kaydet</h3><form id="hiObservationForm"><div class="hi-observation-grid"><label>Marka<select id="hiObservationBrand" required></select></label><label>Tür<select id="hiObservationKind"><option value="ad">Reklam</option><option value="post">Paylaşım</option><option value="page">Sayfa</option></select></label></div><label>Kaynak bağlantısı<input id="hiObservationUrl" type="url" required placeholder="https://www.facebook.com/…" maxlength="2048"></label><label>Gözlem notu<textarea id="hiObservationNote" required minlength="3" maxlength="2000" placeholder="Kampanya, fiyat, hedef kitle veya gördüğünüz değişiklik"></textarea></label><button class="btn" id="hiSaveObservation" type="submit">Gözlemi kaydet</button><span id="hiObservationStatus" role="status"></span></form></article>',
      '<article class="hi-panel"><div class="panel-head"><strong>Gözlem geçmişi</strong><span>Manuel inceleme kayıtları</span></div><div id="hiObservations"></div></article>',
    '</div>'
  ].join('');
  shell.append(section);
  $('hiScanBtn').addEventListener('click',()=>load(true));
  section.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.view)setView(b.dataset.view);
    if(b.dataset.family)setFamily(b.dataset.family);
    if(b.hasAttribute('data-clear-selection')){state.selected.clear();renderProducts();renderCompare()}
    if(b.dataset.observe){$('hiObservationBrand').value=b.dataset.observe;$('hiObservationUrl').value=b.dataset.url||'';$('hiObservationNote').focus()}
  });
  section.addEventListener('change',e=>{if(e.target.dataset.pick)pick(e.target.dataset.pick,e.target.checked)});
  for(const [id,key] of [['hiProvider','provider'],['hiTech','tech'],['hiSegment','segment']])$(id).addEventListener('change',e=>{state[key]=e.target.value;renderProducts()});
  $('hiSearch').addEventListener('input',e=>{state.search=e.target.value;renderProducts()});
  $('hiBestOnly').addEventListener('change',e=>{state.bestOnly=e.target.checked;renderProducts()});
  $('hiAdCountry').addEventListener('change',renderSocial);
  $('hiObservationForm').addEventListener('submit',saveObservation);
}
function bestRows(rows){
  if(!state.bestOnly)return rows;
  const map=new Map();
  for(const r of rows){
    const k=[r.provider,r.name,r.technology,r.speed_down_mbps,r.speed_up_mbps,r.market_segment].join('|'),old=map.get(k);
    if(!old||old.stale&&!r.stale||old.stale===r.stale&&(r.effective_monthly_try??Infinity)<(old.effective_monthly_try??Infinity))map.set(k,r);
  }
  // Selected contract variants stay visible while comparing.
  const keys=new Set([...map.values()].map(x=>x.product_key));
  return [...map.values(),...rows.filter(x=>state.selected.has(x.product_key)&&!keys.has(x.product_key))];
}
function filtered(){
  let rows=(state.data?.products||[]).filter(x=>(x.product_family||'fixed')===state.family);
  if(state.provider!=='Tümü')rows=rows.filter(x=>x.provider===state.provider);
  if(state.tech!=='Tümü')rows=rows.filter(x=>x.technology===state.tech);
  if(state.segment!=='all')rows=rows.filter(x=>(x.market_segment||'residential')===state.segment);
  const query=state.search.toLocaleLowerCase('tr');if(query)rows=rows.filter(x=>[x.name,x.provider,x.speed_down_mbps].join(' ').toLocaleLowerCase('tr').includes(query));
  return bestRows(rows).sort((a,b)=>Number(a.stale)-Number(b.stale)||(a.effective_monthly_try??Infinity)-(b.effective_monthly_try??Infinity)||a.provider.localeCompare(b.provider,'tr'));
}
function renderProducts(){
  const rows=filtered();$('hiRowCount').textContent=rows.length+' teklif';
  $('hiProducts').innerHTML=rows.map(x=>'<tr class="'+(x.stale?'hi-stale':'')+'"><td><input type="checkbox" data-pick="'+esc(x.product_key)+'" '+(state.selected.has(x.product_key)?'checked':'')+' aria-label="'+esc(x.provider+' '+x.name+' '+term(x)+' karşılaştır')+'"></td><td><b>'+esc(x.provider)+'</b><div>'+link(x.product_url||x.source_url,x.name)+'</div><small>'+esc(x.market_segment==='business'?'Kurumsal':'Bireysel')+'</small></td><td>'+esc(x.technology)+'</td><td>'+num(x.speed_down_mbps)+' / '+num(x.speed_up_mbps)+' Mbps</td><td>'+esc(term(x))+'</td><td>'+money(x.total_price_try)+'</td><td><b>'+esc(price(x))+'</b></td><td>'+money(x.install_fee_try)+'</td><td><span class="status '+(x.stale?'warn':'ok')+'">'+(x.stale?'Son doğrulanmış':'Doğrulandı')+'</span><small>'+dt(x.verified_at)+'</small></td></tr>').join('')||'<tr><td colspan="9" class="empty">Bu filtrede doğrulanmış teklif yok. Firma kapsamından kaynak durumunu ve resmî paket sayfasını kontrol edebilirsiniz.</td></tr>';
}
function pick(key,checked){
  $('hiMessage').textContent='';
  if(checked){
    if(state.selected.size>=4){$('hiMessage').textContent='Aynı anda en fazla 4 teklif karşılaştırabilirsiniz.';renderProducts();return}
    const rows=(state.data?.products||[]),candidate=rows.find(x=>x.product_key===key),existing=rows.find(x=>state.selected.has(x.product_key));
    if(existing&&candidate&&(existing.product_family||'fixed')!==(candidate.product_family||'fixed')){$('hiMessage').textContent='Sabit internet ve FWA tekliflerini ayrı karşılaştırın. Önce mevcut seçimi temizleyin.';renderProducts();return}
    state.selected.add(key);
  }else state.selected.delete(key);
  renderCompare();
}
function renderCompare(){
  $('hiSelectedCount').textContent=state.selected.size?'('+state.selected.size+')':'';
  const rows=(state.data?.products||[]).filter(x=>state.selected.has(x.product_key));
  if(rows.length<2){$('hiCompareResult').innerHTML='<p class="hi-help">Yan yana görmek için aşağıdaki paketlerden 2–4 teklif seçin.</p>';return}
  const fields=[
    ['Teknoloji',x=>esc(x.technology)],['Hizmet türü',x=>x.market_segment==='business'?'Kurumsal':'Bireysel'],
    ['İndirme',x=>num(x.speed_down_mbps)+' Mbps'],['Yükleme',x=>num(x.speed_up_mbps)+' Mbps'],
    ['Kota',x=>x.unlimited===true?'Limitsiz':x.data_limit_gb?num(x.data_limit_gb)+' GB':'Kaynakta belirtilmiyor'],
    ['Ödeme ve hediye süre',x=>esc(term(x))],['Toplam paket',x=>money(x.total_price_try)],
    ['Efektif aylık',x=>'<b>'+esc(price(x))+'</b>'],['Kurulum',x=>money(x.install_fee_try)],
    ['12 ay eşdeğer',x=>money(x.first_year_equiv_try)],['Mbps / 100 TL',x=>num(x.mbps_per_100tl,2)],
    ['Koşullar',x=>esc((x.features||[]).join(' • ')||'Kaynağı kontrol edin')],
    ['Son doğrulama',x=>(x.stale?'Güncellik doğrulanamadı • ':'')+dt(x.verified_at)],
    ['Kaynak',x=>link(x.source_url,'Paket sayfası')]
  ];
  const mixed=new Set(rows.map(x=>[x.technology,x.market_segment,term(x),x.unlimited,x.data_limit_gb].join('|'))).size>1;
  $('hiCompareResult').innerHTML=(mixed?'<p class="hi-help hi-warning">Teknoloji, süre, kota veya hizmet türü farklı. Bu tablo koşulları yan yana gösterir; otomatik eşdeğerlik sonucu değildir.</p>':'')+
    '<div class="table-wrap"><table class="data-table hi-comparison"><thead><tr><th>Özellik</th>'+rows.map(x=>'<th>'+esc(x.provider)+'<br>'+esc(x.name)+'</th>').join('')+'</tr></thead><tbody>'+
    fields.map(([label,render])=>'<tr><th scope="row">'+esc(label)+'</th>'+rows.map(x=>'<td>'+render(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p class="hi-help">12 ay eşdeğer toplamı bir yıllık satış teklifi değildir. Gün bazlı paketler için 30 gün bir ay kabul edilir. Fiyatı belirtilmeyen hizmetlere sıfır fiyat atanmaz.</p>';
}
function renderKpis(){
  const d=state.data,rows=d.products.filter(x=>(x.product_family||'fixed')===state.family),current=rows.filter(x=>!x.stale);
  const cards=[['BTHK şirket kapsamı',d.companies?.length||0,'29 şirket • 2026 Q2 listesi'],['Paket verisi alınan şirket',d.metrics.tracked_companies||0,'Kaynak durumu aşağıda'],['Güncel teklif',current.length,current.filter(x=>x.effective_monthly_try>0).length+' fiyatlı • '+rows.filter(x=>x.stale).length+' eski kayıt'],['7 günlük değişiklik',d.metrics.changes_7d||0,'Fiyat, hız ve süre takibi']];
  $('hiKpis').innerHTML=cards.map(([label,value,note])=>'<article class="hi-kpi"><span>'+esc(label)+'</span><strong>'+num(value)+'</strong><small>'+esc(note)+'</small></article>').join('');
}
function changeValue(v){
  if(v==null)return '—';try{const p=JSON.parse(v);if(p&&typeof p==='object')return p.name||'Paket kaydı'}catch{}return String(v);
}
function renderChanges(){
  const sources=new Set((state.data.sources||[]).filter(s=>state.family==='fwa'?/superbox|redbox/.test(s.slug):!/superbox|redbox/.test(s.slug)).map(x=>x.slug));
  const changes=(state.data.changes||[]).filter(c=>sources.has(c.source_slug));
  $('hiChanges').innerHTML=changes.length?changes.slice(0,24).map(c=>'<div class="hi-change"><div><b>'+esc(c.provider+' • '+(c.product_name||'Paket'))+'</b><small>'+esc(c.change_type==='added'?'Yeni paket':c.change_type==='removed'?'Paket kaldırıldı':c.field_name)+' • '+esc(changeValue(c.old_value))+' → '+esc(changeValue(c.new_value))+'</small></div><small>'+dt(c.detected_at)+'</small></div>').join(''):'<p class="hi-help">Henüz değişiklik yok. İlk başarılı tarama başlangıç kaydı oluşturur; sonraki başarılı taramalar karşılaştırılır.</p>';
}
function renderCoverage(){
  const companies=state.data.companies||[];$('hiCoverageCount').textContent=companies.length+' şirket';
  $('hiScopeNote').innerHTML=esc(state.data.scope?.note||'')+' '+link(state.data.scope?.report_url,'BTHK raporu')+' • '+link(state.data.scope?.directory_url,'Resmî firma rehberi');
  $('hiCompanies').innerHTML=companies.map(c=>'<tr><td><b>'+esc(c.legal_name)+'</b><small>'+esc(c.brands.join(' • '))+'</small></td><td>'+ (c.website?link(c.website,'Web sitesi'):'Site doğrulanamadı')+'<div class="hi-source-links">'+c.sources.map(s=>link(s.url,s.name)).join('<br>')+'</div></td><td><span class="status '+(['tracked','partial'].includes(c.status)?'ok':'warn')+'">'+esc(statusText[c.status]||c.status)+'</span></td><td>'+num(c.current_products)+' güncel<br><small>'+num(c.priced_products)+' fiyatlı</small></td></tr>').join('');
  $('hiSourceCount').textContent=state.data.sources.length+' kaynak';
  $('hiSources').innerHTML=state.data.sources.map(s=>'<div class="hi-source"><div><b>'+link(s.url,s.name)+'</b><small>'+esc(s.ownership_group||'')+'</small>'+(s.error?'<small class="hi-source-error">'+esc(s.error)+'</small>':'')+'</div><div class="hi-source-meta"><span class="status '+(s.status==='ok'?'ok':'warn')+'">'+esc(statusText[s.status]||s.status)+'</span><small>'+num(s.parsed_count)+' teklif'+(s.retained_count?' • '+s.retained_count+' eski kayıt korunuyor':'')+'</small><small>'+dt(s.captured_at)+'</small></div></div>').join('');
}
function populateFilters(){
  const fam=state.data.products.filter(x=>(x.product_family||'fixed')===state.family);
  const providers=[...new Set([...(state.data.sources||[]).map(x=>x.provider),...fam.map(x=>x.provider)])].sort((a,b)=>a.localeCompare(b,'tr'));
  $('hiProvider').innerHTML='<option>Tümü</option>'+providers.map(x=>'<option>'+esc(x)+'</option>').join('');$('hiProvider').value=state.provider;
  $('hiTech').innerHTML='<option>Tümü</option>'+[...new Set(fam.map(x=>x.technology).filter(Boolean))].sort().map(x=>'<option>'+esc(x)+'</option>').join('');$('hiTech').value=state.tech;
}
function renderSocial(){
  const country=$('hiAdCountry').value,rows=state.data.social||[];
  $('hiSocialCards').innerHTML=rows.map(s=>{
    const u=new URL(s.ad_library_url);u.searchParams.set('country',country);
    const last=state.observations.find(x=>x.brand===s.brand);
    return '<article class="hi-social-card"><h3>'+esc(s.brand)+'</h3><p>'+link(u.href,s.ad_library_type==='verified_page'?'Ad Library • Doğrulanmış sayfa':'Ad Library • Marka araması')+'</p><p>'+(s.facebook?link(s.facebook,'Facebook'):'<span>Facebook doğrulanmadı</span>')+'</p><p>'+(s.instagram?link(s.instagram,'Instagram'):'<span>Instagram doğrulanmadı</span>')+'</p><small>'+(last?'Son manuel gözlem '+dt(last.created_at):'Henüz manuel gözlem yok')+'</small><button class="btn" data-observe="'+esc(s.brand)+'" data-url="'+esc(s.facebook||u.href)+'">Gözlem ekle</button></article>';
  }).join('');
  const prev=$('hiObservationBrand').value;$('hiObservationBrand').innerHTML=rows.map(s=>'<option>'+esc(s.brand)+'</option>').join('');if(prev)$('hiObservationBrand').value=prev;
}
function renderObservations(){
  $('hiObservations').innerHTML=state.observations.length?state.observations.map(x=>'<div class="hi-note"><div><b>'+esc(x.brand)+'</b> • '+esc({ad:'Reklam',post:'Paylaşım',page:'Sayfa'}[x.kind]||x.kind)+' <small>'+dt(x.created_at)+'</small></div><p>'+esc(x.note)+'</p>'+link(x.source_url,'Kaynağı aç')+'</div>').join(''):'<p class="hi-help">Henüz kaydedilmiş gözlem yok. Reklam veya paylaşım bağlantısını açıp gördüklerinizi kaydedebilirsiniz.</p>';
}
async function loadSocial(){
  try{const r=await fetch('/api/home-internet/social-observations',{cache:'no-store'});if(!r.ok)throw new Error('Gözlem geçmişi alınamadı');const data=await r.json();state.observations=data.rows||[];state.socialLoaded=true;renderSocial();renderObservations()}
  catch(e){$('hiObservations').textContent=e.message}
}
async function saveObservation(e){
  e.preventDefault();const button=$('hiSaveObservation');button.disabled=true;$('hiObservationStatus').textContent='Kaydediliyor…';
  try{
    const r=await fetch('/api/home-internet/social-observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:$('hiObservationBrand').value,kind:$('hiObservationKind').value,source_url:$('hiObservationUrl').value,note:$('hiObservationNote').value})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Kaydedilemedi');
    state.observations.unshift(data.row);$('hiObservationNote').value='';$('hiObservationStatus').textContent='Gözlem kaydedildi.';renderSocial();renderObservations();
  }catch(e){$('hiObservationStatus').textContent=e.message}finally{button.disabled=false}
}
function render(){
  if(!state.data)return;
  const keys=new Set(state.data.products.map(x=>x.product_key));state.selected=new Set([...state.selected].filter(k=>keys.has(k)));
  document.querySelectorAll('[data-family]').forEach(b=>{b.classList.toggle('active',b.dataset.family===state.family);b.setAttribute('aria-pressed',String(b.dataset.family===state.family))});
  renderKpis();renderChanges();populateFilters();renderProducts();renderCompare();renderCoverage();renderSocial();renderObservations();
  const times=state.data.sources.map(x=>x.captured_at).filter(Boolean).sort();$('hiUpdated').textContent='Son tarama '+dt(times.at(-1));
  setView(state.view);
}
function setView(view){
  if(!['tracking','compare','social'].includes(view))return;state.view=view;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view))});
  $('hiMarketViews').hidden=view==='social';$('hiSocialView').hidden=view!=='social';
  $('hiTrackingTop').hidden=view!=='tracking';$('hiTrackingBottom').hidden=view!=='tracking';$('hiCompareView').hidden=view!=='compare';
  if(view==='social'&&state.data&&!state.socialLoaded)loadSocial();
}
function setFamily(family){state.family=family==='fwa'?'fwa':'fixed';state.provider='Tümü';state.tech='Tümü';render()}
async function load(force=false){
  ensure();if(state.loading)return;state.loading=true;const button=$('hiScanBtn');button.disabled=true;button.textContent=force?'Taranıyor…':'Yükleniyor…';$('hiMessage').textContent='';
  try{
    const r=await fetch('/api/home-internet'+(force?'?refresh=1':''),{cache:'no-store'});
    if(!r.ok)throw new Error(r.status===401?'Oturum süresi doldu. Tekrar giriş yapın.':'Ev interneti verisi alınamadı');
    state.data=await r.json();render();
  }catch(e){$('hiMessage').textContent=e.message}
  finally{state.loading=false;button.disabled=false;button.textContent='Şimdi Tara'}
}
window.HomeInternetUI={ensure,load,scan:()=>load(true),setFamily,setView};
function init(){ensure();if(location.hash==='#home')load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();