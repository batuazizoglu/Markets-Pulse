import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {captureTransportConfig} from '../src/ad-capture-proxy.js';
import {canFailoverProxy,getProxyPoolStatus,selectCaptureProxy,recordProxyResult} from '../src/ad-proxy-pool.js';

const entries=[{id:'primary',url:'http://secret-user:secret-password@first-provider.example:8080'},
  {id:'backup',url:'https://second-provider.example:8443',username:'backup-user',password:'backup-secret'}];
const env={AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXIES:JSON.stringify(entries)};
const start=Date.parse('2026-09-20T08:00:00.000Z');
const outage={status:'error',reason:'PROXY_CONNECTION_FAILED',transport_only:true,captured:0};
async function fixture(){const db=new PGlite();await db.exec(SCHEMA_SQL);return db}

test('pool status contains only configured labels and health, with safe empty config states',async()=>{
  const db=await fixture();
  try{
    const selected=await selectCaptureProxy(db,{env,now:start});
    assert.equal(selected.proxy.id,'primary');assert.equal(selected.reason,null);
    await recordProxyResult(db,selected.proxy,{status:'no_ads',captured:0},{now:new Date(start)});
    const status=await getProxyPoolStatus(db,{env,now:start});
    assert.equal(status.proxy_count,2);assert.equal(status.available_count,2);assert.equal(status.next_retry_at,null);
    assert.deepEqual(status.proxies,[
      {id:'primary',state:'ready',last_code:null,last_success_at:new Date(start).toISOString(),retry_at:null},
      {id:'backup',state:'unverified',last_code:null,last_success_at:null,retry_at:null}
    ]);
    const serialized=JSON.stringify(status);
    for(const proxy of captureTransportConfig(env).proxies){assert.ok(!serialized.includes(proxy.key));assert.ok(!serialized.includes(proxy.upstreamUrl))}
    assert.doesNotMatch(serialized,/secret|provider\.example|backup-user|http:/);
    for(const [settings,reason] of [[{},null],[{AD_CAPTURE_TRANSPORT:'proxy'},'PROXY_CONFIG_MISSING'],
      [{AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXIES:'invalid'},'PROXY_CONFIG_INVALID']]){
      const safe=await getProxyPoolStatus(db,{env:settings,now:start});
      assert.equal(safe.code,reason);assert.deepEqual(safe.proxies,[]);assert.equal(safe.available_count,0);
      assert.deepEqual(await selectCaptureProxy(db,{env:settings,now:start}),{proxy:null,reason,retry_at:null});
    }
  }finally{await db.close()}
});

test('selection skips persisted network cooldowns and returns earliest retry without mutating health',async()=>{
  const db=await fixture();
  try{
    const first=(await selectCaptureProxy(db,{env,now:start})).proxy;
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_proxy_health')).rows[0].n,0);
    await recordProxyResult(db,first,outage,{now:start});
    const second=(await selectCaptureProxy(db,{env,now:start})).proxy;
    assert.equal(second.id,'backup');
    assert.equal((await selectCaptureProxy(db,{env,now:start,excludeKeys:[first.key]})).proxy.id,'backup');
    await recordProxyResult(db,second,outage,{now:start+60000});
    const waiting=await selectCaptureProxy(db,{env,now:start+60000});
    assert.deepEqual(waiting,{proxy:null,reason:'PROXY_POOL_COOLDOWN',retry_at:new Date(start+300000).toISOString()});
    const status=await getProxyPoolStatus(db,{env,now:start+60000});
    assert.equal(status.available_count,0);assert.equal(status.next_retry_at,waiting.retry_at);
    assert.deepEqual(status.proxies.map(proxy=>proxy.state),['cooldown','cooldown']);
    assert.equal((await selectCaptureProxy(db,{env,now:start+299999})).proxy,null);
    assert.equal((await selectCaptureProxy(db,{env,now:new Date(start+300000)})).proxy.id,'primary');
    assert.equal((await getProxyPoolStatus(db,{env,now:start+300000})).available_count,1);
    assert.equal((await db.query('SELECT sum(consecutive_failures)::int n FROM ad_cloud_proxy_health')).rows[0].n,2);
  }finally{await db.close()}
});

