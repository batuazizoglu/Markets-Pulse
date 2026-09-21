(()=>{
const routes={
  dashboard:{label:'Dashboard',desc:'Pazarın nabzı, kritik gelişmeler, aksiyonlar ve yönetici özeti.',ids:['market-pulse-section','dashboard-insights-section','overview']},
  competitor:{label:'Rakip Takip',desc:'Değişiklik akışı, günlük değişim, Telsim paketleri ve kaynak sağlığı.',ids:['changes-section','daily-market-section','packages-section','historySection','source-health-section','sources-section']},
  home:{label:'Ev İnterneti',desc:'KKTC sabit internet pazarında fiyat, hız, teknoloji, TCO ve rakip hareketleri.',ids:['home-internet-section']},
  ads:{label:'Reklam Analizi',desc:'AI tarafından kategorilere ayrılan rakip reklamları, görsel teklifler ve değişimler.',ids:['ad-visual-section']},
  compare:{label:'Ürün Karşılaştırma',desc:'Telsim ve KKTCELL ürünlerini segment bazında karşılaştırın.',ids:['benchmark-section']},
  segment:{label:'Segment Analizi',desc:'Genel, Asker, Öğrenci/Genç, Turist ve Premium/Platinum pozisyonu.',ids:['benchmark-section']},
  trends:{label:'Trendler',desc:'Rekabet pozisyonu ve rakip hareketlerinin 7/30/90 günlük seyri.',ids:['benchmark-section','changes-section']},
  evidence:{label:'Kanıt Arşivi',desc:'Telsim tarife sayfalarının tarihli kayıtlarını bulun, karşılaştırın ve indirin.',ids:['evidence-section']},
  reports:{label:'Raporlar',desc:'Yönetici, ürün ve değişiklik verilerini dışa aktarın.',ids:['reports-section']},
  settings:{label:'Ayarlar',desc:'Tema planı, tarama ve arayüz tercihleri.',ids:['settings-section']}
};
const icon={
dashboard:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" stroke-width="1.7"/></svg>',
competitor:'<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6" stroke-width="1.7"/><path d="m16 16 4 4M11 8v6M8 11h6" stroke-width="1.7"/></svg>',
home:'<svg viewBox="0 0 24 24" fill="none"><path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M9 20v-6h6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 7.7c1.4.6 2.5 1.7 3.1 3.1M15 10c.7.3 1.2.8 1.5 1.5" stroke-width="1.4" stroke-linecap="round"/></svg>',
ads:'<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="m4 16 5-5 4 4 3-3 5 5" stroke="currentColor" stroke-width="1.7"/></svg>',
compare:'<svg viewBox="0 0 24 24" fill="none"><path d="M8 5h12M4 5h.01M4 12h12M20 12h.01M8 19h12M4 19h.01" stroke-width="1.8" stroke-linecap="round"/></svg>',
segment:'<svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="8" r="3" stroke-width="1.7"/><circle cx="17" cy="8" r="3" stroke-width="1.7"/><circle cx="12" cy="17" r="3" stroke-width="1.7"/><path d="m9.5 10.2 1.2 3.6m3.8-3.6-1.2 3.6" stroke-width="1.7"/></svg>',
trends:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 18 9 12l4 3 7-9M16 6h4v4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
evidence:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16v14H4V7ZM3 3h18v4H3V3Zm6 9h6" stroke-width="1.7" stroke-linejoin="round"/></svg>',
reports:'<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h9l3 3v15H6V3Z" stroke-width="1.7"/><path d="M15 3v4h4M9 12h6M9 16h6" stroke-width="1.7" stroke-linecap="round"/></svg>',
settings:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke-width="1.7"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2.3a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2.3.7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2.3h3l.7-2.3a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7l2.3-.7Z" stroke-width="1.2" transform="translate(2 1) scale(.83)"/></svg>'
};
let themeMode=localStorage.getItem('marketPulseThemeMode')||'auto';
let currentUser=null;

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
  aside.innerHTML='<div class="app-side-brand"><img src="/brand/market-pulse-logo-dark.svg" alt="Markets Pulse by Turkcell"><div class="app-side-tag">Competitive Intelligence</div></div>'+
    '<nav class="app-nav">'+Object.entries(routes).filter(([k])=>k!=='settings'||currentUser?.role==='admin').map(([k,r])=>'<button class="app-nav-btn" data-route="'+k+'" onclick="MarketPulseUI.go(\''+k+'\')">'+icon[k]+'<span>'+r.label+'</span></button>').join('')+'</nav>'+
    '<div class="app-side-bottom"><div class="app-user-mini"><b>'+((currentUser?.first_name||'')+' '+(currentUser?.last_name||'')).trim()+'</b><span>'+(currentUser?.role==='admin'?'Admin':'Standart')+' • '+(currentUser?.username||'')+'</span></div><button class="app-logout" onclick="MarketPulseUI.logout()">Çıkış Yap</button><div class="app-theme-status"><span class="app-theme-dot"></span><span id="themeStatus">Otomatik</span></div><div class="app-side-copy">Daha fazla veri<br>Daha güçlü kararlar</div></div>';
  document.body.prepend(aside);
}
function topBrand(){
  const b=document.querySelector('.brand');if(!b)return;
  b.innerHTML='<img id="marketPulseTopLogo" src="/brand/market-pulse-logo-light.svg" alt="Markets Pulse by Turkcell">';
  const actions=document.querySelector('.actions');
  if(actions&&!document.getElementById('themeMini'))actions.insertAdjacentHTML('afterbegin','<div class="user-chip"><b>'+((currentUser?.first_name||'')+' '+(currentUser?.last_name||'')).trim()+'</b><span>'+(currentUser?.role==='admin'?'Admin':'Standart')+'</span></div><button id="themeMini" class="theme-mini" onclick="MarketPulseUI.cycleTheme()" title="Tema değiştir">☀</button>');
}
function ensureViews(){
  const shell=document.querySelector('main.shell');if(!shell)return;
  if(!document.getElementById('viewTitle')) {
    const nav=document.querySelector('.section-nav');
    (nav||shell.firstElementChild)?.insertAdjacentHTML(nav?'afterend':'afterend','<div id="viewTitle" class="view-title"><div><h2>Dashboard</h2><p>Pazarın nabzı, kritik gelişmeler ve yönetici özeti.</p></div><span class="view-chip">Markets Pulse • Live</span></div>');
  }
  if(!document.getElementById('dashboard-insights-section')) shell.insertAdjacentHTML('beforeend',`<section id="dashboard-insights-section" class="section"><div class="section-title"><div><h2>Yönetici İçgörüleri</h2><p>Benchmark ve rakip hareketlerinden türetilen dört kritik sinyal</p></div></div><div id="executiveInsights" class="executive-grid"><article class="executive-card"><span>Genel Pozisyon</span><strong>—</strong><small>Hesaplanıyor</small></article><article class="executive-card"><span>En Güçlü Segment</span><strong>—</strong><small>Hesaplanıyor</small></article><article class="executive-card"><span>En Baskı Altındaki</span><strong>—</strong><small>Hesaplanıyor</small></article><article class="executive-card"><span>Öncelikli Aksiyon</span><strong>—</strong><small>Hesaplanıyor</small></article></div></section>`);
  if(!document.getElementById('reports-section')) shell.insertAdjacentHTML('beforeend',`
  <section id="reports-section" class="section">
    <div class="section-title"><div><h2>Rapor Merkezi</h2><p>Mobil, Turkcell Ev İnterneti ve FWA raporlarını birbirinden ayrı PDF/ZIP olarak üretin ve e-posta grubuna gönderin</p></div><span id="reportEmailBadge" class="view-chip">E-posta kontrol ediliyor…</span></div>
    <div id="reportStatusStrip" class="report-status-strip"><div><b>Otomatik dağıtım</b><span>Durum yükleniyor…</span></div></div>
    <div class="report-grid report-grid-4">
      <article class="report-card"><div class="report-icon">☀</div><h3>Günlük Yönetici Özeti</h3><p>Son 24 saat: Competitive Pressure, genel pozisyon, segment skorları, kritik rakip hamleleri ve aksiyon önerileri.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('daily')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('daily',this)">E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">7</div><h3>Haftalık Markets Pulse PDF</h3><p>7 günlük skor değişimi, segment trendleri, önemli Telsim hamleleri, değişiklik özeti ve seçilmiş görsel kanıtlar.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('weekly')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('weekly',this)">E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">30</div><h3>Aylık Birleşik Yönetici Raporu</h3><p>Son 30 gün: mobil rekabet ve segment seyri, Telsim hamleleri, ev interneti, Superbox / Red Box, kanıt kapsamı ve gelecek dönem aksiyonları. Güncel kataloglar ayrıca gösterilir; takvim ayı kapanışı değildir.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('monthly')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('monthly',this)">Hesabıma E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">↯</div><h3>Son 7 Günde Telsim Ne Yaptı?</h3><p>Ürün bazlı ekleme, kaldırma, fiyat/data/fayda değişimleri; tehdit skoru, segment ve önerilen karşı aksiyonlarla.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('telsim7')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('telsim7',this)">E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">⌂</div><h3>Turkcell Ev İnterneti</h3><p>KKTCELL + Lifecell Digital birleşik sabit internet kataloğu; hız, fiyat, TCO, Mbps/100 TL ve rakip ISP benchmark'ı.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('home')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('home',this)">E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">5G</div><h3>Superbox / Red Box</h3><p>FWA ürünleri mobil ve sabit genişbanttan ayrı: KKTCELL Superbox ile Telsim Red Box fiyat, teknoloji ve kontrat karşılaştırması.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('fwa')">PDF İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('fwa',this)">E-posta Gönder</button></div></article>
      <article class="report-card"><div class="report-icon">▣</div><h3>Evidence Pack</h3><p>7 günlük rapor + changes.csv + Paket Görünümü PNG + değişiklik/baseline tam sayfa PNG + HTML + JSON + metadata.</p><div class="report-actions"><button class="btn primary" onclick="MarketPulseUI.reportDownload('evidence')">ZIP İndir</button><button class="btn" data-report-email onclick="MarketPulseUI.sendReport('evidence',this)">E-posta Gönder</button></div></article>
    </div>
    <article class="report-history-card"><div class="panel-head"><strong>Rapor & Dağıtım Geçmişi</strong><button class="btn" onclick="MarketPulseUI.loadReportStatus()">Yenile</button></div><div id="reportHistory" class="report-history"><div class="empty">Geçmiş yükleniyor…</div></div></article>
  </section>`);
  if(currentUser?.role==='admin'&&!document.getElementById('settings-section')) shell.insertAdjacentHTML('beforeend',`
  <section id="settings-section" class="section">
    <div class="section-title"><div><h2>Ayarlar</h2><p>Platform, erişim ve çalışma tercihleri</p></div></div>
    <div class="settings-grid">
      <article class="setting-card"><h3>Tema</h3><p>Varsayılan otomatik plan: 06:00–18:00 Light, 18:00–06:00 Dark. Saat dilimi Asia/Famagusta.</p><div class="theme-choice"><button data-theme-choice="auto" onclick="MarketPulseUI.setTheme('auto')">Otomatik</button><button data-theme-choice="light" onclick="MarketPulseUI.setTheme('light')">Light</button><button data-theme-choice="dark" onclick="MarketPulseUI.setTheme('dark')">Dark</button></div></article>
      <article class="setting-card"><h3>Tarama</h3><p>Rakip kaynaklar arka planda otomatik kontrol edilir.</p><div class="setting-line"><span>Otomatik tarama</span><b>Saatlik</b></div><div class="setting-line"><span>Dashboard yenileme</span><b>60 sn</b></div><div class="setting-line"><span>Kanıt görseli</span><b>Aktif</b></div></article>
      <article class="setting-card"><h3>Marka</h3><p>Markets Pulse by Turkcell • KKTC Turkcell renk sistemi.</p><div class="setting-line"><span>Electric Blue</span><b>#0014F2</b></div><div class="setting-line"><span>Cyan</span><b>#00C2FF</b></div><div class="setting-line"><span>Yellow</span><b>#FFCA00</b></div></article>
      <article class="setting-card user-admin-card"><h3>Kullanıcı Ekle</h3><p>Yeni kullanıcıya otomatik kullanıcı adı ve geçici parola oluşturulur; bilgiler e-posta ile kişiye gönderilir.</p>
        <form class="user-add-form" onsubmit="MarketPulseUI.addUser(event)">
          <div><label>İsim</label><input id="newUserFirst" required></div><div><label>Soyisim</label><input id="newUserLast" required></div>
          <div><label>E-posta</label><input id="newUserEmail" type="email" required></div><div><label>Rol</label><select id="newUserRole"><option value="standard">Standart</option><option value="admin">Admin</option></select></div>
          <button class="btn primary" id="newUserBtn" type="submit">Kullanıcı Oluştur ve Davet Gönder</button>
        </form>
      </article>
      <article class="setting-card user-list-card"><div class="user-list-head"><div><h3>Kullanıcılar</h3><p>Platform erişimi, rol ve davet durumları</p></div><button class="btn" onclick="MarketPulseUI.loadUsers()">Yenile</button></div><div id="userAdminList" class="user-admin-list"><div class="empty">Kullanıcılar yükleniyor…</div></div></article>
    </div>
  </section>`);
}
function organizeContent(){
  const packages=document.getElementById('packages-section'),history=document.getElementById('historySection');
  if(packages&&history&&packages.nextElementSibling!==history)packages.insertAdjacentElement('afterend',history);
  const mp=document.getElementById('market-pulse-section'),insights=document.getElementById('dashboard-insights-section');
  if(mp&&insights&&mp.nextElementSibling!==insights)mp.insertAdjacentElement('afterend',insights);
}
function allRouteIds(){return [...new Set(Object.values(routes).flatMap(r=>r.ids))]}
function currentRoute(){const h=location.hash.replace('#','');return h==='evidence-section'?'evidence':routes[h]?h:'dashboard'}
function applyRoute(route=currentRoute()){
  organizeContent();
  if(!routes[route])route='dashboard';if(route==='settings'&&currentUser?.role!=='admin')route='dashboard';document.body.dataset.view=route;
  const ids=allRouteIds();
  ids.forEach(id=>{const el=document.getElementById(id);if(el){el.dataset.routeSection='1';el.classList.toggle('route-visible',routes[route].ids.includes(id))}});
  document.querySelectorAll('.app-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
  const vt=document.getElementById('viewTitle');if(vt)vt.innerHTML='<div><h2>'+routes[route].label+'</h2><p>'+routes[route].desc+'</p></div><span class="view-chip">Markets Pulse • Live</span>';
  if(route==='segment'&&window.setBmSegment)window.setBmSegment('Genel');
  if(route==='trends'&&window.setBmSegment)window.setBmSegment('Tümü');
  if(route==='evidence'&&window.EvidenceArchive)window.EvidenceArchive.activate();
  if(route==='reports')loadReportStatus();
  if(route==='ads'&&window.AdVisualUI)window.AdVisualUI.load();
  if(route==='settings'&&currentUser?.role==='admin')loadUsers();
  if(route==='home'&&window.HomeInternetUI)window.HomeInternetUI.load();
  window.scrollTo({top:0,behavior:'auto'});
}
function go(route){if(!routes[route])route='dashboard';history.replaceState(null,'','#'+route);applyRoute(route)}

async function loadExecutiveInsights(){
  const box=document.getElementById('executiveInsights');if(!box)return;
  try{
    const [br,mr]=await Promise.all([fetch('/api/benchmark',{cache:'no-store'}),fetch('/api/market-pulse?days=30',{cache:'no-store'})]);
    if(!br.ok||!mr.ok)throw new Error('Executive data unavailable');
    const b=await br.json(),m=await mr.json();
    const scores=(b.segment_scores||[]).filter(x=>x.score!=null).sort((a,z)=>z.score-a.score);
    const strongest=scores[0],weakest=scores[scores.length-1],threat=(m.top_threats||[])[0];
    box.innerHTML=
      '<article class="executive-card primary"><span>Genel Competitive Position</span><strong>'+(b.overall_score?.score??'—')+'/100</strong><small>'+(b.overall_score?.level||'Veri bekleniyor')+' • Güven '+(b.overall_score?.confidence||'—')+'</small></article>'+
      '<article class="executive-card good"><span>En Güçlü Segment</span><strong>'+(strongest?.segment||'—')+'</strong><small>'+(strongest?.score??'—')+'/100 • '+(strongest?.level||'—')+'</small></article>'+
      '<article class="executive-card risk"><span>En Baskı Altındaki Segment</span><strong>'+(weakest?.segment||'—')+'</strong><small>'+(weakest?.score??'—')+'/100 • '+(weakest?.level||'—')+'</small></article>'+
      '<article class="executive-card action"><span>Öncelikli Rakip Hamlesi</span><strong>'+(threat?.product_name||'Anlamlı yeni hamle yok')+'</strong><small>'+(threat?('Tehdit '+threat.threat+'/100 • '+(threat.action||'')):'Son 30 günde kritik hareket görünmüyor')+'</small></article>';
  }catch(e){console.error(e);box.innerHTML='<article class="executive-card"><span>Yönetici İçgörüleri</span><strong>Veri alınamadı</strong><small>Bir sonraki yenilemede tekrar denenecek.</small></article>'}
}

function reportDownload(type){
  window.location.href='/api/reports/'+type+'/download';
  setTimeout(loadReportStatus,1500);
}
function reportFmtTime(v){return v?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
function reportBytes(v){const n=Number(v||0);if(!n)return '—';if(n<1024*1024)return (n/1024).toFixed(0)+' KB';return (n/1024/1024).toFixed(1)+' MB'}
async function sendReport(type,btn){
  const original=btn?.textContent||'E-posta Gönder';if(btn){btn.disabled=true;btn.textContent='Gönderiliyor…'}
  try{
    const r=await fetch('/api/reports/'+type+'/email',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'E-posta gönderilemedi');
    alert('Rapor gönderildi: '+(d.recipients||[]).join(', '));
  }catch(e){alert(e.message||String(e))}
  finally{if(btn){btn.disabled=false;btn.textContent=original}loadReportStatus()}
}
async function loadReportStatus(){
  const badge=document.getElementById('reportEmailBadge'),strip=document.getElementById('reportStatusStrip'),historyBox=document.getElementById('reportHistory');
  if(!badge&&!strip&&!historyBox)return;
  try{
    const r=await fetch('/api/reports/status',{cache:'no-store'});if(!r.ok)throw new Error('Rapor durumu alınamadı');
    const d=await r.json(),em=d.email||{};
    if(badge){badge.textContent=em.configured?'E-posta aktif':'E-posta yapılandırılmadı';badge.classList.toggle('report-ok',!!em.configured);badge.classList.toggle('report-warn',!em.configured)}
    document.querySelectorAll('[data-report-email]').forEach(b=>{b.disabled=!em.configured;b.title=em.configured?'Oturum açan kullanıcının e-posta adresine gönder':'E-posta altyapısı yapılandırılmalı'});
    if(strip)strip.innerHTML='<div><b>Günlük otomatik gönderim</b><span>'+em.daily_cron+' • '+em.timezone+'</span></div><div><b>Haftalık otomatik gönderim</b><span>'+em.weekly_cron+' • '+em.timezone+'</span></div><div><b>Alıcı grubu</b><span>'+(em.recipients?.length?em.recipients.join(', '):'Tanımlı değil')+'</span></div><div><b>E-posta altyapısı</b><span>'+(em.configured?'Hazır • '+(em.from||''):'Railway environment variable gerekli')+'</span></div>';
    if(historyBox){
      const rows=d.recent_runs||[];
      historyBox.innerHTML=rows.length?'<div class="table-wrap"><table class="data-table report-history-table"><thead><tr><th>Tarih</th><th>Rapor</th><th>Tetikleme</th><th>Durum</th><th>Alıcı</th><th>Boyut</th><th>Hata</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+reportFmtTime(x.generated_at)+'</td><td><b>'+String(x.report_type||'')+'</b></td><td>'+String(x.trigger_type||'')+'</td><td><span class="status '+(x.delivery_status==='sent'?'ok':x.delivery_status==='error'?'err':'warn')+'">'+String(x.delivery_status||'')+'</span></td><td>'+((x.recipients||[]).join(', ')||'—')+'</td><td>'+reportBytes(x.file_size_bytes)+'</td><td class="error-text">'+String(x.error||'—')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">Henüz rapor üretim kaydı yok.</div>';
    }
  }catch(e){console.error(e);if(badge)badge.textContent='Rapor durumu alınamadı'}
}

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

async function loadCurrentUser(){
  const r=await fetch('/api/auth/me',{cache:'no-store'});
  if(!r.ok){location.href='/login';throw new Error('Oturum gerekli')}
  const d=await r.json();currentUser=d.user;return currentUser;
}
async function logout(){
  await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});
  location.href='/login';
}
function fmtUserDate(v){return v?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
async function loadUsers(){
  if(currentUser?.role!=='admin')return;
  const box=document.getElementById('userAdminList');if(!box)return;
  try{
    const r=await fetch('/api/admin/users',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Kullanıcılar alınamadı');
    box.innerHTML=(d.users||[]).map(u=>'<div class="user-row"><div class="user-avatar">'+String(u.first_name||'?').slice(0,1)+String(u.last_name||'').slice(0,1)+'</div><div class="user-main"><b>'+u.first_name+' '+u.last_name+'</b><span>'+u.email+' • @'+u.username+'</span><small>'+(u.invite_sent_at?'Davet '+fmtUserDate(u.invite_sent_at):'Davet bekliyor')+' • Son giriş '+fmtUserDate(u.last_login_at)+(u.must_change_password?' • Parola değişimi bekliyor':'')+'</small></div><div class="user-actions"><span class="role-badge '+(u.role==='admin'?'admin':'')+'">'+(u.role==='admin'?'Admin':'Standart')+'</span><span class="status '+(u.active?'ok':'err')+'">'+(u.active?'Aktif':'Pasif')+'</span><button class="btn" onclick="MarketPulseUI.resendInvite('+u.id+')">Yeni Parola Gönder</button>'+(u.id!==currentUser.id?'<button class="btn" onclick="MarketPulseUI.toggleUser('+u.id+','+(!u.active)+')">'+(u.active?'Pasifleştir':'Aktifleştir')+'</button>':'')+'</div></div>').join('')||'<div class="empty">Kullanıcı yok.</div>';
  }catch(e){box.innerHTML='<div class="empty">'+e.message+'</div>'}
}
async function addUser(ev){
  ev.preventDefault();if(currentUser?.role!=='admin')return;
  const btn=document.getElementById('newUserBtn');btn.disabled=true;btn.textContent='Oluşturuluyor…';
  try{
    const body={first_name:document.getElementById('newUserFirst').value,last_name:document.getElementById('newUserLast').value,email:document.getElementById('newUserEmail').value,role:document.getElementById('newUserRole').value};
    const r=await fetch('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Kullanıcı oluşturulamadı');
    alert('Kullanıcı oluşturuldu ve giriş bilgileri '+d.user.email+' adresine gönderildi. Kullanıcı adı: '+d.user.username);
    ev.target.reset();await loadUsers();
  }catch(e){alert(e.message)}finally{btn.disabled=false;btn.textContent='Kullanıcı Oluştur ve Davet Gönder'}
}
async function resendInvite(id){
  if(!confirm('Bu kullanıcı için mevcut parola geçersiz olacak ve yeni geçici parola e-posta ile gönderilecek. Devam edilsin mi?'))return;
  const r=await fetch('/api/admin/users/'+id+'/resend',{method:'POST'}),d=await r.json().catch(()=>({}));if(!r.ok)return alert(d.error||'Davet gönderilemedi');alert('Yeni giriş bilgileri '+d.user.email+' adresine gönderildi.');loadUsers();
}
async function toggleUser(id,active){
  const r=await fetch('/api/admin/users/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({active})}),d=await r.json().catch(()=>({}));if(!r.ok)return alert(d.error||'Kullanıcı güncellenemedi');loadUsers();
}

async function init(){
  await loadCurrentUser();document.body.classList.add('branded-app');sidebar();topBrand();ensureViews();organizeContent();applyTheme();applyRoute();loadExecutiveInsights();
  const obs=new MutationObserver(()=>applyRoute(currentRoute()));obs.observe(document.querySelector('main.shell')||document.body,{childList:true,subtree:false});
  setInterval(()=>{if(themeMode==='auto')applyTheme()},60000);
  setInterval(loadExecutiveInsights,300000);
  window.addEventListener('hashchange',()=>applyRoute(currentRoute()));
}
window.MarketPulseUI={go,setTheme:setThemeMode,cycleTheme,download,applyTheme,reportDownload,sendReport,loadReportStatus,logout,loadUsers,addUser,resendInvite,toggleUser};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
