(()=>{
let state={data:null,family:'fixed',provider:'Tümü',tech:'Tümü',duration:'Tümü',bestOnly:true,loading:false};

function money(v){if(v==null||Number.isNaN(Number(v)))return '—';return Number(v).toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL'}
function num(v,d=0){if(v==null||Number.isNaN(Number(v)))return '—';return Number(v).toLocaleString('tr-TR',{maximumFractionDigits:d})}
function dt(v){return v?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function scoreClass(v){const n=Number(v);return n>=75?'good':n>=60?'warn':'bad'}

function ensure(){
  const shell=document.querySelector('main.shell');if(!shell||document.getElementById('home-internet-section'))return;
  shell.insertAdjacentHTML('beforeend',`
  <section id="home-internet-section" class="section hi-section">
    <div class="section-title hi-title"><div><h2>Ev İnterneti Market Intelligence</h2><p>KKTC sabit internet pazarı • fiyat, hız, teknoloji, sözleşme ekonomisi ve rakip değişiklikleri</p></div><div class="hi-actions"><span id="hiUpdated" class="view-chip">Veri bekleniyor</span><button class="btn" id="hiScanBtn" onclick="HomeInternetUI.scan()">Şimdi Tara</button></div></div>
    <div class="hi-family-tabs"><button class="hi-family-tab active" data-family="fixed" onclick="HomeInternetUI.setFamily('fixed')">Sabit Ev İnterneti</button><button class="hi-family-tab" data-family="fwa" onclick="HomeInternetUI.setFamily('fwa')">Superbox / Red Box</button></div>
    <div id="hiKpis" class="hi-kpis"><article class="hi-kpi"><span>Sağlayıcı</span><strong>—</strong><small>Yükleniyor</small></article><article class="hi-kpi"><span>Normalize Teklif</span><strong>—</strong><small>Yükleniyor</small></article><article class="hi-kpi"><span>En İyi Değer</span><strong>—</strong><small>Yükleniyor</small></article><article class="hi-kpi"><span>7 Günlük Değişiklik</span><strong>—</strong><small>Yükleniyor</small></article></div>
    <div id="hiOpportunity" class="hi-opportunity"></div>
    <div class="hi-toolbar">
      <div class="hi-filter"><label>Sağlayıcı</label><select id="hiProvider" onchange="HomeInternetUI.filter('provider',this.value)"><option>Tümü</option></select></div>
      <div class="hi-filter"><label>Teknoloji</label><select id="hiTech" onchange="HomeInternetUI.filter('tech',this.value)"><option>Tümü</option></select></div>
      <div class="hi-filter"><label>Süre</label><select id="hiDuration" onchange="HomeInternetUI.filter('duration',this.value)"><option>Tümü</option><option value="1">Aylık</option><option value="3">3 Ay</option><option value="6">6 Ay</option><option value="12">12 Ay</option></select></div>
      <label class="hi-toggle"><input id="hiBestOnly" type="checkbox" checked onchange="HomeInternetUI.toggleBest(this.checked)"><span>Her ürünün en iyi dönemini göster</span></label>
    </div>
    <article class="hi-panel"><div class="panel-head"><strong>Fiyat × Hız × TCO Benchmark</strong><span id="hiRowCount" class="muted">—</span></div><div class="table-wrap"><table class="data-table hi-table"><thead><tr><th>Sağlayıcı</th><th>Ürün</th><th>Teknoloji</th><th>Hız</th><th>Süre</th><th>Efektif Aylık</th><th>12 Ay Eşdeğer</th><th>Mbps / 100 TL</th><th>Skor</th></tr></thead><tbody id="hiProducts"><tr><td colspan="9" class="empty">Veri yükleniyor…</td></tr></tbody></table></div></article>
    <div class="hi-grid2">
      <article class="hi-panel"><div class="panel-head"><strong>Kaynak Sağlığı</strong><span>Resmi web kaynakları</span></div><div id="hiSources" class="hi-source-list"></div></article>
      <article class="hi-panel"><div class="panel-head"><strong>Son Değişiklikler</strong><span>30 günlük iz</span></div><div id="hiChanges" class="hi-change-list"></div></article>
    </div>
  </section>`);
}

function bestRows(rows){
  if(!state.bestOnly)return rows;
  const m=new Map();
  for(const r of rows){
    const key=[r.provider,r.name,r.technology,r.speed_down_mbps,r.data_limit_gb].join('|');
    const old=m.get(key);
    if(!old||Number(r.effective_monthly_try??Infinity)<Number(old.effective_monthly_try??Infinity))m.set(key,r);
  }
  return [...m.values()];
}

function filtered(){
  let rows=(state.data?.products||[]).filter(x=>(x.product_family||'fixed')===state.family);
  if(state.provider!=='Tümü')rows=rows.filter(x=>x.provider===state.provider);
  if(state.tech!=='Tümü')rows=rows.filter(x=>x.technology===state.tech);
  if(state.duration!=='Tümü')rows=rows.filter(x=>String(x.duration_months)===String(state.duration));
  rows=bestRows(rows);
  return rows.sort((a,b)=>(b.market_score||0)-(a.market_score||0)||(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity));
}

function renderKpis(){
  const d=state.data,m=d?.metrics||{};
  const fam=(d?.products||[]).filter(x=>(x.product_family||'fixed')===state.family);
  const priced=fam.filter(x=>x.effective_monthly_try!=null);
  const speed=fam.filter(x=>x.speed_down_mbps>0&&x.effective_monthly_try>0).sort((a,b)=>(b.mbps_per_100tl||0)-(a.mbps_per_100tl||0));
  const best=speed[0]||null,fast=[...fam].filter(x=>x.speed_down_mbps>0).sort((a,b)=>b.speed_down_mbps-a.speed_down_mbps)[0]||null;
  const providers=new Set(fam.map(x=>x.provider));
  const cards=state.family==='fwa'?[
    ['Ürün Ailesi','FWA','SIM tabanlı ev interneti'],
    ['Superbox',m.superbox_products??0,'KKTCELL 4.5G FWA'],
    ['Red Box',m.redbox_products??0,'Telsim 5G FWA'],
    ['7 Günlük Değişiklik',m.changes_7d??0,'FWA hareketleri ayrı izleniyor']
  ]:[
    ['Sağlayıcı',providers.size,(m.sources??0)+' resmi kaynak izleniyor'],
    ['Normalize Teklif',fam.length,priced.length+' fiyatlı teklif'],
    ['En İyi Değer',best?num(best.mbps_per_100tl,2):'—',best?(best.provider+' • '+best.name):'Fiyat/hız verisi bekleniyor'],
    ['7 Günlük Değişiklik',m.changes_7d??0,fast?('En yüksek hız: '+num(fast.speed_down_mbps)+' Mbps'):'Değişiklik izleniyor']
  ];
  document.getElementById('hiKpis').innerHTML=cards.map(x=>'<article class="hi-kpi"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></article>').join('');
}

function renderOpportunity(){
  const box=document.getElementById('hiOpportunity');
  if(state.family==='fwa'){
    const f=state.data?.fwa_comparison||{},sb=(f.superbox||[])[0],rb=(f.redbox||[])[0];
    if(!sb&&!rb){box.innerHTML='<article class="hi-op-card neutral"><span>FWA Benchmark</span><strong>Superbox / Red Box verisi bekleniyor.</strong><small>İki ürün ailesi ayrı kaynaklardan izleniyor.</small></article>';return}
    box.innerHTML='<article class="hi-op-card '+(sb&&rb?'good':'neutral')+'"><span>SUPERBOX / RED BOX BENCHMARK</span><strong>'+esc(sb?('Superbox • '+sb.name):'Superbox verisi bekleniyor')+' ↔ '+esc(rb?('Red Box • '+rb.name):'Red Box verisi bekleniyor')+'</strong><small>'+(sb?('Superbox efektif '+money(sb.effective_monthly_try)):'')+(sb&&rb?' • ':'')+(rb?('Red Box efektif '+money(rb.effective_monthly_try)):'')+'</small></article>';
    return;
  }
  const o=(state.data?.opportunities||[])[0];
  if(!o){box.innerHTML='<article class="hi-op-card neutral"><span>Benchmark sinyali</span><strong>Turkcell Ev İnterneti için karşılaştırılabilir hız eşleşmesi henüz oluşmadı.</strong><small>Yeni kaynaklar ve paketler geldikçe otomatik hesaplanacak.</small></article>';return}
  const gap=Number(o.score_gap||0),risk=gap<0;
  box.innerHTML='<article class="hi-op-card '+(risk?'risk':'good')+'"><span>'+(risk?'ÖNCELİKLİ REKABET RİSKİ':'TURKCELL EV İNTERNETİ AVANTAJI')+'</span><strong>'+esc(o.kktcell.name)+' ↔ '+esc(o.competitor.provider+' '+o.competitor.name)+'</strong><small>Home Value Score farkı <b>'+(gap>0?'+':'')+num(gap)+'</b> • Efektif aylık fark <b>'+money(o.monthly_gap_try)+'</b> • Mbps/100 TL farkı <b>'+num(o.value_gap,2)+'</b></small></article>';
}

function renderProducts(){
  const rows=filtered(),body=document.getElementById('hiProducts');document.getElementById('hiRowCount').textContent=rows.length+' teklif';
  body.innerHTML=rows.length?rows.map(x=>{
    const speed=x.speed_down_mbps?num(x.speed_down_mbps)+' Mbps':(x.data_limit_gb?num(x.data_limit_gb)+' GB':'—');
    const duration=x.duration_months+(x.bonus_months?(' + '+x.bonus_months+' hediye'):'')+' ay';
    return '<tr class="'+((x.provider==='Turkcell Ev İnterneti'||x.brand==='Superbox')?'hi-own':'')+'"><td><b>'+esc(x.provider)+'</b></td><td><div class="hi-product-name">'+esc(x.name)+'</div><small>'+esc((x.features||[]).slice(0,2).join(' • '))+'</small></td><td><span class="hi-tech">'+esc(x.technology||'—')+'</span></td><td><b>'+esc(speed)+'</b></td><td>'+esc(duration)+'</td><td><b>'+money(x.effective_monthly_try)+'</b>'+(x.install_fee_try?'<small>Kurulum '+money(x.install_fee_try)+'</small>':'')+'</td><td>'+money(x.first_year_equiv_try)+'</td><td>'+num(x.mbps_per_100tl,2)+'</td><td><span class="hi-score '+scoreClass(x.market_score)+'">'+(x.market_score??'—')+'</span></td></tr>';
  }).join(''):'<tr><td colspan="9" class="empty">Filtreye uygun teklif bulunamadı.</td></tr>';
}

function renderSources(){
  let rows=state.data?.sources||[];const box=document.getElementById('hiSources');
  if(state.family==='fwa')rows=rows.filter(s=>['kktcell-home','telsim-redbox'].includes(s.slug));
  box.innerHTML=rows.map(s=>{
    const ok=s.status==='ok',dynamic=Number(s.parsed_count||0)===0;
    return '<div class="hi-source"><div><b>'+esc(s.name)+'</b><small>'+esc(s.provider)+' • '+esc(s.technology||'')+(s.ownership_group&&s.ownership_group!==s.provider?' • '+esc(s.ownership_group):'')+'</small></div><div class="hi-source-meta"><span class="status '+(ok?'ok':'err')+'">'+(ok?(dynamic?'Kaynak aktif':'Sağlıklı'):'Hata')+'</span><small>'+num(s.response_ms)+' ms • '+num(s.parsed_count)+' teklif</small></div></div>';
  }).join('')||'<div class="empty">Kaynak verisi yok.</div>';
}

function renderChanges(){
  const rows=state.data?.changes||[],box=document.getElementById('hiChanges');
  box.innerHTML=rows.length?rows.slice(0,16).map(c=>'<div class="hi-change"><div><b>'+esc(c.provider)+' • '+esc(c.product_name||'Paket')+'</b><small>'+esc(c.change_type==='added'?'Yeni ürün':c.change_type==='removed'?'Ürün kaldırıldı':c.field_name||'Değişiklik')+'</small></div><div><span class="status '+(c.severity==='critical'||c.severity==='high'?'err':'warn')+'">'+esc(c.severity)+'</span><small>'+dt(c.detected_at)+'</small></div></div>').join(''):'<div class="empty">Henüz kaydedilmiş değişiklik yok. İlk tarama baseline olarak tutuluyor.</div>';
}

function populateFilters(){
  const d=state.data||{},fam=(d.products||[]).filter(x=>(x.product_family||'fixed')===state.family);
  const providers=[...new Set(fam.map(x=>x.provider).filter(Boolean))].sort();
  const tech=[...new Set(fam.map(x=>x.technology).filter(Boolean))].sort();
  const p=document.getElementById('hiProvider'),t=document.getElementById('hiTech');
  p.innerHTML='<option>Tümü</option>'+providers.map(x=>'<option '+(state.provider===x?'selected':'')+'>'+esc(x)+'</option>').join('');
  t.innerHTML='<option>Tümü</option>'+tech.map(x=>'<option '+(state.tech===x?'selected':'')+'>'+esc(x)+'</option>').join('');
}

function render(){
  if(!state.data)return;
  document.querySelectorAll('.hi-family-tab').forEach(b=>b.classList.toggle('active',b.dataset.family===state.family));
  renderKpis();renderOpportunity();populateFilters();renderProducts();renderSources();renderChanges();
  document.getElementById('hiUpdated').textContent='Son güncelleme '+dt(state.data.generated_at);
}

async function load(force=false){
  ensure();if(state.loading)return;state.loading=true;
  const btn=document.getElementById('hiScanBtn');if(btn){btn.disabled=true;btn.textContent=force?'Taranıyor…':'Yükleniyor…'}
  try{
    const r=await fetch('/api/home-internet'+(force?'?refresh=1':''),{cache:'no-store'});
    if(!r.ok)throw new Error('Ev interneti verisi alınamadı');
    state.data=await r.json();render();
  }catch(e){console.error(e);const body=document.getElementById('hiProducts');if(body)body.innerHTML='<tr><td colspan="9" class="empty">'+esc(e.message||String(e))+'</td></tr>'}
  finally{state.loading=false;if(btn){btn.disabled=false;btn.textContent='Şimdi Tara'}}
}
function scan(){return load(true)}
function setFamily(v){state.family=v==='fwa'?'fwa':'fixed';state.provider='Tümü';state.tech='Tümü';state.duration='Tümü';render()}
function filter(k,v){state[k]=v;renderProducts()}
function toggleBest(v){state.bestOnly=!!v;renderProducts()}

function init(){ensure();if(location.hash==='#home')load(false)}
window.HomeInternetUI={ensure,load,scan,setFamily,filter,toggleBest};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();