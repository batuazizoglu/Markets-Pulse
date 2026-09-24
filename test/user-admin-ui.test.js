import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../public/user-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
function row(id,extra={}){return {id,first_name:id===1?'Batu':'İpek',last_name:'Test',email:'test'+id+'@example.com',username:'test'+id,role:id===1?'admin':'standard',active:true,must_change_password:false,created_at:'2026-09-01',last_login_at:'2026-09-20',invite_sent_at:'2026-09-01',deleted_at:null,active_sessions:2,...extra}}
async function fixture(initial=[row(1),row(2),row(3,{active:false})]){
  const dom=new JSDOM('<article id="userManagement"></article>',{url:'https://marketspulse.cloud/#settings',runScripts:'outside-only'});
  const w=dom.window,records=structuredClone(initial),requests=[],selfUpdates=[];let failPatch=false,confirmation=true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('[autofocus]')?.focus()};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  w.confirm=()=>confirmation;
  w.fetch=async(url,opts={})=>{
    requests.push({url,...opts});let data={},status=200;const body=JSON.parse(opts.body||'{}'),method=opts.method||'GET',id=Number(url.split('/')[4]),u=records.find(x=>x.id===id);
    if(method==='GET')data={users:records.filter(x=>Boolean(x.deleted_at)===url.includes('deleted=1')).map(x=>({...x}))};
    else if(method==='PATCH'&&failPatch){status=409;data={error:'Bu kullanıcı adı zaten kullanılıyor.'}}
    else if(method==='PATCH'){Object.assign(u,body);data={ok:true,user:{...u}}}
    else if(method==='DELETE'){u.deleted_at='2026-09-24';u.active=false;data={ok:true,user:{...u}}}
    else if(url.endsWith('/restore')){u.deleted_at=null;u.active=false;data={ok:true,user:{...u}}}
    else if(url.endsWith('/resend')||url.endsWith('/revoke-sessions'))data={ok:true,user:{...u},revoked_sessions:2};
    else if(method==='POST'){const created=row(records.length+1,body);records.push(created);data={ok:true,user:created}}
    return {ok:status<400,status,json:async()=>data};
  };
  w.eval(source);w.MarketPulseUsers.mount({user:records[0],onSelfUpdate:user=>selfUpdates.push(user)});await w.MarketPulseUsers.load();
  return {dom,w,d:w.document,records,requests,selfUpdates,setFail:v=>failPatch=v,setConfirm:v=>confirmation=v};
}
function input(f,selector,value,type='input'){const el=f.d.querySelector(selector);el.value=value;el.dispatchEvent(new f.w.Event(type,{bubbles:true}));return el}
function action(f,id,name){f.d.querySelector(`[data-user-id="${id}"][data-user-action="${name}"]`).click()}
function submit(f){f.d.querySelector('dialog form').dispatchEvent(new f.w.Event('submit',{cancelable:true,bubbles:true}))}

test('user management escapes server fields, filters Turkish names and protects self actions',async()=>{
  const f=await fixture([row(1),row(2,{first_name:'İpek <img src=x>',last_name:'" onmouseover="x',email:'a<script>x</script>@example.com'}),row(3,{active:false}),row(4,{deleted_at:'2026-09-24',active:false})]);
  try{
    assert.equal(f.d.querySelectorAll('#userManagement img,#userManagement script').length,0);
    assert.equal(f.d.querySelectorAll('[onmouseover]').length,0);
    assert.equal(f.d.querySelectorAll('.um-user').length,3);
    assert.equal(f.d.querySelector('[data-user-id="1"][data-user-action="delete"]'),null);
    assert.equal(f.d.querySelector('[data-user-id="1"][data-user-action="access"]'),null);
    input(f,'#umSearch','ipek');assert.equal(f.d.querySelectorAll('.um-user').length,2);
    input(f,'#umStatus','inactive','change');assert.equal(f.d.querySelectorAll('.um-user').length,1);
    input(f,'#umSearch','');input(f,'#umStatus','all','change');input(f,'#umRole','admin','change');assert.equal(f.d.querySelectorAll('.um-user').length,1);
    input(f,'#umRole','all','change');f.d.querySelector('[data-um-view="deleted"]').click();assert.equal(f.d.querySelectorAll('.um-user').length,1);assert.ok(f.d.querySelector('#umStatus').disabled);
    assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
  }finally{f.dom.window.close()}
});

test('editing names, email, username and access saves deliberately and retains form on duplicate error',async()=>{
  const f=await fixture();try{
    action(f,2,'edit');input(f,'#umFirst','Deniz');input(f,'#umEmail','deniz@example.com');input(f,'#umUsername','deniz.test');input(f,'#umEditRole','admin','change');input(f,'#umActive','false','change');
    f.setFail(true);submit(f);await tick();assert.match(f.d.querySelector('.um-dialog-error').textContent,/zaten/);assert.equal(f.d.querySelector('#umFirst').value,'Deniz');assert.equal(f.d.querySelector('[type=submit]').disabled,false);
    f.setFail(false);submit(f);await tick();assert.equal(f.d.querySelector('dialog'),null);
    assert.equal(f.records[1].username,'deniz.test');assert.equal(f.records[1].role,'admin');assert.equal(f.records[1].active,false);
    assert.equal(f.requests.filter(r=>r.url.endsWith('/resend')).length,0);
    action(f,1,'edit');assert.equal(f.d.querySelector('#umEditRole').disabled,true);assert.equal(f.d.querySelector('#umActive').disabled,true);input(f,'#umFirst','Batu Güncel');submit(f);await tick();assert.equal(f.selfUpdates[0].first_name,'Batu Güncel');
  }finally{f.dom.window.close()}
});

