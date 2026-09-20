import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {ISP_SOCIALS,socialDirectory} from '../src/isp-registry.js';
import {adLibrarySource} from '../src/ad-cloud-capture.js';
import {verifiedCloudSources,localCloudTime,queueCloudReview,queueNewCloudSources,queueProviderHandoff,getCloudStatus} from '../src/ad-cloud.js';

const env={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'synthetic-test-token',APIFY_MAX_RUN_USD:'0.10',APIFY_DAILY_BUDGET_USD:'10.00'};
const aliasBrand='A Scheduler Telsim Alias';
async function fixture(run){
  const entries=Array.from({length:10},(_,i)=>({brand:'Scheduler Test '+String(i).padStart(2,'0'),page_id:String(990000000000000+i)}));
  entries.push({brand:aliasBrand,page_id:ISP_SOCIALS.Telsim.page_id},
    {brand:'ZZ Scheduler Test Alias',page_id:entries[0].page_id},
    {brand:'Scheduler Unverified',page_id:'not-a-page-id'});
  const prior=new Map(entries.map(({brand})=>[brand,ISP_SOCIALS[brand]]));
  const sources=[...HOME_INTERNET_SOURCES,...entries.map(({brand},i)=>({provider:brand,url:'https://scheduler-test.example/'+i,company_ids:[]}))];
  const db=new PGlite();
  try{
    for(const {brand,page_id} of entries)ISP_SOCIALS[brand]={page_id};
    await db.exec(SCHEMA_SQL);
    const verified=verifiedCloudSources(sources);
    assert.ok(verified.length>7);
    assert.equal(verified.length,new Set(socialDirectory(sources).filter(adLibrarySource).map(source=>source.page_id)).size);
    assert.equal(verified[0].brand,'Telsim');
    assert.ok(!verified.some(source=>source.brand===aliasBrand||source.brand==='ZZ Scheduler Test Alias'||source.brand==='Scheduler Unverified'));
    await run({db,sources,verified});
  }finally{
    for(const [brand,value] of prior){if(value===undefined)delete ISP_SOCIALS[brand];else ISP_SOCIALS[brand]=value;}
    await db.close();
  }
}
async function lease(db){await db.query("UPDATE ad_cloud_control SET lease_owner='daily-test',lease_until=NOW()+INTERVAL '10 minutes' WHERE id=1");}
async function assertUniqueJobs(db,count){
  const rows=(await db.query("SELECT brand,source_json->>'page_id' page_id FROM ad_cloud_jobs ORDER BY id")).rows;
  assert.equal(rows.length,count);
  assert.equal(new Set(rows.map(row=>row.page_id)).size,count);
  return rows;
}

