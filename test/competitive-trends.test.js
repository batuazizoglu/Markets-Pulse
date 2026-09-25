import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {buildCompetitiveTrends,competitiveTrendsFromRows} from '../src/competitive-trends.js';

let db;
const now='2026-09-25T21:00:00.000Z',start='2026-09-22T21:00:00.000Z',previousStart='2026-09-19T21:00:00.000Z';
before(async()=>{db=new PGlite();await db.exec(SCHEMA_SQL);});
after(async()=>{await db.close();});
beforeEach(async()=>{
  await db.exec('TRUNCATE sources RESTART IDENTITY CASCADE');
  await db.query("INSERT INTO sources(id,slug,name,url,enabled) VALUES(1,'mobile','Mobil','https://example.test/mobile',true),(2,'prepaid','Faturasız','https://example.test/prepaid',true),(3,'archived','Arşiv','https://example.test/archived',false)");
});
async function scan(source,at,status='ok'){
  return (await db.query('INSERT INTO scans(source_id,started_at,finished_at,status) VALUES($1,$2,$2,$3) RETURNING id',[source,at,status])).rows[0].id;
}
async function product({name='Paket',source=1,active=true,first='2026-09-01T09:00:00Z',last='2026-09-25T18:00:00Z'}={}){
  return (await db.query('INSERT INTO products(source_id,identity_base,current_name,first_seen_at,last_seen_at,active) VALUES($1,$2,$2,$3,$4,$5) RETURNING id',[source,name,first,last,active])).rows[0].id;
}
async function version(id,at,{name='Paket',data=10,price=100,days=30,bonus=0,source=1}={}){
  const scanId=await scan(source,at);
  return (await db.query('INSERT INTO product_versions(product_id,scan_id,captured_at,name,data_gb,price_try,validity_days,bonus_data_gb,product_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[id,scanId,at,name,data,price,days,bonus,JSON.stringify([at,name,data,price,days,bonus])])).rows[0].id;
}
async function change(id,at,{scanId=null,source=1,type='field_changed',field='Fiyat',old='100',next='90'}={}){
  scanId??=await scan(source,at);
  await db.query('INSERT INTO changes(source_id,product_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'high\')',[source,id,scanId,at,type,field,old,next]);
  return scanId;
}
const build=()=>buildCompetitiveTrends(db,{days:3,now});

test('bulk SQL uses equal adjacent periods and groups fields into moves with complete daily source coverage',async()=>{
  for(const day of [20,21,22,23,24,25])for(const source of [1,2])await scan(source,`2026-09-${day}T09:00:00Z`);
  const id=await product({name:'Super Cool Uni 10'}),added=await product({name:'Yeni paket'});
  await change(id,previousStart,{old:'100',next:'120'});
  const sharedScan=await change(id,start,{old:'120',next:'100'});
  await change(id,start,{scanId:sharedScan,field:'Data',old:'10',next:'20'});
  await change(id,'2026-09-24T09:00:00Z',{old:'100',next:'90'});
  await change(added,'2026-09-25T09:00:00Z',{type:'added',field:null,old:null,next:'Yeni paket'});
  await change(id,'2026-09-19T20:59:59.999Z');
  await change(id,now);await change(id,'2026-09-25T21:01:00Z');
  const queries=[];const pool={query(sql,values){queries.push(sql);return db.query(sql,values);}};
  const result=await buildCompetitiveTrends(pool,{days:3,now});
  assert.equal(queries.length,5);assert.ok(queries.every(sql=>/^SELECT\s/.test(sql)));
  assert.equal(result.window_start,start);assert.equal(result.previous_start,previousStart);assert.equal(result.previous_end,start);
  assert.equal(+new Date(result.window_end)-+new Date(result.window_start),+new Date(result.previous_end)-+new Date(result.previous_start));
  assert.equal(result.summary.move_count,3);assert.equal(result.summary.previous_move_count,1);
  assert.equal(result.summary.affected_packages,2);assert.equal(result.summary.added_count,1);assert.equal(result.summary.change_pct,200);
  assert.equal(result.coverage.comparable,true);assert.equal(result.coverage.current.source_count,2);
  assert.deepEqual(result.activity.map(row=>[row.date,row.move_count]),[['2026-09-23',1],['2026-09-24',1],['2026-09-25',1]]);
  assert.ok(result.activity.every(row=>row.observed&&!row.partial));
  const directions=Object.fromEntries(result.directions.map(row=>[row.key,row.count]));
  assert.equal(directions.price_decrease,2);assert.equal(directions.data_increase,1);assert.equal(directions.added,1);
  assert.equal(result.price.sample_size,2);assert.equal(result.price.increases,0);assert.equal(result.price.reductions,2);
  assert.equal(result.price.median_change_pct,-13.33);
  assert.deepEqual(result.segments.find(row=>row.name==='Öğrenci / Genç'),{name:'Öğrenci / Genç',current:2,previous:1,priority_count:2});
  assert.ok(result.insights.some(row=>row.title==='Fiyat hareketlerinin yönü'));
});

test('failed, missing and partial scan days are gaps, and incomplete periods never claim percentage growth',async()=>{
  await scan(1,'2026-09-23T08:00:00Z');await scan(2,'2026-09-23T08:00:00Z','error');
  await scan(1,'2026-09-24T08:00:00Z','error');await scan(2,'2026-09-24T08:00:00Z','error');
  await scan(1,'2026-09-25T08:00:00Z');await scan(2,'2026-09-25T08:00:00Z');
  await scan(1,'2026-08-01T08:00:00Z');
  const result=await build();
  assert.deepEqual(result.activity.map(row=>[row.move_count,row.observed,row.partial]),[[0,true,true],[null,false,false],[0,true,false]]);
  assert.equal(result.coverage.current.observed_days,2);assert.equal(result.coverage.current.fully_observed_days,1);
  assert.equal(result.coverage.current.expected_days,3);assert.equal(result.coverage.current.complete,false);
  assert.equal(result.coverage.first_observed_at,'2026-08-01T08:00:00.000Z');
  assert.equal(result.summary.move_count,0);assert.equal(result.summary.previous_move_count,null);assert.equal(result.summary.change_pct,null);
  assert.equal(result.price.median_change_pct,null);
});

test('known events survive absent successful scans and disabled sources without turning unknown days into zero',async()=>{
  const id=await product({source:3});
  const failed=await scan(3,'2026-09-24T08:00:00Z','error');await change(id,'2026-09-24T08:00:00Z',{source:3,scanId:failed});
  const result=await build();
  assert.equal(result.coverage.current.observed_days,0);assert.equal(result.coverage.comparable,false);
  assert.equal(result.summary.move_count,1);assert.equal(result.summary.previous_move_count,null);assert.equal(result.summary.change_pct,null);
  assert.equal(result.activity[0].move_count,null);
  assert.equal(result.activity[1].move_count,1);assert.equal(result.activity[1].observed,true);assert.equal(result.activity[1].scan_observed,false);assert.equal(result.activity[1].partial,true);
  assert.equal(result.activity[2].move_count,null);
  assert.equal(result.insights.filter(row=>/Dönem karşılaştırması sınırlı/.test(row.title)).length,0);
  assert.ok(result.insights.some(row=>row.title==='Paket listesindeki hareket'));
  assert.ok(result.insights.some(row=>row.title==='Hareketlerin yoğunlaştığı grup'));
});

test('same-package values use strict baselines, latest tied versions, base data and fresh sightings after a frozen endpoint',async()=>{
  const id=await product({name:'Değeri artan paket',last:'2026-09-26T09:00:00Z'});
  await version(id,'2026-09-20T09:00:00Z',{name:'Önce',data:10,price:100,bonus:100});
  await version(id,start,{name:'Başlangıç güncellemesi',data:20,price:100});
  await version(id,'2026-09-24T09:00:00Z',{name:'Eski eşzamanlı kayıt',data:20,price:100});
  await version(id,'2026-09-24T09:00:00Z',{name:'Güncel paket',data:30,price:100});
  await version(id,now,{data:999,price:1});await version(id,'2026-09-26T09:00:00Z',{data:1000,price:1});
  const unchanged=await product({name:'Değişmeyen paket'});await version(unchanged,'2026-09-01T09:00:00Z');
  const bonusOnly=await product({name:'Bonus paketi'});await version(bonusOnly,'2026-09-01T09:00:00Z',{bonus:1});await version(bonusOnly,'2026-09-24T10:00:00Z',{bonus:100});
  const zero=await product({name:'Sıfır başlangıç'});await version(zero,'2026-09-01T09:00:00Z',{data:0});await version(zero,'2026-09-24T11:00:00Z',{data:10});
  const toZero=await product({name:'Sıfıra düşüş'});await version(toZero,'2026-09-01T09:00:00Z',{data:10});await version(toZero,'2026-09-24T12:00:00Z',{data:0});
  const result=await build();
  assert.equal(result.values.eligible_count,5);assert.equal(result.values.unchanged_count,2);assert.equal(result.values.changed_count,3);assert.equal(result.values.excluded_count,0);
  const row=result.values.rows.find(row=>row.product_id===id);
  assert.deepEqual(row,{product_id:id,name:'Güncel paket',source_url:'https://example.test/mobile',from_at:'2026-09-20T09:00:00.000Z',to_at:'2026-09-24T09:00:00.000Z',from_value:10,to_value:30,change_pct:200,from_price:100,to_price:100,validity_days:30});
  assert.equal(result.values.rows.find(row=>row.product_id===zero).change_pct,null);
  assert.equal(result.values.rows.find(row=>row.product_id===toZero).change_pct,-100);
});

test('frozen value eligibility survives removal after end and ignores reactivation after end',async()=>{
  const removedLater=await product({name:'Dönemden sonra kaldırılan'});
  await version(removedLater,'2026-09-20T09:00:00Z',{data:10});
  await version(removedLater,'2026-09-24T09:00:00Z',{data:20});
  const reactivatedLater=await product({name:'Dönemde kaldırılan',active:false,last:'2026-09-24T09:00:00Z'});
  await version(reactivatedLater,'2026-09-20T09:00:00Z',{data:10});
  await version(reactivatedLater,'2026-09-24T09:00:00Z',{data:20});
  await change(reactivatedLater,'2026-09-25T09:00:00Z',{type:'removed',field:null,old:'Dönemde kaldırılan',next:null});
  const before=await build();
  assert.deepEqual(before.values.rows.map(row=>row.product_id),[removedLater]);
  assert.equal(before.values.excluded_count,1);

  await change(removedLater,'2026-09-26T09:00:00Z',{type:'removed',field:null,old:'Dönemden sonra kaldırılan',next:null});
  await db.query('UPDATE products SET active=false WHERE id=$1',[removedLater]);
  await version(reactivatedLater,'2026-09-26T10:00:00Z',{data:50});
  await change(reactivatedLater,'2026-09-26T10:00:00Z',{type:'added',field:null,old:null,next:'Yeniden görülen paket'});
  await db.query('UPDATE products SET active=true,last_seen_at=$2 WHERE id=$1',[reactivatedLater,'2026-09-26T10:00:00Z']);
  const after=await build();
  assert.deepEqual(after.values,before.values,'Current flags, future sightings and future lifecycle events cannot change the frozen result');
});

test('endpoint lifecycle reads all prior removals, bounds sightings, and lets removal win timestamp ties',async()=>{
  const atEnd=await product({name:'Tam dönem sonunda kaldırılan',active:false});
  await version(atEnd,'2026-09-20T09:00:00Z',{data:10});
  await version(atEnd,'2026-09-24T09:00:00Z',{data:20});
  await change(atEnd,now,{type:'removed',field:null,old:'Tam dönem sonunda kaldırılan',next:null});
  const tied=await product({name:'Eşzamanlı kaldırılan',last:'2026-09-24T09:00:00Z'});
  await version(tied,'2026-09-20T09:00:00Z',{data:10});
  await version(tied,'2026-09-24T09:00:00Z',{data:20});
  await change(tied,'2026-09-24T09:00:00Z',{type:'removed',field:null,old:'Eşzamanlı kaldırılan',next:null});
  const oldRemoval=await product({name:'Eski kaldırma',last:'2026-09-26T09:00:00Z'});
  await version(oldRemoval,'2026-09-01T09:00:00Z',{data:10});
  await change(oldRemoval,'2026-09-18T09:00:00Z',{type:'removed',field:null,old:'Eski kaldırma',next:null});
  await version(oldRemoval,'2026-09-26T09:00:00Z',{data:20});
  const observedAgain=await product({name:'Dönemde yeniden görülen',last:'2026-09-25T18:00:00Z'});
  await version(observedAgain,'2026-09-20T09:00:00Z',{data:10});
  await version(observedAgain,'2026-09-24T08:00:00Z',{data:20});
  await change(observedAgain,'2026-09-24T09:00:00Z',{type:'removed',field:null,old:'Dönemde yeniden görülen',next:null});
  await change(observedAgain,'2026-09-25T18:00:00Z',{type:'added',field:null,old:null,next:'Dönemde yeniden görülen'});
  const result=await build();
  assert.deepEqual(result.values.rows.map(row=>row.product_id),[atEnd,observedAgain]);
  assert.equal(result.values.eligible_count,2);assert.equal(result.values.excluded_count,2);
});

test('future unchanged sightings cannot add stale pairs or erase previously observed unchanged pairs',async()=>{
  const stale=await product({name:'Dönemde gözlenmeyen',source:3,last:'2026-09-20T09:00:00Z'});
  await version(stale,'2026-09-20T09:00:00Z',{source:3});
  const observed=await product({name:'Dönemde gözlenen değişmeyen',last:'2026-09-24T09:00:00Z'});
  await version(observed,'2026-09-20T09:00:00Z');
  await scan(1,'2026-09-24T09:00:00Z');
  const before=await build();
  assert.equal(before.values.eligible_count,1);assert.equal(before.values.unchanged_count,1);
  assert.equal(before.values.excluded_count,0);
  await scan(1,'2026-09-26T09:00:00Z');await scan(3,'2026-09-26T09:00:00Z');
  await db.query('UPDATE products SET last_seen_at=$1 WHERE id IN ($2,$3)',['2026-09-26T09:00:00Z',stale,observed]);
  const after=await build();
  assert.deepEqual(after.values,before.values,'Future-only source scans and overwritten product timestamps leave the frozen population unchanged');
});

test('new, removed, stale and invalid value pairs are excluded without assumed durations or unlimited values',async()=>{
  const cases=[
    {name:'Yeni',first:start,baseline:false},
    {name:'Baseline yok',baseline:false},
    {name:'Kaldırıldı',active:false},
    {name:'Süre değişti',before:{days:30},after:{days:15}},
    {name:'Süre yok',before:{days:null},after:{days:null}},
    {name:'Fiyat sıfır',before:{price:0}},
    {name:'Veri bilinmiyor',before:{data:null}},
    {name:'Negatif sınırsız işareti',before:{data:-1}},
    {name:'Sayı olmayan veri',before:{data:'NaN'}},
    {name:'Sonsuz fiyat',after:{price:'Infinity'}}
  ];
  for(const entry of cases){
    const id=await product(entry);
    if(entry.baseline!==false)await version(id,'2026-09-20T09:00:00Z',entry.before);
    await version(id,'2026-09-24T09:00:00Z',{data:20,...entry.after});
    if(entry.active===false)await change(id,'2026-09-25T20:00:00Z',{type:'removed',field:null,old:entry.name,next:null});
  }
  const stale=await product({name:'Eski gözlem',source:3,last:'2026-09-20T09:00:00Z'});await version(stale,'2026-09-19T09:00:00Z',{source:3});await version(stale,'2026-09-20T09:00:00Z',{data:20,source:3});
  const result=await build();
  assert.deepEqual(result.values,{rows:[],eligible_count:0,excluded_count:cases.length,unchanged_count:0,changed_count:0});
});

test('rolling periods keep Famagusta dates correct through DST and never divide by an empty previous count',()=>{
  const result=competitiveTrendsFromRows({sources:[{id:1,enabled:true}],scans:[
    {source_id:1,started_at:'2026-10-24T21:30:00Z',status:'ok'},
    {source_id:1,started_at:'2026-10-25T21:30:00Z',status:'ok'},
    {source_id:1,started_at:'2026-10-25T22:30:00Z',status:'ok'}
  ]},{days:2,now:'2026-10-26T10:00:00Z'});
  assert.deepEqual(result.activity.map(row=>row.date),['2026-10-24','2026-10-25','2026-10-26']);
  assert.deepEqual(result.activity.map(row=>row.move_count),[null,0,0]);
  assert.equal(result.coverage.current.expected_days,3);
  assert.equal(result.window_start,'2026-10-24T10:00:00.000Z');
  assert.equal(result.summary.change_pct,null);
  const empty=competitiveTrendsFromRows({},{days:7,now});
  assert.equal(empty.summary.move_count,null);assert.equal(empty.summary.change_pct,null);
  assert.ok(empty.activity.every(day=>day.move_count===null));
});
