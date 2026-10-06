import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {enrichDailyChanges,loadDailyMobileCatalog} from '../src/daily-brief-evidence.js';

let db;
const at='2026-10-06T07:00:00.000Z';
const mobile={id:1,source_id:1,source_slug:'mobile-a',product_id:1,scan_id:12,event_version_id:12,detected_at:at,
  change_type:'field_changed',field_name:'Data',old_value:'20',new_value:'15',product_name:'Original mobile'};
const home={id:10,source_slug:'home-a',provider:'ISP A',product_key:'home-a|plan',scan_id:103,detected_at:at,
  change_type:'field_changed',field_name:'Download Hızı',old_value:'20',new_value:'40',product_name:'Original home'};

async function homeScan(scanId,source,when,status,products,campaigns=[]){
  return db.query(`INSERT INTO home_internet_scans(id,source_slug,provider,source_name,source_url,captured_at,status,payload_json,source_meta_json)
    VALUES($1,$2,'ISP A','Packages','https://example.test/plans',$3,$4,$5::jsonb,$6::jsonb)`,
  [scanId,source,when,status,JSON.stringify(products),JSON.stringify({parser_version:'home-isp-2',campaigns})]);
}
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query(`INSERT INTO sources(id,slug,name,url) VALUES(1,'mobile-a','Mobile A','https://example.test/mobile-a'),(2,'mobile-b','Mobile B','https://example.test/mobile-b')`);
  await db.query(`INSERT INTO scans(id,source_id,started_at,status) VALUES
    (11,1,'2026-10-05T07:00:00Z','ok'),(12,1,$1,'ok'),(13,1,'2026-10-06T08:00:00Z','ok'),(21,2,$1,'ok')`,[at]);
  await db.query(`INSERT INTO products(id,source_id,identity_base,current_name,first_seen_at,last_seen_at) VALUES
    (1,1,'original','Renamed today',$1,$1),(2,2,'other-source','Other source',$1,$1),(3,1,'fresh','No prior version',$1,$1)`,[at]);
  await db.query(`INSERT INTO product_versions(id,product_id,scan_id,captured_at,name,data_gb,bonus_data_gb,price_try,validity_days,extras_json,raw_text,product_hash) VALUES
    (11,1,11,'2026-10-05T07:00:00Z','Original mobile',20,5,500,30,'["Gift included"]','private raw previous','old'),
    (12,1,12,$1,'Original mobile',15,0,500,30,'["Gift removed"]','private raw event','event'),
    (13,1,13,'2026-10-06T08:00:00Z','Renamed today',100,50,900,90,'["Future gift"]','private future','future'),
    (21,2,21,$1,'Other source',99,99,999,99,'[]','private other','other'),
    (14,3,12,$1,'No prior version',10,0,200,30,'[]','private fresh','fresh')`,[at]);
  const old={source_slug:'home-a',product_key:home.product_key,name:'Original home',speed_down_mbps:20,price_monthly_try:300,
    effective_monthly_try:300,total_price_try:3600,duration_months:12,bonus_months:0,unlimited:true,raw_text:'private home raw',internal:{secret:true}};
  const removed={...old,product_key:'home-a|removed',name:'Removed home'};
  const offer={...old,product_key:'home-a|campaign|spring',name:'Season offer',availability:'active',expires_at:'2026-10-07',campaign_text:'A one-month gift'};
  await homeScan(101,'home-a','2026-10-05T07:00:00Z','ok',[old,removed],[offer]);
  await homeScan(102,'home-a','2026-10-06T06:00:00Z','error',[{...old,speed_down_mbps:999,price_monthly_try:1}]);
  await homeScan(103,'home-a',at,'ok',[{...old,speed_down_mbps:40,contract_required:true,contract_months:12,commitment_months:12},{...old,product_key:'home-a|added',name:'New home',price_monthly_try:600}],
    [{...offer,expires_at:'2026-10-08'}]);
  await homeScan(104,'home-a','2026-10-06T08:00:00Z','ok',[{...old,name:'Future home',speed_down_mbps:500,price_monthly_try:900}]);
  await homeScan(105,'home-b',at,'ok',[{...old,source_slug:'home-b',price_monthly_try:999}]);
  await homeScan(106,'fresh-home',at,'ok',[{...old,source_slug:'fresh-home',product_key:'fresh-home|plan'}]);
});
after(async()=>{await db?.close()});

