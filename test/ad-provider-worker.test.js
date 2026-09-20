import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {queueCloudReview,persistCloudCapture} from '../src/ad-cloud.js';
import {runProviderTick,getProviderStatus} from '../src/ad-provider-worker.js';

const env={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'synthetic-provider-token',APIFY_MAX_RUN_USD:'0.10',APIFY_DAILY_BUDGET_USD:'0.20'};
const jpeg=Buffer.from([255,216,255,224,0,0,255,217]);
const at=()=>new Date();
const rawAd=(id='999999',images=1)=>({pageID:'164143610515',adArchiveID:id,isActive:true,
  snapshot:{body:{text:'Ev interneti 20 Mbps'},images:Array.from({length:images},(_,i)=>({originalImageUrl:`https://scontent.fbcdn.net/${id}-${i}.jpg?signature=current`}))}});
const err=(code,other={})=>Object.assign(new Error(code),{code,...other});

async function fixture(overrides={}) {
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  await queueCloudReview(db,HOME_INTERNET_SOURCES,{manual:true});
  await db.query("UPDATE ad_cloud_jobs SET status='error' WHERE brand<>'Telsim'");
  await db.query("UPDATE ad_cloud_control SET lease_owner='provider-test',lease_until=NOW()+INTERVAL '1 day' WHERE id=1");
  let clock=at(),starts=0,polls=0,fetches=0;
  const client={
    startProviderRun:async()=>{starts++;return {id:'run12345',status:'RUNNING',defaultDatasetId:'dataset12345',usageTotalUsd:0};},
    getProviderRun:async()=>{polls++;return {id:'run12345',status:'SUCCEEDED',defaultDatasetId:'dataset12345',usageTotalUsd:0.01};},
    getProviderItems:async(id,{offset})=>({items:offset?[]:[rawAd()],total:1,offset,count:offset?0:1}),
    fetchProviderImage:async()=>{fetches++;return {bytes:jpeg,mime:'image/jpeg'};},
    ...overrides
  };
  const options={env,owner:'provider-test',assertLease:async(connection,owner)=>{
    const row=(await connection.query('SELECT lease_owner,lease_until>NOW() alive FROM ad_cloud_control WHERE id=1 FOR UPDATE')).rows[0];
    if(row.lease_owner!==owner || !row.alive)throw err('CLOUD_LEASE_LOST');
  },persistCapture:persistCloudCapture,normalizeImage:async image=>image.bytes,now:()=>clock,client};
  return {db,client,options,tick:()=>runProviderTick(db,HOME_INTERNET_SOURCES,options),advance:ms=>{clock=new Date(+clock+ms);},stats:()=>({starts,polls,fetches}),
    run:async()=>(await db.query('SELECT * FROM ad_provider_runs ORDER BY job_id LIMIT 1')).rows[0],
    target:async()=>(await db.query("SELECT * FROM ad_cloud_jobs WHERE brand='Telsim' ORDER BY id LIMIT 1")).rows[0]};
}
async function toImport(f) {assert.equal((await f.tick()).status,'running');f.advance(15000);assert.equal((await f.tick()).status,'importing');}
async function toDownload(f) {await toImport(f);assert.equal((await f.tick()).status,'downloading');}

test('missing configuration leaves jobs and budgets unchanged and status exposes no credentials',async()=>{
  const f=await fixture();
  try {
    const before=await f.target();
    assert.deepEqual(await runProviderTick(f.db,HOME_INTERNET_SOURCES,{...f.options,env:{AD_CAPTURE_PROVIDER:'apify'}}),{status:'waiting_config',reason:'PROVIDER_TOKEN_MISSING'});
    assert.deepEqual(await f.target(),before);
    const status=await getProviderStatus(f.db,{env:{AD_CAPTURE_PROVIDER:'apify'}});
    assert.equal(status.enabled,true);assert.equal(status.configured,false);assert.equal(status.starts_today,0);assert.deepEqual(status.runs,[]);
    const configured=await getProviderStatus(f.db,{env});assert.ok(!JSON.stringify(configured).includes(env.APIFY_TOKEN));
  } finally {await f.db.close();}
});

test('starts are budgeted before POST and restart polls the saved run without another paid start',async()=>{
  const f=await fixture();
  try {
    let observed;
    f.client.startProviderRun=async()=>{
      observed={budget:(await f.db.query('SELECT * FROM ad_provider_budget')).rows[0],run:await f.run()};
      return {id:'run12345',status:'RUNNING',defaultDatasetId:'dataset12345',usageTotalUsd:0};
    };
    await f.tick();assert.equal(observed.run.state,'creating');assert.equal(Number(observed.budget.reserved_usd),0.10);assert.equal(observed.budget.starts,1);
    assert.equal((await f.target()).attempts,1);
    assert.equal((await f.tick()).status,'waiting_provider');
    f.advance(15000);
    const restarted=await runProviderTick(f.db,HOME_INTERNET_SOURCES,{...f.options,client:{...f.client,startProviderRun:async()=>{throw Error('must not restart accepted run');}}});
    assert.equal(restarted.status,'importing');assert.equal((await f.target()).attempts,1);
  } finally {await f.db.close();}
});