test('proxy outage cooldown grows from five minutes to a sixty minute cap and success resets it',async()=>{
  const db=await fixture();
  try{
    const proxy=(await selectCaptureProxy(db,{env,now:start})).proxy;
    for(const [index,minutes] of [5,10,20,40,60,60,60].entries()){
      await recordProxyResult(db,proxy,outage,{now:start});
      const row=(await db.query('SELECT * FROM ad_cloud_proxy_health WHERE proxy_key=$1',[proxy.key])).rows[0];
      assert.equal(row.consecutive_failures,index+1);
      assert.equal(+new Date(row.cooldown_until)-start,minutes*60000);
      assert.equal(row.last_code,'PROXY_CONNECTION_FAILED');
    }
    await recordProxyResult(db,proxy,{status:'partial',captured:1},{now:start+1000});
    let row=(await db.query('SELECT * FROM ad_cloud_proxy_health WHERE proxy_key=$1',[proxy.key])).rows[0];
    assert.equal(row.consecutive_failures,0);assert.equal(row.cooldown_until,null);assert.equal(row.last_code,null);
    assert.equal(+new Date(row.last_success_at),start+1000);
    await recordProxyResult(db,proxy,outage,{now:start+2000});
    row=(await db.query('SELECT * FROM ad_cloud_proxy_health WHERE proxy_key=$1',[proxy.key])).rows[0];
    assert.equal(row.consecutive_failures,1);assert.equal(+new Date(row.cooldown_until),start+302000);
    const expired=await getProxyPoolStatus(db,{env,now:start+302000});
    assert.equal(expired.available_count,2);
    assert.equal(expired.proxies[0].state,'unverified');
    assert.equal(expired.proxies[0].retry_at,null);
    assert.equal(expired.proxies[0].last_success_at,new Date(start+1000).toISOString());
    await recordProxyResult(db,proxy,{status:'no_ads',captured:0},{now:start+303000});
    assert.equal((await getProxyPoolStatus(db,{env,now:start+303000})).proxies[0].state,'ready');
  }finally{await db.close()}
});

test('expired network failures yield to untried connections without changing exclusions, pins or health',async()=>{
  const db=await fixture();
  try{
    const first=(await selectCaptureProxy(db,{env,now:start})).proxy;
    await recordProxyResult(db,first,outage,{now:start});
    const before=(await db.query('SELECT * FROM ad_cloud_proxy_health')).rows;
    const retryTime=start+600000;
    const second=(await selectCaptureProxy(db,{env,now:retryTime})).proxy;
    assert.equal(second.id,'backup');
    assert.equal((await selectCaptureProxy(db,{env,now:retryTime,excludeKeys:[second.key]})).proxy.key,first.key);
    assert.equal((await selectCaptureProxy(db,{env,now:retryTime,pinnedKey:first.key})).proxy.key,first.key);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_proxy_health')).rows,before);
    await recordProxyResult(db,first,{status:'no_ads',captured:0},{now:retryTime});
    assert.equal((await selectCaptureProxy(db,{env,now:retryTime})).proxy.key,first.key);
  }finally{await db.close()}
});

test('eligible proxies rank by consecutive network failures with deterministic configuration-order ties',async()=>{
  const db=await fixture();
  try{
    const configured=captureTransportConfig(env).proxies;
    const first={mode:'proxy',configured:true,...configured[0]},second={mode:'proxy',configured:true,...configured[1]};
    await recordProxyResult(db,first,outage,{now:start});
    await recordProxyResult(db,second,outage,{now:start});
    const retryTime=start+600000;
    for(let i=0;i<3;i++)assert.equal((await selectCaptureProxy(db,{env,now:retryTime})).proxy.key,first.key);
    const reversed={...env,AD_CAPTURE_PROXIES:JSON.stringify([...entries].reverse())};
    assert.equal((await selectCaptureProxy(db,{env:reversed,now:retryTime})).proxy.key,second.key);
    await recordProxyResult(db,first,outage,{now:retryTime});
    assert.equal((await selectCaptureProxy(db,{env,now:retryTime+600000})).proxy.key,second.key);
  }finally{await db.close()}
});

