(async () => {
  const root = document.getElementById('evidenceArchive');
  if (!root) return;
  let pendingActivation=false;
  window.EvidenceArchive={activate(){pendingActivation=true;},refreshIfActive(){}};
  await Promise.resolve(window.MarketPulseAccess?.ready).catch(()=>null);
  const isAdmin=()=>window.MarketPulseAccess?.isAdmin()===true;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fold = value => String(value || '').toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g,c=>({'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u'}[c]));
  const stamp = value => value ? new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
  const dateKey = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const kindName = value => ({change:'Değişiklik',daily:'Günlük kayıt',baseline:'İlk kayıt'}[value] || value);
  const fields = {name:'Paket adı',data_gb:'İnternet',bonus_data_gb:'Bonus internet',local_tr_minutes:'Ada içi + Türkiye dk',international_minutes:'Uluslararası dk',sms:'SMS',validity_days:'Geçerlilik',price_try:'Fiyat',extras_json:'Fayda / koşul',red_passport_days:'Red Pasaport'};
  const assetFlags = ['has_focus','has_screenshot','has_html','has_json'];
  const assetNames = ['Paket PNG','Tam sayfa PNG','HTML','JSON'];
  const assetCount = row => assetFlags.filter(key => row[key]).length;
  const icon = name => ({search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>'}[name] || '');
  const svg = name => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icon(name)+'</svg>';
  const safeUrl = value => {try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:'#';}catch{return '#';}};
  const state = {page:1,items:[],selected:new Set(),data:null,view:'grid',loading:false,activated:false,request:null,detailRequest:null,detail:null,mode:'focus',opener:null,busy:false,openedLink:false};
  const initialParams = new URLSearchParams(location.search);
  const filters = ['q','source','from','to','kind','availability'];
  const filterId = key => 'evFilter-'+key;
  root.innerHTML = `
    <div class="ev-intro"><div><div class="ev-eyebrow">KAYNAĞINDAN KAYDA</div><h2>Her değişikliğin bir kanıtı var.</h2><p>Telsim tarife sayfalarının kayıtlı görüntüleri ve paket bilgileri. Tarih ve saatler KKTC saatidir.</p></div><button class="ev-button" id="evRefresh">↻ Yenile</button></div>
    <div class="ev-stats" id="evStats" aria-label="Arşiv özeti"></div>
    <form class="ev-filters" id="evFilters">
      <div class="ev-filter-top"><label class="ev-search-label" for="evFilter-q">Paket veya kaynak ara<div class="ev-search">${svg('search')}<input id="evFilter-q" type="search" maxlength="160" placeholder="${isAdmin()?'Örn. Havalimanı, Super Red veya kayıt no…':'Örn. Havalimanı veya Super Red…'}" autocomplete="off"></div></label><div class="ev-periods" aria-label="Hızlı tarih seçimi"><button type="button" data-period="7">7 gün</button><button type="button" data-period="30">30 gün</button><button type="button" data-period="all" class="active">Tüm arşiv</button></div></div>
      <div class="ev-filter-grid"><label>Kaynak<select id="evFilter-source"><option value="">Tüm kaynaklar</option></select></label><label>Başlangıç<input id="evFilter-from" type="date"></label><label>Bitiş<input id="evFilter-to" type="date"></label><label>Kayıt türü<select id="evFilter-kind"><option value="">Tüm kayıtlar</option><option value="change">Değişiklik</option><option value="daily">Günlük kayıt</option><option value="baseline">İlk kayıt</option></select></label><label>${isAdmin()?'Dosya durumu':'Görsel durumu'}<select id="evFilter-availability"><option value="">Tüm durumlar</option>${isAdmin()?'<option value="complete">Tüm dosyalar hazır</option><option value="missing">Eksik dosyası var</option>':''}<option value="visual">Görseli var</option><option value="no_visual">Görseli yok</option></select></label><div class="ev-filter-actions"><button class="ev-button ev-primary" type="submit">Uygula</button><button class="ev-reset" type="button" id="evReset">Sıfırla</button></div></div>
    </form>
    ${isAdmin()?`<div class="ev-selection" id="evSelection" hidden><div><b id="evSelectedCount"></b><span>Farklı sayfalardan en fazla 10 kayıt seçebilirsiniz.</span></div><div><button class="ev-button ev-primary" id="evExport">${svg('download')} Seçilenleri ZIP indir</button><button class="ev-reset" id="evClearSelection">Seçimi temizle</button></div></div>`:''}
    <div id="evMessage" class="ev-message" role="status" hidden></div>
    <div class="ev-results-bar"><p id="evResultCount" role="status">Arşiv yükleniyor…</p><div class="ev-view-switch" aria-label="Görünüm"><button id="evGridView" class="active" aria-label="Kart görünümü" aria-pressed="true">${svg('grid')}</button><button id="evListView" aria-label="Liste görünümü" aria-pressed="false">${svg('list')}</button></div></div>
    <div id="evResults" class="ev-results" data-view="grid" aria-busy="false"></div>
    <div class="ev-pagination"><span id="evPageInfo"></span><div><button class="ev-button" id="evPrev">← Önceki</button><button class="ev-button" id="evNext">Sonraki →</button></div></div>
    <p class="ev-footnote">${isAdmin()?'İlk taramada, paket değişikliğinde ve yaklaşık 24 saatte bir kanıt alınır. Eksik dosyalar ayrı işaretlenir; kayıtların tümünde dört dosya bulunmayabilir.':'Paket değişiklikleri ve günlük kayıtlarla geçmiş tarifeleri inceleyebilirsiniz. Bazı kayıtlarda görsel bulunmayabilir.'}</p>`;
  for (const key of filters) {
    const value=initialParams.get('ev_'+key);
    if(value!=null&&key!=='source') $(filterId(key)).value=value;
  }
  const dialog=document.createElement('dialog');dialog.id='evDialog';dialog.className='ev-dialog';dialog.setAttribute('aria-labelledby','evDetailTitle');document.body.append(dialog);
  function message(text,error=false){$('evMessage').hidden=!text;$('evMessage').textContent=text;$('evMessage').classList.toggle('error',error);}
  async function json(path,signal){const res=await fetch(path,{signal,cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(isAdmin()&&data.error?data.error:'Kayıtlar alınamadı. Yeniden deneyin.');return data;}
  function currentFilters(){return Object.fromEntries(filters.map(key=>[key,$(filterId(key)).value.trim()]));}
  let appliedFilters={...currentFilters(),source:initialParams.get('ev_source')||''};
  function persistFilters(){const url=new URL(location.href);for(const key of filters){if(appliedFilters[key])url.searchParams.set('ev_'+key,appliedFilters[key]);else url.searchParams.delete('ev_'+key);}history.replaceState(null,'',url);}
  function renderStats(summary={}){
    const stats=[['Arşiv kaydı',summary.total,'Seçili filtrelerde'],['Değişiklik kaydı',summary.changed,'Paket hareketi yakalanan']];
    if(isAdmin())stats.push(['Eksiksiz kayıt',summary.complete,'Paket PNG · tam PNG · HTML · JSON'],['Eksik dosyalı',summary.missing,'Dosya durumundan filtreleyin']);
    $('evStats').innerHTML=stats.map(([label,value,hint],i)=>`<div class="ev-stat ${i===3&&value?'ev-stat-warn':''}"><span>${label}</span><strong>${value??'—'}</strong><small>${hint}</small></div>`).join('');
  }
  function selection(){
    if(!isAdmin())return;
    $('evSelection').hidden=!state.selected.size;$('evSelectedCount').textContent=state.selected.size+' kayıt seçili';
    root.querySelectorAll('[data-select]').forEach(input=>{input.checked=state.selected.has(input.dataset.select);input.closest('.ev-card').classList.toggle('selected',input.checked);});
  }
  function renderRows(){
    $('evResults').innerHTML=state.items.length?state.items.map(row=>{
      const id=String(row.id),preview=row.has_focus?'focus':row.has_screenshot?'image':null,count=assetCount(row);
      return `<article class="ev-card ${state.selected.has(id)?'selected':''}"><div class="ev-preview"><button data-open="${escape(id)}" aria-label="${escape(row.source_name)} ${escape(stamp(row.captured_at))} kaydını incele">${preview?`<img loading="lazy" decoding="async" src="/api/snapshots/${id}/${preview}" alt="${escape(row.source_name)} ${escape(stamp(row.captured_at))} ${preview==='focus'?'paket görünümü':'tam sayfa'}">`:`<span class="ev-no-image">${svg('image')}<b>Görsel bulunmuyor</b><small>${isAdmin()?'Mevcut dosyaları inceleyin':'Kayıt bilgilerini inceleyin'}</small></span>`}<span class="ev-preview-caption">${preview==='focus'?'Paket görünümü':preview?'Tam sayfa':isAdmin()?'Dosya kaydı':'Kayıt bilgileri'} · İncele ↗</span></button>${isAdmin()?`<label class="ev-select" title="ZIP indirmek için seç"><input type="checkbox" data-select="${id}" aria-label="${escape(row.source_name)} ${escape(stamp(row.captured_at))} kaydını seç"></label>`:''}</div>
      <div class="ev-card-body"><div class="ev-card-top"><span class="ev-kind ${row.kind==='change'?'change':''}">${escape(kindName(row.kind))}</span>${isAdmin()?`<span class="ev-record-id">#${id}</span>`:''}</div><h3><button data-open="${id}">${escape(row.source_name)}</button></h3><time datetime="${escape(row.captured_at)}">${stamp(row.captured_at)}</time><div class="ev-card-summary"><b>${row.parsed_count??0} paket</b><span>${row.change_count?row.change_count+' değişiklik':'Değişiklik kaydı yok'}</span></div><p class="ev-package-names" title="${escape((row.package_names||[]).join(' · '))}">${escape((row.package_names||[]).join(' · ')||'Paket bilgileri kayıt detayında')}</p>${isAdmin()?`<div class="ev-file-row">${assetFlags.map((flag,i)=>`<span class="ev-file ${row[flag]?'ready':'missing'}" title="${assetNames[i]}: ${row[flag]?'hazır':'eksik'}">${row[flag]?'✓':'−'} ${assetNames[i]}</span>`).join('')}</div>`:''}<div class="ev-card-bottom"><span class="${(isAdmin()?count<4:!preview)?'ev-warning':''}">${isAdmin()?count+'/4 dosya hazır':preview?'Görsel var':'Görsel bulunmuyor'}</span><button class="ev-open" data-open="${id}">Kaydı incele ${svg('arrow')}</button></div></div></article>`;
    }).join(''):`<div class="ev-empty">${svg('search')}<h3>Bu filtrelerde kayıt bulunamadı.</h3><p>Paket adını kısaltın veya tarih aralığını genişletin.</p><button class="ev-button" id="evEmptyReset">Tüm arşivi göster</button></div>`;
    root.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.open)));
    root.querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>{
      if(input.checked&&state.selected.size>=10){input.checked=false;message('Bir ZIP için en fazla 10 kayıt seçebilirsiniz.',true);return;}
      if(input.checked)state.selected.add(input.dataset.select);else state.selected.delete(input.dataset.select);selection();
    }));
    root.querySelectorAll('.ev-preview img').forEach(img=>img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('span'),{className:'ev-no-image',textContent:'Görsel yüklenemedi. Detaydan yeniden deneyin.'}));}));
    $('evEmptyReset')?.addEventListener('click',reset);selection();
  }
  async function load(){
    state.request?.abort();const controller=new AbortController();state.request=controller;state.loading=true;
    $('evResults').setAttribute('aria-busy','true');$('evRefresh').disabled=true;$('evPrev').disabled=true;$('evNext').disabled=true;
    if(!state.data)$('evResults').innerHTML='<div class="ev-empty">Kayıtlar yükleniyor…</div>';
    const params=new URLSearchParams({...appliedFilters,page:String(state.page),limit:'24'});
    try{
      const data=await json('/api/evidence?'+params,controller.signal);if(controller!==state.request)return;
      state.data=data;state.items=data.items;state.page=data.page;renderStats(data.summary);
      const select=$('evFilter-source'),draftSource=state.sourcesLoaded?select.value:appliedFilters.source;select.innerHTML='<option value="">Tüm kaynaklar</option>'+(data.sources||[]).map(source=>`<option value="${escape(source.slug)}">${escape(source.name)} (${source.count})</option>`).join('');
      if(draftSource&&!Array.from(select.options).some(option=>option.value===draftSource))select.add(new Option(draftSource,draftSource));
      select.value=draftSource;state.sourcesLoaded=true;
      const start=data.total?(data.page-1)*data.page_size+1:0,end=Math.min(data.page*data.page_size,data.total);
      $('evResultCount').innerHTML=`<b>${data.total} kayıt</b><span>${start}–${end} gösteriliyor${data.summary.newest?' · Son kayıt '+stamp(data.summary.newest):''}</span>`;
      $('evPageInfo').textContent='Sayfa '+data.page+' / '+data.pages;renderRows();
      $('evPrev').disabled=data.page<=1;$('evNext').disabled=data.page>=data.pages;message('');
    }catch(error){if(error.name==='AbortError'||controller!==state.request)return;message(error.message,true);if(state.data){state.page=state.data.page;$('evPrev').disabled=state.page<=1;$('evNext').disabled=state.page>=state.data.pages;}else{$('evResultCount').textContent='Kayıtlar alınamadı';$('evResults').innerHTML='<div class="ev-empty"><h3>Arşiv yüklenemedi.</h3><p>Yenile düğmesiyle tekrar deneyin.</p></div>';}}
    finally{if(controller===state.request){state.loading=false;$('evResults').setAttribute('aria-busy','false');$('evRefresh').disabled=false;}}
  }
  function apply(){
    const from=$('evFilter-from').value,to=$('evFilter-to').value;
    if(from&&to&&from>to){message('Başlangıç tarihi bitiş tarihinden sonra olamaz.',true);return;}
    appliedFilters=currentFilters();state.page=1;persistFilters();load();
  }
  function reset(){for(const key of filters)$(filterId(key)).value='';root.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b.dataset.period==='all'));apply();}
  root.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{
    const period=button.dataset.period,today=dateKey();$('evFilter-to').value=period==='all'?'':today;
    const first=new Date(today+'T12:00:00Z');if(period!=='all')first.setUTCDate(first.getUTCDate()-Number(period)+1);
    $('evFilter-from').value=period==='all'?'':first.toISOString().slice(0,10);root.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b===button));apply();
  }));
  for(const key of ['from','to'])$(filterId(key)).addEventListener('input',()=>root.querySelectorAll('[data-period]').forEach(b=>b.classList.remove('active')));
  $('evFilters').addEventListener('submit',event=>{event.preventDefault();apply();});$('evReset').addEventListener('click',reset);
  $('evRefresh').addEventListener('click',()=>load());$('evPrev').addEventListener('click',()=>{state.page--;load();});$('evNext').addEventListener('click',()=>{state.page++;load();});
  $('evClearSelection')?.addEventListener('click',()=>{state.selected.clear();selection();});
  for(const [id,view] of [['evGridView','grid'],['evListView','list']])$(id).addEventListener('click',()=>{state.view=view;$('evResults').dataset.view=view;for(const [buttonId,value] of [['evGridView','grid'],['evListView','list']]){$(buttonId).classList.toggle('active',view===value);$(buttonId).setAttribute('aria-pressed',String(view===value));}});
  $('evExport')?.addEventListener('click',()=>download([...state.selected],$('evExport')));
  async function download(ids,button){
    if(!isAdmin()||!ids.length||state.busy)return;state.busy=true;const label=button.innerHTML,errorTarget=dialog.open?$('evDetailMessage'):null;button.disabled=true;button.textContent='ZIP hazırlanıyor…';
    try{const response=await fetch('/api/evidence/export?ids='+ids.map(encodeURIComponent).join(','));if(!response.ok)throw new Error((await response.json()).error||'İndirme başarısız.');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='markets-pulse-kanit-'+(ids.length===1?ids[0]:ids.length+'-kayit')+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);message(ids.length+' kaydın indirmesi başlatıldı.');}
    catch(error){if(errorTarget?.isConnected)errorTarget.textContent=error.message;else message(error.message,true);}
    finally{state.busy=false;button.disabled=false;button.innerHTML=label;}
  }
  const imagePath=(row,mode)=>'/api/snapshots/'+encodeURIComponent(row.id)+'/'+(mode==='focus'?'focus':'image');
  const fallbackMode=row=>row.has_focus?'focus':row.has_screenshot?'full':row.has_json?'packages':'changes';
  function linkState(id){const url=new URL(location.href);if(id)url.searchParams.set('evidence',id);else url.searchParams.delete('evidence');history.replaceState(null,'',url);}
  async function open(id){
    if(!/^[1-9]\d*$/.test(String(id)))return;state.detailRequest?.abort();const controller=new AbortController();state.detailRequest=controller;
    if(!dialog.open)state.opener=document.activeElement;
    dialog.innerHTML='<div class="ev-detail-loading"><h2 id="evDetailTitle">Kanıt yükleniyor…</h2><button class="ev-button" id="evClose">Kapat ×</button></div>';$('evClose').onclick=()=>dialog.close();
    if(!dialog.open){dialog.showModal();document.body.classList.add('ev-modal-open');}$('evClose').focus();linkState(id);
    try{const data=await json('/api/evidence/'+id,controller.signal);if(controller!==state.detailRequest||!dialog.open)return;state.detail=data;state.mode=fallbackMode(data);renderDetail();}
    catch(error){if(error.name==='AbortError'||controller!==state.detailRequest||!dialog.open)return;dialog.innerHTML='<div class="ev-detail-loading"><h2 id="evDetailTitle">Kayıt açılamadı</h2><p>'+escape(error.message)+'</p><button class="ev-button" id="evClose">Kapat</button></div>';$('evClose').onclick=()=>dialog.close();$('evClose').focus();}
  }
  function renderDetail(){
    const row=state.detail;
    const files=[['focus',isAdmin()?'Paket PNG':'Paket görselini indir',row.has_focus],['image',isAdmin()?'Tam PNG':'Tam sayfayı indir',row.has_screenshot]];
    if(isAdmin())files.push(['html','Ham HTML',row.has_html],['json','JSON',row.has_json]);
    const fileLinks=files.map(([mode,label,available])=>available?`<a href="/api/snapshots/${row.id}/${mode}?download=1" download>${label} ↓</a>`:isAdmin()?`<span title="Bu dosya kayıtta bulunmuyor">${label} eksik</span>`:'').join('');
    dialog.innerHTML=`<header class="ev-detail-header"><div><span class="ev-eyebrow">${isAdmin()?'KANIT #'+escape(row.id):'KAYIT'} · ${escape(kindName(row.kind))}</span><h2 id="evDetailTitle">${escape(row.source_name)}</h2><p>${stamp(row.captured_at)} · KKTC saati · ${row.parsed_count??0} paket</p></div><button class="ev-close" id="evClose" aria-label="Kanıtı kapat">×</button></header>
    <div class="ev-detail-toolbar"><div class="ev-detail-tabs" role="tablist" aria-label="Kanıt içeriği">${[['focus','Paket görünümü',row.has_focus],['full','Tam sayfa',row.has_screenshot],['packages',isAdmin()?'Paket verileri':'Paket bilgileri',row.has_json],['changes','Değişiklikler ('+row.changes.length+')',true],['compare','Öncekiyle karşılaştır',!!row.previous]].map(([mode,label,enabled])=>`<button id="evTab-${mode}" role="tab" aria-selected="${state.mode===mode}" aria-controls="evDetailBody" data-mode="${mode}" ${enabled?'':'disabled'}>${label}</button>`).join('')}</div></div>
    <div class="ev-detail-body" id="evDetailBody" role="tabpanel"></div>
    <footer class="ev-detail-footer"><div class="ev-detail-files">${fileLinks||'<span>Görsel bulunmuyor</span>'}</div><div class="ev-detail-actions"><a class="ev-button" href="${escape(safeUrl(row.source_url))}" target="_blank" rel="noopener noreferrer">Canlı kaynak ↗</a><button class="ev-button" id="evCopyLink">Bağlantıyı kopyala</button>${isAdmin()?`<button class="ev-button ev-primary" id="evDownloadOne">${svg('download')} Kaydı ZIP indir</button>`:''}</div><div id="evDetailMessage" role="status"></div></footer>`;
    $('evClose').onclick=()=>dialog.close();$('evDownloadOne')?.addEventListener('click',()=>download([String(row.id)],$('evDownloadOne')));
    $('evCopyLink').onclick=async()=>{const status=$('evDetailMessage');try{await navigator.clipboard.writeText(location.href);status.textContent='Kayıt bağlantısı kopyalandı. Açmak için platform oturumu gerekir.';}catch{status.textContent='Bağlantı kopyalanamadı. Adres çubuğundaki bağlantıyı kopyalayabilirsiniz.';}};
    dialog.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;renderDetailBody();}));
    dialog.querySelector('.ev-detail-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...dialog.querySelectorAll('[data-mode]:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
    renderDetailBody();$('evClose').focus();
  }
  function readableValue(v){return Array.isArray(v)?v.map(readableValue).join(' · '):v&&typeof v==='object'?Object.entries(v).map(([key,item])=>key+': '+readableValue(item)).join(' · '):String(v??'—');}
  function value(v,unit=''){return v==null||v===''?'—':escape(typeof v==='object'?(isAdmin()?JSON.stringify(v):readableValue(v)):v)+unit;}
  function changeValue(change,key){let v=change[key];if(!isAdmin()&&/extras|ek fayda|koşul/i.test(change.field_name||'')){try{v=JSON.parse(v);}catch{}}return value(v);}
  function renderPackages(){
    const query=fold($('evPackageSearch')?.value),rows=state.detail.packages.filter(row=>fold(row.name).includes(query));
    $('evPackageCount').textContent=rows.length+' paket';
    $('evPackageRows').innerHTML=rows.length?rows.map(row=>{const extras=row.extras_json??row.extras;return `<tr><td><b>${escape(row.name)}</b>${Array.isArray(extras)?'<small>'+escape(extras.join(' · '))+'</small>':''}</td><td>${value(row.data_gb,' GB')}</td><td>${value(row.bonus_data_gb,' GB')}</td><td>${value(row.local_tr_minutes,' dk')}</td><td>${value(row.international_minutes,' dk')}</td><td>${value(row.sms)}</td><td>${value(row.validity_days,' gün')}</td><td>${value(row.red_passport_days,' gün')}</td><td><b>${value(row.price_try,' TL')}</b></td></tr>`;}).join(''):'<tr><td colspan="9">Bu kayıtta aradığınız paket bulunamadı.</td></tr>';
  }
  function renderDetailBody(){
    const row=state.detail,body=$('evDetailBody'),mode=state.mode;
    dialog.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});body.setAttribute('aria-labelledby','evTab-'+mode);
    if(mode==='focus'||mode==='full'){
      body.innerHTML=`<div class="ev-viewer-tools"><span>${mode==='focus'?'Paketlerin bulunduğu alan':'Kaydedilen sayfanın tamamı'} · ${stamp(row.captured_at)}</span><label>Yakınlaştır<select id="evZoom"><option value="fit">Genişliğe sığdır</option><option value="0.75">%75</option><option value="1">%100 (özgün)</option><option value="1.5">%150</option><option value="2">%200</option></select></label></div><div class="ev-image-stage"><img id="evDetailImage" src="${imagePath(row,mode)}" alt="${escape(row.source_name)} ${escape(stamp(row.captured_at))} ${mode==='focus'?'paket görünümü':'tam sayfa'}"></div>`;
      const img=$('evDetailImage'),zoom=()=>{img.style.width=$('evZoom').value==='fit'?'100%':Math.round(img.naturalWidth*Number($('evZoom').value))+'px';};$('evZoom').onchange=zoom;img.onload=zoom;imageErrors();
    }else if(mode==='packages'){
      body.innerHTML=`<div class="ev-viewer-tools"><label class="ev-inline-search">Bu kayıtta paket ara<input type="search" id="evPackageSearch" placeholder="Paket adı…"></label><span id="evPackageCount"></span></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Paket</th><th>İnternet</th><th>Bonus</th><th>Ada içi + TR</th><th>Uluslararası</th><th>SMS</th><th>Süre</th><th>Red Pasaport</th><th>Fiyat</th></tr></thead><tbody id="evPackageRows"></tbody></table></div>`;$('evPackageSearch').oninput=renderPackages;renderPackages();
    }else if(mode==='changes'){
      body.innerHTML=row.changes.length?`<div class="ev-viewer-tools"><span>${isAdmin()?'Bu kanıtın alındığı taramada kaydedilen değişiklikler.':'Bu kayıttaki paket değişiklikleri.'}</span></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Paket</th><th>Hareket</th><th>Alan</th><th>Önce</th><th>Sonra</th></tr></thead><tbody>${row.changes.map(change=>`<tr><td><b>${escape(change.product_name||(isAdmin()||change.change_type!=='field_changed'?change.old_value||change.new_value:null)||'Paket')}</b></td><td>${escape({added:'Eklendi',removed:'Kaldırıldı',field_changed:'Güncellendi'}[change.change_type]||change.change_type)}</td><td>${escape(fields[change.field_name]||change.field_name||'—')}</td><td class="ev-before-value">${changeValue(change,'old_value')}</td><td class="ev-after-value">${changeValue(change,'new_value')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="ev-empty"><h3>'+ (isAdmin()?'Bu taramada değişiklik kaydedilmedi.':'Bu kayıtta değişiklik bulunmuyor.')+'</h3><p>'+ (row.kind==='baseline'?'Bu kayıt, sonraki değişiklikler için başlangıç noktasıdır.':'Bu kayıt, sayfanın o tarihteki durumunu belgeler.')+'</p></div>';
    }else if(mode==='compare'){
      const previous=row.previous;
      const sharedMode=row.has_focus&&previous.has_focus?'focus':row.has_screenshot&&previous.has_screenshot?'full':null;
      body.innerHTML=`<div class="ev-viewer-tools"><span>Aynı kaynağın bir önceki kayıtlı görüntüsü${sharedMode?' · '+(sharedMode==='focus'?'Paket görünümü':'Tam sayfa'):''}. Bu kayıt bir önceki güne ait olmayabilir.</span><button class="ev-button" id="evOpenPrevious">Önceki kaydı aç</button></div><div class="ev-compare">${[[previous,'ÖNCEKİ KAYIT'],[row,'SEÇİLEN KAYIT']].map(([item,label])=>{const imageMode=sharedMode||(item.has_focus?'focus':item.has_screenshot?'full':null);return `<section><div class="ev-compare-title"><b>${label}</b><span>${stamp(item.captured_at)}${isAdmin()?' · #'+item.id:''}</span><small>${imageMode==='focus'?'Paket görünümü':imageMode==='full'?'Tam sayfa':'Görsel yok'}</small></div><div class="ev-compare-image">${!imageMode?'<div class="ev-empty">Bu kayıtta görsel bulunmuyor.</div>':`<img src="${imagePath(item,imageMode)}" alt="${label} ${escape(stamp(item.captured_at))}">`}</div></section>`;}).join('')}</div>`;$('evOpenPrevious').onclick=()=>open(previous.id);imageErrors();
    }
    body.scrollTop=0;
  }
  function imageErrors(){dialog.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const fallback=document.createElement('div');fallback.className='ev-empty';fallback.textContent=isAdmin()?'Görsel yüklenemedi. Diğer dosyalara alt bölümden ulaşabilir veya kaydı yeniden açabilirsiniz.':'Görsel yüklenemedi. Kaydı yeniden açarak tekrar deneyebilirsiniz.';img.replaceWith(fallback);}));}
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{state.detailRequest?.abort();state.detail=null;document.body.classList.remove('ev-modal-open');linkState(null);state.opener?.focus?.();});
  renderStats();
  window.EvidenceArchive={activate(){if(!state.activated){state.activated=true;load();}const id=new URLSearchParams(location.search).get('evidence');if(id&&!state.openedLink){state.openedLink=true;open(id);}},refreshIfActive(){if(state.activated&&document.body.dataset.view==='evidence'&&!dialog.open&&!state.loading)load();}};
  if(pendingActivation)window.EvidenceArchive.activate();
})();

import('/market-pulse.js').catch(err=>console.error('Market Pulse module load failed',err));
import('/benchmark.js').catch(err=>console.error('Benchmark module load failed',err));
