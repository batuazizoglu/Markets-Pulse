import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {registerAuth,bootstrapInitialUsers} from '../src/auth.js';
import {mutateAdminUser,validateUserFields} from '../src/admin-users.js';

const password='ExamplePassword123!',salt='test-only',hash='scrypt$'+salt+'$'+crypto.scryptSync(password,salt,64).toString('hex');
const tokenHash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(){
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const add=async(id,role='standard',overrides={})=>{
    const row={first_name:'İsim',last_name:'Soyisim',email:'person'+id+'@example.com',username:'person'+id,active:true,...overrides};
    await db.query('INSERT INTO app_users(id,first_name,last_name,email,username,password_hash,role,active,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7,$8,FALSE)',[id,row.first_name,row.last_name,row.email,row.username,hash,role,row.active]);
    await db.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day')",[tokenHash('session-'+id),id]);
  };
  await add(1,'admin');await add(2,'admin');await add(3);
  await db.exec("SELECT setval(pg_get_serial_sequence('app_users','id'),3,true)");
  const app=express();app.use(express.json());registerAuth(app,db,'/unused');
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(method,path,body,actor=1,extra={})=>{
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(actor?{cookie:'mp_session=session-'+actor}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  return {db,add,base,request,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close()}};
}
function req(actor,id,body={}){return {appUser:{id:actor,role:'admin',email:'person'+actor+'@example.com'},params:{id:String(id)},headers:{cookie:'mp_session=session-'+actor},body}}

test('admin routes enforce current authorization, origin and strict profile validation',async()=>{
  const f=await fixture();try{
    assert.equal((await f.request('GET','/api/admin/users',undefined,null)).status,401);
    assert.equal((await f.request('GET','/api/admin/users',undefined,3)).status,403);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{first_name:'Yeni'},1,{'sec-fetch-site':'cross-site'})).status,403);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{first_name:'Yeni'},1,{origin:'https://evil.example'})).status,403);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{first_name:'Yeni'},1,{origin:f.base.replace('http:','https:')})).status,403);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{first_name:'Yeni'},1,{origin:f.base.replace('http:','https:'),'x-forwarded-proto':'https'})).status,200);
    for(const body of [{first_name:''},{last_name:'x'.repeat(81)},{email:'wrong@'},{email:'a..b@example.com'},{email:'a@example..com'},{username:'bad user'},{username:'ab'},{role:'owner'},{active:'false'},{password_hash:'x'},{}]){
      assert.equal((await f.request('PATCH','/api/admin/users/3',body)).status,400,JSON.stringify(body));
    }
    assert.equal((await f.request('PATCH','/api/admin/users/0',{first_name:'Yeni'})).status,400);
    assert.equal((await f.request('PATCH','/api/admin/users/999',{first_name:'Yeni'})).status,404);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{email:'PERSON2@EXAMPLE.COM'})).status,409);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{username:'PERSON2'})).status,409);
    const list=await f.request('GET','/api/admin/users');assert.equal(list.body.users.length,3);
    assert.equal(list.body.users[0].active_sessions,1);
    assert.ok(list.body.users.every(u=>!Object.hasOwn(u,'password_hash')&&!Object.hasOwn(u,'bootstrap_email')));
    assert.equal((await f.db.query('SELECT count(*)::int n FROM auth_audit')).rows[0].n,1);
  }finally{await f.close()}
});

test('profile, identity and access changes audit exact fields and revoke appropriate sessions',async()=>{
  const f=await fixture();try{
    const names=await f.request('PATCH','/api/admin/users/3',{first_name:' Ayşe ',last_name:'Öztürk'});
    assert.equal(names.status,200);assert.equal(names.body.user.first_name,'Ayşe');assert.equal(names.body.user.active_sessions,1);assert.equal(names.body.revoked_sessions,0);
    const edited=await f.request('PATCH','/api/admin/users/3',{email:'ISIK@EXAMPLE.COM',username:'ISIK',role:'admin'});
    assert.equal(edited.status,200);assert.equal(edited.body.user.email,'isik@example.com');assert.equal(edited.body.user.username,'isik');assert.equal(edited.body.user.role,'admin');assert.equal(edited.body.revoked_sessions,1);
    assert.equal((await f.request('GET','/api/auth/me',undefined,3)).status,401);
    const login=await f.request('POST','/api/auth/login',{identity:'ISIK@EXAMPLE.COM',password},null);assert.equal(login.status,200);assert.equal(login.body.user.username,'isik');
    const audit=(await f.db.query("SELECT meta_json FROM auth_audit WHERE event='user_updated' ORDER BY id DESC LIMIT 1")).rows[0].meta_json;
    assert.deepEqual(Object.keys(audit.changes).sort(),['email','role','username']);assert.equal(audit.revoked_sessions,1);assert.ok(!JSON.stringify(audit).includes(hash));
    const self=await f.request('PATCH','/api/admin/users/1',{username:'new.admin'});assert.equal(self.status,200);assert.equal(self.body.reauth_required,true);assert.equal((await f.request('GET','/api/auth/me')).status,401);
  }finally{await f.close()}
});