test('mobile benefits and unchanged price come from the original event and its predecessor, never today',async()=>{
  const {changes}=await enrichDailyChanges(db,{changes:[mobile]});
  const row=changes[0];
  assert.equal(row.product_before.price_try,row.product_after.price_try);
  assert.equal(Number(row.product_after.price_try),500);
  assert.equal(Number(row.product_before.data_gb),20);assert.equal(Number(row.product_after.data_gb),15);
  assert.equal(row.product_after.name,'Original mobile');
  assert.equal(row.first_seen_at,at);assert.equal(row.product_after.verified_at,at);
  assert.equal(row.product_before.verified_at,'2026-10-05T07:00:00.000Z');
  assert.deepEqual(row.product_before.extras_json,['Gift included']);assert.deepEqual(row.product_after.extras_json,['Gift removed']);
  assert.equal('raw_text' in row.product_before,false);assert.equal('product_hash' in row.product_after,false);
  assert.equal('product_before' in mobile,false,'the caller and historical records are not rewritten');
  assert.equal((await db.query('SELECT raw_text FROM product_versions WHERE id=12')).rows[0].raw_text,'private raw event');
});

test('mobile event ID, product, source, scan and detected time must all agree',async()=>{
  const inputs=[
    {...mobile,event_version_id:11}, // loadCompetitiveChanges can return an older fallback version.
    {...mobile,event_version_id:13}, // same product but a future scan is not this event.
    {...mobile,event_version_id:21},
    {...mobile,source_slug:'mobile-b'},
    {...mobile,source_id:2},
    {...mobile,scan_id:21},
    {...mobile,detected_at:'2026-10-06T06:59:59Z'},
    {...mobile,change_type:'removed',event_version_id:11,old_value:'Original mobile',new_value:null}
  ];
  const {changes}=await enrichDailyChanges(db,{changes:inputs});
  assert.deepEqual(changes,inputs,'uncertain rows survive with no fabricated evidence');
  const exact=await enrichDailyChanges(db,{changes:[{...mobile,event_version_id:null}]});
  assert.equal(Number(exact.changes[0].product_after.price_try),500,'exact scan is usable when a legacy row lacks version ID');
});

test('missing or incompatible mobile baseline does not imply zero or an unchanged price',async()=>{
  const fresh={...mobile,product_id:3,event_version_id:14,old_value:'5',new_value:'10'};
  const {changes}=await enrichDailyChanges(db,{changes:[fresh,{...mobile,old_value:'999'}, {...mobile,new_value:'999'}]});
  assert.equal('product_before' in changes[0],false);assert.equal(Number(changes[0].product_after.price_try),200);
  assert.equal('product_before' in changes[1],false,'an unrelated baseline cannot prove this recorded change');
  assert.equal('product_after' in changes[2],false,'a mismatched current snapshot cannot prove this recorded change');
});

test('home evidence skips failed scans and uses the immediately previous successful source scan',async()=>{
  const {homeChanges}=await enrichDailyChanges(db,{homeChanges:[home]});
  const row=homeChanges[0];
  assert.equal(row.product_before.price_monthly_try,row.product_after.price_monthly_try);
  assert.equal(row.product_after.price_monthly_try,300);
  assert.equal(row.product_before.speed_down_mbps,20);assert.equal(row.product_after.speed_down_mbps,40);
  assert.equal(row.product_after.name,'Original home');
  assert.equal(row.product_after.verified_at,at);assert.equal(row.product_before.verified_at,'2026-10-05T07:00:00.000Z');
  assert.equal(row.product_after.contract_required,true);assert.equal(row.product_after.contract_months,12);assert.equal(row.product_after.commitment_months,12);
  assert.equal('contract_months' in row.product_before,false,'payment duration must not be promoted to contract evidence');
  assert.equal('raw_text' in row.product_before,false);assert.equal('internal' in row.product_after,false);
  assert.equal('product_before' in home,false);
});

test('home source, exact event time and product identity are required; later and other-source evidence never leaks',async()=>{
  const inputs=[{...home,scan_id:105},{...home,scan_id:104}, {...home,source_slug:'home-b'},
    {...home,product_key:'missing'}, {...home,detected_at:'2026-10-06T06:59:59Z'}, {...home,scan_id:102}];
  const {homeChanges}=await enrichDailyChanges(db,{homeChanges:inputs});
  assert.deepEqual(homeChanges,inputs);
});

test('home campaign dates and added/removed products have only the genuinely recorded sides',async()=>{
  const added={...home,product_key:'home-a|added',change_type:'added'};
  const removed={...home,product_key:'home-a|removed',change_type:'removed'};
  const campaign={...home,product_key:'home-a|campaign|spring',field_name:'Kampanya bitişi',old_value:'2026-10-07',new_value:'2026-10-08'};
  const {homeChanges:[a,r,c]}=await enrichDailyChanges(db,{homeChanges:[added,removed,campaign]});
  assert.equal('product_before' in a,false);assert.equal(a.product_after.name,'New home');
  assert.equal(r.product_before.name,'Removed home');assert.equal('product_after' in r,false);
  assert.equal(c.product_before.expires_at,'2026-10-07');assert.equal(c.product_after.expires_at,'2026-10-08');
  assert.equal(c.product_after.campaign_text,'A one-month gift');assert.equal('raw_text' in c.product_after,false);
});

