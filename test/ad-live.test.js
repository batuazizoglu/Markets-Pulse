import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createHash} from 'node:crypto';
import {SCHEMA_SQL} from '../src/schema.js';
import {recordAdStatus,retireMissingAds} from '../src/ad-live.js';
import {getAdVisuals,getPendingAdVisuals,importAdFeed} from '../src/ad-visual.js';
import {persistCloudCapture} from '../src/ad-cloud.js';

const now=new Date(),at=hours=>new Date(+now-hours*3600000).toISOString(),page='164143610515';
const jpeg=Buffer.from([255,216,255,224,255,217]),hash=createHash('sha256').update(jpeg).digest('hex');
const ad=(id,status='active',hours=1)=>({key:`${page}:${id}:1`,page_id:page,ad_id:id,variant_id:'1',brand:'Telsim',category:'home',ad_status:status,observed_at:at(hours),title:id,conditions:[],offer:{},images:[{sha256:hash,captured_at:at(hours)}]});
async function seed(db,a){await db.query('INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,$5,$6)',[a.key,a.brand,a.category,a.observed_at,'seed',a]);}
async function setup(){const db=new PGlite();await db.exec(SCHEMA_SQL);return db;}

test('database policy controls current visibility and keeps an append-only status audit',async()=>{
  const db=await setup(),a=ad('900001','active',3);
  try{
    await seed(db,a);await recordAdStatus(db,a);
    assert.equal((await getAdVisuals(db,{now})).total,1);
    await db.query("UPDATE ad_lifecycle_policy SET active_max_age_hours=2,updated_at=NOW() WHERE id=1");
    const current=await getAdVisuals(db,{now}),archive=await getAdVisuals(db,{now,view:'archive'});
    assert.equal(current.total,0);assert.equal(current.visibility.max_observation_age_hours,2);
    assert.equal(archive.rows[0].archive_reason,'outdated');
    await recordAdStatus(db,{...a,ad_status:'inactive',observed_at:at(0)});
    const history=(await db.query('SELECT ad_status,source FROM ad_live_status_history WHERE page_id=$1 AND ad_id=$2 ORDER BY checked_at',[page,a.ad_id])).rows;
    assert.deepEqual(history,[{ad_status:'active',source:'observation'},{ad_status:'inactive',source:'observation'}]);
    await db.exec(SCHEMA_SQL);
    assert.equal((await db.query('SELECT count(*)::int count FROM ad_live_status_history WHERE page_id=$1 AND ad_id=$2',[page,a.ad_id])).rows[0].count,2);
  }finally{await db.close();}
});

