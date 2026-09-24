import crypto from 'crypto';
import { promisify } from 'util';
import {USER_COLUMNS,normalizeEmail,validateUserFields,userId,userTransaction,lockUsers,withAdminUserTransaction,auditUserChange,listAdminUsers,mutateAdminUser,requireUserMutationOrigin,sendUserError} from './admin-users.js';

const scryptAsync=promisify(crypto.scrypt);
const COOKIE='mp_session';
const SESSION_DAYS=7;

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function norm(v){return String(v||'').trim().toLowerCase()}
function slug(v){
  return String(v||'').trim().toLocaleLowerCase('tr-TR').replaceAll('ı','i').replaceAll('ğ','g').replaceAll('ü','u').replaceAll('ş','s').replaceAll('ö','o').replaceAll('ç','c')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9._-]+/g,'.').replace(/\.+/g,'.').replace(/^\.|\.$/g,'').slice(0,48);
}
function cookies(req){
  const out={};
  for(const p of String(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())}
  return out;
}
function tokenHash(v){return crypto.createHash('sha256').update(v).digest('hex')}
function ip(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim().slice(0,80)}
function tempPassword(){return 'MP!'+crypto.randomBytes(12).toString('base64url')+'9a'}

async function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const key=await scryptAsync(String(password),salt,64);
  return 'scrypt$'+salt+'$'+Buffer.from(key).toString('hex');
}
async function verifyPassword(password,stored){
  try{
    const parts=String(stored||'').split('$');if(parts[0]!=='scrypt'||!parts[1]||!parts[2])return false;
    const key=Buffer.from(await scryptAsync(String(password),parts[1],64));
    const expected=Buffer.from(parts[2],'hex');
    return key.length===expected.length&&crypto.timingSafeEqual(key,expected);
  }catch{return false}
}
function parseSender(raw){
  const s=String(raw||'Markets Pulse <noreply@marketspulse.cloud>').trim();
  const m=s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m?{name:m[1].replace(/^["']|["']$/g,'').trim()||'Markets Pulse',email:m[2].trim()}:{name:'Markets Pulse',email:s};
}
async function sendBrevo(to,subject,html,text){
  const key=String(process.env.BREVO_API_KEY||'').trim();if(!key)throw new Error('BREVO_API_KEY tanımlı değil');
  const sender=parseSender(process.env.USER_EMAIL_FROM||process.env.REPORT_EMAIL_FROM);
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),30000);
  try{
    const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{accept:'application/json','content-type':'application/json','api-key':key},body:JSON.stringify({sender,to:[{email:to}],subject,htmlContent:html,textContent:text}),signal:ctl.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error('Brevo '+r.status+': '+(data.message||JSON.stringify(data)));
    return data.messageId||null;
  }finally{clearTimeout(timer)}
}
async function audit(pool,userId,identity,event,req,meta={}){
  try{
    await pool.query("INSERT INTO auth_audit(user_id,identity,event,ip,user_agent,meta_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[
      userId||null,identity||null,event,req?ip(req):null,req?String(req.headers['user-agent']||'').slice(0,500):null,JSON.stringify(meta||{})
    ]);
  }catch(e){console.error('[auth-audit]',e.message)}
}
async function uniqueUsername(pool,first,last,email){
  const raw=(slug(String(email||'').split('@')[0])||slug(String(first||'')+'.'+String(last||''))).replace(/^[^a-z0-9]+/,'')||'user',base=raw.length<3?raw+'.user':raw;
  for(let i=0;i<100;i++){const suffix=i===0?'':String(i+1),u=base.slice(0,48-suffix.length)+suffix;const r=await pool.query('SELECT 1 FROM app_users WHERE lower(username)=lower($1) LIMIT 1',[u]);if(!r.rows.length)return u}
  return base.slice(0,43)+'-'+crypto.randomBytes(2).toString('hex');
}
function inviteHtml(user,password){
  const full=esc([user.first_name,user.last_name].filter(Boolean).join(' '));
  const role=user.role==='admin'?'Admin':'Standart';
  return '<!doctype html><html lang="tr"><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#001484">'+
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">'+
  '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(0,20,132,.08)">'+
  '<tr><td style="background:#000f64;padding:24px 30px"><div style="font-size:28px;font-weight:900;color:#fff">Markets <span style="color:#00c2ff">Pulse</span></div><div style="margin-top:6px;font-size:9px;letter-spacing:.2em;color:#b9ccff;font-weight:700">BY TURKCELL • ACCESS INVITATION</div></td></tr>'+
  '<tr><td style="height:4px;background:linear-gradient(90deg,#0014f2,#00c2ff,#ffca00)"></td></tr>'+
  '<tr><td style="padding:28px 30px"><div style="font-size:20px;font-weight:900;color:#001484">Merhaba '+(full||'Markets Pulse kullanıcısı')+',</div>'+
  '<div style="margin-top:10px;color:#42526e;font-size:13px;line-height:1.65">Markets Pulse platformuna erişiminiz oluşturuldu. Aşağıdaki geçici bilgilerle giriş yapabilirsiniz. Güvenlik nedeniyle ilk girişte yeni bir parola belirlemeniz istenecektir.</div>'+
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#f6f9ff;border:1px solid #dce7f6;border-radius:12px">'+
  '<tr><td style="padding:14px 16px;border-bottom:1px solid #e3eaf5;color:#667399;font-size:11px;width:120px">Kullanıcı adı</td><td style="padding:14px 16px;border-bottom:1px solid #e3eaf5;font-size:14px;font-weight:800;color:#001484">'+esc(user.username)+'</td></tr>'+
  '<tr><td style="padding:14px 16px;border-bottom:1px solid #e3eaf5;color:#667399;font-size:11px">Geçici parola</td><td style="padding:14px 16px;border-bottom:1px solid #e3eaf5;font-family:monospace;font-size:14px;font-weight:800;color:#001484">'+esc(password)+'</td></tr>'+
  '<tr><td style="padding:14px 16px;color:#667399;font-size:11px">Erişim rolü</td><td style="padding:14px 16px;font-size:12px;font-weight:800;color:#001484">'+role+'</td></tr></table>'+
  '<div style="text-align:center;margin-top:22px"><a href="https://www.marketspulse.cloud/login" style="display:inline-block;background:#0014f2;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:12px;font-weight:800">Markets Pulse’a Giriş Yap</a></div>'+
  '<div style="margin-top:18px;padding:12px 14px;background:#fff8de;border:1px solid #f3dc7e;border-radius:10px;color:#6f5700;font-size:11px;line-height:1.55"><b>Güvenlik notu:</b> Bu parola yalnızca ilk giriş içindir. E-postayı başka kişilerle paylaşmayın.</div>'+
  '</td></tr><tr><td style="background:#f4f7fb;border-top:1px solid #e3e9f2;padding:16px 30px;color:#7b89a5;font-size:10px">Bu e-posta Markets Pulse tarafından otomatik gönderilmiştir. • noreply@marketspulse.cloud</td></tr>'+
  '</table></td></tr></table></body></html>';
}
async function sendInvite(user,password){
  return sendBrevo(user.email,'Markets Pulse | Platform Erişiminiz',inviteHtml(user,password),
    'Markets Pulse erişiminiz oluşturuldu. Kullanıcı adı: '+user.username+' Geçici parola: '+password+' Giriş: https://www.marketspulse.cloud/login İlk girişte parolanızı değiştirmeniz gerekir.');
}

