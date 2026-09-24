import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {socialDirectory} from '../src/isp-registry.js';
import {adLibrarySource} from '../src/ad-cloud-capture.js';
import {queueProviderHandoff,createCloudWorker,localCloudTime,verifiedCloudSources} from '../src/ad-cloud.js';

const env={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'synthetic-token',APIFY_MAX_RUN_USD:'0.10',APIFY_DAILY_BUDGET_USD:'1.00'};
const directory=socialDirectory(HOME_INTERNET_SOURCES).filter(adLibrarySource);
const verified=verifiedCloudSources(HOME_INTERNET_SOURCES);
async function fixture(){
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  for(const source of directory)await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,attempts,note) VALUES('old-browser',$1,$2::jsonb,'error',3,'Eski proxy hatası')",[source.brand,JSON.stringify(source)]);
  const unverified=socialDirectory(HOME_INTERNET_SOURCES).find(source=>!adLibrarySource(source));
  if(unverified)await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,note) VALUES('old-browser',$1,$2::jsonb,'blocked','Doğrulanmamış kaynak')",[unverified.brand,JSON.stringify(unverified)]);
  await db.query("UPDATE ad_cloud_control SET lease_owner='handoff-test',lease_until=NOW()+INTERVAL '1 day' WHERE id=1");
  return db;
}
const handoff=db=>queueProviderHandoff(db,HOME_INTERNET_SOURCES,'handoff-test',{env});

test('provider handoff recovers interrupted FixNet and queues all verified sources once',async()=>{
  const db=await fixture();
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='running',attempts=2,captured=3,proxy_key='old-proxy-key',proxy_attempts=4 WHERE brand='FixNet'");
    const prior=(await db.query("SELECT * FROM ad_cloud_jobs WHERE brand<>'FixNet' ORDER BY id")).rows;
    const result=await handoff(db);assert.equal(result.recovered,1);assert.equal(result.queued,verified.length-1);
    const recovered=(await db.query("SELECT status,attempts,captured,proxy_key,proxy_attempts FROM ad_cloud_jobs WHERE brand='FixNet'")).rows[0];
    assert.deepEqual(recovered,{status:'retry',attempts:2,captured:3,proxy_key:'old-proxy-key',proxy_attempts:4});
    assert.deepEqual((await db.query("SELECT * FROM ad_cloud_jobs WHERE batch_key='old-browser' AND brand<>'FixNet' ORDER BY id")).rows,prior);
    const queued=(await db.query("SELECT brand,source_json->>'page_id' page_id FROM ad_cloud_jobs WHERE status IN ('queued','retry') AND attempts<3 ORDER BY brand")).rows;
    const byBrand=(a,b)=>a.brand.localeCompare(b.brand,'en');
    assert.deepEqual(queued.sort(byBrand),verified.map(source=>({brand:source.brand,page_id:source.page_id})).sort(byBrand));
    const count=(await db.query('SELECT count(*)::int n FROM ad_cloud_jobs')).rows[0].n;
    assert.deepEqual(await handoff(db),{recovered:0,queued:0,brands:[]});
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_jobs')).rows[0].n,count);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_budget')).rows[0].n,0);
  }finally{await db.close();}
});

test('exhausted interrupted browser captures retain their history and get a separate provider queue record',async()=>{
  const db=await fixture();
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='running',captured=2,proxy_key='pinned',proxy_attempts=5 WHERE brand='FixNet'");
    const result=await handoff(db);assert.equal(result.recovered,1);assert.equal(result.queued,verified.length);
    const records=(await db.query("SELECT batch_key,status,attempts,captured,proxy_key,proxy_attempts FROM ad_cloud_jobs WHERE brand='FixNet' ORDER BY id")).rows;
    assert.deepEqual(records,[{batch_key:'old-browser',status:'error',attempts:3,captured:2,proxy_key:'pinned',proxy_attempts:5},
      {batch_key:'provider-source-1435421553398998',status:'queued',attempts:0,captured:0,proxy_key:null,proxy_attempts:0}]);
    // An already-seeded bootstrap batch is not recreated even after another process marks it terminal.
    await db.query("UPDATE ad_cloud_jobs SET status='error' WHERE batch_key LIKE 'provider-source-%'");
    assert.deepEqual(await handoff(db),{recovered:0,queued:0,brands:[]});
    assert.equal((await db.query("SELECT count(*)::int n FROM ad_cloud_jobs WHERE batch_key LIKE 'provider-source-%'")).rows[0].n,verified.length);
  }finally{await db.close();}
});

