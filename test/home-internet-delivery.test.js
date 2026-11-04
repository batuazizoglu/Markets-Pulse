import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {get} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {SCHEMA_SQL} from '../src/schema.js';
import {registerAuth} from '../src/auth.js';
import {requireAdminForRefresh} from '../src/operational-access.js';
import {getHomeInternetMarket,marketPayload,HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {normalizeOffer} from '../src/isp-economics.js';
import {sendHomeInternetMarket} from '../src/home-internet-http.js';

let db,server,base,readerCookie,adminCookie;
const password='Initial-Test-123',newPassword='Changed-Test-456';
const source=HOME_INTERNET_SOURCES.find(s=>s.slug==='kibrisonline-home');
const captured=new Date(Date.now()-3600000).toISOString();
const products=Array.from({length:860},(_,i)=>normalizeOffer({product_key:'delivery-'+i,source_slug:source.slug,
  provider:source.provider,source_url:source.url,name:'Kayıtlı Paket '+i,technology:'WDSL',speed_down_mbps:10+i%40,
  duration_months:12,total_price_try:6000+i*10,product_family:'fixed'}));
const scan={source_slug:source.slug,provider:source.provider,status:'ok',captured_at:captured,parsed_count:products.length,
  payload_json:products,source_meta_json:{parser_version:'home-isp-2',source_revision:source.revision||1}};
const fixture=()=>marketPayload([scan],[],[scan]);
const uiSource=await readFile(new URL('../public/home-internet.js',import.meta.url),'utf8');

before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query(`INSERT INTO home_internet_scans(source_slug,provider,source_name,source_url,captured_at,status,parsed_count,payload_json,source_meta_json)
    VALUES($1,$2,$3,$4,$5,'ok',$6,$7::jsonb,$8::jsonb)`,[source.slug,source.provider,source.name,source.url,captured,products.length,JSON.stringify(products),JSON.stringify(scan.source_meta_json)]);
  // The catalog predates both accounts. Exercise real cookies, first-login
  // password change and the production auth middleware, with local data only.
  const salt='delivery-test',hash='scrypt$'+salt+'$'+scryptSync(password,salt,64).toString('hex');
  for(const role of ['standard','admin'])await db.query(`INSERT INTO app_users(first_name,last_name,email,username,password_hash,role,must_change_password)
    VALUES('Test','User',$1,$2,$3,$4,$5)`,[role+'@example.com',role,hash,role,role==='standard']);
  const app=express();app.use(express.json());registerAuth(app,db,new URL('../public',import.meta.url).pathname);
  const serverSource=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const start=serverSource.indexOf("app.get('/api/home-internet'");
  const route=serverSource.slice(start,serverSource.indexOf('\n\n',start));
  const dependencies={app,pool:db,requireAdminForRefresh,getHomeInternetMarket,sendHomeInternetMarket};
  compileFunction(route,Object.keys(dependencies))(...Object.values(dependencies));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  for(const role of ['standard','admin']){
    const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:role,password})});
    assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
    if(role==='standard')readerCookie=cookie;else adminCookie=cookie;
  }
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db?.close()});

test('a newly created standard account sees the existing catalog after first-login password change',async()=>{
  assert.equal((await fetch(base+'/api/home-internet?view=browser')).status,401);
  const before=await fetch(base+'/api/home-internet?view=browser',{headers:{cookie:readerCookie}});
  assert.equal(before.status,428);
  const changed=await fetch(base+'/api/auth/change-password',{method:'POST',headers:{cookie:readerCookie,'content-type':'application/json'},body:JSON.stringify({current_password:password,new_password:newPassword})});
  assert.equal(changed.status,200);
  const read=await fetch(base+'/api/home-internet?view=browser',{headers:{cookie:readerCookie}});
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');
  const data=await read.json();assert.equal(data.products.length,860);assert.equal(data.products[0].stale,false);
  const admin=await (await fetch(base+'/api/home-internet?view=browser',{headers:{cookie:adminCookie}})).json();
  assert.deepEqual(data.products,admin.products,'Catalog does not depend on account age or role');
  assert.equal((await fetch(base+'/api/home-internet?view=browser&refresh=1',{headers:{cookie:readerCookie}})).status,403);
});