test('sticky proxy selection waits for its own connection and never silently replaces a removed pin',async()=>{
  const db=await fixture();
  try{
    const first=(await selectCaptureProxy(db,{env,now:start})).proxy;
    await recordProxyResult(db,first,outage,{now:start});
    const pin=await selectCaptureProxy(db,{env,now:start,pinnedKey:first.key});
    assert.equal(pin.reason,'PROXY_POOL_COOLDOWN');assert.equal(pin.proxy,null);
    assert.equal((await selectCaptureProxy(db,{env,now:start})).proxy.id,'backup');
    const replaced={...env,AD_CAPTURE_PROXIES:JSON.stringify([{...entries[0],url:'http://replacement-provider.example:8080'},entries[1]])};
    assert.deepEqual(await selectCaptureProxy(db,{env:replaced,now:start,pinnedKey:first.key}),
      {proxy:null,reason:'PROXY_PIN_MISSING',retry_at:null});
    const changedCredentials={...env,AD_CAPTURE_PROXIES:JSON.stringify([{...entries[0],url:'http://secret-user:new-secret@first-provider.example:8080'},entries[1]])};
    assert.equal((await selectCaptureProxy(db,{env:changedCredentials,now:start,pinnedKey:first.key})).reason,'PROXY_PIN_MISSING');
    assert.equal((await selectCaptureProxy(db,{env,now:start+300000,pinnedKey:first.key})).proxy.key,first.key);
  }finally{await db.close()}
});

test('health and job proxy counters survive database restart and idempotent schema application',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ad-proxy-health-'));
  let db=new PGlite(directory);
  try{
    await db.exec(SCHEMA_SQL);
    const proxy=(await selectCaptureProxy(db,{env,now:start})).proxy;
    await recordProxyResult(db,proxy,outage,{now:start});
    await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,proxy_key,proxy_attempts)
      VALUES('test','Test','{}',$1,2)`,[proxy.key]);
    await db.close();db=new PGlite(directory);await db.exec(SCHEMA_SQL);
    assert.equal((await selectCaptureProxy(db,{env,now:start})).proxy.id,'backup');
    const job=(await db.query("SELECT proxy_key,proxy_attempts FROM ad_cloud_jobs WHERE batch_key='test'")).rows[0];
    assert.deepEqual(job,{proxy_key:proxy.key,proxy_attempts:2});
    assert.equal((await getProxyPoolStatus(db,{env,now:start})).proxies[0].state,'cooldown');
  }finally{await db.close();await rm(directory,{recursive:true,force:true})}
});

test('only confirmed zero-evidence network failures permit failover; access restrictions do not penalize proxy health',async()=>{
  assert.equal(canFailoverProxy(outage),true);
  const denied=[{...outage,transport_only:false},{...outage,transport_only:undefined},{...outage,captured:1},
    {...outage,captured:undefined},{...outage,captured:'0'},{...outage,status:'rate_limited'},
    ...['PROXY_AUTH_FAILED','PROXY_ACCESS_DENIED','ACCESS_RESTRICTED','HTTP_500','TIMEOUT','CARDS_NOT_FOUND'].map(reason=>({...outage,reason})),
    ...[401,403,407,429,451].map(http_status=>({...outage,http_status})),null];
  for(const result of denied)assert.equal(canFailoverProxy(result),false,JSON.stringify(result));
  assert.equal(canFailoverProxy(outage,1),false);assert.equal(canFailoverProxy(outage,'0'),false);
  const db=await fixture();
  try{
    const proxy=(await selectCaptureProxy(db,{env,now:start})).proxy;
    for(const result of denied)await recordProxyResult(db,proxy,result,{now:start});
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_proxy_health')).rows[0].n,0);
    await recordProxyResult(db,proxy,outage,{now:start});
    const before=(await db.query('SELECT * FROM ad_cloud_proxy_health')).rows;
    for(const result of [{status:'error',captured:0},{status:'blocked',captured:1,reason:'ACCESS_RESTRICTED'},
      {status:'partial',captured:0},{status:'no_ads',captured:0,http_status:403}])await recordProxyResult(db,proxy,result,{now:start+1000});
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_proxy_health')).rows,before);
  }finally{await db.close()}
});
