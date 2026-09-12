(()=>{
const routes={
  dashboard:{label:'Dashboard',desc:'Pazarın nabzı, kritik gelişmeler ve yönetici özeti.',ids:['market-pulse-section','overview']},
  competitor:{label:'Rakip Takip',desc:'Telsim paketleri, değişiklikler, kaynaklar ve kanıt arşivi.',ids:['packages-section','changes-section','historySection','evidence-section','sources-section']},
  compare:{label:'Ürün Karşılaştırma',desc:'Telsim ve KKTCELL ürünlerini segment bazında karşılaştırın.',ids:['benchmark-section']},
  segment:{label:'Segment Analizi',desc:'Genel, Asker, Öğrenci/Genç, Turist ve Premium/Platinum pozisyonu.',ids:['benchmark-section']},
  trends:{label:'Trendler',desc:'Rekabet pozisyonu ve rakip hareketlerinin 7/30/90 günlük seyri.',ids:['benchmark-section','changes-section']},
  reports:{label:'Raporlar',desc:'Yönetici, ürün ve değişiklik verilerini dışa aktarın.',ids:['reports-section']},
  settings:{label:'Ayarlar',desc:'Tema planı, tarama ve arayüz tercihleri.',ids:['settings-section']}
};
const icon={
dashboard:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" stroke-width="1.7"/></svg>',
competitor:'<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6" stroke-width="1.7"/><path d="m16 16 4 4M11 8v6M8 11h6" stroke-width="1.7"/></svg>',
compare:'<svg viewBox="0 0 24 24" fill="none"><path d="M8 5h12M4 5h.01M4 12h12M20 12h.01M8 19h12M4 19h.01" stroke-width="1.8" stroke-linecap="round"/></svg>',
segment:'<svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="8" r="3" stroke-width="1.7"/><circle cx="17" cy="8" r="3" stroke-width="1.7"/><circle cx="12" cy="17" r="3" stroke-width="1.7"/><path d="m9.5 10.2 1.2 3.6m3.8-3.6-1.2 3.6" stroke-width="1.7"/></svg>',
trends:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 18 9 12l4 3 7-9M16 6h4v4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
reports:'<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h9l3 3v15H6V3Z" stroke-width="1.7"/><path d="M15 3v4h4M9 12h6M9 16h6" stroke-width="1.7" stroke-linecap="round"/></svg>',
settings:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke-width="1.7"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2.3a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2.3.7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2.3h3l.7-2.3a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7l2.3-.7Z" stroke-width="1.2" transform="translate(2 1) scale(.83)"/></svg>'
};
let themeMode=localStorage.getItem('marketPulseThemeMode')||'auto';

function cyprusHour(){
  const part=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Famagusta',hour:'2-digit',hour12:false}).format(new Date());
  return Number(part.split(':')[0])||0;
}
function resolvedTheme(){if(themeMode==='light'||themeMode==='dark')return themeMode;const h=cyprusHour();return h>=6&&h<18?'light':'dark'}
function applyTheme(){
  const theme=resolvedTheme();document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#000F64':'#f5f8fc');
  const logo=document.getElementById('marketPulseTopLogo');if(logo)logo.src=theme==='dark'?'/brand/market-pulse-logo-dark.svg':'/brand/market-pulse-logo-light.svg';
  const status=document.getElementById('themeStatus');if(status)status.textContent=themeMode==='auto'?('Otomatik • '+(theme==='dark'?'Dark':'Light')):(theme==='dark'?'Dark':'Light');
  const mini=document.getElementById('themeMini');if(mini)mini.textContent=theme==='dark'?'☾':'☀';
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===themeMode));
}
function setThemeMode(mode){themeMode=mode;localStorage.setItem('marketPulseThemeMode',mode);applyTheme()}
function cycleTheme(){const t=resolvedTheme();setThemeMode(t==='dark'?'light':'dark')}

