const bmStyle=document.createElement('style');
bmStyle.textContent=`
#benchmark-section{scroll-margin-top:90px}.bm-headline{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:10px}.bm-headline h2{margin:0;font-size:16px}.bm-headline p{margin:2px 0 0;color:var(--muted);font-size:12px}.bm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.bm-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:14px}.bm-kpi span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:800}.bm-kpi strong{display:block;font-size:23px;margin-top:5px}.bm-kpi.good strong{color:var(--good)}.bm-kpi.bad strong{color:var(--bad)}.bm-kpi.warn strong{color:var(--warn)}.bm-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,.75fr);gap:12px}.bm-panel{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}.bm-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line)}.bm-status{font-size:10px;color:var(--muted)}.bm-table-wrap{overflow:auto;max-height:650px}.bm-table{width:100%;border-collapse:collapse;min-width:1050px}.bm-table th,.bm-table td{padding:10px 11px;border-bottom:1px solid #eef2f6;text-align:left;vertical-align:middle;font-size:11px}.bm-table th{position:sticky;top:0;background:#fbfcfd;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.05em;z-index:2}.bm-pos{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:900}.bm-pos.ours{background:var(--goodbg);color:var(--good)}.bm-pos.theirs{background:var(--badbg);color:var(--bad)}.bm-pos.parity{background:var(--warnbg);color:var(--warn)}.bm-gap.good{color:var(--good);font-weight:800}.bm-gap.bad{color:var(--bad);font-weight:800}.bm-source-list{padding:12px 14px}.bm-source{padding:10px 0;border-bottom:1px solid #eef2f6}.bm-source:last-child{border-bottom:0}.bm-source-top{display:flex;justify-content:space-between;gap:8px}.bm-source b{font-size:12px}.bm-source small{display:block;color:var(--muted);margin-top:3px}.bm-actions{padding:12px 14px;border-top:1px solid var(--line);background:#fbfcfd;font-size:10px;color:var(--muted)}.bm-mobile{display:none;padding:10px}.bm-card{border:1px solid var(--line);border-radius:12px;padding:13px;margin-bottom:9px}.bm-card-top{display:flex;justify-content:space-between;gap:10px}.bm-card h3{margin:0;font-size:13px}.bm-vs{display:grid;grid-template-columns:1fr 24px 1fr;gap:7px;align-items:center;margin-top:10px}.bm-side{background:var(--surface2);border-radius:9px;padding:9px}.bm-side span{display:block;font-size:9px;color:var(--muted);text-transform:uppercase}.bm-side b{display:block;font-size:11px;margin-top:2px}.bm-versus{text-align:center;color:var(--muted);font-size:9px}.bm-rec{margin-top:9px;padding:8px 9px;background:#f8fafc;border-radius:8px;font-size:10px;color:#344054}.bm-refresh{border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 9px;font-size:10px;font-weight:800;cursor:pointer}
@media(max-width:1000px){.bm-grid{grid-template-columns:1fr}.bm-kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:720px){.bm-headline{align-items:flex-start}.bm-headline p{display:none}.bm-table-wrap{display:none}.bm-mobile{display:block}.bm-kpis{gap:8px}.bm-kpi{padding:12px}.bm-kpi strong{font-size:19px}}
`;
document.head.appendChild(bmStyle);

function bmEsc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function bmNum(v,s=''){return v==null||Number.isNaN(Number(v))?'—':`${Number(v).toLocaleString('tr-TR',{maximumFractionDigits:2})}${s}`}
function bmGap(v,s=''){if(v==null)return '<span>—</span>';const n=Number(v);return `<span class="bm-gap ${n>=0?'good':'bad'}">${n>0?'+':''}${n.toLocaleString('tr-TR',{maximumFractionDigits:1})}${s}</span>`}
function bmPos(p){return p==='KKTCELL_ADVANTAGE'?'<span class="bm-pos ours">KKTCELL AVANTAJ</span>':p==='TELSIM_ADVANTAGE'?'<span class="bm-pos theirs">TELSIM AVANTAJ</span>':p==='PARITY'?'<span class="bm-pos parity">PARİTE</span>':'<span class="bm-pos">—</span>'}

function installBenchmark(){
  const nav=document.querySelector('.section-nav');
  if(nav&&!nav.querySelector('a[href="#benchmark-section"]')) nav.insertAdjacentHTML('beforeend','<a href="#benchmark-section">Benchmark</a>');
  if(document.getElementById('benchmark-section'))return;
  const anchor=document.getElementById('overview');
  if(!anchor){setTimeout(installBenchmark,250);return}
  anchor.insertAdjacentHTML('beforebegin',`<section id="benchmark-section" class="section"><div class="bm-headline"><div><h2>KKTCELL Product Benchmark Engine</h2><p>En yakın ticari eşleşme üzerinden Telsim ↔ Kuzey Kıbrıs Turkcell karşılaştırması</p></div><button class="bm-refresh" onclick="loadBenchmark(true)">KKTCELL'i Yenile</button></div><div id="bmBox" class="empty">Benchmark hazırlanıyor…</div></section>`);
  loadBenchmark(false);
}