function raw(path,encoding){return new Promise((resolve,reject)=>{
  get(base+path,{headers:{cookie:adminCookie,'accept-encoding':encoding}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
  }).on('error',reject);
})}
test('browser catalog transfers substantially fewer bytes without dropping products, sources or history',async()=>{
  const full=await raw('/api/home-internet','identity');
  const compact=await raw('/api/home-internet?view=browser','gzip');
  assert.equal(full.status,200);assert.equal(compact.status,200);
  assert.equal(full.headers['content-encoding'],undefined);assert.equal(compact.headers['content-encoding'],'gzip');
  assert.match(compact.headers.vary,/Accept-Encoding/);
  const a=JSON.parse(full.body),b=JSON.parse(gunzipSync(compact.body));
  for(const key of ['products','sources','changes','metrics','companies','campaigns','social'])assert.deepEqual(b[key],a[key],key);
  assert.ok(a.fixed_products.length);assert.equal(b.fixed_products,undefined);
  assert.ok(compact.body.length<full.body.length*.25,'At least 75% less transfer for a full-sized catalog');
  assert.equal(Number(compact.headers['content-length']),compact.body.length);
  console.log('[delivery-fixture]',JSON.stringify({full_bytes:full.body.length,browser_gzip_bytes:compact.body.length,products:b.products.length}));
  const optedOut=await raw('/api/home-internet?view=browser','gzip;q=0, identity');
  assert.equal(optedOut.headers['content-encoding'],undefined);assert.equal(JSON.parse(optedOut.body).products.length,860);
});

function ui(responses,{role='standard'}={}){
  const dom=new JSDOM('<main class="shell"></main>',{url:'https://example.com/#dashboard',runScripts:'outside-only'}),requests=[];
  dom.window.MarketPulseAccess={ready:Promise.resolve({role}),isAdmin:()=>role==='admin'};
  dom.window.fetch=async(url,options)=>{requests.push({url,options});return responses[Math.min(requests.length-1,responses.length-1)](dom)};
  dom.window.eval(uiSource);
  return {dom,requests,load:force=>force?dom.window.HomeInternetUI.scan():dom.window.HomeInternetUI.load()};
}
const ok=()=>({ok:true,json:async()=>fixture()});
const broken=dom=>{throw new dom.window.TypeError('Failed to fetch')};
test('a first network failure retries the read once and renders the shared catalog',async()=>{
  const f=ui([broken,ok]);try{
    await f.load();assert.equal(f.requests.length,2);
    for(const r of f.requests){assert.match(r.url,/view=browser/);assert.doesNotMatch(r.url,/refresh=1/);assert.equal(r.options.credentials,'same-origin');}
    assert.equal(f.dom.window.document.getElementById('hiMessage').textContent,'');
    assert.ok(f.dom.window.document.querySelector('#hiProducts [data-pick]'));
  }finally{f.dom.window.close()}
});
test('a failed response body retries once; persistent failure leaves a useful message and manual retry',async()=>{
  const f=ui([()=>({ok:true,json:async()=>{throw new TypeError('Failed to fetch')}}),broken]);try{
    await f.load();assert.equal(f.requests.length,2);
    assert.match(f.dom.window.document.getElementById('hiMessage').textContent,/Bağlantınızı kontrol edip Yenile/);
    assert.equal(f.dom.window.document.getElementById('hiScanBtn').disabled,false);
    assert.doesNotMatch(f.dom.window.document.body.textContent,/Failed to fetch/);
  }finally{f.dom.window.close()}
});
test('auth failures and admin source collection are never automatically retried',async()=>{
  for(const status of [401,403,428,429]){
    const f=ui([()=>({ok:false,status})]);try{await f.load();assert.equal(f.requests.length,1,String(status));}finally{f.dom.window.close()}
  }
  const admin=ui([broken],{role:'admin'});try{await admin.load(true);assert.equal(admin.requests.length,1);assert.match(admin.requests[0].url,/refresh=1/);}finally{admin.dom.window.close()}
});

test('a stalled read is aborted, retried once and leaves the refresh button usable',async()=>{
  const f=ui([ok]);try{
    const original=f.dom.window.setTimeout.bind(f.dom.window);
    f.dom.window.setTimeout=(fn,ms,...args)=>original(fn,[20000,750].includes(ms)?5:ms,...args);
    f.dom.window.fetch=(url,options)=>{
      f.requests.push({url,options});
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new f.dom.window.DOMException('Timed out','AbortError')),{once:true}));
    };
    await f.load();assert.equal(f.requests.length,2);
    assert.ok(f.requests.every(r=>r.options.signal.aborted));
    assert.match(f.dom.window.document.getElementById('hiMessage').textContent,/zaman aşımına/);
    assert.equal(f.dom.window.document.getElementById('hiScanBtn').disabled,false);
  }finally{f.dom.window.close()}
});
