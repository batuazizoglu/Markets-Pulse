let activeSource='all',showInactive=false,cachePackages=[],cacheValue=[],cacheSummary=null,searchTerm='';
const $=id=>document.getElementById(id);
const fmtTime=v=>v?new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Famagusta'}).format(new Date(v)):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=v=>v==null||v===''?null:Number(v);
const val=(v,s='')=>v==null?'—':`${v}${s}`;
async function api(path,opts){const r=await fetch(path,opts);let j;try{j=await r.json()}catch{j={}}if(!r.ok)throw new Error(j.error||r.statusText);return j}

async function loadAll(){
  try{
    $('liveText').textContent='Güncelleniyor…';
    const [sum,packs,changes,snaps,comp,value]=await Promise.all([
      api('/api/summary'),api('/api/packages'),api('/api/changes?limit=100'),api('/api/snapshots'),api('/api/comparison'),api('/api/value-index')
    ]);
    cacheSummary=sum;cachePackages=packs;cacheValue=value;
    renderKpis(sum);renderSourceCards(sum.sources||[]);renderHero(changes,value);renderTabs(sum.sources||[]);renderPackages();
    renderComparison(comp.rows||[]);renderValue(value||[]);renderChanges(changes);renderEvidence(snaps);renderSourceTable(sum.sources||[]);
    await loadTimeline(7);
    $('liveText').textContent='Canlı • 60 sn';
  }catch(e){console.error(e);$('liveText').textContent='Bağlantı hatası'}
}

function renderKpis(sum){
  $('kpiProducts').textContent=sum.active_products??0;
  $('kpiToday').textContent=sum.changes_today??0;
  $('kpi24').textContent=sum.changes_24h??0;
  $('kpiSources').textContent=(sum.sources||[]).length;
  const t=(sum.sources||[]).map(x=>x.last_checked_at).filter(Boolean).sort().pop();
  $('kpiLast').textContent=t?fmtTime(t):'—';
}

