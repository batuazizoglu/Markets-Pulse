const mpStyle=document.createElement('style');
mpStyle.textContent=`
#market-pulse-section{margin-top:0;scroll-margin-top:90px}.mp-shell{display:grid;gap:12px}.mp-hero{display:grid;grid-template-columns:280px minmax(0,1fr);gap:12px}.mp-pressure,.mp-summary,.mp-mini,.mp-threats,.mp-mix{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}.mp-pressure{padding:18px;display:flex;align-items:center;gap:18px}.mp-ring{--score:0;width:108px;height:108px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--red) calc(var(--score)*1%),#eef2f6 0);position:relative;flex:0 0 auto}.mp-ring:after{content:"";position:absolute;inset:10px;background:#fff;border-radius:50%}.mp-ring strong{position:relative;z-index:1;font-size:28px;letter-spacing:-.04em}.mp-pressure-copy span,.mp-label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:800}.mp-pressure-copy b{display:block;font-size:17px;margin-top:4px}.mp-pressure-copy small{display:block;color:var(--muted);margin-top:3px}.mp-summary{padding:20px}.mp-summary h2{margin:4px 0 7px;font-size:22px;letter-spacing:-.025em}.mp-summary p{margin:0;color:var(--muted);max-width:900px}.mp-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:13px}.mp-badge{padding:5px 8px;border-radius:999px;background:#f2f4f7;color:#344054;font-size:10px;font-weight:800}.mp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.mp-mini{padding:14px}.mp-mini strong{display:block;font-size:22px;margin-top:5px;letter-spacing:-.03em}.mp-mini small{color:var(--muted)}.mp-main{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,.75fr);gap:12px}.mp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line)}.mp-head strong{font-size:14px}.mp-list{padding:4px 14px 12px}.mp-move{padding:12px 2px;border-bottom:1px solid #eef2f6}.mp-move:last-child{border-bottom:0}.mp-move-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.mp-move-title{font-weight:850}.mp-meta{font-size:10px;color:var(--muted);margin-top:2px}.mp-score{min-width:54px;text-align:center;border-radius:10px;padding:7px 8px;font-weight:900;background:var(--badbg);color:var(--bad)}.mp-score.med{background:var(--warnbg);color:var(--warn)}.mp-score.low{background:var(--goodbg);color:var(--good)}.mp-reasons{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.mp-reason{font-size:9px;padding:4px 6px;border-radius:7px;background:#f8fafc;color:#475467;border:1px solid #eaecf0}.mp-action{margin-top:8px;padding:9px 10px;border-radius:9px;background:#f8fafc;font-size:11px;color:#344054}.mp-action b{color:#101828}.mp-mixes{padding:12px 14px}.mp-mix-group+.mp-mix-group{margin-top:16px}.mp-mix-title{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:800;margin-bottom:8px}.mp-bar-row{display:grid;grid-template-columns:minmax(90px,1fr) 2fr 38px;gap:8px;align-items:center;margin:7px 0;font-size:11px}.mp-bar{height:7px;border-radius:999px;background:#eef2f6;overflow:hidden}.mp-bar i{display:block;height:100%;background:var(--navy);border-radius:999px}.mp-bar-row em{font-style:normal;text-align:right;color:var(--muted)}.mp-note{font-size:10px;color:var(--muted);padding:0 2px}.mp-empty{padding:28px;color:var(--muted);text-align:center}.mp-window{display:flex;gap:5px}.mp-window button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 8px;font-size:10px;font-weight:800;color:var(--muted);cursor:pointer}.mp-window button.active{background:var(--navy);color:#fff;border-color:var(--navy)}
@media(max-width:1000px){.mp-hero,.mp-main{grid-template-columns:1fr}.mp-kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:720px){.mp-pressure{padding:14px}.mp-ring{width:88px;height:88px}.mp-ring strong{font-size:23px}.mp-summary{padding:15px}.mp-summary h2{font-size:18px}.mp-kpis{gap:8px}.mp-mini{padding:12px}.mp-mini strong{font-size:18px}.mp-move-top{align-items:center}.mp-head{align-items:flex-start;flex-direction:column}.mp-window{width:100%;overflow:auto}}
`;
document.head.appendChild(mpStyle);

