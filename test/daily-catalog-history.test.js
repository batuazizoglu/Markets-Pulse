import {after,afterEach,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {loadDailyMobileCatalog} from '../src/daily-brief-evidence.js';
import {buildReportContext,sourceHealth} from '../src/report-data.js';
import {buildDailyBrief} from '../src/daily-brief.js';
import {dailyBriefEmailHtml,dailyBriefPlainText} from '../src/daily-brief-email.js';
import {renderReportHtml} from '../src/report-render.js';

let db;
const cutoff='2026-10-14T05:00:00.000Z'; // 08:00 in KKTC.
const range={start:'2026-10-14T03:30:00.000Z',end:cutoff};
const scan=async(id,source,started,finished,status='ok')=>db.query(
  'INSERT INTO scans(id,source_id,started_at,finished_at,status,http_status) VALUES($1,$2,$3,$4,$5,$6)',
  [id,source,started,finished,status,status==='error'?503:status==='ok'?200:null]);
const product=async(id,source=1)=>db.query(`INSERT INTO products(id,source_id,identity_base,current_name,first_seen_at,last_seen_at)
  VALUES($1,$2,$3,$3,'2026-10-14T03:00:00Z','2026-10-14T04:00:00Z')`,[id,source,'Plan '+id]);
const version=async(id,productId,scanId,at,price=999)=>db.query(`INSERT INTO product_versions
  (id,product_id,scan_id,captured_at,name,price_try,data_gb,validity_days,extras_json,product_hash)
  VALUES($1,$2,$3,$4,$5,$6,50,30,'["Taahhütsüz"]',$7)`,[id,productId,scanId,at,'Plan '+productId,price,'hash-'+id]);
const remove=async(productId,scanId,at,source=1)=>db.query(`INSERT INTO changes
  (source_id,product_id,scan_id,detected_at,change_type,severity) VALUES($1,$2,$3,$4,'removed','critical')`,[source,productId,scanId,at]);
const read=async()=>({catalog:await loadDailyMobileCatalog(db,range),health:await sourceHealth(db,{cutoff})});
const ids=rows=>rows.map(row=>Number(row.product_id));

before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.exec(`INSERT INTO sources(id,slug,name,url) VALUES
    (1,'mobile-a','Mobile A','https://example.test/a'),(2,'mobile-b','Mobile B','https://example.test/b'),
    (3,'unobserved','Unobserved','https://example.test/unobserved')`);
  await scan(10,1,'2026-10-14T03:00:00Z','2026-10-14T03:01:00Z');
  await scan(11,1,'2026-10-14T04:00:00Z','2026-10-14T04:01:00Z');
  await scan(20,2,'2026-10-14T04:00:00Z','2026-10-14T04:01:00Z');
  for(const id of [1,2,3]){await product(id);await version(id,id,10,'2026-10-14T03:00:00Z')}
  await product(4,2);await version(4,4,20,'2026-10-14T04:00:00Z');
  await remove(2,11,'2026-10-14T04:00:00Z');
  await db.exec('UPDATE products SET active=FALSE WHERE id=2');
});
beforeEach(async()=>db.exec('BEGIN'));
afterEach(async()=>db.exec('ROLLBACK'));
after(async()=>db?.close());

test('completed scans carry unchanged versions forward and respect recorded removals',async()=>{
  const {catalog,health}=await read();
  assert.deepEqual(ids(catalog),[1,3,4]);
  assert.equal(catalog[0].verified_at,'2026-10-14T04:00:00.000Z');
  assert.equal(Number(catalog[0].price_try),999);
  assert.deepEqual(health.map(row=>row.active_products),[2,1,0]);
  await db.exec('UPDATE products SET active=TRUE WHERE id=2');
  assert.deepEqual(ids(await loadDailyMobileCatalog(db,range)),[1,3,4],'current reactivation cannot erase a historical removal');
});

test('08:00 in-flight writes do not hide or replace the completed catalogue or counts',async()=>{
  const before=await read();
  await scan(12,1,'2026-10-14T04:59:00Z',null,'running');
  await db.exec(`UPDATE products SET last_seen_at='2026-10-14T04:59:00Z',current_name='In-flight rename',active=FALSE WHERE id IN (1,3)`);
  await version(12,1,12,'2026-10-14T04:59:00Z',1499);
  await product(5);await version(15,5,12,'2026-10-14T04:59:00Z',1999);
  await remove(3,12,'2026-10-14T04:59:00Z');
  assert.deepEqual(await read(),before);
  await db.exec(`UPDATE scans SET status='ok',finished_at='2026-10-14T05:01:00Z' WHERE id=12`);
  assert.deepEqual(await read(),before,'a scan completing after the cutoff remains outside the historical report');
});

test('latest failed check stays failed while counts retain the last successful catalogue',async()=>{
  const before=await read();
  await scan(12,1,'2026-10-14T04:30:00Z','2026-10-14T04:31:00Z','error');
  await db.exec("UPDATE scans SET error='Source unavailable' WHERE id=12; UPDATE products SET active=FALSE WHERE source_id=1");
  await version(12,1,12,'2026-10-14T04:30:00Z',1);
  await remove(3,12,'2026-10-14T04:30:00Z');
  await product(5);await version(15,5,12,'2026-10-14T04:30:00Z',1);
  const failed=await read();
  assert.deepEqual(ids(failed.catalog),[4],'failed sources remain excluded from fresh ad comparisons');
  assert.equal(failed.health[0].last_status,'error');assert.equal(failed.health[0].http_status,503);
  assert.equal(failed.health[0].last_error,'Source unavailable');
  assert.equal(failed.health[0].active_products,before.health[0].active_products);
  assert.deepEqual(failed.health[0].last_success_at,before.health[0].last_success_at);
  await scan(13,1,'2026-10-14T04:45:00Z','2026-10-14T04:46:00Z');
  const recovered=await read();
  assert.deepEqual(ids(recovered.catalog),[1,3,4],'partial failed versions, additions and removals are never verified evidence');
  assert.equal(Number(recovered.catalog[0].price_try),999);assert.equal(recovered.health[0].active_products,2);
});

