function renderEvidence(rows){
  $('evidenceGrid').innerHTML=rows.length?rows.slice(0,18).map(x=>{
    const preview=x.has_focus?`/api/snapshots/${x.id}/focus`:x.has_screenshot?`/api/snapshots/${x.id}/image`:null;
    const focusCount=x.screenshot_meta?.focus_card_count||0;
    const cookieClean=(x.screenshot_meta?.cookie_clicked||0)+(x.screenshot_meta?.cookie_removed||0);
    return `<article class="card evidence-card">
      <div class="evidence-img">${preview?`<img loading="lazy" src="${preview}" alt="${esc(x.source_name)} paket kanıt görüntüsü">`:`<div class="evidence-missing"><b>Ekran görüntüsü yok</b><br>${esc(x.focused_screenshot_error||x.screenshot_error||'Capture bekleniyor')}</div>`}</div>
      <div class="evidence-body">
        <div class="evidence-title"><b>${esc(x.source_name)}</b><span class="status ${x.has_focus?'ok':x.has_screenshot?'warn':'err'}">${x.has_focus?'PAKET ODAĞI':x.has_screenshot?'TAM SAYFA':'PNG YOK'}</span></div>
        <div class="evidence-meta">${fmtTime(x.captured_at)} • ${esc(x.kind)} • ${x.parsed_count??0} paket${focusCount?` • ${focusCount} kart işaretli`:''}${cookieClean?` • çerez temizlendi`:''}</div>
        <div class="evidence-actions">
          ${x.has_focus?`<button class="mini-btn primary" onclick="openEvidenceMode(${x.id},'${escAttr(x.source_name)}','${escAttr(fmtTime(x.captured_at))}','focus')">Paket Görünümü</button>`:''}
          ${x.has_screenshot?`<button class="mini-btn" onclick="openEvidenceMode(${x.id},'${escAttr(x.source_name)}','${escAttr(fmtTime(x.captured_at))}','full')">Tam Sayfa</button>`:''}
          ${x.has_html?`<a class="mini-btn" href="/api/snapshots/${x.id}/html" target="_blank">HTML</a>`:''}
          ${x.has_json?`<a class="mini-btn" href="/api/snapshots/${x.id}/json" target="_blank">JSON</a>`:''}
          <a class="mini-btn" href="${esc(x.source_url)}" target="_blank" rel="noopener">Canlı Sayfa</a>
        </div>
      </div>
    </article>`;
  }).join(''):`<div class="empty">Kanıt snapshot'ı henüz oluşmadı.</div>`;
}

function openEvidenceMode(id,name,time,mode='focus'){
  const focused=mode==='focus';
  $('evidenceTitle').textContent=`${name} • ${time} • ${focused?'Paket Görünümü':'Tam Sayfa'}`;
  $('evidenceFull').src=focused?`/api/snapshots/${id}/focus`:`/api/snapshots/${id}/image`;
  $('evidenceModal').classList.add('open');
  document.body.style.overflow='hidden';
}

function openEvidence(id,name,time){openEvidenceMode(id,name,time,'focus')}

import('/market-pulse.js').catch(err=>console.error('Market Pulse module load failed',err));
import('/benchmark.js').catch(err=>console.error('Benchmark module load failed',err));
