import crypto from 'node:crypto';

const FIELDS=['first_name','last_name','email','username','role','active'];
export const USER_COLUMNS='id,first_name,last_name,email,username,role,active,must_change_password,invite_sent_at,last_login_at,created_at,updated_at,deleted_at';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code})}
export function userId(value){const id=Number(value);if(!Number.isSafeInteger(id)||id<1)fail(400,'BAD_ID','Geçersiz kullanıcı');return id}
export function normalizeEmail(value){return typeof value==='string'?value.trim().toLowerCase():''}
export function validateUserFields(input,{creating=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'BAD_INPUT','Geçerli kullanıcı bilgileri gerekli');
  const out={};
  for(const key of Object.keys(input))if(!FIELDS.includes(key))fail(400,'BAD_INPUT','Desteklenmeyen kullanıcı alanı: '+key);
  for(const key of ['first_name','last_name']){
    if(!Object.hasOwn(input,key)&&!creating)continue;
    const value=typeof input[key]==='string'?input[key].trim():'';
    if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))fail(400,'BAD_INPUT','İsim ve soyisim 1–80 karakter olmalı');out[key]=value;
  }
  if(Object.hasOwn(input,'email')||creating){
    const value=normalizeEmail(input.email),at=value.lastIndexOf('@');
    if(value.length>254||at<1||at>64||! /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value)||value.includes('..'))fail(400,'BAD_INPUT','Geçerli bir e-posta adresi girin');out.email=value;
  }
  if(Object.hasOwn(input,'username')){
    const value=typeof input.username==='string'?input.username.trim().toLowerCase():'';
    if(!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(value))fail(400,'BAD_INPUT','Kullanıcı adı 3–48 karakter; harf, rakam, nokta, alt çizgi veya tire içermeli');out.username=value;
  }
  if(Object.hasOwn(input,'role')){if(!['admin','standard'].includes(input.role))fail(400,'BAD_INPUT','Geçerli bir rol seçin');out.role=input.role}
  if(Object.hasOwn(input,'active')){if(typeof input.active!=='boolean')fail(400,'BAD_INPUT','Hesap durumu geçersiz');out.active=input.active}
  if(!Object.keys(out).length)fail(400,'BAD_INPUT','Değişiklik yok');return out;
}
export function requireUserMutationOrigin(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli',code:'BAD_ORIGIN'});
  const origin=req.get('origin');
  if(origin){try{const url=new URL(origin);if(url.host!==req.get('host')||url.protocol!==req.protocol+':')return res.status(403).json({error:'Geçersiz kaynak',code:'BAD_ORIGIN'})}catch{return res.status(403).json({error:'Geçersiz kaynak',code:'BAD_ORIGIN'})}}
  if(['POST','PATCH'].includes(req.method)&&!req.is('application/json'))return res.status(400).json({error:'JSON gerekli',code:'BAD_INPUT'});
  next();
}
export async function userTransaction(pool,callback){
  if(typeof pool.connect!=='function')return pool.transaction(callback);
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await callback(client);await client.query('COMMIT');return result}
  catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function lockUsers(client){
  // Serialize all admin writes, including last-admin checks and seed creation.
  await client.query('LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE');
}
export async function withAdminUserTransaction(pool,req,callback){
  return userTransaction(pool,async client=>{
    await lockUsers(client);
    const actor=(await client.query('SELECT id,email,role,active,deleted_at FROM app_users WHERE id=$1',[userId(req.appUser?.id)])).rows[0];
    if(!actor?.active||actor.deleted_at||actor.role!=='admin')fail(403,'ADMIN_REQUIRED','Admin yetkisi gerekli');
    // Recheck the session after taking the lock: a queued request may have been revoked.
    const cookie=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mp_session='));
    let token;try{token=cookie&&decodeURIComponent(cookie.slice('mp_session='.length))}catch{}
    const hash=token&&crypto.createHash('sha256').update(token).digest('hex');
    if(!hash||!(await client.query('SELECT 1 FROM app_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>NOW()',[hash,actor.id])).rows.length)fail(403,'SESSION_REVOKED','Oturumunuz sona erdi. Yeniden giriş yapın.');
    return callback(client,actor);
  });
}
export async function auditUserChange(client,actor,event,req,meta){
  await client.query('INSERT INTO auth_audit(user_id,identity,event,ip,user_agent,meta_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[
    actor.id,actor.email,event,String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim().slice(0,80),String(req.headers?.['user-agent']||'').slice(0,500),JSON.stringify(meta)
  ]);
}
export async function listAdminUsers(pool,{deleted=false}={}){
  const columns=USER_COLUMNS.split(',').map(x=>'u.'+x).join(',');
  return (await pool.query(`SELECT ${columns},(SELECT count(*)::int FROM app_sessions s WHERE s.user_id=u.id AND s.expires_at>NOW()) AS active_sessions FROM app_users u WHERE u.deleted_at IS ${deleted?'NOT ':''}NULL ORDER BY u.active DESC,u.first_name,u.last_name,u.id`)).rows;
}
export async function mutateAdminUser(pool,req,action){
  const id=userId(req.params.id),fields=action==='update'?validateUserFields(req.body):null;
  return withAdminUserTransaction(pool,req,async(client,actor)=>{
    const before=(await client.query(`SELECT ${USER_COLUMNS} FROM app_users WHERE id=$1`,[id])).rows[0];
    if(!before)fail(404,'USER_NOT_FOUND','Kullanıcı bulunamadı');
    if(action==='restore'&&!before.deleted_at)fail(409,'NOT_DELETED','Kullanıcı silinmiş değil');
    if(action!=='restore'&&before.deleted_at)fail(409,'USER_DELETED','Önce silinen kullanıcıyı geri yükleyin');
    const next={...before,...fields};
    if(action==='delete'){next.deleted_at=new Date();next.active=false}
    if(action==='restore'){next.deleted_at=null;next.active=false}
    if(Number(actor.id)===id&&(action==='delete'||next.active===false||next.role!=='admin'))fail(400,'SELF_PROTECTED','Kendi hesabınızı silemez, pasifleştiremez veya admin rolünüzü kaldıramazsınız');
    if(before.active&&before.role==='admin'&&!before.deleted_at&&(!next.active||next.role!=='admin'||next.deleted_at)){
      const admins=(await client.query("SELECT count(*)::int n FROM app_users WHERE active=TRUE AND role='admin' AND deleted_at IS NULL")).rows[0].n;
      if(admins<=1)fail(409,'LAST_ADMIN','Son aktif admin hesabı kaldırılamaz');
    }
    const changes={};
    for(const key of [...FIELDS,'deleted_at'])if(String(before[key]??'')!==String(next[key]??''))changes[key]={before:before[key],after:next[key]};
    if(action==='update'&&!Object.keys(changes).length)fail(400,'NO_CHANGE','Değişiklik yok');
    let user=before;
    if(action!=='revoke-sessions'){
      const keys=Object.keys(changes),values=keys.map(key=>next[key]);values.push(id);
      user=(await client.query(`UPDATE app_users SET ${keys.map((key,index)=>key+'=$'+(index+1)).join(',')},updated_at=NOW() WHERE id=$${values.length} RETURNING ${USER_COLUMNS}`,values)).rows[0];
    }
    const revoke=action!=='update'||['email','username','role','active'].some(key=>Object.hasOwn(changes,key));
    let revoked=0;
    if(revoke){const result=await client.query('DELETE FROM app_sessions WHERE user_id=$1 RETURNING token_hash',[id]);revoked=result.rows.length}
    const event={update:'user_updated',delete:'user_deleted',restore:'user_restored','revoke-sessions':'user_sessions_revoked'}[action];
    await auditUserChange(client,actor,event,req,{target:id,changes,revoked_sessions:revoked});
    const sessions=(await client.query('SELECT count(*)::int n FROM app_sessions WHERE user_id=$1 AND expires_at>NOW()',[id])).rows[0].n;
    return {ok:true,user:{...user,active_sessions:sessions},revoked_sessions:revoked,reauth_required:Number(actor.id)===id&&revoke};
  });
}
export function sendUserError(res,error){
  if(error.code==='23505'||error.code==='USER_EXISTS')return res.status(409).json({error:'Bu e-posta veya kullanıcı adı zaten kullanılıyor (silinen kullanıcılar dahil).',code:'USER_EXISTS'});
  if(error.status)return res.status(error.status).json({error:error.message,code:error.code,...(error.reauth_required?{reauth_required:true}:{})});
  console.error('[admin-users]',error.code||'UNKNOWN');return res.status(500).json({error:'Kullanıcı işlemi tamamlanamadı',code:'USER_OPERATION_FAILED'});
}
