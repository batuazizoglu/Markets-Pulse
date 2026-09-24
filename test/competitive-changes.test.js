import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {competitiveWindow,loadCompetitiveChanges} from '../src/competitive-changes.js';
import {buildMarketPulse,marketPulseFromRows} from '../src/intelligence.js';
import {buildReportContext} from '../src/report-data.js';
import {collectMonthlyData} from '../src/monthly-report-data.js';

const end=new Date('2030-07-02T09:00:00.000Z'),window=competitiveWindow(7,end);
const eventAt=new Date(+end-3600000),latestAt=new Date(+end-60000);
let db;
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query("INSERT INTO sources(id,slug,name,url) VALUES(1,'test-mobile','Telsim Test','https://synthetic.example/')");
  await db.query("INSERT INTO scans(id,source_id,started_at,status) VALUES(1,1,$1,'ok'),(2,1,$2,'ok'),(3,1,$3,'ok')",[eventAt,new Date(+end+3600000),latestAt]);
  await db.query(`INSERT INTO products(id,source_id,identity_base,current_name,first_seen_at,last_seen_at)
    SELECT n,1,'future tourist eSIM','Future Tourist '||n,$1,$2 FROM generate_series(1,81) n`,[eventAt,end]);
  await db.query(`INSERT INTO product_versions(product_id,scan_id,captured_at,name,extras_json,product_hash)
    SELECT n,1,$1,'Historical package '||n,'{"detail":"Generic package"}'::jsonb,'historical-'||n FROM generate_series(1,81) n`,[eventAt]);
  await db.query(`INSERT INTO product_versions(product_id,scan_id,captured_at,name,extras_json,product_hash)
    SELECT n,2,$1,'Future Tourist '||n,'{"detail":"Numara taşıma"}'::jsonb,'future-'||n FROM generate_series(1,81) n`,[new Date(+end+3600000)]);
  await db.query(`INSERT INTO changes(source_id,product_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity)
    SELECT 1,p,1,$1,'field_changed','Field '||f,'100','101','high' FROM generate_series(1,80) p CROSS JOIN generate_series(1,12) f`,[eventAt]);
  await db.query(`INSERT INTO changes(source_id,product_id,scan_id,detected_at,change_type,old_value,new_value,severity)
    VALUES(1,1,1,$1,'added',NULL,'Historical package 1','critical'),(1,2,1,$1,'removed','Historical package 2',NULL,'critical')`,[eventAt]);
  await db.query(`INSERT INTO changes(source_id,product_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity)
    VALUES(1,81,3,$1,'field_changed','Fiyat','499','599','critical')`,[latestAt]);
  await db.query(`INSERT INTO changes(source_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity)
    VALUES(1,1,$1,'added',NULL,NULL,'Legacy added package','critical'),
      (1,1,$1,'removed',NULL,'Legacy removed package',NULL,'critical'),
      (1,1,$1,'field_changed','Paket Adı','Legacy old name','Legacy renamed package','medium')`,[eventAt]);
  for(const [time,label] of [[window.window_start,'At start'],[new Date(+new Date(window.window_start)-1),'Before start'],[end,'At end'],[new Date(+end+1),'Future']]){
    await db.query("INSERT INTO changes(source_id,scan_id,detected_at,change_type,new_value,severity) VALUES(1,1,$1,'added',$2,'critical')",[time,label]);
  }
});
after(async()=>db?.close());

test('canonical timeline and intelligence contain all fields and complete groups beyond legacy row and move limits',async()=>{
  const timeline=await loadCompetitiveChanges(db,{start:window.window_start,end});
  const market=await buildMarketPulse(db,7,end);
  assert.equal(timeline.length,967);
  assert.deepEqual(market.changes,timeline);
  assert.equal(market.change_count,timeline.length);
  assert.equal(market.move_count,85);
  assert.equal(market.moves.length,market.move_count);
  assert.equal(market.moves.reduce((n,move)=>n+move.changes.length,0),market.change_count);
  assert.deepEqual(market.moves.flatMap(move=>move.changes.map(change=>String(change.id))).sort(),timeline.map(change=>String(change.id)).sort());
  assert.equal(market.moves.find(move=>Number(move.product_id)===1).changes.length,13);
  assert.equal(market.moves.find(move=>Number(move.product_id)===2).changes.length,13);
  const latest=market.moves[0];
  assert.equal(latest.product_name,'Historical package 81');
  assert.equal(latest.decision,'NO_REACTION');
  assert.ok(!market.top_threats.some(move=>move.key===latest.key));
  assert.equal(market.top_threats.length,8);
  assert.ok(market.moves.some(move=>move.changes.some(change=>change.change_type==='added')));
  assert.ok(market.moves.some(move=>move.changes.some(change=>change.change_type==='removed')));
});

