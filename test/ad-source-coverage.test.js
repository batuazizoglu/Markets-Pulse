import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {getCloudSourceCoverage} from '../src/ad-source-coverage.js';
import {getAdReport,getAdVisuals} from '../src/ad-visual.js';

const start='2026-11-04T06:00:00Z',end='2026-11-05T06:00:00Z',at='2026-11-05T04:00:00Z',finished='2026-11-05T04:15:00Z';
async function job(db,{brand='Telsim',page='164143610515',created=at,state='complete',expected=2,done=finished}={}){
  const {rows}=await db.query(`INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,created_at,finished_at)
    VALUES($1,$2,$3,'partial',$4,$5) RETURNING id`,[brand+created,brand,JSON.stringify({brand,page_id:page}),created,done]);
  await db.query(`INSERT INTO ad_provider_runs(job_id,state,expected_ads,coverage_complete,max_run_usd,created_at,finished_at)
    VALUES($1,$2,$3,$4,0.1,$5,$6)`,[rows[0].id,state,expected,state==='complete',created,done]);
}
test('reports use completed source checks even without a new AI analysis, and retain every incomplete source',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    assert.equal(await getCloudSourceCoverage(db,{end}),null);
    await db.query("UPDATE ad_visual_sync SET status='partial',checked_at=$1,coverage_json=$2 WHERE id=1",[start,JSON.stringify([{brand:'Telsim',status:'partial',checked_at:start}])]);
    await job(db);
    let report=await getAdReport(db,start,end);
    assert.equal(report.status,'ok');assert.equal(report.coverage[0].status,'ok');assert.equal(report.coverage[0].reviewed_ads,2);
    assert.equal(+new Date(report.checked_at),+new Date(at));assert.equal(report.rows.length,0);
    const dashboard=await getAdVisuals(db,{now:new Date(end)});assert.equal(dashboard.monitoring.status,'ok');assert.equal(dashboard.monitoring.coverage[0].status,'ok');
    await job(db,{brand:'Nethouse',page:'159064954156749',expected:0});
    report=await getAdReport(db,start,end);assert.equal(report.status,'ok');assert.equal(report.coverage.find(x=>x.brand==='Nethouse').status,'no_ads');
    await job(db,{brand:'Broadmax',page:'123456',state:'partial',expected:null});
    report=await getAdReport(db,start,end);assert.equal(report.status,'partial');assert.equal(report.coverage.length,3);
    assert.equal(report.coverage.find(x=>x.brand==='Broadmax').status,'partial');
  }finally{await db.close();}
});
test('report cutoff excludes future checks; delayed imports never refresh old source observations',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    await job(db,{created:'2026-11-01T04:00:00Z'});
    await job(db,{created:'2026-11-05T07:00:00Z',done:'2026-11-05T07:10:00Z',expected:0});
    let coverage=await getCloudSourceCoverage(db,{end});
    assert.equal(coverage.coverage.length,1);assert.equal(coverage.coverage[0].reviewed_ads,2);
    assert.equal(coverage.checked_at,'2026-11-01T04:00:00.000Z');
    await job(db,{brand:'Nethouse',page:'159064954156749',done:'2026-11-05T06:10:00Z'});
    coverage=await getCloudSourceCoverage(db,{end});
    assert.equal(coverage.status,'partial');assert.equal(coverage.coverage.find(x=>x.brand==='Nethouse').status,'partial');
  }finally{await db.close();}
});
