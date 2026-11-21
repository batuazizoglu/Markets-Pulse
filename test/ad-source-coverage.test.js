import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {getCloudSourceCoverage} from '../src/ad-source-coverage.js';
import {getAdReport,getAdVisuals,validateAdFeed} from '../src/ad-visual.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {verifiedCloudSources} from '../src/ad-cloud.js';

const start='2026-11-04T06:00:00Z',end='2026-11-05T06:00:00Z',at='2026-11-05T04:00:00Z',finished='2026-11-05T04:15:00Z';
const directory=verifiedCloudSources(HOME_INTERNET_SOURCES);
async function job(db,{brand='Telsim',page='164143610515',created=at,state='complete',expected=2,done=finished}={}){
  const {rows}=await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,created_at,finished_at)
    VALUES($1,$2,$3,'partial',$4,$5) RETURNING id`,[brand+created,brand,JSON.stringify({brand,page_id:page}),created,done]);
  await db.query(`INSERT INTO ad_provider_runs(job_id,state,expected_ads,coverage_complete,max_run_usd,created_at,finished_at)
    VALUES($1,$2,$3,$4,0.1,$5,$6)`,[rows[0].id,state,expected,state==='complete',created,done]);
}
async function remainingJobs(db,exclude=[]){
  for(const source of directory.filter(source=>!exclude.includes(source.brand)))await job(db,{brand:source.brand,page:source.page_id,expected:0});
}
test('reports use completed source checks even without a new AI analysis, and retain every incomplete source',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    assert.equal(await getCloudSourceCoverage(db,{end}),null);
    await db.query("UPDATE ad_visual_sync SET status='partial',checked_at=$1,coverage_json=$2 WHERE id=1",[start,JSON.stringify([{brand:'Telsim',status:'partial',checked_at:start}])]);
    await remainingJobs(db,['Telsim']);
    await job(db);
    let report=await getAdReport(db,start,end);
    assert.equal(report.status,'ok');assert.equal(report.coverage.find(x=>x.brand==='Telsim').status,'ok');assert.equal(report.coverage.find(x=>x.brand==='Telsim').reviewed_ads,2);
    assert.equal(+new Date(report.checked_at),+new Date(at));assert.equal(report.rows.length,0);
    const dashboard=await getAdVisuals(db,{now:new Date(end)});assert.equal(dashboard.monitoring.status,'ok');assert.equal(dashboard.monitoring.coverage.find(x=>x.brand==='Telsim').status,'ok');
    report=await getAdReport(db,start,end);assert.equal(report.status,'ok');assert.equal(report.coverage.find(x=>x.brand==='Nethouse').status,'no_ads');
    await job(db,{brand:'Broadmax',page:'546525498748970',created:'2026-11-05T04:01:00Z',state:'partial',expected:null});
    report=await getAdReport(db,start,end);assert.equal(report.status,'partial');assert.equal(report.coverage.length,directory.length);
    assert.equal(report.coverage.find(x=>x.brand==='Broadmax').status,'partial');
  }finally{await db.close();}
});
test('report cutoff excludes future checks; delayed imports never refresh old source observations',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    await job(db,{created:'2026-11-01T04:00:00Z'});
    await job(db,{created:'2026-11-05T07:00:00Z',done:'2026-11-05T07:10:00Z',expected:0});
    let coverage=await getCloudSourceCoverage(db,{end});
    assert.equal(coverage.coverage.length,directory.length);assert.equal(coverage.coverage.find(x=>x.brand==='Telsim').reviewed_ads,null);
    assert.equal(coverage.coverage.find(x=>x.brand==='Telsim').status,'partial');
    assert.match(coverage.coverage.find(x=>x.brand==='Telsim').note,/güncellik süresini aştı/);
    assert.equal(coverage.checked_at,'2026-11-01T04:00:00.000Z');
    await job(db,{brand:'Nethouse',page:'159064954156749',done:'2026-11-05T06:10:00Z'});
    coverage=await getCloudSourceCoverage(db,{end});
    assert.equal(coverage.status,'partial');assert.equal(coverage.coverage.find(x=>x.brand==='Nethouse').status,'partial');
  }finally{await db.close();}
});

test('verified inventory includes missing sources, deduplicates shared pages and never invents a check timestamp',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const initial=await getCloudSourceCoverage(db,{end,sources:HOME_INTERNET_SOURCES});
    assert.equal(initial.coverage.length,directory.length);assert.equal(initial.status,'partial');assert.equal(initial.checked_at,null);
    assert.ok(initial.coverage.every(source=>source.status==='partial'&&source.checked_at===null&&source.reviewed_ads===null));
    assert.equal(initial.coverage.filter(source=>new URL(source.source_url).searchParams.get('view_all_page_id')==='127496543986832').length,1);
    assert.ok(initial.coverage.some(source=>source.brand==='KKTCELL'));
    assert.ok(!initial.coverage.some(source=>source.brand==='Turkcell Ev İnterneti'));
    await remainingJobs(db,['Xrealnet']);
    const report=await getAdReport(db,start,end),dashboard=await getAdVisuals(db,{now:new Date(end)});
    assert.equal(report.status,'partial');assert.equal(dashboard.monitoring.status,'partial');
    const missing=report.coverage.find(source=>source.brand==='Xrealnet');
    assert.equal(missing.status,'partial');assert.equal(missing.checked_at,null);assert.equal(missing.reviewed_ads,null);
    assert.equal(dashboard.monitoring.coverage.find(source=>source.brand==='Xrealnet').stale,true);
    const feed={schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Daily',timezone:'Asia/Famagusta'},
      run:{id:'missing-source-check',checked_at:end,status:'partial',coverage:report.coverage},ads:[]};
    assert.equal(validateAdFeed(feed,HOME_INTERNET_SOURCES,new Date(end)).run.coverage.find(source=>source.brand==='Xrealnet').checked_at,null);
    for(const patch of [{status:'ok'},{status:'no_ads'},{reviewed_ads:0}]){
      await assert.rejects(async()=>validateAdFeed({...feed,run:{...feed.run,coverage:[{...missing,...patch}]}},HOME_INTERNET_SOURCES,new Date(end)),/Geçersiz inceleme tarihi/);
    }
  }finally{await db.close();}
});

test('skipped queue cleanup cannot hide an actual check; a new pending check and stale sources remain incomplete',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    await remainingJobs(db,['Xrealnet']);
    await job(db,{brand:'Xrealnet',page:'391015854865659',created:'2026-11-03T04:00:00Z',expected:0});
    let result=await getCloudSourceCoverage(db,{end});
    assert.equal(result.status,'partial');assert.equal(result.coverage.find(source=>source.brand==='Xrealnet').status,'partial');
    await db.query('UPDATE ad_lifecycle_policy SET active_max_age_hours=72 WHERE id=1');
    result=await getCloudSourceCoverage(db,{end});assert.equal(result.status,'ok');
    await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,created_at,finished_at)
      VALUES('skipped-ticket','Xrealnet',$1,'skipped','2026-11-05T04:05:00Z','2026-11-05T04:10:00Z')`,[{page_id:'391015854865659'}]);
    result=await getCloudSourceCoverage(db,{end});assert.equal(result.status,'ok');
    assert.equal(result.coverage.find(source=>source.brand==='Xrealnet').checked_at,'2026-11-03T04:00:00.000Z');
    await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,created_at)
      VALUES('current-ticket','Xrealnet',$1,'queued','2026-11-05T04:20:00Z')`,[{page_id:'391015854865659'}]);
    result=await getCloudSourceCoverage(db,{end});assert.equal(result.status,'partial');
    assert.equal(result.coverage.find(source=>source.brand==='Xrealnet').reviewed_ads,null);
  }finally{await db.close();}
});

test('a historical result for a different page cannot satisfy a currently verified advertiser',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    await remainingJobs(db,['KKTCELL']);
    await job(db,{brand:'KKTCELL',page:'999999999',expected:0});
    const result=await getCloudSourceCoverage(db,{end});
    assert.equal(result.status,'partial');
    const source=result.coverage.find(source=>source.brand==='KKTCELL');
    assert.equal(source.status,'partial');assert.equal(source.checked_at,null);
    assert.equal(new URL(source.source_url).searchParams.get('view_all_page_id'),'127496543986832');
  }finally{await db.close();}
});
