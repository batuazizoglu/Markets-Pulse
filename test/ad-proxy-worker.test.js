import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {createCloudWorker,queueCloudReview,getCloudStatus,localCloudTime} from '../src/ad-cloud.js';
import {adLibrarySource} from '../src/ad-cloud-capture.js';
import {captureTransportConfig} from '../src/ad-capture-proxy.js';
import {normalizeVision} from '../src/ad-cloud-vision.js';
import {getAdVisuals} from '../src/ad-visual.js';

const entries=[{id:'primary',url:'http://primary.example:8080'},{id:'backup',url:'http://backup.example:8080'},{id:'third',url:'http://third.example:8080'}];
const poolEnv=(count=2)=>({AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXIES:JSON.stringify(entries.slice(0,count))});
const outage=()=>({status:'blocked',reason:'PROXY_CONNECTION_FAILED',transport_only:true,captured:0});
const jpeg=Buffer.from([255,216,255,224,0,0,255,217]);
const hash=createHash('sha256').update(jpeg).digest('hex');
const quiet=()=>{};

async function fixture(){
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
  await db.query("UPDATE ad_cloud_jobs SET status='unverified' WHERE brand<>'Telsim'");
  await db.query('UPDATE ad_cloud_control SET scheduled_day=$1',[localCloudTime().day]);
  return db;
}
async function target(db){return (await db.query("SELECT status,attempts,captured,proxy_key,proxy_attempts FROM ad_cloud_jobs WHERE brand='Telsim' ORDER BY id LIMIT 1")).rows[0]}
function observation(source){
  const at=new Date().toISOString();
  return {brand:source.brand,page_id:source.page_id,ad_id:'99999999',variant_id:'1',source_url:adLibrarySource(source),ad_status:'active',started_on:null,observed_at:at,ad_text:'Numaranızı taşıyın 25 GB 799 TL',has_video:false,evidence:[{sha256:hash,bytes:jpeg,captured_at:at}]};
}
function vision(){
  return {category:'mnp',category_evidence:'Numaranızı taşıyın',title:'Numara taşıma 25 GB',visible_text:'25 GB 799 TL',visual_summary:'Kırmızı fiyat kutusu',conditions:[],uncertainties:[],offer:{price_try:799,previous_price_try:null,data_gb:25,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'},field_evidence:{price_try:'799 TL',previous_price_try:'',data_gb:'25 GB',bonus_data_gb:'',minutes:'',speed_mbps:'',commitment_months:'',billing_period:''}};
}
async function resetTarget(db){
  await db.query("UPDATE ad_cloud_jobs SET status='queued',attempts=0,captured=0,proxy_key=NULL,proxy_attempts=0,available_at=NOW() WHERE brand='Telsim'");
  await db.query('DELETE FROM ad_cloud_proxy_health');
}

test('a transport outage selects one backup within the same job attempt and persists its evidence and pin',async()=>{
  const db=await fixture(),env=poolEnv(),calls=[];
  const proxies=captureTransportConfig(env).proxies;
  try{
    const capture=async(source,save,{proxyConfig,timeoutMs})=>{
      calls.push({id:proxyConfig.id,timeoutMs});
      if(proxyConfig.id==='primary')return outage();
      await save(observation(source));return {status:'partial',captured:1};
    };
    const result=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,capture,log:quiet})();
    assert.deepEqual(calls.map(x=>x.id),['primary','backup']);
    assert.ok(calls[0].timeoutMs<=110000&&calls[1].timeoutMs>0&&calls[1].timeoutMs<=calls[0].timeoutMs);
    assert.equal(result.scan.captured,1);
    assert.deepEqual(await target(db),{status:'partial',attempts:1,captured:1,proxy_key:proxies[1].key,proxy_attempts:2});
    const health=(await db.query('SELECT * FROM ad_cloud_proxy_health WHERE proxy_key=$1',[proxies[0].key])).rows[0];
    assert.equal(health.consecutive_failures,1);assert.ok(+new Date(health.cooldown_until)>Date.now());
    const status=await getCloudStatus(db,{env});
    assert.equal(status.capture_transport.proxies.find(x=>x.id==='backup').state,'ready');
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_visual_evidence')).rows[0].n,1);
  }finally{await db.close()}
});

