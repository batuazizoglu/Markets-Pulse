(()=>{
const labels={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'İnceleme Bekleyen'};
const state={data:null,category:'home',brand:'all',loading:null,loaded:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v&&Number.isFinite(+new Date(v))?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'Henüz yok';
const money=v=>v==null?'Fiyat okunamadı':Number(v).toLocaleString('tr-TR')+' TL';
const statusText={ok:'İnceleme güncel',partial:'Kısmi kapsam',blocked:'Kaynağa erişilemiyor',error:'İnceleme hatası',unverified:'Sayfa doğrulanmadı',no_ads:'Bu filtrede reklam yok',pending:'İlk inceleme bekleniyor',stale:'Yeni inceleme bekleniyor',sync_error:'Son aktarım başarısız'};
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['facebook.com','www.facebook.com','instagram.com','www.instagram.com'].includes(u.hostname)?u.href:'#'}catch{return '#'}}
function imageUrl(hash){return /^[a-f0-9]{64}$/.test(hash||'')?'/api/ad-visuals/evidence/'+hash+'.jpg':''}
function offerText(o={}){
  return [o.price_try==null?'Fiyat okunamadı':money(o.price_try)+(o.billing_period==='monthly'?' / ay':o.billing_period==='unknown'?' • Dönem doğrulanmadı':''),
    o.data_gb==null?null:o.data_gb+' GB',o.bonus_data_gb==null?null:'+'+o.bonus_data_gb+' GB bonus',
    o.minutes==null?null:o.minutes+' DK',o.speed_mbps==null?null:o.speed_mbps+' Mbps'].filter(Boolean).join(' · ');
}
function frame(root,home=false){
  root.classList.add('av-root');root.dataset.home=home?'1':'0';
  root.innerHTML='<div class="av-heading"><div><h2>'+(home?'Ev İnterneti Reklam Analizi':'Reklam Görsel Analizi')+'</h2><p>Görsellerden okunan teklifler, kampanya koşulları ve tarihli kanıtlar.</p></div><button class="btn" data-av-refresh>Sonuçları yenile</button></div>'+
    (home?'<p><a href="#ads">GSM ve MNP reklamlarını ayrı görüntüle →</a></p>':'<nav class="av-tabs" aria-label="Reklam kategorileri"></nav><label class="av-filter">Marka <select data-av-brand aria-label="Reklam markası"><option value="all">Tüm markalar</option></select></label>')+
    '<div class="av-status" role="status">İnceleme bilgileri yükleniyor…</div><div class="av-cards"></div><details class="av-coverage"><summary>İnceleme kapsamı ve kaynak durumu</summary><div></div></details>'+
    '<p class="av-help">Sayılar reklam kayıtlarını gösterir; aynı kampanya farklı reklam kimlikleriyle yayınlanabilir. Görseldeki teklif, paket kataloğuna ve karşılaştırma skoruna otomatik uygulanmaz.</p>';
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-av-refresh'))load(true);
    if(b.dataset.avCategory)setCategory(b.dataset.avCategory);
    if(b.dataset.avHistory)history(b);
  });
  root.addEventListener('change',e=>{if(e.target.hasAttribute('data-av-brand')){state.brand=e.target.value;render()}});
}
function card(a){
  const src=imageUrl(a.images?.[0]?.sha256);
  const flags=[a.stale?'Son doğrulanmış kayıt':a.ad_status==='active'?'Son gözlemde aktif':a.ad_status==='inactive'?'Son gözlemde pasif':'Durum belirsiz',a.review_required?'Koşul doğrulaması gerekli':null].filter(Boolean);
  return '<article class="av-card">'+(src?'<a class="av-image" href="'+src+'" target="_blank" rel="noopener"><img loading="lazy" src="'+src+'" alt="'+esc(a.brand+' '+a.title+' reklam kanıtı')+'"></a>':'')+
    '<div class="av-card-body"><div class="av-flags">'+flags.map(f=>'<span>'+esc(f)+'</span>').join('')+'</div><p class="av-brand">'+esc(a.brand)+' • '+esc(labels[a.category])+'</p><h3>'+esc(a.title)+'</h3>'+
    '<p class="av-offer">'+esc(offerText(a.offer))+'</p>'+(a.offer?.previous_price_try==null?'':'<p class="av-help">Görselde üstü çizili fiyat: '+esc(money(a.offer.previous_price_try))+'</p>')+
    '<p>'+esc(a.visual_summary)+'</p><details><summary>Teklif koşulları ve okuma notları</summary><p><b>Sınıflandırma dayanağı:</b> '+esc(a.category_evidence)+'</p>'+
    '<ul>'+(a.conditions||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+((a.uncertainties||[]).length?'<p><b>Doğrulanamayan / okunamayan:</b></p><ul>'+a.uncertainties.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
    '<p>'+esc(a.ad_text)+'</p></details><p class="av-help">Gözlem: '+stamp(a.observed_at)+'<br>İlk kayıt: '+stamp(a.first_seen_at)+'<br>Reklam kimliği: '+esc(a.ad_id)+'</p>'+
    '<div class="av-links"><a href="'+esc(safeLink(a.source_url))+'" target="_blank" rel="noopener noreferrer">Ad Library kaynağı ↗</a>'+
    (a.images||[]).map((x,i)=>'<a href="'+imageUrl(x.sha256)+'" target="_blank" rel="noopener">Kanıt '+(i+1)+' • '+stamp(x.captured_at)+'</a>').join('')+
    '<button class="btn" data-av-history="'+esc(a.key)+'">Teklif geçmişi</button></div><div class="av-history"></div></div></article>';
}
function render(){
  if(!state.data)return;
  const {rows=[],monitoring:m={},groups={}}=state.data;
  for(const root of document.querySelectorAll('.av-root')){
    const home=root.dataset.home==='1',category=home?'home':state.category;
    const nav=root.querySelector('.av-tabs');
    if(nav)nav.innerHTML=Object.entries(labels).filter(([k])=>k!=='review'||groups.review).map(([k,label])=>'<button data-av-category="'+k+'" class="'+(k===category?'active':'')+'" aria-pressed="'+(k===category)+'">'+label+' <span>'+Number(groups[k]||0)+'</span></button>').join('');
    const brand=root.querySelector('[data-av-brand]');
    if(brand){brand.innerHTML='<option value="all">Tüm markalar</option>'+[...new Set(rows.map(x=>x.brand))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');brand.value=state.brand}
    const schedule=m.schedule?.enabled?m.schedule.description:'Düzenli inceleme planı henüz etkin değil';
    root.querySelector('.av-status').innerHTML='<b>'+esc(statusText[m.status]||'İnceleme bekleniyor')+'</b><span>'+esc(schedule)+' • KKTC saati</span><span>Son inceleme: '+stamp(m.checked_at)+' • Uygulamaya aktarım: '+stamp(m.imported_at)+'</span>'+(m.last_error?'<span>'+esc(m.last_error)+'</span>':'');
    const selected=rows.filter(a=>a.category===category&&(home||state.brand==='all'||a.brand===state.brand));
    root.querySelector('.av-cards').innerHTML=selected.map(card).join('')||'<div class="av-empty">Bu kategoride henüz doğrulanmış görsel analizi yok. Bu durum reklam olmadığı anlamına gelmez; inceleme kapsamını aşağıdan kontrol edin.</div>';
    root.querySelector('.av-coverage div').innerHTML=(m.coverage||[]).map(c=>'<div class="av-source"><b>'+esc(c.brand)+'</b><span>'+esc(c.stale?'Yeni inceleme bekleniyor':statusText[c.status]||c.status)+' • '+esc(c.country)+' • '+stamp(c.checked_at)+'</span><p>'+esc(c.note)+'</p><a href="'+esc(safeLink(c.source_url))+'" target="_blank" rel="noopener noreferrer">Kaynağı aç ↗</a></div>').join('')||'<p>Henüz kaynak inceleme kaydı yok.</p>';
  }
}
async function history(button){
  button.disabled=true;
  const box=button.closest('.av-card-body').querySelector('.av-history');
  try{
    const r=await fetch('/api/ad-visuals/history?key='+encodeURIComponent(button.dataset.avHistory),{cache:'no-store'});if(!r.ok)throw new Error('Teklif geçmişi alınamadı');
    const data=await r.json();
    box.innerHTML=(data.rows||[]).map(x=>'<div><b>'+stamp(x.observed_at)+' • '+(x.event_type==='first_seen'?'İlk gözlem':'Değişiklik')+'</b><p>'+esc(offerText(x.analysis_json?.offer))+'</p><p>'+esc((x.analysis_json?.conditions||[]).join(' · '))+'</p></div>').join('')||'<p>Geçmiş kayıt yok.</p>';
  }catch(e){box.textContent=e.message}finally{button.disabled=false}
}
function load(force=false){
  if(state.loading)return state.loading;
  if(!force&&state.data&&Date.now()-state.loaded<60000){render();return Promise.resolve()}
  state.loading=(async()=>{
    try{const r=await fetch('/api/ad-visuals',{cache:'no-store'});if(!r.ok)throw new Error('Reklam analizi alınamadı');state.data=await r.json();state.loaded=Date.now();render()}
    catch(e){for(const el of document.querySelectorAll('.av-status'))el.textContent=e.message}
  })().finally(()=>{state.loading=null});return state.loading;
}
function setCategory(category){if(!Object.hasOwn(labels,category))return;state.category=category;render()}
function mountHome(){const root=document.getElementById('hiAdVisualMount');if(!root)return;if(!root.classList.contains('av-root'))frame(root,true);load()}
function init(){
  const shell=document.querySelector('.shell');if(!shell)return;
  const section=document.createElement('section');section.id='ad-visual-section';section.className='section';frame(section);shell.append(section);
  if(location.hash==='#ads')load();
}
window.AdVisualUI={load,setCategory,mountHome};
init();
})();