function mpEsc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function mpTime(v){return v?new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Famagusta'}).format(new Date(v)):'—'}
let mpDays=30;

function installMarketPulse(){
  document.title='Markets Pulse by Turkcell';
  const nav=document.querySelector('.section-nav');
  if(nav&&!nav.querySelector('a[href="#market-pulse-section"]')) nav.insertAdjacentHTML('afterbegin','<a href="#market-pulse-section">Markets Pulse</a>');
  const overview=document.getElementById('overview');
  if(overview&&!document.getElementById('market-pulse-section')) overview.insertAdjacentHTML('beforebegin',`<section id="market-pulse-section" class="mp-shell"><div id="mpContent" class="mp-empty">Markets Pulse hesaplanıyor…</div></section>`);
  loadMarketPulse(30);
}

async function loadMarketPulse(days=30,btn){
  mpDays=days;
  if(btn){document.querySelectorAll('.mp-window button').forEach(b=>b.classList.remove('active'));btn.classList.add('active')}
  const box=document.getElementById('mpContent');
  if(!box)return;
  try{
    const r=await fetch('/api/market-pulse?days='+days,{cache:'no-store'});
    if(!r.ok)throw new Error(await r.text());
    const d=await r.json();renderMarketPulse(d);
  }catch(e){console.error(e);box.innerHTML='<div class="mp-empty">Markets Pulse verisi şu anda yüklenemiyor.</div>'}
}

function renderMarketPulse(d){
  const box=document.getElementById('mpContent');if(!box)return;
  const levelClass=d.pressure_index>=70?'':d.pressure_index>=40?'med':'low';
  const topIntent=d.intent_mix?.[0];const topSegment=d.segment_mix?.[0];
  box.className='mp-shell';
  box.innerHTML=`
    <div class="mp-hero">
      <article class="mp-pressure"><div class="mp-ring" style="--score:${d.pressure_index||0}"><strong>${d.pressure_index||0}</strong></div><div class="mp-pressure-copy"><span>Competitive Pressure</span><b>${mpEsc(d.pressure_level)}</b><small>${d.window_days} günlük pencere</small></div></article>
      <article class="mp-summary"><span class="mp-label">Executive Summary</span><h2>Bugün pazarda ne oluyor?</h2><p>${mpEsc(d.executive_summary)}</p><div class="mp-badges"><span class="mp-badge">Rakip: ${mpEsc(d.competitor)}</span>${topIntent?`<span class="mp-badge">Ana niyet: ${mpEsc(topIntent.name)} · %${topIntent.pct}</span>`:''}${topSegment?`<span class="mp-badge">Odak: ${mpEsc(topSegment.name)} · %${topSegment.pct}</span>`:''}<span class="mp-badge">Açıklanabilir skor V1</span></div></article>
    </div>
    <div class="mp-kpis"><article class="mp-mini"><span class="mp-label">Rakip Hamlesi</span><strong>${d.move_count||0}</strong><small>${d.window_days} günde gruplanmış hareket</small></article><article class="mp-mini"><span class="mp-label">Tehdit</span><strong>${d.threat_count||0}</strong><small>Aksiyon değerlendirmesi gereken</small></article><article class="mp-mini"><span class="mp-label">Fırsat</span><strong>${d.opportunity_count||0}</strong><small>KKTCELL lehine değerlendirilebilir</small></article><article class="mp-mini"><span class="mp-label">Reaksiyon Gereksiz</span><strong>${d.no_reaction_count||0}</strong><small>İzle, fiyat savaşı yaratma</small></article></div>
    <div class="mp-main">
      <article class="mp-threats"><div class="mp-head"><strong>Öncelikli Rakip Hamleleri</strong><div class="mp-window"><button ${mpDays===7?'class="active"':''} onclick="loadMarketPulse(7,this)">7 gün</button><button ${mpDays===30?'class="active"':''} onclick="loadMarketPulse(30,this)">30 gün</button><button ${mpDays===90?'class="active"':''} onclick="loadMarketPulse(90,this)">90 gün</button></div></div><div class="mp-list">${renderMoves(d.top_threats||[])}</div></article>
      <article class="mp-mix"><div class="mp-head"><strong>Rakip Strateji Haritası</strong><span class="muted">Niyet + segment</span></div><div class="mp-mixes"><div class="mp-mix-group"><div class="mp-mix-title">Stratejik Niyet</div>${renderMix(d.intent_mix||[])}</div><div class="mp-mix-group"><div class="mp-mix-title">Segment Odağı</div>${renderMix(d.segment_mix||[])}</div>${(d.opportunities||[]).length?`<div class="mp-mix-group"><div class="mp-mix-title">En Güçlü Fırsat</div><div class="mp-action"><b>${mpEsc(d.opportunities[0].product_name)}</b><br>${mpEsc(d.opportunities[0].action)}</div></div>`:''}</div></article>
    </div>
    <div class="mp-note">${mpEsc(d.methodology)} • Skor karar desteğidir; müşteri tabanı, marj ve KKTCELL ürün benchmark’ı bağlandıkça V2’de kalibre edilecektir.</div>`;
}

function renderMoves(rows){
  if(!rows.length)return '<div class="mp-empty">Bu dönemde anlamlı rakip hareketi yok.</div>';
  return rows.slice(0,6).map(m=>{const c=m.threat>=70?'':m.threat>=40?'med':'low';return `<div class="mp-move"><div class="mp-move-top"><div><div class="mp-move-title">${mpEsc(m.product_name)}</div><div class="mp-meta">${mpTime(m.detected_at)} • ${mpEsc(m.segment)} • ${mpEsc(m.intent)} • ${m.decision==='OPPORTUNITY'?'FIRSAT':m.decision==='NO_REACTION'?'İZLE':'TEHDİT'}</div></div><div class="mp-score ${c}">${m.threat}/100</div></div><div class="mp-reasons">${(m.reasons||[]).map(x=>`<span class="mp-reason">${mpEsc(x)}</span>`).join('')}</div><div class="mp-action"><b>Önerilen aksiyon:</b> ${mpEsc(m.action)}</div></div>`}).join('');
}
function renderMix(rows){return rows.slice(0,6).map(x=>`<div class="mp-bar-row"><span>${mpEsc(x.name)}</span><div class="mp-bar"><i style="width:${Math.max(3,x.pct)}%"></i></div><em>%${x.pct}</em></div>`).join('')||'<div class="muted">Veri bekleniyor.</div>'}

window.loadMarketPulse=loadMarketPulse;
installMarketPulse();
setInterval(()=>loadMarketPulse(mpDays),60000);