test('access denial, challenges and unknown parse failures keep the original proxy without failover',async()=>{
  const db=await fixture(),env=poolEnv(),primary=captureTransportConfig(env).proxies[0];
  try{
    const outcomes=[
      {status:'blocked',http_status:403,captured:0},
      {status:'blocked',reason:'LOGIN_OR_CHALLENGE',captured:0},
      {status:'error',reason:'UNKNOWN_PAGE_STRUCTURE',captured:0},
      // A contradictory collector result must not turn an explicit denial into a network outage.
      {...outage(),http_status:403}
    ];
    for(const outcome of outcomes){
      await resetTarget(db);const calls=[];
      await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async(source,save,{proxyConfig})=>{calls.push(proxyConfig.id);return {...outcome}}})();
      assert.deepEqual(calls,['primary']);
      const job=await target(db);assert.equal(job.attempts,1);assert.equal(job.proxy_attempts,1);assert.equal(job.proxy_key,primary.key);
      assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_proxy_health')).rows[0].n,0);
    }
  }finally{await db.close()}
});

test('saved evidence prevents switching after a throw, an inaccurate zero, and process restart',async()=>{
  const db=await fixture(),env=poolEnv(),primary=captureTransportConfig(env).proxies[0],calls=[];
  try{
    const first=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async(source,save,{proxyConfig})=>{
      calls.push(proxyConfig.id);await save(observation(source));throw new Error('synthetic interrupted browser');
    }})();
    assert.equal(first.scan.captured,1);assert.deepEqual(calls,['primary']);
    assert.equal((await target(db)).proxy_key,primary.key);
    // A replacement process recovers this running job from durable state.
    await db.query("UPDATE ad_cloud_jobs SET status='running',available_at=NOW() WHERE brand='Telsim'");
    const restarted=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async(source,save,{proxyConfig})=>{calls.push(proxyConfig.id);return outage()}})();
    assert.equal(restarted.scan.captured,1);assert.deepEqual(calls,['primary','primary']);
    assert.equal((await target(db)).captured,1);assert.equal((await target(db)).proxy_key,primary.key);
    assert.equal((await target(db)).attempts,2);
    await resetTarget(db);calls.length=0;
    const inaccurate=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async(source,save,{proxyConfig})=>{
      calls.push(proxyConfig.id);await save(observation(source));return outage();
    }})();
    assert.equal(inaccurate.scan.captured,1);assert.deepEqual(calls,['primary']);
    assert.equal((await target(db)).proxy_key,primary.key);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_proxy_health')).rows[0].n,0);
  }finally{await db.close()}
});

test('HTTP 429 honors a 48-hour pause and resumes on the same proxy despite a healthy backup',async()=>{
  const db=await fixture(),env=poolEnv(),calls=[];
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='queued' WHERE brand='Cypking'");
    const capture=async(source,save,{proxyConfig})=>{
      calls.push({brand:source.brand,id:proxyConfig.id});
      return calls.length===1?{status:'rate_limited',http_status:429,retry_after_ms:172800000,captured:0}:{status:'no_ads',captured:0};
    };
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,capture,log:quiet})();
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,capture,log:quiet})();
    assert.deepEqual(calls,[{brand:'Telsim',id:'primary'}]);
    assert.equal((await db.query("SELECT attempts FROM ad_cloud_jobs WHERE brand='Cypking'")).rows[0].attempts,0);
    assert.ok(+new Date((await getCloudStatus(db,{env})).capture_after)>Date.now()+172700000);
    await db.query("UPDATE ad_cloud_control SET capture_after=NOW()-INTERVAL '1 second'");
    await db.query("UPDATE ad_cloud_jobs SET available_at=NOW()-INTERVAL '1 second' WHERE brand='Telsim'");
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,capture,log:quiet})();
    assert.deepEqual(calls,[{brand:'Telsim',id:'primary'},{brand:'Telsim',id:'primary'}]);
    assert.equal((await target(db)).attempts,2);assert.equal((await target(db)).status,'no_ads');
  }finally{await db.close()}
});

