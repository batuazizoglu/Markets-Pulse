(()=>{
const labels={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'Diğer / Belirsiz'};
const state={data:null,category:'home',brand:'all',loading:null,loaded:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v&&Number.isFinite(+new Date(v))?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'Henüz yok';
const money=v=>v==null?'Fiyat okunamadı':Number(v).toLocaleString('tr-TR')+' TL';
const statusText={ok:'İnceleme güncel',partial:'Kısmi kapsam',blocked:'Kaynağa erişilemiyor',error:'İnceleme hatası',unverified:'Sayfa doğrulanmadı',no_ads:'Bu filtrede reklam yok',pending:'İlk inceleme bekleniyor',stale:'Yeni inceleme bekleniyor',sync_error:'Son aktarım başarısız'};
const sourceStatus={queued:'Tarama kuyruğunda',running:'Taranıyor',retry:'Yeniden denenecek',partial:'Kısmi kapsam',unverified:'Sayfa kimliği doğrulanmadı',blocked:'Kaynağa erişilemiyor',error:'Tarama tamamlanamadı',no_ads:'Son taramada bu filtrede reklam bulunamadı',not_scanned:'Henüz taranmadı'};
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['facebook.com','www.facebook.com','instagram.com','www.instagram.com'].includes(u.hostname)?u.href:'#'}catch{return '#'}}
function imageUrl(hash){return /^[a-f0-9]{64}$/.test(hash||'')?'/api/ad-visuals/evidence/'+hash+'.jpg':''}
function sourceDirectory(data){
  const sources=new Map(),ensure=brand=>{if(!sources.has(brand))sources.set(brand,{brand});return sources.get(brand)};
  for(const source of data.source_directory||[])Object.assign(ensure(source.brand),source);
  for(const source of data.monitoring?.coverage||[])Object.assign(ensure(source.brand),{legacy:source});
  for(const source of data.cloud?.sources||[])Object.assign(ensure(source.brand),{live:source});
  for(const row of data.rows||[]){const source=ensure(row.brand);source.page_id||=row.page_id;source.ad_library_url||=row.source_url}
  return [...sources.values()].filter(s=>typeof s.brand==='string'&&s.brand).map(s=>{
    const latest=s.live||s.legacy,verified=/^\d{5,30}$/.test(s.page_id||'');
    return {...s,verified,status:latest?.status||(verified?'not_scanned':'unverified'),note:latest?.note||'',
      checked_at:s.live?(s.live.finished_at||null):s.legacy?.checked_at,available_at:s.live?.available_at,
      captured:s.live?.captured||0,url:s.ad_library_url||s.legacy?.source_url,country:s.country||s.legacy?.country,
      rows:(data.rows||[]).filter(row=>row.brand===s.brand)};
  }).sort((a,b)=>a.brand.localeCompare(b.brand,'tr'));
}
function sourceCard(source){
  const pending=source.rows.filter(a=>['pending','retry'].includes(a.ai_queue_status)).length;
  const status=source.live?(source.status==='partial'&&source.captured>0?'Görseller kaydedildi':sourceStatus[source.status]||statusText[source.status]):source.legacy?.stale?'Yeni inceleme bekleniyor':sourceStatus[source.status]||statusText[source.status];
  const url=safeLink(source.url);
  return '<div class="av-source" data-av-source="'+esc(source.brand)+'"><b>'+esc(source.brand)+'</b><span>'+esc(status||'İnceleme bekleniyor')+'</span>'+
    (source.country?'<span>Ülke filtresi: '+esc(source.country==='CY'?'Kıbrıs (CY)':source.country)+'</span>':'')+
    (source.note?'<p>'+esc(source.note)+'</p>':'')+
    (pending?'<p>AI incelemesi bekleyen: '+pending+'</p>':source.captured>0&&!source.rows.length?'<p>Görseller kaydedildi; analiz sonucu henüz yayınlanmadı.</p>':'')+
    '<span>Son tamamlanan tarama: '+stamp(source.checked_at)+'</span>'+
    (source.status==='retry'?'<span>Sonraki deneme: '+stamp(source.available_at)+'</span>':'')+
    (url!=='#'?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Ad Library kaynağını aç ↗</a>':'')+'</div>';
}
function offerText(o={}){
  return [o.price_try==null?'Fiyat okunamadı':money(o.price_try)+(o.billing_period==='monthly'?' / ay':o.billing_period==='unknown'?' • Dönem doğrulanmadı':''),
    o.data_gb==null?null:o.data_gb+' GB',o.bonus_data_gb==null?null:'+'+o.bonus_data_gb+' GB bonus',
    o.minutes==null?null:o.minutes+' DK',o.speed_mbps==null?null:o.speed_mbps+' Mbps'].filter(Boolean).join(' · ');
}
function frame(root,home=false){
  root.classList.add('av-root');root.dataset.home=home?'1':'0';
  root.innerHTML='<div class="av-heading"><div><h2>'+(home?'Ev İnterneti Reklam Analizi':'Reklam Görsel Analizi')+'</h2><p>Görsellerden okunan teklifler, kampanya koşulları ve tarihli kanıtlar.</p></div><button class="btn" data-av-scan>Bulutta tara</button><button class="btn" data-av-refresh>Sonuçları yenile</button></div>'+
    (home?'<p><a href="#ads">GSM ve MNP reklamlarını ayrı görüntüle →</a></p>':'<nav class="av-tabs" aria-label="Reklam kategorileri"></nav>')+
    '<label class="av-filter">Marka <select data-av-brand aria-label="Reklam markası"><option value="all">Tüm markalar</option></select></label>'+
    '<div class="av-status" role="status">İnceleme bilgileri yükleniyor…</div><div class="av-review-info"></div><div class="av-job-message" role="status"></div><div class="av-source-focus" aria-live="polite"></div><div class="av-cards"></div><details class="av-cloud"><summary>Bulut taraması ve analiz kuyruğu</summary><div></div></details><details class="av-coverage"><summary>İnceleme kapsamı ve kaynak durumu</summary><div></div></details>'+
    '<p class="av-help">Sayılar reklam kayıtlarını gösterir; aynı kampanya farklı reklam kimlikleriyle yayınlanabilir. Görseldeki teklif, paket kataloğuna ve karşılaştırma skoruna otomatik uygulanmaz.</p>';
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-av-refresh'))load(true);
    if(b.hasAttribute('data-av-scan'))scan();
    if(b.hasAttribute('data-av-analyze'))analyze(b.dataset.avAnalyze||null);
    if(b.dataset.avCategory)setCategory(b.dataset.avCategory);
    if(b.dataset.avHistory)history(b);
  });
  root.addEventListener('change',e=>{if(e.target.hasAttribute('data-av-brand')){state.brand=e.target.value;render()}});
}
function card(a){
  const src=imageUrl((a.images?.[1]||a.images?.[0])?.sha256);
  const aiPending=['pending','retry'].includes(a.ai_queue_status);
  const aiLabel=aiPending?(a.ai_analysis?'AI yeniden inceliyor':'AI inceleme kuyruğunda'):a.ai_queue_status==='error'?'AI incelemesi tamamlanamadı':a.ai_analysis?.status==='completed'?'AI incelemesi tamamlandı':null;
  const flags=[aiLabel,a.stale?'Son doğrulanmış kayıt':a.ad_status==='active'?'Son gözlemde aktif':a.ad_status==='inactive'?'Son gözlemde pasif':'Durum belirsiz',(a.uncertainties||[]).length?'Belirsiz alanlar var':null].filter(Boolean);
  return '<article class="av-card">'+(src?'<a class="av-image" href="'+src+'" target="_blank" rel="noopener"><img loading="lazy" src="'+src+'" alt="'+esc(a.brand+' '+a.title+' reklam kanıtı')+'"></a>':'')+
    '<div class="av-card-body"><div class="av-flags">'+flags.map(f=>'<span>'+esc(f)+'</span>').join('')+'</div><p class="av-brand">'+esc(a.brand)+' • '+esc(labels[a.category])+'</p><h3>'+esc(a.title)+'</h3>'+
    '<p class="av-offer">'+esc(offerText(a.offer))+'</p>'+(a.offer?.previous_price_try==null?'':'<p class="av-help">Görselde üstü çizili fiyat: '+esc(money(a.offer.previous_price_try))+'</p>')+
    '<p>'+esc(a.visual_summary)+'</p><details><summary>Teklif koşulları ve okuma notları</summary><p><b>Sınıflandırma dayanağı:</b> '+esc(a.category_evidence)+'</p>'+
    '<ul>'+(a.conditions||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+((a.uncertainties||[]).length?'<p><b>Doğrulanamayan / okunamayan:</b></p><ul>'+a.uncertainties.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
    '<p>'+esc(a.ad_text)+'</p></details><p class="av-help">Görselin alındığı tarih: '+stamp(a.observed_at)+(a.ai_analysis?'<br>AI incelemesi: '+stamp(a.ai_analysis.analyzed_at)+' • '+Number(a.ai_analysis.pass||1)+'. okuma':'')+'<br>İlk kayıt: '+stamp(a.first_seen_at)+'<br>Reklam kimliği: '+esc(a.ad_id)+'</p>'+
    '<div class="av-links"><a href="'+esc(safeLink(a.source_url))+'" target="_blank" rel="noopener noreferrer">Ad Library kaynağı ↗</a>'+
    (a.images||[]).map((x,i)=>'<a href="'+imageUrl(x.sha256)+'" target="_blank" rel="noopener">Kanıt '+(i+1)+' • '+stamp(x.captured_at)+'</a>').join('')+
    '<button class="btn" data-av-analyze="'+esc(a.key)+'"'+(aiPending?' disabled':'')+'>AI ile yeniden incele</button><button class="btn" data-av-history="'+esc(a.key)+'">Teklif geçmişi</button></div><div class="av-history"></div></div></article>';
}
function render(){
  if(!state.data)return;
  const {rows=[],monitoring:m={},groups={}}=state.data;
  const sources=sourceDirectory(state.data);
  for(const root of document.querySelectorAll('.av-root')){
    const home=root.dataset.home==='1',category=home?'home':state.category;
    const nav=root.querySelector('.av-tabs');
    if(nav)nav.innerHTML=Object.entries(labels).filter(([k])=>k!=='review'||groups.review).map(([k,label])=>'<button data-av-category="'+k+'" class="'+(k===category?'active':'')+'" aria-pressed="'+(k===category)+'">'+label+' <span>'+Number(groups[k]||0)+'</span></button>').join('');
    root.querySelector('.av-review-info').innerHTML=category==='review'?'<p>Bu reklamlar da AI tarafından incelenir. Cihaz, marka ve hizmet duyuruları veya kategorisi kesinleşmeyen reklamlar burada gösterilir. Analiz durumu her kartta ayrıca belirtilir.</p><button class="btn" data-av-analyze>Tüm diğer / belirsiz kayıtları AI ile yeniden incele</button>':'';
    const brand=root.querySelector('[data-av-brand]');
    if(brand){brand.innerHTML='<option value="all">Tüm markalar</option>'+sources.map(x=>'<option value="'+esc(x.brand)+'">'+esc(x.brand)+'</option>').join('');brand.value=state.brand}
    const schedule=m.schedule?.enabled?m.schedule.description:'Düzenli inceleme planı henüz etkin değil';
    root.querySelector('.av-status').innerHTML='<b>'+esc(statusText[m.status]||'İnceleme bekleniyor')+'</b><span>'+esc(schedule)+' • KKTC saati</span><span>Son inceleme: '+stamp(m.checked_at)+' • Uygulamaya aktarım: '+stamp(m.imported_at)+'</span>'+(m.last_error?'<span>'+esc(m.last_error)+'</span>':'');
    const cloud=state.data.cloud;
    if(cloud){
      root.querySelector('.av-status').innerHTML+='<span><b>'+esc(cloud.vision_configured?'Görsel analiz bağlantısı tanımlı':'Görsel analiz bağlantısı bekleniyor')+'</b> • '+esc(cloud.worker_online?'Sunucu görevi çalışıyor':'Sunucu görevi kontrol edilmeli')+'</span><span>'+esc(cloud.message)+'</span>';
      if(cloud.capture_transport){
        const transport=cloud.capture_transport;
        root.querySelector('.av-status').innerHTML+='<span><b>'+esc(transport.mode==='proxy'?'Birincil tarama: Proxy':'Birincil tarama: Doğrudan bağlantı')+'</b> • '+esc(transport.message)+'</span>';
        if(transport.mode==='proxy'&&transport.proxy_count){
          const labels={unverified:'Henüz doğrulanmadı',ready:'Son bağlantı başarılı',cooldown:'Geçici olarak bekliyor'};
          root.querySelector('.av-status').innerHTML+='<span>'+Number(transport.proxy_count)+' bağlantı • '+Number(transport.available_count||0)+' bağlantı denemeye uygun</span>'+(transport.proxies||[]).map(p=>'<span><b>'+esc(p.id)+'</b>: '+esc(labels[p.state]||'Kontrol bekleniyor')+(p.retry_at?' • Sonraki deneme: '+stamp(p.retry_at):'')+'</span>').join('');
        }
      }
      const c=cloud.candidates||{};
      root.querySelector('.av-cloud div').innerHTML='<p>AI incelemesi bekleyen: '+Number((c.pending||0)+(c.retry||0))+' • Analizi tamamlanan: '+Number(c.analyzed||0)+' • Hatalı: '+Number(c.error||0)+'</p><p>Sunucu kontrolü: '+stamp(cloud.worker_heartbeat)+'</p>';
    }else root.querySelector('.av-cloud div').textContent='Bulut görevi bilgileri bekleniyor.';
    const selected=rows.filter(a=>a.category===category&&(state.brand==='all'||a.brand===state.brand)),focus=sources.find(s=>s.brand===state.brand);
    root.querySelector('.av-source-focus').innerHTML=focus?sourceCard(focus):'';
    root.querySelector('.av-cards').innerHTML=selected.map(card).join('')||'<div class="av-empty">'+(focus?.status==='no_ads'?'Son kaynak taramasında seçili reklam filtresinde reklam bulunamadı. Yeni taramalarda sonuç değişebilir.':'Bu kategoride henüz doğrulanmış görsel analizi yok. Bu durum reklam olmadığı anlamına gelmez; kaynağın tarama durumunu kontrol edin.')+'</div>';
    const verified=sources.filter(s=>s.verified),unverified=sources.filter(s=>!s.verified),missing=verified.filter(s=>!s.rows.length&&!s.captured&&s.status!=='no_ads');
    root.querySelector('.av-coverage>summary').textContent='İnceleme kapsamı ve kaynak durumu'+(missing.length?' • '+missing.length+' sayfada görsel bekleniyor':'');
    root.querySelector('.av-coverage>div').innerHTML=verified.map(sourceCard).join('')+(unverified.length?'<details class="av-unverified"><summary>Sayfa kimliği doğrulanacak '+unverified.length+' kaynak</summary>'+unverified.map(sourceCard).join('')+'</details>':'')||(sources.length?'':'<p>Henüz kaynak inceleme kaydı yok.</p>');
  }
}
async function history(button){
  button.disabled=true;
  const box=button.closest('.av-card-body').querySelector('.av-history');
  try{
    const r=await fetch('/api/ad-visuals/history?key='+encodeURIComponent(button.dataset.avHistory),{cache:'no-store'});if(!r.ok)throw new Error('Teklif geçmişi alınamadı');
    const data=await r.json();
    box.innerHTML=(data.rows||[]).map(x=>'<div><b>'+stamp(x.observed_at)+' • '+(x.event_type==='first_seen'?'İlk gözlem':x.event_type==='analysis_updated'?'AI yeniden inceledi':'Değişiklik')+'</b><p>'+esc(offerText(x.analysis_json?.offer))+'</p><p>'+esc((x.analysis_json?.conditions||[]).join(' · '))+'</p></div>').join('')||'<p>Geçmiş kayıt yok.</p>';
  }catch(e){box.textContent=e.message}finally{button.disabled=false}
}
function load(force=false){
  if(state.loading)return state.loading;
  if(!force&&state.data&&Date.now()-state.loaded<60000){render();return Promise.resolve()}
  state.loading=(async()=>{
    for(const b of document.querySelectorAll('[data-av-refresh]'))b.disabled=true;
    try{
      const r=await fetch('/api/ad-visuals',{cache:'no-store'});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Reklam analizi alınamadı');state.data=data;state.loaded=Date.now();render();
    }
    catch(e){for(const el of document.querySelectorAll('.av-status'))el.textContent=e.message}
  })().finally(()=>{state.loading=null;for(const b of document.querySelectorAll('[data-av-refresh]'))b.disabled=false});return state.loading;
}
async function scan(){
  for(const b of document.querySelectorAll('[data-av-scan]'))b.disabled=true;
  try{
    const r=await fetch('/api/ad-visuals/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),data=await r.json();
    if(!r.ok)throw new Error(data.error||'Bulut taraması başlatılamadı');
    for(const el of document.querySelectorAll('.av-job-message'))el.textContent=data.message+' Sonuçlar için Sonuçları yenile düğmesini kullanın.';
  }catch(e){for(const el of document.querySelectorAll('.av-job-message'))el.textContent=e.message}
  finally{for(const b of document.querySelectorAll('[data-av-scan]'))b.disabled=false}
}
async function analyze(key){
  for(const b of document.querySelectorAll('[data-av-analyze]'))b.disabled=true;
  try{
    const r=await fetch('/api/ad-visuals/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(key?{key}:{})}),data=await r.json();
    if(!r.ok)throw new Error(data.error||'AI incelemesi başlatılamadı');
    for(const el of document.querySelectorAll('.av-job-message'))el.textContent=data.message+' Sonuçlar için Sonuçları yenile düğmesini kullanın.';
  }catch(e){for(const el of document.querySelectorAll('.av-job-message'))el.textContent=e.message}
  finally{for(const b of document.querySelectorAll('[data-av-analyze]'))b.disabled=false}
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