function sidebar(){
  if(document.querySelector('.app-sidebar'))return;
  const aside=document.createElement('aside');aside.className='app-sidebar';
  aside.innerHTML='<div class="app-side-brand"><img src="/brand/market-pulse-logo-dark.svg" alt="Market Pulse by Turkcell"><div class="app-side-tag">Competitive Intelligence</div></div>'+
    '<nav class="app-nav">'+Object.entries(routes).map(([k,r])=>'<button class="app-nav-btn" data-route="'+k+'" onclick="MarketPulseUI.go(\''+k+'\')">'+icon[k]+'<span>'+r.label+'</span></button>').join('')+'</nav>'+
    '<div class="app-side-bottom"><div class="app-theme-status"><span class="app-theme-dot"></span><span id="themeStatus">Otomatik</span></div><div class="app-side-copy">Daha fazla veri<br>Daha güçlü kararlar</div></div>';
  document.body.prepend(aside);
}
function topBrand(){
  const b=document.querySelector('.brand');if(!b)return;
  b.innerHTML='<img id="marketPulseTopLogo" src="/brand/market-pulse-logo-light.svg" alt="Market Pulse by Turkcell">';
  const actions=document.querySelector('.actions');
  if(actions&&!document.getElementById('themeMini'))actions.insertAdjacentHTML('afterbegin','<button id="themeMini" class="theme-mini" onclick="MarketPulseUI.cycleTheme()" title="Tema değiştir">☀</button>');
}
function ensureViews(){
  const shell=document.querySelector('main.shell');if(!shell)return;
  if(!document.getElementById('viewTitle')) {
    const nav=document.querySelector('.section-nav');
    (nav||shell.firstElementChild)?.insertAdjacentHTML(nav?'afterend':'afterend','<div id="viewTitle" class="view-title"><div><h2>Dashboard</h2><p>Pazarın nabzı, kritik gelişmeler ve yönetici özeti.</p></div><span class="view-chip">Market Pulse • Live</span></div>');
  }
  if(!document.getElementById('reports-section')) shell.insertAdjacentHTML('beforeend',`
  <section id="reports-section" class="section">
    <div class="section-title"><div><h2>Rapor Merkezi</h2><p>Canlı Market Pulse verisini dışa aktarın</p></div></div>
    <div class="report-grid">
      <article class="report-card"><div class="report-icon">↗</div><h3>Yönetici Özeti</h3><p>Market Pulse, skorlar ve son rakip hareketlerini JSON olarak indirin.</p><div class="report-actions"><button class="btn" onclick="MarketPulseUI.download('executive')">JSON İndir</button></div></article>
      <article class="report-card"><div class="report-icon">⇄</div><h3>Ürün Benchmark</h3><p>Telsim ↔ KKTCELL benchmark eşleşmelerini CSV veya JSON olarak dışa aktarın.</p><div class="report-actions"><button class="btn" onclick="MarketPulseUI.download('benchmark','csv')">CSV</button><button class="btn" onclick="MarketPulseUI.download('benchmark')">JSON</button></div></article>
      <article class="report-card"><div class="report-icon">⌁</div><h3>Rakip Değişiklikleri</h3><p>Son değişiklik akışını tarih ve alan farklarıyla birlikte indirin.</p><div class="report-actions"><button class="btn" onclick="MarketPulseUI.download('changes','csv')">CSV</button><button class="btn" onclick="MarketPulseUI.download('changes')">JSON</button></div></article>
    </div>
  </section>`);
  if(!document.getElementById('settings-section')) shell.insertAdjacentHTML('beforeend',`
  <section id="settings-section" class="section">
    <div class="section-title"><div><h2>Ayarlar</h2><p>Görünüm ve çalışma tercihleri</p></div></div>
    <div class="settings-grid">
      <article class="setting-card"><h3>Tema</h3><p>Varsayılan otomatik plan: 06:00–18:00 Light, 18:00–06:00 Dark. Saat dilimi Asia/Famagusta.</p><div class="theme-choice"><button data-theme-choice="auto" onclick="MarketPulseUI.setTheme('auto')">Otomatik</button><button data-theme-choice="light" onclick="MarketPulseUI.setTheme('light')">Light</button><button data-theme-choice="dark" onclick="MarketPulseUI.setTheme('dark')">Dark</button></div></article>
      <article class="setting-card"><h3>Tarama</h3><p>Rakip kaynaklar arka planda otomatik kontrol edilir.</p><div class="setting-line"><span>Otomatik tarama</span><b>Saatlik</b></div><div class="setting-line"><span>Dashboard yenileme</span><b>60 sn</b></div><div class="setting-line"><span>Kanıt görseli</span><b>Aktif</b></div></article>
      <article class="setting-card"><h3>Marka</h3><p>Market Pulse by Turkcell • KKTC Turkcell renk sistemi.</p><div class="setting-line"><span>Electric Blue</span><b>#0014F2</b></div><div class="setting-line"><span>Cyan</span><b>#00C2FF</b></div><div class="setting-line"><span>Yellow</span><b>#FFCA00</b></div></article>
    </div>
  </section>`);
}
function allRouteIds(){return [...new Set(Object.values(routes).flatMap(r=>r.ids))]}
function currentRoute(){const h=location.hash.replace('#','');return routes[h]?h:'dashboard'}
function applyRoute(route=currentRoute()){
  if(!routes[route])route='dashboard';document.body.dataset.view=route;
  const ids=allRouteIds();
  ids.forEach(id=>{const el=document.getElementById(id);if(el){el.dataset.routeSection='1';el.classList.toggle('route-visible',routes[route].ids.includes(id))}});
  document.querySelectorAll('.app-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
  const vt=document.getElementById('viewTitle');if(vt)vt.innerHTML='<div><h2>'+routes[route].label+'</h2><p>'+routes[route].desc+'</p></div><span class="view-chip">Market Pulse • Live</span>';
  if(route==='segment'&&window.setBmSegment)window.setBmSegment('Genel');
  if(route==='trends'&&window.setBmSegment)window.setBmSegment('Tümü');
  window.scrollTo({top:0,behavior:'auto'});
}
function go(route){if(!routes[route])route='dashboard';history.replaceState(null,'','#'+route);applyRoute(route)}

function csv(rows){
  if(!Array.isArray(rows)||!rows.length)return '';
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>typeof r[k]!=='object')))];
  const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return [keys.map(q).join(','),...rows.map(r=>keys.map(k=>q(r[k])).join(','))].join('\n');
}
function saveBlob(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},300)}
async function download(kind,format='json'){
  let url='/api/market-pulse?days=30',name='market-pulse-executive';
  if(kind==='benchmark'){url='/api/benchmark';name='market-pulse-benchmark'}
  if(kind==='changes'){url='/api/changes?limit=250';name='market-pulse-changes'}
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Rapor alınamadı');const data=await r.json();
  if(format==='csv'){
    const rows=kind==='benchmark'?(data.matches||[]):Array.isArray(data)?data:[data];
    saveBlob(name+'.csv',csv(rows),'text/csv;charset=utf-8');
  }else saveBlob(name+'.json',JSON.stringify(data,null,2),'application/json');
}

function init(){
  document.body.classList.add('branded-app');sidebar();topBrand();ensureViews();applyTheme();applyRoute();
  const obs=new MutationObserver(()=>applyRoute(currentRoute()));obs.observe(document.querySelector('main.shell')||document.body,{childList:true,subtree:false});
  setInterval(()=>{if(themeMode==='auto')applyTheme()},60000);
  window.addEventListener('hashchange',()=>applyRoute(currentRoute()));
}
window.MarketPulseUI={go,setTheme:setThemeMode,cycleTheme,download,applyTheme};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();