test('an entirely cooling proxy pool preserves queued attempts while stored evidence reaches AI',async()=>{
  const db=await fixture();
  const env={...poolEnv(),OPENAI_API_KEY:'synthetic-test-only',AD_VISION_DAILY_LIMIT:'1'};
  try{
    await createCloudWorker(db,HOME_INTERNET_SOURCES,{env:{},log:quiet,capture:async(source,save)=>{await save(observation(source));return {status:'partial',captured:1}}})();
    await db.query("UPDATE ad_cloud_jobs SET status='queued' WHERE brand='Cypking'");
    for(const proxy of captureTransportConfig(env).proxies){
      await db.query("INSERT INTO ad_cloud_proxy_health(proxy_key,consecutive_failures,cooldown_until,last_code) VALUES($1,1,NOW()+INTERVAL '30 minutes','PROXY_CONNECTION_FAILED')",[proxy.key]);
    }
    const before=(await db.query('SELECT id,status,attempts,proxy_attempts FROM ad_cloud_jobs ORDER BY id')).rows;let analyzed=0;
    const result=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async()=>{throw Error('cooldown must be checked before capturing')},analyze:async candidate=>{analyzed++;return normalizeVision(vision(),candidate)}})();
    assert.equal(result.scan.status,'waiting_proxy');assert.equal(result.scan.reason,'PROXY_POOL_COOLDOWN');
    assert.equal(result.analysis.status,'analyzed');assert.equal(analyzed,1);
    assert.deepEqual((await db.query('SELECT id,status,attempts,proxy_attempts FROM ad_cloud_jobs ORDER BY id')).rows,before);
    assert.equal((await getAdVisuals(db)).groups.mnp,1);
  }finally{await db.close()}
});

test('three failing proxies stay bounded to two physical connections per tick and three job attempts',async()=>{
  const db=await fixture(),env=poolEnv(3),calls=[];
  try{
    const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async(source,save,{proxyConfig})=>{calls.push(proxyConfig.id);return outage()}});
    await worker();assert.deepEqual(calls,['primary','backup']);
    assert.equal((await target(db)).attempts,1);assert.equal((await target(db)).proxy_key,null);
    await db.query("UPDATE ad_cloud_jobs SET available_at=NOW() WHERE brand='Telsim'");
    await worker();assert.deepEqual(calls,['primary','backup','third']);
    assert.equal((await target(db)).attempts,2);
    await db.query("UPDATE ad_cloud_proxy_health SET cooldown_until=NOW()-INTERVAL '1 second'");
    await db.query("UPDATE ad_cloud_jobs SET available_at=NOW() WHERE brand='Telsim'");
    await worker();assert.deepEqual(calls,['primary','backup','third','primary','backup']);
    assert.deepEqual(await target(db),{status:'error',attempts:3,captured:0,proxy_key:null,proxy_attempts:5});
    await db.query("UPDATE ad_cloud_jobs SET available_at=NOW() WHERE brand='Telsim'");
    await worker();assert.equal(calls.length,5);
  }finally{await db.close()}
});

test('removing the pinned connection leaves its retry waiting without consuming attempts or redirecting',async()=>{
  const db=await fixture(),initial=poolEnv(),key=captureTransportConfig(initial).proxies[0].key;
  const env={AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXIES:JSON.stringify([entries[1]])};
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='retry',attempts=1,proxy_attempts=1,proxy_key=$1 WHERE brand='Telsim'",[key]);
    const before=await target(db);let calls=0;
    const result=await createCloudWorker(db,HOME_INTERNET_SOURCES,{env,log:quiet,capture:async()=>{calls++;return {status:'no_ads',captured:0}}})();
    assert.equal(result.scan.status,'waiting_proxy');assert.equal(result.scan.reason,'PROXY_PIN_MISSING');
    assert.equal(calls,0);assert.deepEqual(await target(db),before);
    assert.equal((await getCloudStatus(db,{env})).capture_transport.available_count,1);
  }finally{await db.close()}
});