test('only fresh explicit active observations enter rows, totals, brand filters and keyset pages',async()=>{
  const db=await setup();
  try{
    for(const a of [ad('100001'),ad('100002'),ad('100003','inactive'),ad('100004','unknown'),ad('100005','active',31),ad('100006','active',-1)])await seed(db,a);
    const first=await getAdVisuals(db,{now,limit:1});assert.equal(first.total,2);assert.equal(first.groups.home,2);assert.equal(first.brand_groups.Telsim.home,2);assert.equal(first.pagination.total,2);assert.equal(first.rows[0].key,ad('100001').key);
    const next=await getAdVisuals(db,{now,limit:1,cursor:first.pagination.next_cursor});assert.equal(next.rows[0].key,ad('100002').key);assert.equal(next.pagination.has_more,false);
    await recordAdStatus(db,{...ad('100001','inactive'),observed_at:at(0)});
    await recordAdStatus(db,{...ad('100002','unknown'),observed_at:at(0)});
    assert.equal((await getAdVisuals(db,{now,brand:'Telsim'})).total,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_visual_items')).rows[0].n,6);
  }finally{await db.close();}
});

test('unchanged capture refreshes source status without resetting AI or reviving it through reanalysis',async()=>{
  const db=await setup(),a=ad('200001','active',72);
  try{
    await seed(db,a);
    const job=(await db.query('INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES($1,$2,$3) RETURNING *',['live-replay','Telsim',{page_id:page}])).rows[0];
    const candidate={...a,evidence:[{bytes:jpeg,sha256:hash,captured_at:a.observed_at}]};
    await persistCloudCapture(db,candidate,job);
    await db.query("UPDATE ad_cloud_candidates SET status='analyzed',attempts=2,review_round=1,analysis_json='{}'");
    const before=(await db.query('SELECT * FROM ad_cloud_candidates')).rows[0];
    await persistCloudCapture(db,{...candidate,observed_at:at(1)},job);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_candidates')).rows[0],before);
    assert.equal((await getAdVisuals(db,{now})).total,1);
    await persistCloudCapture(db,{...candidate,ad_status:'inactive',observed_at:at(0)},job);
    assert.equal((await getAdVisuals(db,{now})).total,0);
    await recordAdStatus(db,{...a,observed_at:at(1)}); // delayed active response cannot undo a newer inactive status
    const reanalyzed={...a,ai_analysis:{status:'completed',analyzed_at:at(0),pass:2,model:'test'}};
    await importAdFeed(db,{producer:'cloud-vision',run:{id:'live-old-reanalysis',checked_at:at(0),status:'partial',coverage:[]},ads:[reanalyzed],schedule:{}},{reanalysis:true});
    assert.equal((await getAdVisuals(db,{now})).total,0);
    assert.equal((await db.query('SELECT ad_status FROM ad_live_status')).rows[0].ad_status,'inactive');
  }finally{await db.close();}
});

test('complete source scans retire missing ads across variants but older scans and other pages cannot override presence',async()=>{
  const db=await setup();
  try{
    for(const a of [ad('300001'),ad('300002'),{...ad('300003'),page_id:'12345678'}]){await seed(db,a);await recordAdStatus(db,a);}
    await retireMissingAds(db,page,['300001'],at(0));
    assert.deepEqual((await getAdVisuals(db,{now})).rows.map(x=>x.ad_id).sort(),['300001','300003']);
    assert.deepEqual((await db.query("SELECT ad_id,ad_status,source FROM ad_live_status_history WHERE page_id=$1 AND source='complete_scan' ORDER BY ad_id",[page])).rows,
      [{ad_id:'300002',ad_status:'inactive',source:'complete_scan'}]);
    await recordAdStatus(db,{...ad('300002'),observed_at:new Date(+now+1000).toISOString()});
    await retireMissingAds(db,page,[],at(0));
    assert.deepEqual((await getAdVisuals(db,{now})).rows.map(x=>x.ad_id).sort(),['300002','300003']);
    await db.exec(SCHEMA_SQL); // restart migration must not resurrect an inactive ad from archived JSON
    assert.deepEqual((await getAdVisuals(db,{now})).rows.map(x=>x.ad_id).sort(),['300002','300003']);
  }finally{await db.close();}
});

test('unanalysed media uses the same live policy and newer creative evidence hides the old analysed image',async()=>{
  const db=await setup();
  try{
    const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('pending-live','Telsim','{}') RETURNING *")).rows[0];
    await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',[hash,jpeg]);
    for(const a of [ad('400001'),ad('400002','inactive'),ad('400003','unknown'),ad('400004','active',72)]){
      await db.query('INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,observed_at) VALUES($1,$2,$3,$4,$5)',[a.key,job.id,'seed',a,a.observed_at]);
    }
    const pending=await getPendingAdVisuals(db,{now});assert.equal(pending.total,1);assert.equal(pending.pagination.total,1);assert.equal(pending.rows[0].ad_id,'400001');
    await seed(db,ad('400001','active',2));
    assert.equal((await getAdVisuals(db,{now})).total,0);assert.equal((await getPendingAdVisuals(db,{now})).total,1);
  }finally{await db.close();}
});

test('archive is the exact complement of current ads, including unknown status and superseded creatives',async()=>{
  const db=await setup();
  try{
    for(const a of [ad('500001'),ad('500002','inactive'),ad('500003','unknown'),ad('500004','active',72),ad('500005','active',-1),{...ad('500006'),ad_status:null},ad('500007')])await seed(db,a);
    const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('archive-newer','Telsim',$1) RETURNING *",[{page_id:page}])).rows[0];
    await persistCloudCapture(db,{...ad('500007'),observed_at:at(0),evidence:[{bytes:jpeg,sha256:hash,captured_at:at(0)}]},job);
    const current=await getAdVisuals(db,{now}),archived=await getAdVisuals(db,{now,view:'archive',limit:2});
    assert.equal(current.total,1);assert.equal(archived.total,6);assert.equal(archived.groups.home,6);assert.equal(archived.brand_groups.Telsim.home,6);
    assert.equal(archived.visibility.active_only,false);assert.equal(archived.visibility.view,'archive');
    let cursor,rows=[];
    do{const data=await getAdVisuals(db,{now,view:'archive',limit:2,...(cursor?{cursor}:{})});rows.push(...data.rows);cursor=data.pagination.next_cursor;}while(cursor);
    assert.equal(new Set(rows.map(x=>x.key)).size,6);assert.ok(rows.every(x=>x.archived&&!current.rows.some(y=>y.key===x.key)));
    const reasons=Object.fromEntries(rows.map(x=>[x.ad_id,x.archive_reason]));assert.deepEqual(reasons,{'500002':'inactive','500003':'unverified','500004':'outdated','500005':'outdated','500006':'unverified','500007':'superseded'});
    await assert.rejects(getAdVisuals(db,{now,cursor:archived.pagination.next_cursor}),/Geçersiz/);
    for(const view of ['all','',[],{}])await assert.rejects(getAdVisuals(db,{now,view}),/Geçersiz/);
    const filtered=await getAdVisuals(db,{now,view:'archive',brand:'Telsim',category:'home'});assert.equal(filtered.pagination.total,6);
    await recordAdStatus(db,{...ad('500004'),observed_at:at(0)});
    assert.equal((await getAdVisuals(db,{now})).total,2);assert.equal((await getAdVisuals(db,{now,view:'archive'})).total,5);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_visual_items')).rows[0].n,7);
  }finally{await db.close();}
});
