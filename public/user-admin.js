/* User management: mutations are initiated by explicit administrator actions. */
(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=v=>String(v??'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
const fullName=u=>[u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||'Kullanıcı';
const fmt=v=>v&&!Number.isNaN(Date.parse(v))?new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
let root,currentUser,onSelfUpdate,users=[],deleted=[],query='',role='all',status='all',view='current',loadVersion=0;
const busy=new Set();
function mount(options){
  currentUser=options.user;onSelfUpdate=options.onSelfUpdate;
  if(currentUser?.role!=='admin')return;
  root=document.getElementById('userManagement');if(!root||root.dataset.mounted)return;
  root.dataset.mounted='1';
  root.innerHTML=`<div class="user-list-head"><div><h3>Kullanıcı Yönetimi</h3><p>Hesap bilgilerini, yönetici yetkisini ve platform erişimini yönetin.</p></div><div class="um-head-actions"><button type="button" class="btn" data-um-refresh>Yenile</button><button type="button" class="btn primary" data-um-create>+ Kullanıcı Ekle</button></div></div>
    <div class="um-counts" aria-label="Kullanıcı özeti"></div>
    <div class="um-notice" role="status" aria-live="polite" hidden></div>
    <div class="um-view-tabs" aria-label="Hesap listesi"><button type="button" class="btn active" data-um-view="current" aria-pressed="true">Mevcut Hesaplar</button><button type="button" class="btn" data-um-view="deleted" aria-pressed="false">Silinenler</button></div>
    <div class="um-filters"><div><label for="umSearch">Kullanıcı ara</label><input id="umSearch" type="search" placeholder="İsim, e-posta veya kullanıcı adı" autocomplete="off"></div><div><label for="umRole">Rol</label><select id="umRole"><option value="all">Tüm roller</option><option value="admin">Admin</option><option value="standard">Standart</option></select></div><div><label for="umStatus">Erişim</label><select id="umStatus"><option value="all">Tüm durumlar</option><option value="active">Aktif</option><option value="inactive">Pasif</option></select></div></div>
    <p class="um-list-meta" aria-live="polite"></p><div id="userAdminList" class="user-admin-list"><div class="empty">Kullanıcılar yükleniyor…</div></div>`;
  root.querySelector('[data-um-refresh]').addEventListener('click',()=>load());
  root.querySelector('[data-um-create]').addEventListener('click',()=>edit());
  root.querySelector('#umSearch').addEventListener('input',e=>{query=e.target.value;renderList()});
  root.querySelector('#umRole').addEventListener('change',e=>{role=e.target.value;renderList()});
  root.querySelector('#umStatus').addEventListener('change',e=>{status=e.target.value;renderList()});
  root.querySelectorAll('[data-um-view]').forEach(b=>b.addEventListener('click',()=>{
    view=b.dataset.umView;root.querySelectorAll('[data-um-view]').forEach(t=>{const active=t===b;t.classList.toggle('active',active);t.setAttribute('aria-pressed',String(active))});
    root.querySelector('#umStatus').disabled=view==='deleted';renderList();
  }));
  root.querySelector('#userAdminList').addEventListener('click',e=>{
    const button=e.target.closest('[data-user-action]');if(!button||button.disabled)return;
    const user=[...users,...deleted].find(u=>String(u.id)===button.dataset.userId);if(!user)return;
    const action=button.dataset.userAction;
    if(action==='edit')edit(user);else if(action==='delete')deleteUser(user);else if(action==='restore')restoreUser(user);else if(action==='access')toggleUser(user);else if(action==='revoke')revoke(user);else if(action==='resend')resend(user);
  });
}
function notice(text,error=false){
  if(!root)return;const el=root.querySelector('.um-notice');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);el.setAttribute('role',error?'alert':'status');
}
async function request(path,method='GET',body){
  const response=await fetch('/api/admin/users'+path,{method,cache:'no-store',...(method!=='GET'?{headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||(response.status===401?'Oturumunuz sona erdi. Sayfayı yenileyip yeniden giriş yapın.':'İşlem tamamlanamadı. Lütfen tekrar deneyin.')),{reauth_required:Boolean(data.reauth_required)});
  return data;
}
async function load(){
  if(!root||currentUser?.role!=='admin')return false;
  const version=++loadVersion;root.querySelector('[data-um-refresh]').disabled=true;root.querySelector('#userAdminList').setAttribute('aria-busy','true');
  try{
    const [existing,removed]=await Promise.all([request(''),request('?deleted=1')]);if(version!==loadVersion)return false;
    users=Array.isArray(existing.users)?existing.users:[];deleted=Array.isArray(removed.users)?removed.users:[];renderList();return true;
  }catch(e){if(version===loadVersion){notice(e.message,true);if(!users.length&&!deleted.length)root.querySelector('#userAdminList').innerHTML='<div class="empty">Kullanıcı listesi alınamadı. Yenile düğmesiyle tekrar deneyin.</div>'}return false}
  finally{if(version===loadVersion){root.querySelector('[data-um-refresh]').disabled=false;root.querySelector('#userAdminList').setAttribute('aria-busy','false')}}
}
function actionButton(action,id,text,{danger=false,disabled=false}={}){
  return `<button type="button" class="btn${danger?' um-danger':''}" data-user-action="${action}" data-user-id="${esc(id)}"${disabled||busy.has(String(id))?' disabled':''}>${text}</button>`;
}
function renderList(){
  if(!root)return;
  root.querySelector('.um-counts').innerHTML=[['Toplam hesap',users.length],['Aktif erişim',users.filter(u=>u.active).length],['Aktif admin',users.filter(u=>u.active&&u.role==='admin').length],['Silinen hesap',deleted.length]].map(([label,count])=>`<div><strong>${count}</strong><span>${label}</span></div>`).join('');
  const source=view==='deleted'?deleted:users;
  const rows=source.filter(u=>(role==='all'||u.role===role)&&(view==='deleted'||status==='all'||Boolean(u.active)===(status==='active'))&&(!query||fold([u.first_name,u.last_name,u.email,u.username].join(' ')).includes(fold(query))));
  root.querySelector('.um-list-meta').textContent=`${source.length} hesaptan ${rows.length} gösteriliyor${view==='deleted'?' • Geri yüklenen hesaplar pasif olarak açılır.':''}`;
  root.querySelector('#userAdminList').innerHTML=rows.map(u=>{
    const self=String(u.id)===String(currentUser.id),isDeleted=view==='deleted',pending=busy.has(String(u.id));
    const actions=isDeleted?actionButton('restore',u.id,'Geri Yükle'):actionButton('edit',u.id,'Düzenle')+(!self?actionButton('access',u.id,u.active?'Pasifleştir':'Aktifleştir')+actionButton('revoke',u.id,'Oturumları Kapat',{disabled:!u.active}):'')+actionButton('resend',u.id,'Yeni Parola Gönder',{disabled:!u.active})+(!self?actionButton('delete',u.id,'Sil',{danger:true}):'');
    return `<article class="um-user" aria-label="${esc(fullName(u))}"${pending?' aria-busy="true"':''}><div class="um-identity"><div class="user-avatar" aria-hidden="true">${esc(String(u.first_name||'?').slice(0,1)+String(u.last_name||'').slice(0,1))}</div><div class="um-person"><h4>${esc(fullName(u))}${self?' <span class="um-self">Siz</span>':''}</h4><div class="um-email">${esc(u.email)}</div><div class="um-username">@${esc(u.username)}</div></div><div class="um-badges"><span class="role-badge ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'Standart'}</span><span class="status ${isDeleted?'warn':u.active?'ok':'err'}">${isDeleted?'Silindi':u.active?'Aktif':'Pasif'}</span></div></div><div class="um-history"><span>Son giriş <b>${fmt(u.last_login_at)}</b></span><span>Açık oturum: <b>${Number(u.active_sessions)||0}</b></span><span>${isDeleted?'Silinme <b>'+fmt(u.deleted_at):'Davet <b>'+fmt(u.invite_sent_at)}</b></span>${u.must_change_password&&!isDeleted?'<span>Parola değişimi bekliyor</span>':''}</div><div class="um-row-actions">${pending?'<span class="um-working" role="status">İşleniyor…</span>':''}${actions}</div></article>`;
  }).join('')||`<div class="empty">${query||role!=='all'||status!=='all'?'Bu filtrelerle eşleşen hesap yok.':view==='deleted'?'Silinen hesap yok.':'Henüz kullanıcı yok.'}</div>`;
}
function modal(title,content){
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='um-dialog';dialog.setAttribute('aria-labelledby','umDialogTitle');
  dialog.innerHTML=`<div class="um-dialog-head"><h3 id="umDialogTitle">${esc(title)}</h3><button type="button" class="btn" data-um-close aria-label="Pencereyi kapat">✕</button></div>${content}`;
  document.body.appendChild(dialog);dialog.querySelector('[data-um-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',e=>{if(dialog.dataset.busy==='1')e.preventDefault()});
  dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus();else root?.querySelector('[data-um-refresh]')?.focus()},{once:true});
  dialog.showModal();return dialog;
}
function dialogBusy(dialog,value){
  dialog.dataset.busy=value?'1':'';dialog.setAttribute('aria-busy',String(value));
  dialog.querySelectorAll('button,input,select').forEach(el=>{if(value){el.dataset.wasDisabled=String(el.disabled);el.disabled=true}else{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled}});
}
function dialogError(dialog,message){const el=dialog.querySelector('.um-dialog-error');el.textContent=message;el.hidden=false;el.focus()}
function edit(user){
  const creating=!user,self=user&&String(user.id)===String(currentUser.id);
  const dialog=modal(creating?'Kullanıcı Ekle':'Kullanıcıyı Düzenle',`
    <p class="um-dialog-description">${creating?'Hesap oluşturulunca kullanıcı adı ve geçici parola, yazdığınız e-posta adresine gönderilir.':'İsim, iletişim ve erişim bilgilerini güncelleyin.'}</p>
    <form class="um-form"><div class="um-fields"><div><label for="umFirst">İsim</label><input id="umFirst" name="first_name" required maxlength="80" autocomplete="given-name" autofocus></div><div><label for="umLast">Soyisim</label><input id="umLast" name="last_name" required maxlength="80" autocomplete="family-name"></div><div class="um-wide"><label for="umEmail">E-posta</label><input id="umEmail" name="email" type="email" required maxlength="254" autocomplete="email"></div>
    ${creating?'':'<div class="um-wide"><label for="umUsername">Kullanıcı adı</label><input id="umUsername" name="username" required minlength="3" maxlength="48" pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,47}" autocomplete="off" autocapitalize="none" spellcheck="false"><small>3–48 karakter: İngilizce harf, rakam, nokta, tire veya alt çizgi.</small></div>'}
    <div><label for="umEditRole">Rol</label><select id="umEditRole" name="role"${self?' disabled':''}><option value="standard">Standart</option><option value="admin">Admin</option></select></div>
    ${creating?'':'<div><label for="umActive">Erişim</label><select id="umActive" name="active"'+(self?' disabled':'')+'><option value="true">Aktif</option><option value="false">Pasif</option></select></div>'}</div>
    ${self?'<p class="um-help">Kendi yönetici yetkinizi veya erişiminizi bu ekrandan kapatamazsınız. E-posta ya da kullanıcı adınızı değiştirirseniz yeniden giriş yapmanız gerekir.</p>':creating?'<p class="um-help">Admin tüm hesapları ve platform ayarlarını yönetebilir. Standart kullanıcı raporlara ve analizlere erişir.</p>':'<p class="um-help">E-posta, kullanıcı adı, rol veya erişim değişikliği mevcut oturumları kapatır.</p>'}
    <div class="um-dialog-error" role="alert" tabindex="-1" hidden></div><div class="um-dialog-actions"><button type="button" class="btn" data-um-cancel>Vazgeç</button><button type="submit" class="btn primary">${creating?'Oluştur ve Davet Gönder':'Değişiklikleri Kaydet'}</button></div></form>`);
  const form=dialog.querySelector('form');if(user){for(const key of ['first_name','last_name','email','username','role'])form.elements[key].value=user[key]??'';form.elements.active.value=String(Boolean(user.active))}
  dialog.querySelector('[data-um-cancel]').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(dialog.dataset.busy==='1'||!form.reportValidity())return;
    const body={};for(const key of ['first_name','last_name','email'])body[key]=form.elements[key].value.trim();
    body.role=self?user.role:form.elements.role.value;
    if(!creating){body.username=form.elements.username.value.trim();body.active=self?Boolean(user.active):form.elements.active.value==='true'}
    const submit=form.querySelector('[type=submit]'),label=submit.textContent;dialogBusy(dialog,true);submit.textContent='Kaydediliyor…';
    try{
      const data=await request(creating?'':'/'+user.id,creating?'POST':'PATCH',body);
      if(self&&data.user){currentUser={...currentUser,...data.user};await onSelfUpdate?.(currentUser)}
      dialog.close();
      if(data.reauth_required){notice('Bilgileriniz güncellendi. Yeni bilgilerinizle giriş yapmanız için yönlendiriliyorsunuz.');location.assign('/login');return}
      const refreshed=await load(),inviteFailed=creating&&data.user?.invite_sent===false;
      const message=creating?(inviteFailed?(data.user.invite_error||'Hesap oluşturuldu ancak davet e-postası gönderilemedi. Yeni Parola Gönder düğmesiyle tekrar deneyebilirsiniz.'):`${fullName(data.user)} oluşturuldu; giriş bilgileri ${data.user.email} adresine gönderildi.`):`${fullName(data.user||{...user,...body})} güncellendi.`;
      mutationNotice(message,refreshed,inviteFailed);
    }catch(error){dialogError(dialog,error.message)}finally{if(dialog.isConnected){dialogBusy(dialog,false);submit.textContent=label}}
  });
}
function mutationNotice(message,refreshed,error=false){notice(message+(refreshed?'':' Liste yenilenemedi; son durumu görmek için Yenile düğmesini kullanın.'),error||!refreshed)}
async function runAction(user,action,message){
  const id=String(user.id);if(busy.has(id))return;busy.add(id);renderList();notice('');
  try{const data=await action();if(data?.reauth_required){notice(message+' Yeniden giriş yapmanız için yönlendiriliyorsunuz.');location.assign('/login');return}const refreshed=await load();mutationNotice(message,refreshed)}
  catch(error){notice(error.message,true);if(error.reauth_required){const dialog=modal('Yeniden Giriş Gerekli',`<p class="um-dialog-description">${esc(error.message)}</p><p class="um-help">Bu işlem sırasında oturumunuz kapatıldı. Yeni parola e-postası ulaşmadıysa başka bir yöneticiden daveti yeniden göndermesini isteyin.</p><div class="um-dialog-actions"><a class="btn primary" href="/login">Giriş Ekranına Dön</a></div>`);dialog.addEventListener('close',()=>location.assign('/login'),{once:true})}}finally{busy.delete(id);renderList()}
}
function deleteUser(user){
  if(String(user.id)===String(currentUser.id))return;
  const name=fullName(user),dialog=modal('Kullanıcıyı Sil',`<p class="um-dialog-description"><strong>${esc(name)}</strong> (${esc(user.email)}) hesabının erişimi kapatılır ve açık oturumları sonlandırılır. Hesabı daha sonra <b>Silinenler</b> listesinden geri yükleyebilirsiniz.</p><form class="um-form"><label for="umDeleteName">Onaylamak için “${esc(name)}” yazın</label><input id="umDeleteName" required autocomplete="off" autofocus><div class="um-dialog-error" role="alert" tabindex="-1" hidden></div><div class="um-dialog-actions"><button type="button" class="btn" data-um-cancel>Vazgeç</button><button type="submit" class="btn um-danger" disabled>Hesabı Sil</button></div></form>`);
  const field=dialog.querySelector('input'),submit=dialog.querySelector('[type=submit]');field.addEventListener('input',()=>submit.disabled=field.value.trim()!==name);
  dialog.querySelector('[data-um-cancel]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(field.value.trim()!==name||dialog.dataset.busy==='1')return;dialogBusy(dialog,true);submit.textContent='Siliniyor…';try{await request('/'+user.id,'DELETE');dialog.close();const refreshed=await load();mutationNotice(name+' silindi. Silinenler listesinden geri yükleyebilirsiniz.',refreshed)}catch(error){dialogError(dialog,error.message);dialogBusy(dialog,false);submit.textContent='Hesabı Sil'}});
}
function restoreUser(user){
  if(!confirm(fullName(user)+' hesabı pasif olarak geri yüklenecek. Erişimi ayrıca aktifleştirmeniz gerekir. Devam edilsin mi?'))return;
  return runAction(user,()=>request('/'+user.id+'/restore','POST'),fullName(user)+' pasif olarak geri yüklendi. Mevcut Hesaplar listesinden aktifleştirebilirsiniz.');
}
function toggleUser(user){
  if(String(user.id)===String(currentUser.id))return;
  if(!confirm(fullName(user)+(user.active?' hesabının erişimi kapatılacak ve açık oturumları sonlandırılacak.':' hesabının platform erişimi açılacak.')+' Devam edilsin mi?'))return;
  return runAction(user,()=>request('/'+user.id,'PATCH',{active:!user.active}),fullName(user)+(user.active?' pasifleştirildi.':' aktifleştirildi.'));
}
function revoke(user){
  if(!confirm(fullName(user)+' kullanıcısının tüm açık oturumları kapatılacak. Kullanıcı mevcut parolasıyla yeniden giriş yapabilir. Devam edilsin mi?'))return;
  return runAction(user,()=>request('/'+user.id+'/revoke-sessions','POST'),fullName(user)+' için açık oturumlar kapatıldı.');
}
function resend(user){
  if(!confirm(fullName(user)+' için mevcut parola geçersiz olacak ve yeni geçici parola '+user.email+' adresine gönderilecek. Devam edilsin mi?'))return;
  return runAction(user,()=>request('/'+user.id+'/resend','POST'),'Yeni giriş bilgileri '+user.email+' adresine gönderildi.');
}
window.MarketPulseUsers={mount,load};
})();