test('ambiguous starts fence subsequent daily jobs for the same page and retain reserved budget',async()=>{
  const f=await fixture({startProviderRun:async()=>{throw err('PROVIDER_TIMEOUT',{ambiguous:true});}});
  try {
    assert.equal((await f.tick()).status,'start_unknown');
    const original=await f.target();
    await f.db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('next-day',$1,$2::jsonb)",[original.brand,JSON.stringify(original.source_json)]);
    assert.equal((await f.tick()).status,'idle');
    const jobs=(await f.db.query("SELECT attempts,status FROM ad_cloud_jobs WHERE brand='Telsim' ORDER BY id")).rows;
    assert.deepEqual(jobs,[{attempts:1,status:'blocked'},{attempts:0,status:'queued'}]);
    const status=await getProviderStatus(f.db,{env});assert.equal(status.reserved_today_usd,0.10);assert.equal(status.starts_today,1);
    assert.equal(status.runs[0].state,'start_unknown');
  } finally {await f.db.close();}
});

test('a persisted creation fence is never automatically repeated after process interruption',async()=>{
  const f=await fixture();
  try {
    await f.tick();await f.db.query("UPDATE ad_provider_runs SET state='creating',run_id=NULL,dataset_id=NULL");
    assert.equal((await f.tick()).status,'start_unknown');assert.equal(f.stats().starts,1);
  } finally {await f.db.close();}
});

test('all creatives across paginated rows are preserved and duplicate rows do not inflate captures',async()=>{
  const f=await fixture({getProviderItems:async(id,{offset})=>offset===0 ? {items:[rawAd('999999',5)],total:2,offset:0,count:1} : {items:[rawAd('999999',5)],total:2,offset:1,count:1}});
  try {
    await toImport(f);assert.equal((await f.tick()).status,'importing');
    assert.equal((await f.run()).dataset_offset,1);
    assert.equal((await f.tick()).status,'downloading');
    const first=await f.tick();assert.equal(first.captured,3);assert.equal(first.pending,2);
    const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.ads,1);assert.equal(final.assets,5);assert.equal(final.captured,5);
    assert.equal((await f.target()).captured,5);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM ad_cloud_candidates')).rows[0].n,5);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM ad_visual_evidence')).rows[0].n,1);
    assert.equal((await f.run()).rows_imported,2);
    const status=await getProviderStatus(f.db,{env});assert.equal(status.runs[0].coverage_complete,false);assert.equal(status.runs[0].source_exhausted,true);
  } finally {await f.db.close();}
});

test('metadata page and cursor roll back together when the lease is lost',async()=>{
  const f=await fixture();
  try {
    await toImport(f);
    f.client.getProviderItems=async()=>{
      await f.db.query("UPDATE ad_cloud_control SET lease_owner='replacement'");
      return {items:[rawAd()],offset:0,total:1,count:1};
    };
    await assert.rejects(f.tick(),/CLOUD_LEASE_LOST/);
    assert.equal((await f.run()).dataset_offset,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM ad_provider_assets')).rows[0].n,0);
  } finally {await f.db.close();}
});

test('sticky incomplete summaries and missing assets cannot become complete or no_ads',async()=>{
  const f=await fixture({getProviderItems:async(id,{offset})=>offset===0 ?
    {items:[{totalCount:1,isResultComplete:false}],offset,total:3,count:1} :
    {items:[{totalCount:1,isResultComplete:true},{...rawAd(),snapshot:{body:'Ev interneti'}}],offset,total:3,count:2}});
  try {
    await toImport(f);await f.tick();await f.tick();
    const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.missing,1);assert.equal(final.captured,0);
    assert.equal((await f.run()).coverage_denied,true);assert.equal((await f.run()).coverage_complete,false);
    assert.equal((await f.target()).status,'partial');assert.equal(f.stats().fetches,0);
  } finally {await f.db.close();}
});

test('zero ads requires an explicit complete supplier result, not an empty dataset',async()=>{
  const f=await fixture({getProviderItems:async()=>({items:[],total:0,count:0,offset:0})});
  try {
    await toDownload(f);assert.equal((await f.tick()).status,'partial');assert.equal((await f.target()).status,'partial');
    await f.db.query("UPDATE ad_provider_runs SET state='importing',source_exhausted=FALSE,dataset_offset=0");
    f.client.getProviderItems=async()=>({items:[{totalCount:0,isResultComplete:true}],total:1,count:1,offset:0});
    await f.tick();assert.equal((await f.tick()).status,'complete');assert.equal((await f.target()).status,'no_ads');
  } finally {await f.db.close();}
});

