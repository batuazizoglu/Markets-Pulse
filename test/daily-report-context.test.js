import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {buildReportContext,sourceHealth} from '../src/report-data.js';

test('daily context freezes all change windows and preserves dated campaigns and event-time families',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const end='2026-10-06T05:00:00.000Z',start='2026-10-05T05:00:00.000Z';
  let homeOptions,sourceOptions;
  const changed={id:1,product_key:'historical-fwa',product_name:'Red Box',product_family:'fwa',source_slug:'legacy-source',change_type:'field_changed',field_name:'Aylık fiyat',old_value:'800',new_value:'900',detected_at:'2026-10-05T10:00:00.000Z'};
  const loaders={
    currentBenchmark:async()=>({overall_score:{segment:'Toplam',score:null},segment_scores:[]}),
    sourceHealth:async(_,options)=>{sourceOptions=options;return []},
    getHomeInternetMarket:async(_,options)=>{
      homeOptions=options;
      return {products:[{product_key:changed.product_key,product_family:'fixed'}],sources:[],changes:[changed,{...changed,id:2,detected_at:end}],campaigns:[
        {product_key:'fixed-campaign',name:'Sabit kampanya',expires_at:'2026-10-08',product_family:'fixed'},
        {product_key:'fwa-campaign',name:'Superbox kampanyası',expires_at:'2026-10-07',product_family:'fwa'}]};
    }
  };
  try{
    const ctx=await buildReportContext(db,'daily',{now:end},loaders);
    assert.equal(homeOptions.refresh,false);assert.equal(homeOptions.days,1);assert.equal(new Date(homeOptions.now).toISOString(),end);
    assert.equal(new Date(sourceOptions.cutoff).toISOString(),end,'source readiness uses the exact same report cutoff');
    assert.equal(ctx.period_start,start);assert.equal(ctx.period_end,end);
    assert.deepEqual(ctx.daily_changes,[]);assert.deepEqual(ctx.changes,ctx.market.changes);
    assert.equal(ctx.daily_home.fixed.changes.length,0,'current catalogue family cannot overwrite the historical family');
    assert.deepEqual(ctx.daily_home.fwa.changes.map(x=>x.id),[1],'exclusive end is respected');
    assert.equal(ctx.daily_home.fixed.campaigns[0].expires_at,'2026-10-08');
    assert.equal(ctx.daily_home.fwa.campaigns[0].expires_at,'2026-10-07');
    assert.deepEqual(ctx.ad_report_data.rows,[]);assert.equal(ctx.ad_report_data.status,'pending');
  }finally{await db.close()}
});

test('daily source health ignores unfinished and future checks but retains the latest completed failure',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const cutoff='2026-10-14T05:00:00.000Z';
  const add=async(id,started,finished,status,error=null)=>db.query(
    'INSERT INTO scans(source_id,started_at,finished_at,status,http_status,parsed_count,error) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,started,finished,status,status==='error'?503:status==='ok'?200:null,status==='ok'?12:0,error]);
  try{
    for(let id=1;id<=5;id++)await db.query('INSERT INTO sources(id,slug,name,url) VALUES($1,$2,$3,$4)',[id,'source-'+id,'Source '+id,'https://example.com/'+id]);
    await add(1,'2026-10-14T04:00:00Z','2026-10-14T04:01:00Z','ok');
    await add(1,cutoff,null,'running');
    await add(2,'2026-10-14T03:00:00Z','2026-10-14T03:01:00Z','ok');
    await add(2,'2026-10-14T04:00:00Z','2026-10-14T04:01:00Z','error','Known source failure');
    await add(2,cutoff,null,'running');
    await add(3,'2026-10-14T04:59:00Z','2026-10-14T05:00:01Z','ok');
    await add(3,'2026-10-14T05:01:00Z','2026-10-14T05:02:00Z','ok');
    await add(4,'2026-10-12T03:00:00Z','2026-10-12T03:01:00Z','ok');
    await add(5,'2026-10-14T04:59:00Z',cutoff,'ok');
    const rows=await sourceHealth(db,{cutoff});
    assert.equal(rows.length,5);
    assert.equal(rows[0].last_status,'ok');
    assert.equal(new Date(rows[0].last_checked_at).toISOString(),'2026-10-14T04:00:00.000Z');
    assert.equal(rows[1].last_status,'error','a completed failure must not be replaced with an older success');
    assert.equal(rows[1].last_error,'Known source failure');assert.equal(rows[1].http_status,503);
    assert.equal(new Date(rows[1].last_success_at).toISOString(),'2026-10-14T03:00:00.000Z');
    assert.equal(rows[2].last_status,null,'a check finishing after the cutoff is not completed in this report');
    assert.equal(rows[2].last_checked_at,null);assert.equal(rows[2].last_success_at,null);
    assert.equal(new Date(rows[3].last_checked_at).toISOString(),'2026-10-12T03:00:00.000Z','old evidence keeps its actual age for freshness checks');
    assert.equal(rows[4].last_status,'ok','a check finishing exactly at the cutoff is complete');
    const legacy=await sourceHealth(db);
    assert.equal(legacy[0].last_status,'running','non-daily callers retain current-status behavior');
    assert.equal(legacy[2].last_status,'ok');
  }finally{await db.close()}
});