async function loadBenchmark(force=false){
  const box=document.getElementById('bmBox');if(!box)return;
  try{
    const r=await fetch('/api/benchmark'+(force?'?refresh=1':''),{cache:'no-store'});
    if(!r.ok)throw new Error(await r.text());
    renderBenchmark(await r.json());
  }catch(e){console.error(e);box.innerHTML='<div class="empty">KKTCELL benchmark verisi şu anda alınamıyor.</div>'}
}

function renderBenchmark(d){
  const box=document.getElementById('bmBox');if(!box)return;
  const c=d.counts||{};const rows=d.matches||[];const sources=d.kktcell_sources||[];
  box.className='';
  box.innerHTML=`
    <div class="bm-kpis"><article class="bm-kpi good"><span>KKTCELL Avantaj</span><strong>${c.KKTCELL_ADVANTAGE||0}</strong></article><article class="bm-kpi bad"><span>Telsim Avantaj</span><strong>${c.TELSIM_ADVANTAGE||0}</strong></article><article class="bm-kpi warn"><span>Parite</span><strong>${c.PARITY||0}</strong></article><article class="bm-kpi"><span>Eşleşen SKU</span><strong>${d.total_matches||0}</strong></article></div>
    <div class="bm-grid"><article class="bm-panel"><div class="bm-panel-head"><strong>Ürün Bazlı Karşılaştırma</strong><span class="bm-status">${bmEsc(d.methodology)} • ${d.kktcell_core_count||0} KKTCELL çekirdek ürün</span></div><div class="bm-table-wrap"><table class="bm-table"><thead><tr><th>Segment</th><th>Telsim</th><th>KKTCELL</th><th>Data T</th><th>Data K</th><th>Fiyat T</th><th>Fiyat K</th><th>Data Gap</th><th>Fiyat Gap</th><th>Değer</th><th>Pozisyon</th></tr></thead><tbody>${rows.map(renderBenchmarkRow).join('')}</tbody></table></div><div class="bm-mobile">${rows.slice(0,30).map(renderBenchmarkCard).join('')}</div></article>
    <aside class="bm-panel"><div class="bm-panel-head"><strong>KKTCELL Kaynak Sağlığı</strong><span class="bm-status">Canlı katalog</span></div><div class="bm-source-list">${sources.map(s=>`<div class="bm-source"><div class="bm-source-top"><b>${bmEsc(s.name)}</b><span class="status ${s.ok?'ok':'err'}">${s.ok?'SAĞLIKLI':'HATA'}</span></div><small>${s.parsed_count||0} ürün • ${s.core_count||0} çekirdek • ${s.response_ms||0} ms</small><small><a href="${bmEsc(s.url)}" target="_blank" rel="noopener">Resmi sayfa ↗</a></small></div>`).join('')}</div><div class="bm-actions">Data gap = KKTCELL − Telsim. Fiyat gap = KKTCELL − Telsim. Değer metriği efektif GB / 100 TL üzerinden hesaplanır; sosyal medya/bonus GB ayrı tutulup efektif dataya eklenir.</div></aside></div>`;
}

function renderBenchmarkRow(m){
  const vg=m.gaps?.value_gb_per_100tl;
  return `<tr><td>${bmEsc(m.segment)}</td><td><b>${bmEsc(m.telsim.name)}</b></td><td><b>${bmEsc(m.kktcell.name)}</b></td><td>${bmNum(m.telsim.effective_data_gb,' GB')}</td><td>${bmNum(m.kktcell.effective_data_gb,' GB')}</td><td>${bmNum(m.telsim.price_try,' TL')}</td><td>${bmNum(m.kktcell.price_try,' TL')}</td><td>${bmGap(m.gaps?.data_gb,' GB')}</td><td>${bmGap(m.gaps?.price_try,' TL')}</td><td>${bmGap(vg,' GB/100TL')}</td><td>${bmPos(m.position)}</td></tr>`;
}
function renderBenchmarkCard(m){return `<article class="bm-card"><div class="bm-card-top"><div><h3>${bmEsc(m.segment)}</h3><div class="muted">Eşleşme ${m.match_score}/100</div></div>${bmPos(m.position)}</div><div class="bm-vs"><div class="bm-side"><span>Telsim</span><b>${bmEsc(m.telsim.name)}</b><small>${bmNum(m.telsim.effective_data_gb,' GB')} • ${bmNum(m.telsim.price_try,' TL')}</small></div><div class="bm-versus">VS</div><div class="bm-side"><span>KKTCELL</span><b>${bmEsc(m.kktcell.name)}</b><small>${bmNum(m.kktcell.effective_data_gb,' GB')} • ${bmNum(m.kktcell.price_try,' TL')}</small></div></div><div class="bm-rec"><b>Öneri:</b> ${bmEsc(m.recommendation)}</div></article>`}

window.loadBenchmark=loadBenchmark;
installBenchmark();
setInterval(()=>loadBenchmark(false),15*60*1000);