test('home missing previous snapshots and mismatched recorded values are unknown, never invented',async()=>{
  const fresh={...home,source_slug:'fresh-home',scan_id:106,product_key:'fresh-home|plan',new_value:'20'};
  const {homeChanges:[row,mismatch]}=await enrichDailyChanges(db,{homeChanges:[fresh,{...home,old_value:'999'}]});
  assert.equal('product_before' in row,false);assert.equal(row.product_after.price_monthly_try,300);
  assert.equal('product_before' in mismatch,false);assert.equal(mismatch.product_after.speed_down_mbps,40);
});

test('hundreds of fields share two bounded read queries and all rows remain in their original order',async()=>{
  const queries=[];const pool={query:async(sql,params)=>{queries.push({sql,params});return db.query(sql,params)}};
  const changes=Array.from({length:250},(_,i)=>({...mobile,id:i+1}));
  const homeChanges=Array.from({length:250},(_,i)=>({...home,id:i+1}));
  const result=await enrichDailyChanges(pool,{changes,homeChanges});
  assert.equal(queries.length,2);assert.ok(queries.every(q=>JSON.parse(q.params[0]).length===1),'events are deduplicated before querying');
  assert.deepEqual(result.changes.map(x=>x.id),changes.map(x=>x.id));
  assert.deepEqual(result.homeChanges.map(x=>x.id),homeChanges.map(x=>x.id));
  assert.ok(result.changes.every(x=>x.product_after));assert.ok(result.homeChanges.every(x=>x.product_after));
});

test('empty or malformed legacy identity does not query or discard records',async()=>{
  const rows=[{...mobile,product_id:null},{...mobile,scan_id:'invalid'},{...mobile,detected_at:'invalid'}];
  const homeRows=[{...home,scan_id:null},{...home,detected_at:'invalid'}];
  const pool={query(){throw new Error('No query expected')}};
  assert.deepEqual(await enrichDailyChanges(pool,{changes:rows,homeChanges:homeRows}),{changes:rows,homeChanges:homeRows});
  assert.deepEqual(await enrichDailyChanges(pool),{changes:[],homeChanges:[]});
});

test('daily mobile catalogue returns every fresh active product with the latest observed version before the report cutoff',async()=>{
  const catalog=await loadDailyMobileCatalog(db,{start:'2026-10-05T07:30:00Z',end:'2026-10-06T07:30:00Z'});
  assert.deepEqual(catalog.map(x=>Number(x.product_id)),[1,3,2]);
  const product=catalog.find(x=>Number(x.product_id)===1);
  assert.equal(product.name,'Original mobile');assert.equal(Number(product.price_try),500,'the future version is excluded');
  assert.equal(product.brand,'Telsim');assert.equal(product.provider,'Telsim');assert.equal(product.source_url,'https://example.test/mobile-a');
  assert.equal(product.id,product.product_id);assert.equal(product.verified_at,at);assert.equal(product.first_seen_at,at);
  assert.equal('raw_text' in product,false);assert.equal('product_hash' in product,false);assert.equal('contract_months' in product,false);
});

test('daily catalogue does not fall back to older success when the latest source check failed',async()=>{
  await db.query("INSERT INTO scans(id,source_id,started_at,status) VALUES(15,1,'2026-10-06T07:05:00Z','error')");
  try{
    const catalog=await loadDailyMobileCatalog(db,{start:'2026-10-05T07:30:00Z',end:'2026-10-06T07:30:00Z'});
    assert.deepEqual(catalog.map(x=>Number(x.product_id)),[2]);
  }finally{await db.query('DELETE FROM scans WHERE id=15')}
});

test('daily catalogue requires observed-in-window active products and a finished-in-window source check',async()=>{
  const range={start:'2026-10-05T07:30:00Z',end:'2026-10-06T07:30:00Z'};
  try{
    await db.query("UPDATE products SET last_seen_at='2026-10-05T07:00:00Z' WHERE id=3");
    assert.deepEqual((await loadDailyMobileCatalog(db,range)).map(x=>Number(x.product_id)),[1,2]);
    await db.query("UPDATE products SET last_seen_at='2026-10-06T08:00:00Z' WHERE id=1");
    assert.deepEqual((await loadDailyMobileCatalog(db,range)).map(x=>Number(x.product_id)),[2]);
    await db.query('UPDATE products SET active=FALSE WHERE id=2');
    assert.deepEqual(await loadDailyMobileCatalog(db,range),[]);
    await db.query('UPDATE products SET active=TRUE,last_seen_at=$1',[at]);
    await db.query("UPDATE scans SET finished_at='2026-10-06T08:00:00Z' WHERE id=12");
    assert.deepEqual((await loadDailyMobileCatalog(db,range)).map(x=>Number(x.product_id)),[2]);
  }finally{
    await db.query('UPDATE products SET active=TRUE,last_seen_at=$1',[at]);
    await db.query('UPDATE scans SET finished_at=NULL WHERE id=12');
  }
  await assert.rejects(loadDailyMobileCatalog(db,{start:'invalid',end:at}),RangeError);
});