test('later successful edits and active-state changes cannot rewrite a past report',async()=>{
  const before=await read();
  await scan(12,1,'2026-10-15T04:00:00Z','2026-10-15T04:01:00Z');
  await db.exec(`UPDATE products SET active=NOT active,last_seen_at='2026-10-15T04:00:00Z',current_name='Renamed later',first_seen_at='2026-10-15T04:00:00Z'`);
  await version(12,1,12,'2026-10-15T04:00:00Z',1999);
  await version(13,2,12,'2026-10-15T04:00:00Z',2999);
  await remove(3,12,'2026-10-15T04:00:00Z');
  await product(5);await version(15,5,12,'2026-10-15T04:00:00Z');
  assert.deepEqual(await read(),before);
});

test('historical daily context, email and PDF content remain identical after later scans',async()=>{
  const loaders={sourceHealth,currentBenchmark:async()=>({overall_score:null,segment_scores:[]}),
    getHomeInternetMarket:async()=>({products:[],sources:[],changes:[],campaigns:[],opportunities:[]})};
  const render=async()=>{
    const ctx=await buildReportContext(db,'daily',{now:cutoff},loaders);
    return {ctx,email:dailyBriefEmailHtml(ctx),text:dailyBriefPlainText(ctx),pdf:renderReportHtml(ctx)};
  };
  const before=await render();
  assert.deepEqual(before.ctx.sources.map(row=>row.active_products),[2,1,0]);
  await scan(12,1,'2026-10-15T04:00:00Z','2026-10-15T04:01:00Z');
  await db.exec("UPDATE products SET active=NOT active,last_seen_at='2026-10-15T04:00:00Z',current_name='Changed later'");
  await version(12,1,12,'2026-10-15T04:00:00Z',1999);
  await remove(3,12,'2026-10-15T04:00:00Z');
  await product(5);await version(15,5,12,'2026-10-15T04:00:00Z');
  assert.deepEqual(await render(),before);
});

test('a completed return restores only its exact product identity and source',async()=>{
  await scan(12,1,'2026-10-14T04:30:00Z','2026-10-14T04:31:00Z');
  await version(12,2,12,'2026-10-14T04:30:00Z',799);
  await version(13,1,20,'2026-10-14T04:00:00Z',1); // Wrong-source evidence.
  await remove(3,20,'2026-10-14T04:00:00Z',2);
  const {catalog,health}=await read();
  assert.deepEqual(ids(catalog),[1,2,3,4]);
  assert.equal(Number(catalog[0].price_try),999);assert.equal(Number(catalog[1].price_try),799);
  assert.equal(health[0].active_products,3);
});

test('only a completed successful baseline can supply a historical product count',async()=>{
  await product(5,3);
  await scan(30,3,'2026-10-14T04:30:00Z','2026-10-14T04:31:00Z','error');
  await version(15,5,30,'2026-10-14T04:30:00Z');
  const {catalog,health}=await read();
  assert.deepEqual(ids(catalog),[1,3,4]);
  assert.equal(health[2].last_status,'error');assert.equal(health[2].last_success_at,null);
  assert.equal(health[2].active_products,0);
});

test('cutoff boundaries use completed scan time and deterministic scan IDs',async()=>{
  await scan(12,1,'2026-10-14T04:59:00Z',cutoff);
  await version(12,1,12,'2026-10-14T04:59:00Z',799);
  await scan(13,1,'2026-10-14T04:59:00Z',cutoff);
  await remove(3,13,'2026-10-14T04:59:00Z');
  const {catalog,health}=await read();
  assert.deepEqual(ids(catalog),[1,4]);assert.equal(Number(catalog[0].price_try),799);
  assert.equal(health[0].active_products,1);
  assert.equal((await loadDailyMobileCatalog(db,{start:cutoff,end:cutoff})).length,0,'old scan observations are not made fresh by a later completion');
});

test('ad comparisons keep the same verified price during concurrent scanning',async()=>{
  const brief=async()=>buildDailyBrief({period_start:range.start,period_end:cutoff,catalog_products:await loadDailyMobileCatalog(db,range),
    changes:[],sources:await sourceHealth(db,{cutoff}),daily_home:{fixed:{products:[],sources:[],changes:[]},fwa:{products:[],sources:[],changes:[]}},
    ad_report_data:{status:'complete',rows:[{event_type:'first_seen',observed_at:'2026-10-14T04:30:00Z',
      analysis_json:{ad_id:'123',title:'Plan 1',brand:'Telsim',source_url:'https://www.facebook.com/ads/library/?id=123',
        category:'gsm',offer:{price_try:899,billing_period:'monthly',commitment_months:0},uncertainties:[]}}]}});
  const before=await brief();
  assert.ok(before.ads[0]?.mismatch,'the fixture must exercise an actual ad/catalog price mismatch');
  await scan(12,1,'2026-10-14T04:59:00Z',null,'running');
  await db.exec("UPDATE products SET last_seen_at='2026-10-14T04:59:00Z',active=FALSE WHERE id=1");
  await version(12,1,12,'2026-10-14T04:59:00Z',899);
  assert.deepEqual(await brief(),before);
});