test('provider running and ambiguous creation history, AI candidates, and spend reservations stay untouched',async()=>{
  const db=await fixture();
  try{
    for(const [brand,state] of [['Kıbrıs Online','running'],['Nethouse','start_unknown'],['Telsim','creating']]){
      const job=(await db.query('SELECT id FROM ad_cloud_jobs WHERE brand=$1',[brand])).rows[0];
      await db.query('UPDATE ad_cloud_jobs SET status=$2 WHERE id=$1',[job.id,state==='start_unknown'?'blocked':'running']);
      await db.query('INSERT INTO ad_provider_runs(job_id,state,max_run_usd,run_id) VALUES($1,$2,0.10,$3)',[job.id,state,state==='running'?'existingRun':null]);
    }
    await db.query("INSERT INTO ad_provider_budget(day,reserved_usd,starts) VALUES('2026-09-21',0.30,3)");
    const job=(await db.query("SELECT id FROM ad_cloud_jobs WHERE brand='Nethouse'")).rows[0];
    await db.query("INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,observed_at,status,attempts,last_error) VALUES('159064954156749:999999:1',$1,'old-fingerprint','{}'::jsonb,NOW(),'retry',2,'VISION_RATE_LIMIT')",[job.id]);
    const before={runs:(await db.query('SELECT * FROM ad_provider_runs ORDER BY job_id')).rows,budget:(await db.query('SELECT * FROM ad_provider_budget')).rows,candidates:(await db.query('SELECT * FROM ad_cloud_candidates')).rows,
      jobs:(await db.query("SELECT * FROM ad_cloud_jobs WHERE brand IN ('Kıbrıs Online','Nethouse','Telsim') ORDER BY id")).rows};
    const result=await handoff(db);assert.equal(result.recovered,0);assert.equal(result.queued,verified.length-3);
    assert.deepEqual((await db.query('SELECT * FROM ad_provider_runs ORDER BY job_id')).rows,before.runs);
    assert.deepEqual((await db.query('SELECT * FROM ad_provider_budget')).rows,before.budget);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_candidates')).rows,before.candidates);
    assert.deepEqual((await db.query("SELECT * FROM ad_cloud_jobs WHERE brand IN ('Kıbrıs Online','Nethouse','Telsim') ORDER BY id")).rows,before.jobs);
    assert.deepEqual(await handoff(db),{recovered:0,queued:0,brands:[]});
  }finally{await db.close();}
});

test('a queued future retry is retained without shortening its wait or creating a duplicate',async()=>{
  const db=await fixture();
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='retry',attempts=2,available_at=NOW()+INTERVAL '2 hours' WHERE brand='FixNet'");
    const before=(await db.query("SELECT * FROM ad_cloud_jobs WHERE brand='FixNet'")).rows;
    assert.equal((await handoff(db)).queued,verified.length-1);
    assert.deepEqual((await db.query("SELECT * FROM ad_cloud_jobs WHERE brand='FixNet'")).rows,before);
    assert.equal((await db.query("SELECT count(*)::int n FROM ad_cloud_jobs WHERE brand='FixNet'")).rows[0].n,1);
  }finally{await db.close();}
});

test('handoff mutation requires the current worker lease and browser mode is unchanged',async()=>{
  const db=await fixture();
  try{
    const before=(await db.query('SELECT * FROM ad_cloud_jobs ORDER BY id')).rows;
    await assert.rejects(queueProviderHandoff(db,HOME_INTERNET_SOURCES,'expired-owner',{env}),/CLOUD_LEASE_LOST/);
    assert.deepEqual(await queueProviderHandoff(db,HOME_INTERNET_SOURCES,'expired-owner',{env:{}}),{recovered:0,queued:0,brands:[]});
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_jobs ORDER BY id')).rows,before);
  }finally{await db.close();}
});

test('worker handoff precedes daily scheduling and is restart-safe while provider configuration is missing',async()=>{
  const db=await fixture();
  try{
    await db.query("UPDATE ad_cloud_jobs SET status='running' WHERE brand='FixNet'");
    await db.query('UPDATE ad_cloud_control SET lease_owner=NULL,lease_until=NULL,scheduled_day=$1 WHERE id=1',[localCloudTime().day]);
    let ticks=0;
    const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{env:{AD_CAPTURE_PROVIDER:'apify'},log:()=>{},providerTick:async()=>{
      ticks++;
      assert.equal((await db.query("SELECT count(*)::int n FROM ad_cloud_jobs WHERE status='running' AND NOT EXISTS(SELECT 1 FROM ad_provider_runs p WHERE p.job_id=ad_cloud_jobs.id)")).rows[0].n,0);
      assert.equal((await db.query("SELECT count(*)::int n FROM ad_cloud_jobs WHERE status IN ('queued','retry') AND attempts<3")).rows[0].n,verified.length);
      return {status:'waiting_config',reason:'PROVIDER_TOKEN_MISSING'};
    }});
    assert.equal((await worker()).scan.status,'waiting_config');
    assert.equal((await worker()).scan.status,'waiting_config');assert.equal(ticks,2);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_runs')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_budget')).rows[0].n,0);
  }finally{await db.close();}
});