function renderHero(changes,value){
  const todayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Famagusta'}).format(new Date());
  const today=(changes||[]).filter(c=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Famagusta'}).format(new Date(c.detected_at))===todayKey);
  if(today.length){
    const c=today[0];
    $('heroMove').textContent=c.change_type==='field_changed'?`${c.product_name||'Paket'} • ${fieldLabel(c.field_name)}`:c.change_type==='added'?`${c.product_name||'Paket'} eklendi`:`${c.product_name||'Paket'} kaldırıldı`;
    $('heroSub').textContent=c.change_type==='field_changed'?`${pretty(c.old_value)} → ${pretty(c.new_value)} • ${c.source_name}`:`${c.source_name} • ${fmtTime(c.detected_at)}`;
  }else{$('heroMove').textContent='Bugün anlamlı değişiklik yok';$('heroSub').textContent='Tüm aktif tarifeler son bilinen durumla aynı.'}
  if(value?.length){const v=value[0];$('heroValue').textContent=`${Number(v.gb_per_100tl).toFixed(2)} GB / 100 TL`;$('heroValueSub').textContent=`${v.name||v.current_name} • ${v.data_gb} GB • ${v.price_try} TL`}
  else{$('heroValue').textContent='—';$('heroValueSub').textContent='Data ve fiyat bilgisi bekleniyor.'}
}

function renderSourceCards(rows){
  $('sourceCards').innerHTML=rows.map(s=>`<article class="card source-card"><div class="source-top"><div><div class="source-name">${esc(s.name)}</div><a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener">Resmi sayfayı aç ↗</a></div><span class="status ${s.last_status==='ok'?'ok':s.last_status?'err':'warn'}">${s.last_status==='ok'?'SAĞLIKLI':s.last_status==='error'?'HATA':'BEKLİYOR'}</span></div><div class="source-stats"><div class="source-stat"><strong>${s.active_products||0}</strong><span>Aktif paket</span></div><div class="source-stat"><strong>${s.parsed_count??'—'}</strong><span>Son tarama</span></div><div class="source-stat"><strong>${s.response_ms?`${s.response_ms} ms`:'—'}</strong><span>Yanıt</span></div><div class="source-stat"><strong>${s.http_status??'—'}</strong><span>HTTP</span></div></div></article>`).join('');
}

function renderTabs(rows){
  const tabs=[['all','Tümü'],...rows.map(s=>[s.slug,s.name])];
  $('packageTabs').innerHTML=tabs.map(([id,label])=>`<button class="tab ${activeSource===id?'active':''}" onclick="setSource('${id}',this)">${esc(label)}</button>`).join('');
}
function setSource(id,el){activeSource=id;document.querySelectorAll('#packageTabs .tab').forEach(x=>x.classList.remove('active'));el?.classList.add('active');renderPackages()}
function setPackageMode(mode,el){showInactive=mode==='all';document.querySelectorAll('#statusTabs .tab').forEach(x=>x.classList.remove('active'));el?.classList.add('active');renderPackages()}
function setSearch(v){searchTerm=(v||'').trim().toLocaleLowerCase('tr-TR');renderPackages()}

function filteredPackages(){
  const unique=new Map();
  for(const p of cachePackages){
    if(activeSource!=='all'&&p.source_slug!==activeSource)continue;
    if(!showInactive&&!p.active)continue;
    const n=(p.name||p.current_name||'').toLocaleLowerCase('tr-TR');
    if(searchTerm&&!n.includes(searchTerm)&&!(p.source_name||'').toLocaleLowerCase('tr-TR').includes(searchTerm))continue;
    const key=[p.source_slug,p.current_name,p.data_gb,p.bonus_data_gb,p.local_tr_minutes,p.international_minutes,p.sms,p.validity_days,p.price_try,p.active].join('|');
    if(!unique.has(key))unique.set(key,p);
  }
  return [...unique.values()];
}

function renderPackages(){
  const rows=filteredPackages();$('packageCount').textContent=`${rows.length} paket`;
  const idx=new Map(cacheValue.map(v=>[String(v.id),v]));
  $('packageRows').innerHTML=rows.length?rows.map(p=>{const vi=idx.get(String(p.id));return `<tr class="clickable" onclick="showHistory(${p.id})"><td><b>${esc(p.name||p.current_name)}</b><div class="muted">${fmtTime(p.captured_at)}</div></td><td>${esc(p.source_name)}</td><td>${val(p.data_gb,' GB')}</td><td>${val(p.bonus_data_gb,' GB')}</td><td>${val(p.local_tr_minutes,' dk')}</td><td>${val(p.international_minutes,' dk')}</td><td>${val(p.sms)}</td><td>${val(p.validity_days,' gün')}</td><td class="price">${val(p.price_try,' TL')}</td><td>${vi?`${Number(vi.gb_per_100tl).toFixed(2)}`:'—'}</td><td><span class="status ${p.active?'ok':'err'}">${p.active?'AKTİF':'PASİF'}</span></td></tr>`}).join(''):`<tr><td colspan="11" class="empty">Bu filtrede paket bulunamadı.</td></tr>`;
  $('packageCards').innerHTML=rows.length?rows.map(p=>`<article class="pkg-card" onclick="showHistory(${p.id})"><div class="pkg-head"><div><div class="pkg-name">${esc(p.name||p.current_name)}</div><div class="pkg-source">${esc(p.source_name)} • ${fmtTime(p.captured_at)}</div></div><span class="status ${p.active?'ok':'err'}">${p.active?'AKTİF':'PASİF'}</span></div><div class="pkg-metrics"><div class="pkg-metric"><span>Data</span><b>${val(p.data_gb,' GB')}</b></div><div class="pkg-metric"><span>Dakika</span><b>${val(p.local_tr_minutes,' dk')}</b></div><div class="pkg-metric"><span>Fiyat</span><b>${val(p.price_try,' TL')}</b></div><div class="pkg-metric"><span>Bonus</span><b>${val(p.bonus_data_gb,' GB')}</b></div><div class="pkg-metric"><span>Uluslararası</span><b>${val(p.international_minutes,' dk')}</b></div><div class="pkg-metric"><span>SMS</span><b>${val(p.sms)}</b></div></div></article>`).join(''):`<div class="empty">Bu filtrede paket bulunamadı.</div>`;
}

function renderComparison(rows){
  const list=[...rows].sort((a,b)=>Number(b.changed)-Number(a.changed));
  $('compareRows').innerHTML=list.length?list.map(p=>`<tr><td><b>${esc(p.current_name_version||p.current_name)}</b></td><td>${esc(p.source_name)}</td><td>${val(p.previous_data_gb,' GB')}</td><td>${val(p.current_data_gb,' GB')}</td><td>${val(p.previous_price_try,' TL')}</td><td>${val(p.current_price_try,' TL')}</td><td>${delta(p.previous_data_gb,p.current_data_gb,' GB')}</td><td>${delta(p.previous_price_try,p.current_price_try,' TL')}</td><td><span class="status ${p.changed?'warn':'ok'}">${p.previous_version_id?(p.changed?'DEĞİŞTİ':'AYNI'):'BAŞLANGIÇ'}</span></td></tr>`).join(''):`<tr><td colspan="9" class="empty">Karşılaştırma verisi henüz yok.</td></tr>`;
  $('compareCards').innerHTML=list.slice(0,20).map(p=>`<article class="pkg-card"><div class="pkg-head"><div><div class="pkg-name">${esc(p.current_name_version||p.current_name)}</div><div class="pkg-source">${esc(p.source_name)}</div></div><span class="status ${p.changed?'warn':'ok'}">${p.previous_version_id?(p.changed?'DEĞİŞTİ':'AYNI'):'BAŞLANGIÇ'}</span></div><div class="pkg-metrics"><div class="pkg-metric"><span>Data Dün</span><b>${val(p.previous_data_gb,' GB')}</b></div><div class="pkg-metric"><span>Data Bugün</span><b>${val(p.current_data_gb,' GB')}</b></div><div class="pkg-metric"><span>Data Δ</span><b>${deltaText(p.previous_data_gb,p.current_data_gb,' GB')}</b></div><div class="pkg-metric"><span>Fiyat Dün</span><b>${val(p.previous_price_try,' TL')}</b></div><div class="pkg-metric"><span>Fiyat Bugün</span><b>${val(p.current_price_try,' TL')}</b></div><div class="pkg-metric"><span>Fiyat Δ</span><b>${deltaText(p.previous_price_try,p.current_price_try,' TL')}</b></div></div></article>`).join('');
}
function delta(a,b,s=''){a=num(a);b=num(b);if(a==null||b==null)return '<span class="muted">—</span>';const d=b-a;if(!d)return '<span class="muted">—</span>';return `<span class="${d>0?'good':'bad'}">${d>0?'+':''}${d}${s}</span>`}
function deltaText(a,b,s=''){a=num(a);b=num(b);if(a==null||b==null)return '—';const d=b-a;return d?`${d>0?'+':''}${d}${s}`:'—'}

function renderValue(rows){
  $('valueList').innerHTML=rows.length?rows.slice(0,12).map(v=>`<div class="value-row"><div class="rank">${v.rank}</div><div><b>${esc(v.name||v.current_name)}</b><div class="muted">${esc(v.source_name)} • ${v.data_gb} GB / ${v.price_try} TL</div></div><div class="score">${Number(v.gb_per_100tl).toFixed(2)}<div class="muted">GB/100TL</div></div></div>`).join(''):`<div class="empty">Değer endeksi için veri bekleniyor.</div>`;
}

function renderChanges(rows){
  $('changeFeed').innerHTML=rows.length?rows.map(c=>`<article class="change" ${c.product_id?`onclick="showHistory(${c.product_id})"`:''}><div class="change-top"><div><div class="change-title">${esc(c.product_name||c.old_value||c.new_value||'Paket')}</div><div class="change-meta">${esc(c.source_name)} • ${fmtTime(c.detected_at)}</div></div><span class="status ${c.severity==='critical'?'err':c.severity==='high'?'warn':'ok'}">${esc(c.severity)}</span></div><div class="diff">${c.change_type==='field_changed'?`${esc(fieldLabel(c.field_name))}: <span class="old">${esc(pretty(c.old_value))}</span> → <span class="new">${esc(pretty(c.new_value))}</span>`:c.change_type==='added'?'<span class="new">Yeni paket eklendi</span>':'<span class="old">Paket kaldırıldı / görünmüyor</span>'}</div></article>`).join(''):`<div class="empty">Henüz anlamlı değişiklik yok.</div>`;
}

async function loadTimeline(days=7,el){
  if(el){el.parentElement.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));el.classList.add('active')}
  const rows=await api('/api/timeline?days='+days);
  $('timeline').innerHTML=rows.length?rows.slice(0,80).map(c=>`<div class="tl ${esc(c.severity)}"><div class="tl-time">${fmtTime(c.detected_at)}</div><div class="tl-axis"><span class="tl-dot"></span></div><div class="tl-content"><b>${esc(c.product_name||c.old_value||c.new_value||'Paket')}</b><div class="muted">${esc(c.source_name)} • ${changeText(c)}</div></div></div>`).join(''):`<div class="empty">Bu dönemde değişiklik yok.</div>`;
}