test('soft delete requires typed account name, then restore leaves account inactive',async()=>{
  const f=await fixture();try{
    action(f,2,'delete');input(f,'#umDeleteName','wrong');submit(f);await tick();assert.equal(f.requests.filter(r=>r.method==='DELETE').length,0);assert.equal(f.d.querySelector('[type=submit]').disabled,true);
    input(f,'#umDeleteName','İpek Test');assert.equal(f.d.querySelector('[type=submit]').disabled,false);submit(f);await tick();assert.equal(f.records[1].active,false);assert.ok(f.records[1].deleted_at);
    f.d.querySelector('[data-um-view="deleted"]').click();f.setConfirm(false);action(f,2,'restore');await tick();assert.ok(f.records[1].deleted_at);
    f.setConfirm(true);action(f,2,'restore');await tick();assert.equal(f.records[1].deleted_at,null);assert.equal(f.records[1].active,false);
    for(const r of f.requests.filter(r=>r.method!=='GET'))assert.equal(r.headers['content-type'],'application/json');
  }finally{f.dom.window.close()}
});

test('password delivery and session revocation require explicit confirmation and JSON requests',async()=>{
  const f=await fixture();try{
    f.setConfirm(false);action(f,2,'resend');action(f,2,'revoke');await tick();assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
    f.setConfirm(true);action(f,2,'revoke');await tick();action(f,2,'resend');await tick();
    const posts=f.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);assert.ok(posts[0].url.endsWith('/revoke-sessions'));assert.ok(posts[1].url.endsWith('/resend'));
    assert.ok(posts.every(r=>r.headers['content-type']==='application/json'&&r.body==='{}'));
    assert.match(f.d.querySelector('.um-notice').textContent,/test2@example.com/);
  }finally{f.dom.window.close()}
});

test('failed user loading surfaces an actionable error without erasing existing records',async()=>{
  const f=await fixture();try{
    f.w.fetch=async()=>{throw new Error('Ağ bağlantısı kesildi')};await f.w.MarketPulseUsers.load();assert.equal(f.d.querySelectorAll('.um-user').length,3);assert.match(f.d.querySelector('.um-notice').textContent,/Ağ bağlantısı/);assert.equal(f.d.querySelector('[data-um-refresh]').disabled,false);
  }finally{f.dom.window.close()}
});

test('created account with failed invitation is reported accurately, without duplicate creation',async()=>{
  const f=await fixture();try{
    const previous=f.w.fetch;f.w.fetch=async(url,opts)=>{const response=await previous(url,opts);if(url==='/api/admin/users'&&opts.method==='POST'){const data=await response.json();data.user.invite_sent=false;data.user.invite_error='Hesap oluşturuldu ancak davet e-postası gönderilemedi. Daveti yeniden gönderebilirsiniz.';return {...response,json:async()=>data}}return response};
    f.d.querySelector('[data-um-create]').click();input(f,'#umFirst','Yeni');input(f,'#umLast','Hesap');input(f,'#umEmail','yeni@example.com');submit(f);await tick();
    assert.equal(f.records.length,4);assert.equal(f.d.querySelector('dialog'),null);assert.match(f.d.querySelector('.um-notice').textContent,/davet e-postası gönderilemedi/);assert.ok(f.d.querySelector('.um-notice').classList.contains('error'));
    assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
  }finally{f.dom.window.close()}
});

test('successful edit retains a refresh warning when the following list request fails',async()=>{
  const f=await fixture();try{
    const previous=f.w.fetch;let saved=false;f.w.fetch=async(url,opts)=>{if(saved&&opts.method==='GET')throw new Error('Ağ kesildi');const response=await previous(url,opts);if(opts.method==='PATCH')saved=true;return response};
    action(f,2,'edit');input(f,'#umFirst','Yeni İsim');submit(f);await tick();assert.equal(f.records[1].first_name,'Yeni İsim');assert.match(f.d.querySelector('.um-notice').textContent,/güncellendi.*Liste yenilenemedi/);assert.ok(f.d.querySelector('.um-notice').classList.contains('error'));
  }finally{f.dom.window.close()}
});

test('failed self password email preserves reauthentication error and presents sign-in recovery',async()=>{
  const f=await fixture();try{
    const previous=f.w.fetch;f.w.fetch=async(url,opts)=>url.endsWith('/1/resend')?{ok:false,status:400,json:async()=>({error:'Yeni parola e-postası gönderilemedi.',code:'INVITE_FAILED',reauth_required:true})}:previous(url,opts);
    action(f,1,'resend');await tick();assert.match(f.d.querySelector('dialog').textContent,/e-postası gönderilemedi/);assert.match(f.d.querySelector('dialog').textContent,/başka bir yöneticiden/);assert.equal(f.d.querySelector('dialog a').getAttribute('href'),'/login');assert.match(f.d.querySelector('.um-notice').textContent,/gönderilemedi/);
  }finally{f.dom.window.close()}
});