test('an individual complete flag without the source ad count remains partial',async()=>{
  const f=await fixture({getProviderItems:async()=>({items:[{...rawAd(),isResultComplete:true}],offset:0,total:1,count:1})});
  try {
    await toDownload(f);
    const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.captured,1);
    assert.equal((await f.run()).expected_ads,null);assert.equal((await f.run()).coverage_complete,false);
    assert.equal((await getProviderStatus(f.db,{env})).runs[0].coverage_complete,false);
  } finally {await f.db.close();}
});

test('failed provider runs still import their available partial dataset and preserve video previews',async()=>{
  const f=await fixture({getProviderRun:async()=>({id:'run12345',status:'TIMED-OUT',defaultDatasetId:'dataset12345',usageTotalUsd:0.04}),
    getProviderItems:async()=>({items:[{...rawAd(),isResultComplete:true,totalCount:1,snapshot:{body:'Ev interneti',videos:[{videoPreviewImageUrl:'https://scontent.fbcdn.net/preview.jpg'}]}}],total:1,count:1,offset:0})});
  try {
    await toDownload(f);assert.equal((await f.tick()).status,'partial');
    const run=await f.run();assert.equal(run.coverage_denied,true);assert.equal(run.last_error,'PROVIDER_RUN_TIMED_OUT');
    const candidate=(await f.db.query('SELECT payload FROM ad_cloud_candidates')).rows[0].payload;
    assert.equal(candidate.has_video,true);assert.equal(candidate.media_kind,'video_preview');assert.equal(candidate.images.length,1);
  } finally {await f.db.close();}
});

test('a failed later dataset read retains and downloads earlier imported assets',async()=>{
  const f=await fixture({getProviderItems:async(id,{offset})=>{
    if(offset)throw err('PROVIDER_AUTH_FAILED',{http_status:401});
    return {items:[rawAd()],offset:0,total:2,count:1};
  }});
  try {
    await toImport(f);await f.tick();assert.equal((await f.run()).dataset_offset,1);
    assert.equal((await f.tick()).status,'downloading');
    const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.captured,1);
    const run=await f.run();assert.equal(run.dataset_offset,1);assert.equal(run.source_exhausted,false);assert.equal(run.coverage_denied,true);
  } finally {await f.db.close();}
});

test('media Retry-After pauses the source and retry attempts survive a replacement worker',async()=>{
  let calls=0;
  const f=await fixture({fetchProviderImage:async()=>{calls++;if(calls===1)throw err('MEDIA_RATE_LIMITED',{http_status:429,retry_after_ms:172800000});return {bytes:jpeg,mime:'image/jpeg'};}});
  try {
    await toDownload(f);assert.equal((await f.tick()).pending,1);
    assert.equal((await f.tick()).status,'waiting_provider');assert.equal(calls,1);
    const row=(await f.db.query('SELECT attempts,available_at FROM ad_provider_assets')).rows[0];assert.equal(row.attempts,1);
    f.advance(172800001);
    assert.equal((await runProviderTick(f.db,HOME_INTERNET_SOURCES,{...f.options})).captured,1);assert.equal(calls,2);
    assert.equal((await f.db.query('SELECT attempts FROM ad_provider_assets')).rows[0].attempts,2);
  } finally {await f.db.close();}
});

test('media access denial stops further asset requests while decode errors become visible errors',async()=>{
  let calls=0;
  const f=await fixture({getProviderItems:async()=>({items:[rawAd('999999',3)],total:1,count:1,offset:0}),fetchProviderImage:async()=>{calls++;throw err('MEDIA_AUTH_FAILED',{http_status:403});}});
  try {
    await toDownload(f);const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.errors,3);assert.equal(calls,1);
    await f.db.query("UPDATE ad_provider_runs SET state='downloading'");
    await f.db.query("UPDATE ad_provider_assets SET status='pending',attempts=0,available_at=NOW()");
    f.client.fetchProviderImage=async()=>({bytes:jpeg,mime:'image/jpeg'});
    f.options.normalizeImage=async()=>{throw err('PROVIDER_IMAGE_INVALID');};
    const invalid=await f.tick();assert.equal(invalid.errors,3);assert.equal(invalid.pending,0);
    assert.equal((await f.db.query('SELECT MAX(attempts)::int n FROM ad_provider_assets')).rows[0].n,1);
  } finally {await f.db.close();}
});