test('soft deletion, inactive restore and session revocation preserve identity ownership and audit',async()=>{
  const f=await fixture();try{
    const deleted=await f.request('DELETE','/api/admin/users/3');assert.equal(deleted.status,200);assert.equal(deleted.body.user.active,false);assert.ok(deleted.body.user.deleted_at);assert.equal(deleted.body.revoked_sessions,1);
    assert.equal((await f.request('GET','/api/admin/users')).body.users.length,2);
    assert.deepEqual((await f.request('GET','/api/admin/users?deleted=1')).body.users.map(x=>Number(x.id)),[3]);
    assert.equal((await f.request('POST','/api/auth/login',{identity:'person3',password},null)).status,401);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{active:true})).status,409);
    assert.equal((await f.request('PATCH','/api/admin/users/2',{email:'PERSON3@EXAMPLE.COM'})).status,409);
    const restored=await f.request('POST','/api/admin/users/3/restore',{});assert.equal(restored.status,200);assert.equal(restored.body.user.active,false);assert.equal(restored.body.user.deleted_at,null);
    assert.equal((await f.request('POST','/api/admin/users/3/restore',{})).status,409);
    assert.equal((await f.request('PATCH','/api/admin/users/3',{active:true})).status,200);
    assert.equal((await f.request('POST','/api/auth/login',{identity:'PERSON3',password},null)).status,200);
    const revoked=await f.request('POST','/api/admin/users/3/revoke-sessions',{});assert.equal(revoked.status,200);assert.equal(revoked.body.revoked_sessions,1);assert.equal(revoked.body.user.active_sessions,0);
    const events=(await f.db.query("SELECT event FROM auth_audit WHERE event LIKE 'user_%' ORDER BY id")).rows.map(x=>x.event);
    assert.deepEqual(events,['user_deleted','user_restored','user_updated','user_sessions_revoked']);
  }finally{await f.close()}
});

test('self protections and serialized fresh authorization prevent loss of the last active admin',async()=>{
  const f=await fixture();try{
    for(const [method,path,body] of [['DELETE','/api/admin/users/1'],['PATCH','/api/admin/users/1',{active:false}],['PATCH','/api/admin/users/1',{role:'standard'}]])assert.equal((await f.request(method,path,body)).status,400);
    const outcomes=await Promise.allSettled([mutateAdminUser(f.db,req(1,2,{role:'standard'}),'update'),mutateAdminUser(f.db,req(2,1,{role:'standard'}),'update')]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,403);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM app_users WHERE active AND role='admin' AND deleted_at IS NULL")).rows[0].n,1);
    await f.db.query('DELETE FROM app_sessions WHERE user_id=1');
    await assert.rejects(mutateAdminUser(f.db,req(1,3,{first_name:'Yeni'}),'update'),error=>error.status===403);
    assert.equal((await f.db.query('SELECT first_name FROM app_users WHERE id=3')).rows[0].first_name,'İsim');
  }finally{await f.close()}
});

