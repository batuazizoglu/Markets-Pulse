import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {persistCloudCapture,createCloudWorker} from '../src/ad-cloud.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';

const bytes=Buffer.from([255,216,255,224,255,217]);
const candidate={brand:'Telsim',page_id:'164143610515',ad_id:'12345678',variant_id:'img_1',ad_text:'25 GB',observed_at:new Date().toISOString(),evidence:[{bytes,sha256:createHash('sha256').update(bytes).digest('hex'),captured_at:new Date().toISOString()}]};
test('capture replay preserves AI attempt budget and counts unique variants per run',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('test','Telsim',$1) RETURNING *",[JSON.stringify({page_id:candidate.page_id})])).rows[0];
    await persistCloudCapture(db,candidate,job);
    await db.query("UPDATE ad_cloud_candidates SET status='error',attempts=3,last_error='VISION_LIMIT',review_round=2,available_at=NOW()+INTERVAL '1 day',analysis_json='{\"saved\":true}'");
    const before=(await db.query('SELECT * FROM ad_cloud_candidates')).rows[0];
    await persistCloudCapture(db,{...candidate,observed_at:new Date(Date.now()+1000).toISOString()},job);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_candidates')).rows[0],before);
    assert.equal((await db.query('SELECT captured FROM ad_cloud_jobs')).rows[0].captured,1);
    const second=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('second','Telsim',$1) RETURNING *",[JSON.stringify({page_id:candidate.page_id})])).rows[0];
    await persistCloudCapture(db,candidate,second);
    assert.deepEqual((await db.query('SELECT captured FROM ad_cloud_jobs ORDER BY id')).rows.map(r=>r.captured),[1,1]);
    await persistCloudCapture(db,{...candidate,ad_text:'50 GB'},second);
    const changed=(await db.query('SELECT * FROM ad_cloud_candidates')).rows[0];
    assert.equal(changed.status,'pending');assert.equal(changed.attempts,0);assert.equal(changed.analysis_json,null);assert.equal(changed.review_round,0);
    assert.equal((await db.query('SELECT captured FROM ad_cloud_jobs WHERE id=$1',[second.id])).rows[0].captured,1);
  }finally{await db.close()}
});
test('provider tick runs independently of proxy readiness and its failure does not stop AI queue',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  let providerCalls=0;
  try{
    const worker=createCloudWorker(db,HOME_INTERNET_SOURCES,{
      env:{AD_CAPTURE_PROVIDER:'apify',AD_CAPTURE_TRANSPORT:'proxy'},log:()=>{},
      capture:async()=>{throw Error('browser must not run')},
      providerTick:async()=>{providerCalls++;throw Object.assign(Error('safe'),{code:'PROVIDER_NETWORK_ERROR'})}
    });
    const result=await worker();assert.equal(providerCalls,1);assert.equal(result.scan.reason,'PROVIDER_NETWORK_ERROR');assert.equal(result.analysis.status,'waiting_config');
    assert.ok((await db.query('SELECT status,attempts FROM ad_cloud_jobs')).rows.every(r=>r.status==='queued'&&r.attempts===0));
  }finally{await db.close()}
});