function renderEvidence(rows){
  $('evidenceGrid').innerHTML=rows.length?rows.slice(0,18).map(x=>`<article class="card evidence-card"><div class="evidence-img">${x.has_screenshot?`<img loading="lazy" src="/api/snapshots/${x.id}/image" alt="${esc(x.source_name)} ekran görüntüsü">`:`<div class="evidence-missing"><b>Ekran görüntüsü yok</b><br>${esc(x.screenshot_error||'Eski snapshot veya capture bekleniyor')}</div>`}</div><div class="evidence-body"><div class="evidence-title"><b>${esc(x.source_name)}</b><span class="status ${x.has_screenshot?'ok':'warn'}">${x.has_screenshot?'PNG HAZIR':'PNG YOK'}</span></div><div class="evidence-meta">${fmtTime(x.captured_at)} • ${esc(x.kind)} • ${x.parsed_count??0} paket</div><div class="evidence-actions">${x.has_screenshot?`<button class="mini-btn primary" onclick="openEvidence(${x.id},'${escAttr(x.source_name)}','${escAttr(fmtTime(x.captured_at))}')">Ekran Görüntüsü</button>`:''}${x.has_html?`<a class="mini-btn" href="/api/snapshots/${x.id}/html" target="_blank">HTML</a>`:''}${x.has_json?`<a class="mini-btn" href="/api/snapshots/${x.id}/json" target="_blank">JSON</a>`:''}<a class="mini-btn" href="${esc(x.source_url)}" target="_blank" rel="noopener">Canlı Sayfa</a></div></div></article>`).join(''):`<div class="empty">Kanıt snapshot'ı henüz oluşmadı.</div>`;
}
function escAttr(s){return String(s??'').replace(/['\\]/g,m=>m==="'"?'&#39;':'\\\\')}
function openEvidence(id,name,time){$('evidenceTitle').textContent=`${name} • ${time}`;$('evidenceFull').src=`/api/snapshots/${id}/image`;$('evidenceModal').classList.add('open');document.body.style.overflow='hidden'}
function closeEvidence(){$('evidenceModal').classList.remove('open');$('evidenceFull').src='';document.body.style.overflow=''}

function renderSourceTable(rows){
  $('sourceRows').innerHTML=rows.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td class="url"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></td><td><span class="status ${s.last_status==='ok'?'ok':s.last_status?'err':'warn'}">${s.last_status==='ok'?'SAĞLIKLI':s.last_status==='error'?'HATA':'BEKLİYOR'}</span></td><td>${s.http_status??'—'}</td><td>${s.parsed_count??'—'}</td><td>${s.active_products??0}</td><td>${s.response_ms?`${s.response_ms} ms`:'—'}</td><td>${fmtTime(s.last_checked_at)}</td><td class="error-text">${esc(s.last_error||'—')}</td></tr>`).join('');
}

async function showHistory(id){
  const rows=await api('/api/product/'+id+'/history');const p=cachePackages.find(x=>String(x.id)===String(id));
  $('historyTitle').textContent=p?.name||p?.current_name||rows[0]?.name||'Paket';
  $('historyBox').classList.add('open');
  $('historyRows').innerHTML=rows.map(v=>`<tr><td>${fmtTime(v.captured_at)}</td><td>${esc(v.name)}</td><td>${val(v.data_gb,' GB')}</td><td>${val(v.bonus_data_gb,' GB')}</td><td>${val(v.local_tr_minutes,' dk')}</td><td>${val(v.international_minutes,' dk')}</td><td>${val(v.sms)}</td><td>${val(v.validity_days,' gün')}</td><td class="price">${val(v.price_try,' TL')}</td></tr>`).join('');
  $('historySection').scrollIntoView({behavior:'smooth',block:'start'});
}

async function scanNow(){const b=$('scanBtn');b.disabled=true;b.textContent='Taranıyor…';try{const r=await api('/api/scan',{method:'POST'});await loadAll();const failed=(r.sources||[]).filter(x=>!x.ok);if(failed.length)alert('Bazı kaynaklar taranamadı: '+failed.map(x=>x.source).join(', '))}catch(e){alert('Tarama hatası: '+e.message)}finally{b.disabled=false;b.textContent='Şimdi Tara'}}
function fieldLabel(f){return ({data_gb:'Data',bonus_data_gb:'Bonus Data',local_tr_minutes:'Ada İçi + Türkiye DK',international_minutes:'Uluslararası DK',sms:'SMS',validity_days:'Geçerlilik',price_try:'Fiyat',name:'Paket Adı',extras_json:'Ek Fayda / Koşul','Data':'Data','Bonus Data':'Bonus Data','Ada İçi + TR Dakika':'Ada İçi + TR Dakika','Uluslararası Dakika':'Uluslararası Dakika','Geçerlilik (gün)':'Geçerlilik','Fiyat':'Fiyat'})[f]||f||'Alan'}
function pretty(v){if(v==null)return '—';try{const x=JSON.parse(v);if(typeof x==='object')return JSON.stringify(x)}catch{}return String(v)}
function changeText(c){if(c.change_type==='field_changed')return `${fieldLabel(c.field_name)}: ${pretty(c.old_value)} → ${pretty(c.new_value)}`;if(c.change_type==='added')return 'Yeni paket eklendi';return 'Paket kaldırıldı / görünmüyor'}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEvidence()});
loadAll();setInterval(loadAll,60000);