test('Apify schedules every unique verified page from 06:00, with persistent same-day and next-day checks',async()=>fixture(async({db,sources,verified})=>{
  const count=verified.length;
  assert.deepEqual(localCloudTime(new Date('2030-07-01T02:59:59Z')),{day:'2030-07-01',hour:5});
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-07-01T02:59:59Z')})).queued,0);
  assert.equal((await getCloudStatus(db,{env,sources})).schedule.last_scheduled_day,null);
  const first=await queueCloudReview(db,sources,{env,now:new Date('2030-07-01T03:00:00Z')});
  assert.equal(first.queued,count);
  assert.equal(first.batch_key,'daily-2030-07-01');
  await assertUniqueJobs(db,count);
  let status=await getCloudStatus(db,{env,sources});
  assert.equal(status.schedule.timezone,'Asia/Famagusta');
  assert.equal(status.schedule.daily_at,'06:00');
  assert.equal(status.schedule.verified_pages_count,count);
  assert.equal(status.schedule.last_scheduled_day,'2030-07-01');
  await db.query("UPDATE ad_cloud_jobs SET status='no_ads',finished_at=NOW()");
  // A new invocation has no process-local scheduling state and cannot repeat today's completed batch.
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-07-01T17:00:00Z')})).queued,0);
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-07-02T02:59:59Z')})).queued,0);
  status=await getCloudStatus(db,{env,sources});
  assert.equal(status.schedule.last_scheduled_day,'2030-07-01');
  // A later startup catches up the current local day; it does not require a tick at exactly 06:00.
  const next=await queueCloudReview(db,sources,{env,now:new Date('2030-07-02T09:30:00Z')});
  assert.equal(next.queued,count);
  assert.equal(next.batch_key,'daily-2030-07-02');
  assert.equal((await getCloudStatus(db,{env,sources})).schedule.last_scheduled_day,'2030-07-02');
  assert.equal((await db.query('SELECT count(*)::int count FROM ad_cloud_jobs')).rows[0].count,count*2);
  assert.equal((await db.query('SELECT count(*)::int count FROM ad_provider_runs')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int count FROM ad_provider_budget')).rows[0].count,0);
}));

test('winter scheduling uses local 06:00 and preserves a pending alias page without duplicating it',async()=>fixture(async({db,sources,verified})=>{
  const alias=socialDirectory(sources).find(source=>source.brand===aliasBrand);
  await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,attempts,available_at) VALUES('prior-alias',$1,$2::jsonb,'retry',2,NOW()+INTERVAL '2 days')",[alias.brand,JSON.stringify(alias)]);
  const prior=(await db.query("SELECT * FROM ad_cloud_jobs WHERE batch_key='prior-alias'")).rows;
  assert.equal(localCloudTime(new Date('2030-12-01T03:59:59Z')).hour,5);
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-12-01T03:59:59Z')})).queued,0);
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-12-01T04:00:00Z')})).queued,verified.length-1);
  await assertUniqueJobs(db,verified.length);
  assert.deepEqual((await db.query("SELECT * FROM ad_cloud_jobs WHERE batch_key='prior-alias'")).rows,prior);
}));

test('browser daily batches retain Telsim plus six competitors and rotate verified pages',async()=>fixture(async({db,sources})=>{
  assert.equal((await queueCloudReview(db,sources,{env:{},now:new Date('2030-07-01T03:00:00Z')})).queued,7);
  const first=await assertUniqueJobs(db,7);
  assert.equal(first[0].brand,'Telsim');
  await db.query("UPDATE ad_cloud_jobs SET status='no_ads',finished_at=NOW()");
  const next=await queueCloudReview(db,sources,{env:{},now:new Date('2030-07-02T03:00:00Z')});
  assert.equal(next.queued,7);
  const rows=(await db.query('SELECT brand FROM ad_cloud_jobs WHERE batch_key=$1',[next.batch_key])).rows;
  assert.ok(rows.some(row=>row.brand==='Telsim'));
  assert.ok(rows.filter(row=>row.brand!=='Telsim').every(row=>!first.some(old=>old.brand===row.brand)));
}));

test('initial registration deduplicates shared advertiser pages and historical alias captures across restarts',async()=>fixture(async({db,sources,verified})=>{
  const alias=socialDirectory(sources).find(source=>source.brand===aliasBrand);
  await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status) VALUES('historical-alias',$1,$2::jsonb,'no_ads')",[alias.brand,JSON.stringify(alias)]);
  await lease(db);
  assert.equal((await queueNewCloudSources(db,sources,'daily-test')).length,verified.length-1);
  await assertUniqueJobs(db,verified.length);
  assert.deepEqual(await queueNewCloudSources(db,sources,'daily-test'),[]);
  assert.deepEqual(await queueProviderHandoff(db,sources,'daily-test',{env}),{recovered:0,queued:1,brands:['Telsim']});
  assert.deepEqual(await queueProviderHandoff(db,sources,'daily-test',{env}),{recovered:0,queued:0,brands:[]});
  assert.deepEqual(await queueNewCloudSources(db,sources,'daily-test'),[]);
}));

test('provider bootstrap, registration and daily scheduling share one page queue without spending',async()=>fixture(async({db,sources,verified})=>{
  await lease(db);
  assert.equal((await queueProviderHandoff(db,sources,'daily-test',{env})).queued,verified.length);
  assert.deepEqual(await queueNewCloudSources(db,sources,'daily-test'),[]);
  assert.equal((await queueCloudReview(db,sources,{env,now:new Date('2030-07-01T12:00:00Z')})).queued,0);
  await assertUniqueJobs(db,verified.length);
  assert.deepEqual(await queueProviderHandoff(db,sources,'daily-test',{env}),{recovered:0,queued:0,brands:[]});
  const activeManual=await queueCloudReview(db,sources,{env,manual:true,now:new Date('2030-07-01T12:00:00Z')});
  assert.equal(activeManual.already_queued,true);
  await db.query("UPDATE ad_cloud_jobs SET status='no_ads',finished_at=NOW()");
  const manual=await queueCloudReview(db,sources,{env,manual:true,now:new Date('2030-07-01T12:05:00Z')});
  assert.equal(manual.queued,verified.length);
  const manualRows=(await db.query("SELECT source_json->>'page_id' page_id FROM ad_cloud_jobs WHERE batch_key=$1",[manual.batch_key])).rows;
  assert.equal(new Set(manualRows.map(row=>row.page_id)).size,verified.length);
  assert.equal((await queueCloudReview(db,sources,{env,manual:true,now:new Date('2030-07-01T12:09:59Z')})).rate_limited,true);
  assert.equal((await db.query('SELECT count(*)::int count FROM ad_provider_runs')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int count FROM ad_provider_budget')).rows[0].count,0);
}));