test('a frozen inclusive-start/exclusive-end window bounds rows, counts and generated timestamps consistently',async()=>{
  const market=await buildMarketPulse(db,7,end),names=new Set(market.changes.map(change=>change.product_name));
  assert.ok(names.has('At start'));
  for(const name of ['Before start','At end','Future'])assert.ok(!names.has(name),name);
  assert.equal(market.window_start,window.window_start);
  assert.equal(market.window_end,end.toISOString());
  assert.equal(market.generated_at,end.toISOString());
  assert.equal(market.window_days,7);
  const bounded=await loadCompetitiveChanges(db,{end,limit:10});
  assert.equal(bounded.length,10);
  assert.equal(competitiveWindow(999,end).window_days,180);
  assert.equal(competitiveWindow(0,end).window_days,30);
});

test('historical names and extras match the event version, including exact-time versions and legacy name fallbacks',async()=>{
  const rows=await loadCompetitiveChanges(db,{start:window.window_start,end});
  const product=rows.find(row=>Number(row.product_id)===3);
  assert.equal(product.product_name,'Historical package 3');
  assert.deepEqual(product.extras_json,{detail:'Generic package'});
  assert.ok(product.event_version_id);
  const market=marketPulseFromRows(rows,7,end),move=market.moves.find(row=>Number(row.product_id)===3);
  assert.equal(move.segment,'Genel');assert.equal(move.intent,'Defend');
  for(const name of ['Legacy added package','Legacy removed package','Legacy renamed package'])assert.ok(rows.some(row=>row.product_name===name));
  const monthly=await collectMonthlyData(db,window.window_start,end);
  assert.deepEqual(monthly.changes,rows);
});

test('group keys do not merge orphaned changes with product IDs and priority ties use newest event then stable key',()=>{
  const at=new Date(+end-1000).toISOString(),older=new Date(+end-2000).toISOString();
  const rows=[
    {id:1,scan_id:1,product_id:null,detected_at:at,product_name:'Orphan',change_type:'added',severity:'critical'},
    {id:2,scan_id:1,product_id:1,detected_at:at,product_name:'Product',change_type:'added',severity:'critical'},
    {id:3,scan_id:2,product_id:1,detected_at:older,product_name:'Older',change_type:'added',severity:'critical'}
  ];
  const first=marketPulseFromRows(rows,7,end),second=marketPulseFromRows([...rows].reverse(),7,end);
  assert.equal(first.move_count,3);
  assert.deepEqual(first,second);
  assert.equal(first.top_threats.at(-1).product_name,'Older');
});

test('daily, weekly and monthly reports derive analysis and statistics from one canonical change query',async()=>{
  const loaders={currentBenchmark:async()=>({overall_score:null,segment_scores:[]}),sourceHealth:async()=>[],getHomeInternetMarket:async()=>({products:[],sources:[],changes:[],opportunities:[]})};
  for(const type of ['daily','weekly','monthly']){
    let mobileReads=0;
    const pool={query(sql,args){if(/FROM changes c\b/.test(sql))mobileReads++;return db.query(sql,args)}};
    const ctx=await buildReportContext(pool,type,{now:end},loaders);
    assert.equal(mobileReads,1,type);
    assert.equal(ctx.stats.total,ctx.market.change_count,type);
    assert.deepEqual(ctx.changes,ctx.market.changes,type);
    assert.equal(ctx.market.moves.reduce((n,move)=>n+move.changes.length,0),ctx.stats.total,type);
    assert.equal(ctx.period_start,ctx.market.window_start,type);
    assert.equal(ctx.period_end,ctx.market.window_end,type);
    assert.equal(ctx.generated_at,ctx.market.generated_at,type);
    const dashboard=await buildMarketPulse(db,ctx.days,end);
    assert.deepEqual(ctx.market,dashboard,type);
  }
});
