(()=>{
const coreLabels={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'Diğer / Belirsiz'};
const state={data:null,category:'home',brand:'all',loading:null,loaded:0,views:new Map(),requests:new Map(),generation:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v&&Number.isFinite(+new Date(v))?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'Henüz yok';
const money=v=>v==null?'Fiyat okunamadı':Number(v).toLocaleString('tr-TR')+' TL';
const statusText={ok:'İnceleme güncel',partial:'Kısmi kapsam',blocked:'Kaynağa erişilemiyor',error:'İnceleme hatası',unverified:'Sayfa doğrulanmadı',no_ads:'Bu filtrede reklam yok',pending:'İlk inceleme bekleniyor',stale:'Yeni inceleme bekleniyor',sync_error:'Son aktarım başarısız'};
const sourceStatus={queued:'Tarama kuyruğunda',running:'Taranıyor',retry:'Yeniden denenecek',partial:'Kısmi kapsam',unverified:'Sayfa kimliği doğrulanmadı',blocked:'Kaynağa erişilemiyor',error:'Tarama tamamlanamadı',no_ads:'Son taramada bu filtrede reklam bulunamadı',not_scanned:'Henüz taranmadı',waiting_config:'Sağlayıcı ayarları bekleniyor',creating:'Sağlayıcı taraması başlatılıyor',importing:'Bulunan reklamlar kaydediliyor',downloading:'Reklam görselleri indiriliyor',complete:'Sağlayıcı işlemi tamamlandı',start_unknown:'Sağlayıcı başlangıcı doğrulanamadı'};
const count=v=>Number.isInteger(Number(v))&&Number(v)>=0?Number(v):0;
const customCategory=key=>typeof key==='string'&&key.length<=80&&/^auto-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
const categoryName=value=>typeof value==='string'&&value.trim()&&value.length<=60?value.trim():null;
function categoryLabels(){
  const labels=Object.assign(Object.create(null),coreLabels),catalog=state.data?.categories;
  if(catalog&&typeof catalog==='object'&&!Array.isArray(catalog))for(const [key,value] of Object.entries(catalog))if(customCategory(key)&&categoryName(value))labels[key]=categoryName(value);
  for(const row of [...(state.data?.rows||[]),...[...state.views.values()].flatMap(view=>view.rows||[])])if(customCategory(row.category)&&!Object.hasOwn(labels,row.category)&&categoryName(row.category_label))labels[row.category]=categoryName(row.category_label);
  return labels;
}
function categoryEntries(labels=categoryLabels()){
  const groups=state.data?.groups||{};
  return Object.entries(labels).filter(([key])=>['home','gsm','mnp'].includes(key)||Object.hasOwn(groups,key)&&count(groups[key])>0);
}
function selectableCategory(category){return categoryEntries().some(([key])=>key===category)}
function categoryLabel(row,labels){return labels[row.category]||categoryName(row.category_label)||coreLabels.review}
function providerCounters(run){return '<p data-av-provider-counts>Bulunan reklam: '+count(run.ads)+' • Keşfedilen görsel / varyant: '+count(run.assets)+' • Kaydedilen: '+count(run.captured)+' • Bekleyen: '+count(run.pending)+' • Medyası eksik: '+count(run.missing)+' • İndirme hatası: '+count(run.errors)+'</p><p>'+esc(run.coverage_complete===true?'Sağlayıcı kapsamı tam olarak doğruladı.':run.limit_reached?'Sağlayıcı sınırına ulaşıldı; kapsam kısmi.':'Kapsamın tam olduğu doğrulanmadı; sıfır sonuç reklam olmadığı anlamına gelmez.')+'</p>'}
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['facebook.com','www.facebook.com','instagram.com','www.instagram.com'].includes(u.hostname)?u.href:'#'}catch{return '#'}}
function imageUrl(hash){return /^[a-f0-9]{64}$/.test(hash||'')?'/api/ad-visuals/evidence/'+hash+'.jpg':''}
function captureBrand(brand,data=state.data){
  const directory=data?.source_directory||[],source=directory.find(s=>s.brand===brand);
  if(!source?.capture_brand||source.capture_brand===brand)return brand;
  const primary=directory.find(s=>s.brand===source.capture_brand);
  return /^\d{5,30}$/.test(source.page_id||'')&&String(primary?.page_id)===String(source.page_id)?primary.brand:brand;
}
function sourceDirectory(data){
  const sources=new Map(),ensure=brand=>{if(!sources.has(brand))sources.set(brand,{brand});return sources.get(brand)};
  for(const source of data.source_directory||[])Object.assign(ensure(source.brand),source);
  for(const source of data.monitoring?.coverage||[])Object.assign(ensure(source.brand),{legacy:source});
  for(const source of data.cloud?.sources||[])Object.assign(ensure(source.brand),{live:source});
  if(data.cloud?.capture_provider?.enabled)for(const run of data.cloud.capture_provider.runs||[]){const source=ensure(run.brand);if(!source.provider||+new Date(run.updated_at)>+new Date(source.provider.updated_at))source.provider=run}
  for(const brand of Object.keys(data.brand_groups||{}))ensure(brand);
  for(const row of data.rows||[]){const source=ensure(row.brand);source.page_id||=row.page_id;source.ad_library_url||=row.source_url}
  return [...sources.values()].filter(s=>typeof s.brand==='string'&&s.brand).map(s=>{
    const capture_brand=captureBrand(s.brand,data),shared=capture_brand!==s.brand;
    if(shared){const primary=sources.get(capture_brand);s={...s,live:primary?.live,provider:primary?.provider,legacy:primary?.legacy}}
    const latest=s.live||s.legacy,verified=/^\d{5,30}$/.test(s.page_id||''),provider=data.cloud?.capture_provider;
    const waiting=provider?.enabled&&provider.configured===false;
    return {...s,capture_brand,shared,verified,status:waiting?'waiting_config':s.provider?(s.provider.coverage_complete===true&&s.provider.ads===0?'no_ads':s.provider.state):latest?.status||(verified?'not_scanned':'unverified'),note:waiting?provider.message:s.provider?(s.provider.last_error||''):latest?.note||'',
      checked_at:s.provider?.updated_at||(s.live?(s.live.finished_at||null):s.legacy?.checked_at),available_at:s.live?.available_at,
      captured:s.provider?.captured??s.live?.captured??0,archive_count:data.brand_groups?Object.values(data.brand_groups[capture_brand]||{}).reduce((n,v)=>n+count(v),0):null,pending_count:data.pending_media?count(data.pending_media.brand_totals?.[capture_brand]):null,url:s.ad_library_url||s.legacy?.source_url,country:s.country||s.legacy?.country,
      rows:(data.rows||[]).filter(row=>row.brand===capture_brand)};
  }).sort((a,b)=>a.brand.localeCompare(b.brand,'tr'));
}
function sourceCard(source){
  const pending=source.pending_count??source.rows.filter(a=>['pending','retry'].includes(a.ai_queue_status)).length;
  const status=source.provider||source.status==='waiting_config'?sourceStatus[source.status]:source.live?(source.status==='partial'&&source.captured>0?'Görseller kaydedildi':sourceStatus[source.status]||statusText[source.status]):source.legacy?.stale?'Yeni inceleme bekleniyor':sourceStatus[source.status]||statusText[source.status];
  const url=safeLink(source.url);
  return '<div class="av-source" data-av-source="'+esc(source.brand)+'"><b>'+esc(source.brand)+'</b><span>'+esc(status||'İnceleme bekleniyor')+'</span>'+
    (source.shared?'<p>Ortak reklam hesabı: '+esc(source.capture_brand)+'. Tarama ve arşiv sayıları bu hesaba aittir; reklamlar bir kez kaydedilir.</p>':'')+
    (source.country?'<span>Ülke filtresi: '+esc(source.country==='CY'?'Kıbrıs (CY)':source.country)+'</span>':'')+
    (source.note?'<p>'+esc(source.note)+'</p>':'')+
    (source.provider?providerCounters(source.provider):'')+
    (source.archive_count!==null?'<p>Arşivdeki analiz: '+count(source.archive_count)+'</p>':'')+
    (pending?'<p>AI sonucu yayınlanmamış görsel: '+pending+'</p>':source.captured>0&&!(source.archive_count??source.rows.length)?'<p>Görseller kaydedildi; analiz sonucu henüz yayınlanmadı.</p>':'')+
    '<span>'+(source.provider?'Sağlayıcı son durumu: ':'Son tamamlanan tarama: ')+stamp(source.checked_at)+'</span>'+
    (source.status==='retry'?'<span>Sonraki deneme: '+stamp(source.available_at)+'</span>':'')+
    (source.research_note?'<p>'+esc(source.research_note)+'</p>':'')+
    (source.research_checked_at?'<span>Hesap araştırması: '+esc(source.research_checked_at)+'</span>':'')+
    '<div class="av-links">'+(url!=='#'?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Ad Library kaynağını aç ↗</a>':'')+
    [['facebook','Facebook sayfası'],['instagram','Instagram hesabı']].filter(([key])=>safeLink(source[key])!=='#').map(([key,label])=>'<a href="'+esc(safeLink(source[key]))+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>').join('')+
    (source.additional_social_links||[]).filter(link=>safeLink(link.url)!=='#').map(link=>'<a href="'+esc(safeLink(link.url))+'" target="_blank" rel="noopener noreferrer">Diğer '+esc(link.platform==='instagram'?'Instagram':'Facebook')+' hesabı ↗</a>').join('')+'</div></div>';
}
function offerText(o={}){
  return [o.price_try==null?'Fiyat okunamadı':money(o.price_try)+(o.billing_period==='monthly'?' / ay':o.billing_period==='unknown'?' • Dönem doğrulanmadı':''),
    o.data_gb==null?null:o.data_gb+' GB',o.bonus_data_gb==null?null:'+'+o.bonus_data_gb+' GB bonus',
    o.minutes==null?null:o.minutes+' DK',o.speed_mbps==null?null:o.speed_mbps+' Mbps'].filter(Boolean).join(' · ');
}
function frame(root,home=false){
  root.classList.add('av-root');root.dataset.home=home?'1':'0';
  root.innerHTML='<div class="av-heading"><div><h2>'+(home?'Ev İnterneti Reklam Analizi':'Reklam Görsel Analizi')+'</h2><p>Görsellerden okunan teklifler, kampanya koşulları ve tarihli kanıtlar.</p></div><button class="btn" data-av-scan>Bulutta tara</button><button class="btn" data-av-refresh>Sonuçları yenile</button></div>'+
    (home?'<p><a href="#ads">Tüm reklam kategorilerini görüntüle →</a></p>':'<nav class="av-tabs" aria-label="Reklam kategorileri"></nav><p class="av-help">AI, mevcut kategorilere uymayan reklamlar için yeni kategori oluşturabilir.</p>')+
    '<label class="av-filter">Marka <select data-av-brand aria-label="Reklam markası"><option value="all">Tüm markalar</option></select></label>'+
    '<div class="av-status" role="status">İnceleme bilgileri yükleniyor…</div><div class="av-review-info"></div><div class="av-job-message" role="status"></div><div class="av-source-focus" aria-live="polite"></div><div class="av-cards"></div><div class="av-pagination" aria-live="polite"></div>'+(home?'':'<details class="av-pending"><summary>AI sonucu beklenen görseller</summary><div class="av-pending-content"></div></details>')+'<details class="av-cloud"><summary>Bulut taraması ve analiz kuyruğu</summary><div></div></details><details class="av-coverage"><summary>İnceleme kapsamı ve kaynak durumu</summary><div></div></details>'+
    '<p class="av-help">Sayılar reklam kayıtlarını gösterir; aynı kampanya farklı reklam kimlikleriyle yayınlanabilir. Görseldeki teklif, paket kataloğuna ve karşılaştırma skoruna otomatik uygulanmaz.</p>';
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-av-refresh'))load(true);
    if(b.hasAttribute('data-av-scan'))scan();
    if(b.hasAttribute('data-av-analyze'))analyze(b.dataset.avAnalyze||null);
    if(b.hasAttribute('data-av-more'))loadView(home?'home':state.category,state.brand,true);
    if(b.hasAttribute('data-av-pending-more'))loadView('pending_media',state.brand,true);
    if(b.dataset.avCategory)setCategory(b.dataset.avCategory);
    if(b.dataset.avHistory)history(b);
  });
  root.addEventListener('change',e=>{if(e.target.hasAttribute('data-av-brand')){state.brand=e.target.value;render();ensureViews()}});
  root.querySelector('.av-pending')?.addEventListener('toggle',e=>{if(e.target.open)loadView('pending_media',state.brand)});
}
function pendingCard(a){
  const source=safeLink(a.source_url);
  return '<article class="av-source av-pending-item"><b>'+esc(a.brand)+'</b><p>'+(a.status==='error'?'AI incelemesi tamamlanamadı.':'AI incelemesi bekliyor.')+' Kategori doğrulanmadı.</p>'+(a.media_kind==='video_preview'?'<p>Video önizlemesi; videonun tamamı incelenmedi.</p>':'')+(a.images||[]).filter(x=>imageUrl(x.sha256)).map(x=>'<a class="av-image" href="'+imageUrl(x.sha256)+'" target="_blank" rel="noopener"><img loading="lazy" src="'+imageUrl(x.sha256)+'" alt="'+esc(a.brand+' kaydedilmiş reklam görseli')+'"></a>').join('')+'<p>'+esc(a.ad_text)+'</p><p>Kaydedilme: '+stamp(a.observed_at)+'<br>Reklam: '+esc(a.ad_id)+' • Varyant: '+esc(a.variant_id)+'</p>'+(source!=='#'?'<a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Ad Library kaynağı ↗</a>':'')+'</article>';
}
function card(a,labels){
  const src=imageUrl((a.images?.[1]||a.images?.[0])?.sha256);
  const aiPending=['pending','retry'].includes(a.ai_queue_status);
  const aiLabel=aiPending?(a.ai_analysis?'AI yeniden inceliyor':'AI inceleme kuyruğunda'):a.ai_queue_status==='error'?'AI incelemesi tamamlanamadı':a.ai_analysis?.status==='completed'?'AI incelemesi tamamlandı':null;
  const flags=[a.media_kind==='video_preview'?'Video önizlemesi incelendi':null,aiLabel,a.stale?'Son doğrulanmış kayıt':a.ad_status==='active'?'Son gözlemde aktif':a.ad_status==='inactive'?'Son gözlemde pasif':'Durum belirsiz',(a.uncertainties||[]).length?'Belirsiz alanlar var':null].filter(Boolean);
  return '<article class="av-card">'+(src?'<a class="av-image" href="'+src+'" target="_blank" rel="noopener"><img loading="lazy" src="'+src+'" alt="'+esc(a.brand+' '+a.title+' reklam kanıtı')+'"></a>':'')+
    '<div class="av-card-body"><div class="av-flags">'+flags.map(f=>'<span>'+esc(f)+'</span>').join('')+'</div><p class="av-brand">'+esc(a.brand)+' • '+esc(categoryLabel(a,labels))+'</p><h3>'+esc(a.title)+'</h3>'+
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
  const {monitoring:m={},groups={}}=state.data;
  const labels=categoryLabels(),categories=categoryEntries(labels);
  if(!categories.some(([key])=>key===state.category))state.category='home';
  const sources=sourceDirectory(state.data);
  for(const root of document.querySelectorAll('.av-root')){
    const home=root.dataset.home==='1',category=home?'home':state.category,view=currentView(category,state.brand),loading=state.requests.has(viewKey(category,state.brand));
    const nav=root.querySelector('.av-tabs');
    if(nav)nav.innerHTML=categories.map(([k,label])=>'<button data-av-category="'+esc(k)+'" class="'+(k===category?'active':'')+'" aria-pressed="'+(k===category)+'">'+esc(label)+' <span>'+count(Object.hasOwn(groups,k)?groups[k]:0)+'</span></button>').join('');
    root.querySelector('.av-review-info').innerHTML=category==='review'?'<p>Kategorisi görselden kesinleştirilemeyen reklamlar burada gösterilir. AI incelemesi yeterli kanıt bulduğunda mevcut bir kategoriye atayabilir veya yeni kategori oluşturabilir. Analiz durumu her kartta ayrıca belirtilir.</p><button class="btn" data-av-analyze>Tüm diğer / belirsiz kayıtları AI ile yeniden incele</button>':'';
    const brand=root.querySelector('[data-av-brand]');
    if(brand){brand.innerHTML='<option value="all">Tüm markalar</option>'+sources.map(x=>'<option value="'+esc(x.brand)+'">'+esc(x.brand)+'</option>').join('');brand.value=state.brand}
    const liveSchedule=state.data.cloud?.schedule||m.schedule;
    const schedule=liveSchedule?.enabled?liveSchedule.description:'Düzenli inceleme planı henüz etkin değil';
    root.querySelector('.av-status').innerHTML='<b>'+esc(statusText[m.status]||'İnceleme bekleniyor')+'</b><span>'+esc(schedule)+' • KKTC saati</span><span>Son inceleme: '+stamp(m.checked_at)+' • Uygulamaya aktarım: '+stamp(m.imported_at)+'</span>'+(m.last_error?'<span>'+esc(m.last_error)+'</span>':'');
    const cloud=state.data.cloud;
    if(cloud){
      if(cloud.schedule?.enabled&&cloud.schedule.daily_at)root.querySelector('.av-status').innerHTML+='<span data-av-daily-schedule>Günlük otomatik tarama: '+esc(cloud.schedule.daily_at)+' • '+count(cloud.schedule.verified_pages_count)+' doğrulanmış reklam sayfası</span><span>Son günlük kuyruk: '+esc(cloud.schedule.last_scheduled_day||'İlk planlanan saat bekleniyor')+'</span>';
      root.querySelector('.av-status').innerHTML+='<span><b>'+esc(cloud.vision_configured?'Görsel analiz bağlantısı tanımlı':'Görsel analiz bağlantısı bekleniyor')+'</b> • '+esc(cloud.worker_online?'Sunucu görevi çalışıyor':'Sunucu görevi kontrol edilmeli')+'</span><span>'+esc(cloud.message)+'</span>';
      const provider=cloud.capture_provider;
      if(provider?.enabled){
        root.querySelector('.av-status').innerHTML+='<span data-av-provider-status><b>Reklam sağlayıcısı: '+esc(provider.provider==='apify'?'Apify':provider.provider)+'</b> • '+esc(provider.configured?'Bağlantı ve bütçe ayarları tanımlı':'Sağlayıcı ayarları bekleniyor')+'</span><span>'+esc(provider.message)+'</span>';
      }else if(cloud.capture_transport){
        const transport=cloud.capture_transport;
        root.querySelector('.av-status').innerHTML+='<span><b>'+esc(transport.mode==='proxy'?'Birincil tarama: Proxy':'Birincil tarama: Doğrudan bağlantı')+'</b> • '+esc(transport.message)+'</span>';
        if(transport.mode==='proxy'&&transport.proxy_count){
          const labels={unverified:'Henüz doğrulanmadı',ready:'Son bağlantı başarılı',cooldown:'Geçici olarak bekliyor'};
          root.querySelector('.av-status').innerHTML+='<span>'+Number(transport.proxy_count)+' bağlantı • '+Number(transport.available_count||0)+' bağlantı denemeye uygun</span>'+(transport.proxies||[]).map(p=>'<span><b>'+esc(p.id)+'</b>: '+esc(labels[p.state]||'Kontrol bekleniyor')+(p.retry_at?' • Sonraki deneme: '+stamp(p.retry_at):'')+'</span>').join('');
        }
      }
      const c=cloud.candidates||{};
      root.querySelector('.av-cloud div').innerHTML='<p>AI incelemesi bekleyen: '+Number((c.pending||0)+(c.retry||0))+' • Analizi tamamlanan: '+Number(c.analyzed||0)+' • Hatalı: '+Number(c.error||0)+'</p><p>Sunucu kontrolü: '+stamp(cloud.worker_heartbeat)+'</p>'+(provider?.enabled?sources.filter(s=>s.provider&&!s.shared).map(s=>'<div class="av-source"><b>'+esc(s.brand)+'</b>'+providerCounters(s.provider)+'</div>').join(''):'');
    }else root.querySelector('.av-cloud div').textContent='Bulut görevi bilgileri bekleniyor.';
    const selected=view.rows.filter(a=>a.category===category&&(state.brand==='all'||a.brand===captureBrand(state.brand))),focus=sources.find(s=>s.brand===state.brand);
    root.querySelector('.av-source-focus').innerHTML=focus?sourceCard(focus):'';
    root.querySelector('.av-cards').innerHTML=selected.map(a=>card(a,labels)).join('')||'<div class="av-empty">'+(loading?'Reklam arşivi yükleniyor…':view.error?'Reklam arşivi alınamadı. Yeniden deneyin.':focus?.status==='no_ads'?'Son kaynak taramasında seçili reklam filtresinde reklam bulunamadı. Yeni taramalarda sonuç değişebilir.':'Bu kategoride henüz doğrulanmış görsel analizi yok. Bu durum reklam olmadığı anlamına gelmez; kaynağın tarama durumunu kontrol edin.')+'</div>';
    root.querySelector('.av-pagination').innerHTML=state.data.pagination?'<p>'+selected.length+' / '+count(view.pagination.total)+' analiz gösteriliyor.</p>'+(view.error?'<p>'+esc(view.error)+'</p>':'')+(view.pagination.has_more||view.error?'<button class="btn" data-av-more'+(loading?' disabled':'')+'>'+(loading?'Yükleniyor…':view.error?'Yeniden dene':'Daha fazla analiz göster')+'</button>':''):'';
    const pendingBox=root.querySelector('.av-pending');
    if(pendingBox){
      const pending=currentView('pending_media',state.brand),waiting=state.requests.has(viewKey('pending_media',state.brand));
      pendingBox.querySelector('summary').textContent='AI sonucu beklenen görseller • '+count(pending.pagination.total);
      pendingBox.querySelector('.av-pending-content').innerHTML='<p>Kaydedilmiş görseller burada AI sonucu yayınlanmadan görüntülenebilir. Kategori ve teklifler henüz doğrulanmadı; marka filtresi uygulanır.</p><div class="av-cards">'+pending.rows.map(pendingCard).join('')+'</div><p>'+pending.rows.length+' / '+count(pending.pagination.total)+' medya kaydı gösteriliyor.</p>'+(pending.error?'<p>'+esc(pending.error)+'</p>':'')+(pending.pagination.has_more||pending.error?'<button class="btn" data-av-pending-more'+(waiting?' disabled':'')+'>'+(waiting?'Yükleniyor…':pending.error?'Yeniden dene':'Daha fazla görsel göster')+'</button>':'');
    }
    const verified=sources.filter(s=>s.verified),unverified=sources.filter(s=>!s.verified),missing=verified.filter(s=>!s.shared&&!(s.archive_count??s.rows.length)&&!s.captured&&s.status!=='no_ads');
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
const viewKey=(category,brand)=>JSON.stringify([category,captureBrand(brand)]);
function currentView(category,brand){
  brand=captureBrand(brand);
  const cached=state.views.get(viewKey(category,brand));if(cached)return cached;
  if(category==='pending_media'){const total=brand==='all'?state.data?.pending_media?.total:state.data?.pending_media?.brand_totals?.[brand];return {rows:[],pagination:{total:count(total),has_more:count(total)>0,next_cursor:null}}}
  const rows=(state.data?.rows||[]).filter(a=>a.category===category&&(brand==='all'||a.brand===brand));
  const complete=!state.data?.pagination?.has_more;
  const total=brand==='all'?state.data?.groups?.[category]:state.data?.brand_groups?.[brand]?.[category];
  return {rows:complete?rows:[],pagination:{total:total??rows.length,has_more:!complete,next_cursor:null}};
}
function loadView(category,brand,more=false){
  brand=captureBrand(brand);
  const pending=category==='pending_media';
  if(!pending&&!selectableCategory(category))return Promise.resolve();
  if(!pending&&!state.data?.pagination?.has_more||pending&&!currentView(category,brand).pagination.total)return Promise.resolve();
  const key=viewKey(category,brand),prior=state.views.get(key);
  if(state.requests.has(key))return state.requests.get(key);
  if(prior&&!more&&!prior.error||more&&prior&&!prior.pagination.has_more&&!prior.error)return Promise.resolve();
  const generation=state.generation,params=new URLSearchParams(pending?{limit:'50'}:{category,limit:'100'});
  if(brand!=='all')params.set('brand',brand);
  if(more&&prior?.pagination.next_cursor)params.set('cursor',prior.pagination.next_cursor);
  const request=(async()=>{
    try{
      const r=await fetch('/api/ad-visuals'+(pending?'/pending':'')+'?'+params,{cache:'no-store'}),data=await r.json();
      if(!r.ok)throw new Error(data.error||'Reklam arşivi alınamadı');
      if(generation!==state.generation)return;
      const rows=more&&prior?.pagination.next_cursor?[...prior.rows,...data.rows]:data.rows||[];
      state.views.set(key,{rows:[...new Map(rows.map(a=>[a.key,a])).values()],pagination:data.pagination||{total:rows.length,has_more:false,next_cursor:null}});
    }catch(e){if(generation===state.generation)state.views.set(key,{...(prior||currentView(category,brand)),error:e.message})}
  })().finally(()=>{if(generation===state.generation){state.requests.delete(key);render()}});
  state.requests.set(key,request);render();return request;
}
function ensureViews(){
  const categories=new Set([...document.querySelectorAll('.av-root')].map(root=>root.dataset.home==='1'?'home':state.category));
  if(document.querySelector('.av-pending[open]'))categories.add('pending_media');
  return Promise.all([...categories].map(category=>loadView(category,state.brand)));
}
function load(force=false){
  if(state.loading)return state.loading;
  if(!force&&state.data&&Date.now()-state.loaded<60000){render();return ensureViews()}
  state.loading=(async()=>{
    for(const b of document.querySelectorAll('[data-av-refresh]'))b.disabled=true;
    try{
      const r=await fetch('/api/ad-visuals',{cache:'no-store'});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Reklam analizi alınamadı');state.data=data;state.loaded=Date.now();state.generation++;state.views.clear();state.requests.clear();render();await ensureViews();
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
function setCategory(category){if(!selectableCategory(category))return;state.category=category;render();return ensureViews()}
function mountHome(){const root=document.getElementById('hiAdVisualMount');if(!root)return;if(!root.classList.contains('av-root'))frame(root,true);return load()}
function init(){
  const shell=document.querySelector('.shell');if(!shell)return;
  const section=document.createElement('section');section.id='ad-visual-section';section.className='section';frame(section);shell.append(section);
  if(location.hash==='#ads')load();
}
window.AdVisualUI={load,setCategory,mountHome};
init();
})();