export async function createAndInviteUser(pool,input,{req}={}){
  const {created_by,...editable}=input;
  const fields=validateUserFields(editable,{creating:true}),password=tempPassword(),hash=await hashPassword(password);
  const insert=async(client,actor)=>{
    const username=fields.username||await uniqueUsername(client,fields.first_name,fields.last_name,fields.email);
    const user=(await client.query(`INSERT INTO app_users(first_name,last_name,email,username,password_hash,role,active,must_change_password,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8) RETURNING ${USER_COLUMNS}`,[fields.first_name,fields.last_name,fields.email,username,hash,fields.role||'standard',fields.active!==false,actor?.id||created_by||null])).rows[0];
    if(actor)await auditUserChange(client,actor,'user_created',req,{target:user.id,email:user.email,role:user.role});return user;
  };
  const user=req?await withAdminUserTransaction(pool,req,insert):await userTransaction(pool,async client=>{await lockUsers(client);return insert(client)});
  if(!user.active)return {...user,active_sessions:0,invite_sent:false};
  try{
    const messageId=await sendInvite(user,password);
    const updated=(await pool.query(`UPDATE app_users SET invite_sent_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING ${USER_COLUMNS}`,[user.id])).rows[0];
    await audit(pool,user.id,user.email,'invite_sent',req,{message_id:messageId});
    return {...updated,active_sessions:0,message_id:messageId,invite_sent:true};
  }catch(error){console.error('[auth-invite]',error.code||'SEND_FAILED');return {...user,active_sessions:0,invite_sent:false,invite_error:'Kullanıcı oluşturuldu ancak davet e-postası gönderilemedi. Daveti yeniden gönderebilirsiniz.'}}
}
async function resetInvite(pool,id,req){
  const password=tempPassword(),hash=await hashPassword(password);
  const user=await withAdminUserTransaction(pool,req,async(client,actor)=>{
    const before=(await client.query(`SELECT ${USER_COLUMNS} FROM app_users WHERE id=$1`,[id])).rows[0];
    if(!before)throw Object.assign(new Error('Kullanıcı bulunamadı'),{status:404,code:'USER_NOT_FOUND'});
    if(!before.active||before.deleted_at)throw Object.assign(new Error('Pasif veya silinen kullanıcıya davet gönderilemez'),{status:409,code:'USER_INACTIVE'});
    const row=(await client.query(`UPDATE app_users SET password_hash=$1,must_change_password=TRUE,invite_sent_at=NULL,updated_at=NOW() WHERE id=$2 RETURNING ${USER_COLUMNS}`,[hash,id])).rows[0];
    const revoked=await client.query('DELETE FROM app_sessions WHERE user_id=$1 RETURNING token_hash',[id]);
    await auditUserChange(client,actor,'user_invite_reset',req,{target:id,revoked_sessions:revoked.rows.length});return row;
  });
  try{
    const messageId=await sendInvite(user,password);
    const updated=(await pool.query(`UPDATE app_users SET invite_sent_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING ${USER_COLUMNS}`,[user.id])).rows[0];
    await audit(pool,req.appUser.id,req.appUser.email,'invite_resent',req,{target:id,message_id:messageId});
    return {user:{...updated,active_sessions:0},message_id:messageId,reauth_required:Number(req.appUser.id)===id};
  }catch(error){console.error('[auth-invite]',error.code||'SEND_FAILED');throw Object.assign(new Error('Davet gönderilemedi. Kullanıcı oturumları kapatıldı; daveti yeniden deneyin.'),{status:400,code:'INVITE_FAILED',reauth_required:Number(req.appUser.id)===id})}
}
export async function bootstrapInitialUsers(pool){
  let list=[];try{list=JSON.parse(process.env.INITIAL_USERS_JSON||'[]')}catch(e){console.error('[auth-bootstrap] bad INITIAL_USERS_JSON',e.message)}
  if(!Array.isArray(list)||!list.length)return {total:0,created:0,invited:0};
  let created=0,invited=0;
  for(const item of list){
    const email=normalizeEmail(item?.email);if(!email)continue;
    const password=tempPassword();let user=null;
    await userTransaction(pool,async client=>{
      await lockUsers(client);
      // Original seed ownership survives email edits, deletion and recycled addresses.
      const existing=(await client.query('SELECT id FROM app_users WHERE lower(bootstrap_email)=lower($1) OR (bootstrap_email IS NULL AND lower(email)=lower($1)) ORDER BY (bootstrap_email IS NOT NULL) DESC LIMIT 1',[email])).rows[0];
      if(existing){await client.query('UPDATE app_users SET bootstrap_email=COALESCE(bootstrap_email,$1) WHERE id=$2',[email,existing.id]);return}
      const fields=validateUserFields({first_name:item.first_name,last_name:item.last_name,email,role:item.role||'standard'},{creating:true});
      const username=await uniqueUsername(client,fields.first_name,fields.last_name,email),hash=await hashPassword(password);
      user=(await client.query(`INSERT INTO app_users(first_name,last_name,email,username,password_hash,role,active,must_change_password,bootstrap_email) VALUES($1,$2,$3,$4,$5,$6,TRUE,TRUE,$3) RETURNING ${USER_COLUMNS}`,[fields.first_name,fields.last_name,email,username,hash,fields.role])).rows[0];created++;
    });
    // Existing users are never reset or re-invited by deployment bootstrap.
    if(!user)continue;
    try{
      const messageId=await sendInvite(user,password);
      await pool.query('UPDATE app_users SET invite_sent_at=NOW(),updated_at=NOW() WHERE id=$1',[user.id]);
      await audit(pool,user.id,email,'bootstrap_invite_sent',null,{message_id:messageId});invited++;
    }catch(error){console.error('[auth-bootstrap] invite failed',error.code||'SEND_FAILED')}
  }
  console.log('[auth-bootstrap]',JSON.stringify({total:list.length,created,invited}));
  return {total:list.length,created,invited};
}

