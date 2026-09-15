(()=>{
let user=null,inserted=false;
async function getUser(){
  try{const r=await fetch('/api/auth/me',{cache:'no-store'});if(!r.ok)return null;const d=await r.json();return d.user||null}catch{return null}
}
function cardHtml(){return `<article id="matchReviewSettingsCard" class="setting-card">
  <h3>Eşleşme İnceleme</h3>
  <p>Comparable Product Engine v2.4 shadow sonuçlarını inceleyin; Primary / Secondary / Reject kararlarını kalıcı admin override olarak yönetin.</p>
  <div class="setting-line"><span>Motor</span><b>v2.4 Shadow</b></div>
  <div class="setting-line"><span>Canlı eşleştirme</span><b>Henüz etkilenmiyor</b></div>
  <div class="setting-line"><span>Durum</span><b id="matchReviewSettingsStatus">Yükleniyor…</b></div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="location.href='/match-review'">Eşleşmeleri İncele</button><button class="btn" onclick="MarketPulseAdminTools.refreshMatchReviewStatus()">Durumu Yenile</button></div>
</article>`}
async function refreshMatchReviewStatus(){
  const el=document.getElementById('matchReviewSettingsStatus');if(!el)return;
  el.textContent='Yükleniyor…';
  try{
    const r=await fetch('/api/admin/match-review',{cache:'no-store'}),d=await r.json();
    if(!r.ok)throw new Error(d.error||'Durum alınamadı');
    const c=d.effective_counts||{};
    el.textContent=`${c.Primary||0} P • ${c.Secondary||0} S • ${c.Review||0} Rv • ${c.Reject||0} Rj • ${d.override_count||0} override`;
  }catch(e){el.textContent='Durum alınamadı';console.error('[match-review-settings]',e)}
}
function insert(){
  if(inserted||user?.role!=='admin')return;
  const grid=document.querySelector('#settings-section .settings-grid');if(!grid)return;
  if(document.getElementById('matchReviewSettingsCard')){inserted=true;return}
  const tmp=document.createElement('div');tmp.innerHTML=cardHtml();const card=tmp.firstElementChild;
  const userCard=grid.querySelector('.user-admin-card');if(userCard)grid.insertBefore(card,userCard);else grid.appendChild(card);
  inserted=true;refreshMatchReviewStatus();
}
async function init(){user=await getUser();if(user?.role!=='admin')return;insert();const obs=new MutationObserver(insert);obs.observe(document.body,{childList:true,subtree:true});setTimeout(insert,1000)}
window.MarketPulseAdminTools={refreshMatchReviewStatus};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