test('bootstrap claims survive email edits, deleted accounts and recycled seed emails without re-invites',async()=>{
  const f=await fixture(),oldSeed=process.env.INITIAL_USERS_JSON,oldKey=process.env.BREVO_API_KEY,originalFetch=globalThis.fetch;let sends=0;
  try{
    process.env.INITIAL_USERS_JSON=JSON.stringify([{first_name:'Initial',last_name:'Admin',email:'PERSON2@EXAMPLE.COM',role:'admin'},{first_name:'New',last_name:'Seed',email:'new.seed@example.com',role:'standard'}]);process.env.BREVO_API_KEY='test-only';
    // Only mocked email transport runs; no network mail is sent.
    globalThis.fetch=async(url,options)=>{if(String(url)==='https://api.brevo.com/v3/smtp/email'){sends++;return new Response(JSON.stringify({messageId:'mock-'+sends}),{status:201,headers:{'content-type':'application/json'}})}return originalFetch(url,options)};
    await f.db.exec("SELECT setval(pg_get_serial_sequence('app_users','id'),3,true)");
    const first=await bootstrapInitialUsers(f.db);assert.deepEqual(first,{total:2,created:1,invited:1});assert.equal(sends,1);
    const oldHash=(await f.db.query('SELECT password_hash FROM app_users WHERE id=2')).rows[0].password_hash;
    await mutateAdminUser(f.db,req(1,2,{email:'changed@example.com'}),'update');await f.add(10,'standard',{email:'person2@example.com'});
    assert.deepEqual(await bootstrapInitialUsers(f.db),{total:2,created:0,invited:0});assert.equal(sends,1);
    assert.equal((await f.db.query('SELECT bootstrap_email FROM app_users WHERE id=2')).rows[0].bootstrap_email,'person2@example.com');
    assert.equal((await f.db.query('SELECT bootstrap_email FROM app_users WHERE id=10')).rows[0].bootstrap_email,null);
    await mutateAdminUser(f.db,req(1,2),'delete');assert.deepEqual(await bootstrapInitialUsers(f.db),{total:2,created:0,invited:0});assert.equal(sends,1);
    const deleted=(await f.db.query('SELECT active,deleted_at,password_hash FROM app_users WHERE id=2')).rows[0];assert.equal(deleted.active,false);assert.ok(deleted.deleted_at);assert.equal(deleted.password_hash,oldHash);
    await mutateAdminUser(f.db,req(1,2),'restore');await bootstrapInitialUsers(f.db);assert.equal((await f.db.query('SELECT active FROM app_users WHERE id=2')).rows[0].active,false);assert.equal(sends,1);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM app_users')).rows[0].n,5);
  }finally{globalThis.fetch=originalFetch;if(oldSeed===undefined)delete process.env.INITIAL_USERS_JSON;else process.env.INITIAL_USERS_JSON=oldSeed;if(oldKey===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=oldKey;await f.close()}
});

test('normalization uses ASCII case folding for identifiers and preserves Turkish display names',()=>{
  assert.deepEqual(validateUserFields({first_name:'İlker',last_name:'Işık',email:'ILKER@EXAMPLE.COM',username:'ILKER.ISIK'}),{first_name:'İlker',last_name:'Işık',email:'ilker@example.com',username:'ilker.isik'});
});

test('creation and resend use validated identities, safe generated usernames and explicit email failure outcomes',async()=>{
  const f=await fixture(),oldKey=process.env.BREVO_API_KEY,originalFetch=globalThis.fetch;let sends=0,failSend=false;
  try{
    process.env.BREVO_API_KEY='test-only';
    globalThis.fetch=async(url,options)=>{if(String(url)==='https://api.brevo.com/v3/smtp/email'){sends++;return new Response(JSON.stringify(failSend?{message:'mock send failure'}:{messageId:'mock-'+sends}),{status:failSend?503:201,headers:{'content-type':'application/json'}})}return originalFetch(url,options)};
    const body={first_name:'Yeni',last_name:'Üye',email:'A@EXAMPLE.COM',role:'standard'};
    assert.equal((await f.request('POST','/api/admin/users',{...body,role:'owner'})).status,400);assert.equal(sends,0);
    const created=await f.request('POST','/api/admin/users',body);assert.equal(created.status,201);assert.equal(created.body.user.invite_sent,true);assert.equal(created.body.user.email,'a@example.com');assert.equal(created.body.user.username,'a.user');assert.ok(!Object.hasOwn(created.body.user,'password_hash'));
    await f.add(100,'standard',{username:'x'.repeat(48)});
    const long=await f.request('POST','/api/admin/users',{...body,email:'x'.repeat(48)+'@example.com'});assert.equal(long.status,201);assert.equal(long.body.user.username.length,48);assert.equal(long.body.user.username,'x'.repeat(47)+'2');
    const punctuation=await f.request('POST','/api/admin/users',{...body,email:'-abc@example.com'});assert.equal(punctuation.status,201);assert.equal(punctuation.body.user.username,'abc');assert.doesNotThrow(()=>validateUserFields({username:punctuation.body.user.username}));
    assert.equal((await f.request('POST','/api/admin/users',{...body,email:'a@example.com'})).status,409);assert.equal(sends,3);
    failSend=true;
    const failed=await f.request('POST','/api/admin/users',{...body,email:'failure@example.com'});assert.equal(failed.status,201);assert.equal(failed.body.user.invite_sent,false);assert.match(failed.body.user.invite_error,/yeniden/);assert.equal(failed.body.user.invite_sent_at,null);
    const self=await f.request('POST','/api/admin/users/1/resend',{});assert.equal(self.status,400);assert.equal(self.body.code,'INVITE_FAILED');assert.equal(self.body.reauth_required,true);assert.equal((await f.request('GET','/api/auth/me')).status,401);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_audit WHERE event='user_created'")).rows[0].n,4);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM auth_audit WHERE event='user_invite_reset'")).rows[0].n,1);
  }finally{globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=oldKey;await f.close()}
});

test('user-management schema migrations are idempotent and retain existing rows',async()=>{
  const f=await fixture();try{
    await f.db.exec(SCHEMA_SQL);await f.db.exec(SCHEMA_SQL);
    const users=(await f.db.query('SELECT id,deleted_at,bootstrap_email FROM app_users ORDER BY id')).rows;
    assert.equal(users.length,3);assert.ok(users.every(user=>user.deleted_at===null&&user.bootstrap_email===null));
  }finally{await f.close()}
});