async function getUser(pool,req){
  const token=cookies(req)[COOKIE];if(!token)return null;
  const r=await pool.query("SELECT u.id,u.first_name,u.last_name,u.email,u.username,u.role,u.active,u.must_change_password,u.last_login_at FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE AND u.deleted_at IS NULL LIMIT 1",[tokenHash(token)]);
  if(!r.rows.length)return null;
  pool.query('UPDATE app_sessions SET last_used_at=NOW() WHERE token_hash=$1',[tokenHash(token)]).catch(()=>{});
  return r.rows[0];
}
function setCookie(res,token){res.setHeader('Set-Cookie',COOKIE+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+(SESSION_DAYS*86400))}
function clearCookie(res){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')}
async function newSession(pool,user,req,res){
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO app_sessions(token_hash,user_id,expires_at,ip,user_agent) VALUES($1,$2,NOW()+INTERVAL '7 days',$3,$4)",[tokenHash(token),user.id,ip(req),String(req.headers['user-agent']||'').slice(0,500)]);
  setCookie(res,token);
}
function adminOnly(req,res,next){if(!req.appUser)return res.status(401).json({error:'Oturum gerekli'});if(req.appUser.role!=='admin')return res.status(403).json({error:'Admin yetkisi gerekli'});next()}

export function registerAuth(app,pool,publicDir){
  app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');next();
  });
  // Share previews can read this public artwork without access to application data.
  app.get('/brand/markets-pulse-social-v1.png',(req,res)=>res.sendFile(publicDir+'/brand/markets-pulse-social-v1.png',{maxAge:'1y',immutable:true}));
  app.get(['/login','/login.html'],(req,res)=>res.sendFile(publicDir+'/login.html'));
  app.get(['/change-password','/change-password.html'],async(req,res)=>{if(!await getUser(pool,req))return res.redirect('/login');res.sendFile(publicDir+'/change-password.html')});

  app.post('/api/auth/login',async(req,res)=>{
    const identity=norm(req.body?.identity),password=String(req.body?.password||'');if(!identity||!password)return res.status(400).json({error:'Kullanıcı adı/e-posta ve parola gerekli'});
    const user=(await pool.query('SELECT * FROM app_users WHERE (lower(username)=lower($1) OR lower(email)=lower($1)) AND deleted_at IS NULL LIMIT 1',[identity])).rows[0];
    if(!user||!user.active){await audit(pool,null,identity,'login_failed',req,{reason:'not_found'});return res.status(401).json({error:'Kullanıcı adı veya parola hatalı'})}
    if(user.locked_until&&new Date(user.locked_until)>new Date())return res.status(423).json({error:'Çok sayıda hatalı deneme. 15 dakika sonra tekrar deneyin.'});
    if(!await verifyPassword(password,user.password_hash)){
      const fail=Number(user.failed_login_count||0)+1,lock=fail>=5?new Date(Date.now()+15*60*1000):null;
      await pool.query('UPDATE app_users SET failed_login_count=$1,locked_until=$2 WHERE id=$3',[lock?0:fail,lock,user.id]);await audit(pool,user.id,identity,'login_failed',req,{reason:'bad_password',locked:!!lock});
      return res.status(401).json({error:lock?'Hesap 15 dakika kilitlendi':'Kullanıcı adı veya parola hatalı'});
    }
    await pool.query('UPDATE app_users SET failed_login_count=0,locked_until=NULL,last_login_at=NOW(),updated_at=NOW() WHERE id=$1',[user.id]);await newSession(pool,user,req,res);await audit(pool,user.id,identity,'login_success',req);
    res.json({ok:true,user:{id:user.id,first_name:user.first_name,last_name:user.last_name,email:user.email,username:user.username,role:user.role,must_change_password:user.must_change_password},redirect:user.must_change_password?'/change-password':'/'});
  });
  app.post('/api/auth/logout',async(req,res)=>{const token=cookies(req)[COOKIE];if(token)await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[tokenHash(token)]).catch(()=>{});clearCookie(res);res.json({ok:true})});
  app.get('/api/auth/me',async(req,res)=>{const user=await getUser(pool,req);if(!user)return res.status(401).json({error:'Oturum gerekli'});res.json({user})});
  app.post('/api/auth/change-password',async(req,res)=>{
    const user=await getUser(pool,req);if(!user)return res.status(401).json({error:'Oturum gerekli'});
    const current=String(req.body?.current_password||''),next=String(req.body?.new_password||'');
    if(next.length<12||!/[A-ZÇĞİÖŞÜ]/.test(next)||!/[a-zçğıöşü]/.test(next)||!/[0-9]/.test(next))return res.status(400).json({error:'Yeni parola en az 12 karakter; büyük harf, küçük harf ve rakam içermeli.'});
    const hash=(await pool.query('SELECT password_hash FROM app_users WHERE id=$1',[user.id])).rows[0].password_hash;if(!await verifyPassword(current,hash))return res.status(401).json({error:'Mevcut parola hatalı'});
    await pool.query('UPDATE app_users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2',[await hashPassword(next),user.id]);await audit(pool,user.id,user.email,'password_changed',req);res.json({ok:true,redirect:'/'});
  });

  app.use(async(req,res,next)=>{
    if(req.path.startsWith('/api/auth/'))return next();
    const user=await getUser(pool,req);
    if(!user){if(req.path.startsWith('/api/'))return res.status(401).json({error:'Oturum gerekli',code:'AUTH_REQUIRED'});return res.redirect('/login')}
    req.appUser=user;
    if(user.must_change_password){if(req.path.startsWith('/api/'))return res.status(428).json({error:'Parola değişikliği gerekli',code:'PASSWORD_CHANGE_REQUIRED'});return res.redirect('/change-password')}
    next();
  });

  app.use('/api/admin/users',adminOnly,requireUserMutationOrigin);
  app.get('/api/admin/users',async(req,res)=>{try{res.json({users:await listAdminUsers(pool,{deleted:req.query.deleted==='1'})})}catch(error){sendUserError(res,error)}});
  app.post('/api/admin/users',async(req,res)=>{try{const user=await createAndInviteUser(pool,{...req.body,created_by:req.appUser.id},{req});res.status(201).json({ok:true,user})}catch(error){sendUserError(res,error)}});
  app.post('/api/admin/users/:id/resend',async(req,res)=>{try{res.json({ok:true,...await resetInvite(pool,userId(req.params.id),req)})}catch(error){sendUserError(res,error)}});
  for(const [method,path,action] of [['patch','/:id','update'],['delete','/:id','delete'],['post','/:id/restore','restore'],['post','/:id/revoke-sessions','revoke-sessions']]){
    app[method]('/api/admin/users'+path,async(req,res)=>{try{res.json(await mutateAdminUser(pool,req,action))}catch(error){sendUserError(res,error)}});
  }

  app.get('/match-review',adminOnly,(req,res)=>res.sendFile(publicDir+'/match-review.html'));
  app.get('/api/admin/match-review',adminOnly,async(req,res)=>{try{const m=await import('./match-review.js');res.json(await m.buildMatchReviewSnapshot(pool,{refresh:req.query.refresh==='1'}))}catch(e){console.error('[match-review]',e);res.status(500).json({error:e.message||'Eşleşme inceleme verisi alınamadı'})}});
  app.put('/api/admin/match-review/:id',adminOnly,async(req,res)=>{try{const m=await import('./match-review.js');const row=await m.saveMatchOverride(pool,{telsimProductId:Number(req.params.id),decision:req.body?.decision,kktcellProductKey:req.body?.kktcell_product_key,note:req.body?.note,userId:req.appUser.id,refresh:false});await audit(pool,req.appUser.id,req.appUser.email,'match_override_set',req,{telsim_product_id:Number(req.params.id),decision:row.decision,kktcell_product_key:row.kktcell_product_key,engine_score:row.engine_score});res.json({ok:true,override:row})}catch(e){res.status(400).json({error:e.message||'Karar kaydedilemedi'})}});
  app.delete('/api/admin/match-review/:id',adminOnly,async(req,res)=>{try{const m=await import('./match-review.js');const old=await m.deleteMatchOverride(pool,Number(req.params.id));await audit(pool,req.appUser.id,req.appUser.email,'match_override_deleted',req,{telsim_product_id:Number(req.params.id),old_decision:old?.decision||null});res.json({ok:true,deleted:!!old})}catch(e){res.status(400).json({error:e.message||'Override silinemedi'})}});
}