test('budget exhaustion does not create a provider run or consume source attempts',async()=>{
  const f=await fixture();
  try {
    f.options.env={...env,APIFY_DAILY_BUDGET_USD:'0.10'};
    await toDownload(f);await f.tick();
    const original=await f.target();
    await f.db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('second-batch',$1,$2::jsonb)",[original.brand,JSON.stringify(original.source_json)]);
    assert.equal((await f.tick()).status,'daily_budget');assert.equal(f.stats().starts,1);
    const next=(await f.db.query("SELECT attempts,status FROM ad_cloud_jobs WHERE batch_key='second-batch'")).rows[0];assert.deepEqual(next,{attempts:0,status:'queued'});
  } finally {await f.db.close();}
});

test('a long dataset Retry-After ends a stalled import locally while healthy large imports continue',async()=>{
  let calls=0;
  const f=await fixture({getProviderItems:async(id,{offset})=>{
    calls++;
    if(offset)throw err('PROVIDER_RATE_LIMITED',{http_status:429,retry_after_ms:172800000});
    return {items:[rawAd()],offset:0,total:2,count:1};
  }});
  try {
    await toImport(f);await f.tick();
    // Successful import progress may continue beyond the external run's age window.
    await f.db.query("UPDATE ad_provider_runs SET created_at=created_at-INTERVAL '3 hours'");
    assert.equal((await f.tick()).status,'waiting_provider');assert.equal(calls,2);
    assert.equal((await f.run()).state,'importing');
    f.advance(2*3600000+1);
    assert.equal((await f.tick()).status,'downloading');assert.equal(calls,2);
    const final=await f.tick();assert.equal(final.captured,1);assert.equal(final.status,'partial');
    assert.equal((await f.run()).last_error,'PROVIDER_IMPORT_TIMEOUT');
  } finally {await f.db.close();}
});

test('a second source progresses during a media pause without another run for the paused page',async()=>{
  let mediaCalls=0;
  const f=await fixture();
  try {
    const second=(await f.db.query("SELECT * FROM ad_cloud_jobs WHERE brand='Cypking' LIMIT 1")).rows[0];assert.ok(second.source_json.page_id);
    f.client.startProviderRun=async source=>({id:source.brand==='Telsim'?'runTelsim':'runCypking',status:'RUNNING',defaultDatasetId:source.brand==='Telsim'?'dataTelsim':'dataCypking',usageTotalUsd:0});
    f.client.getProviderRun=async id=>({id,status:'SUCCEEDED',defaultDatasetId:id==='runTelsim'?'dataTelsim':'dataCypking',usageTotalUsd:0.01});
    f.client.getProviderItems=async id=>({items:[id==='dataTelsim'?rawAd():{...rawAd('888888'),pageID:second.source_json.page_id}],offset:0,total:1,count:1});
    f.client.fetchProviderImage=async asset=>{mediaCalls++;if(asset.urls[0].includes('999999'))throw err('MEDIA_RATE_LIMITED',{http_status:429,retry_after_ms:172800000});return {bytes:jpeg,mime:'image/jpeg'};};
    await toDownload(f);assert.equal((await f.tick()).pending,1);assert.equal(mediaCalls,1);
    const first=await f.target();
    await f.db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('paused-repeat',$1,$2::jsonb)",[first.brand,JSON.stringify(first.source_json)]);
    await f.db.query("UPDATE ad_cloud_jobs SET status='queued' WHERE id=$1",[second.id]);
    const started=await f.tick();assert.equal(started.status,'running');assert.equal(started.job_id,second.id);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM ad_provider_runs')).rows[0].n,2);
    f.advance(15000);assert.equal((await f.tick()).status,'importing');await f.tick();
    assert.equal((await f.tick()).captured,1);assert.equal(mediaCalls,2);
    assert.equal((await f.db.query("SELECT attempts FROM ad_cloud_jobs WHERE batch_key='paused-repeat'")).rows[0].attempts,0);
    assert.equal((await f.db.query('SELECT captured FROM ad_cloud_jobs WHERE id=$1',[first.id])).rows[0].captured,0);
    assert.equal((await f.run()).state,'downloading');
  } finally {await f.db.close();}
});

test('network media failures consume at most three attempts and become explicit asset errors',async()=>{
  let calls=0;
  const f=await fixture({fetchProviderImage:async()=>{calls++;throw err('MEDIA_DOWNLOAD_FAILED');}});
  try {
    await toDownload(f);await f.tick();f.advance(60001);await f.tick();f.advance(120001);
    const final=await f.tick();assert.equal(final.status,'partial');assert.equal(final.errors,1);assert.equal(calls,3);
    assert.equal((await f.db.query('SELECT attempts FROM ad_provider_assets')).rows[0].attempts,3);
    await f.tick();assert.equal(calls,3);
  } finally {await f.db.close();}
});
