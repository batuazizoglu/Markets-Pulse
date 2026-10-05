import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {competitiveWindow} from '../src/competitive-changes.js';
import {getHomeInternetMarket,loadHomeInternetChanges,marketPayload} from '../src/home-internet.js';

const now=new Date('2026-10-06T00:00:00.000Z'),day=86400000;
const at=days=>new Date(+now-days*day).toISOString();
let db;
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query(`INSERT INTO home_internet_scans(id,source_slug,provider,source_name,source_url,technology,ownership_group,captured_at,status,payload_json,source_meta_json)
    VALUES(1,'extend-wdsl','Extend','Recorded Extend source','https://example.com/old-packages','WDSL','Recorded owner',$1,'ok',$2::jsonb,$3::jsonb)`,[
    at(1),JSON.stringify([{product_key:'extend-wdsl|offer',name:'Historical offer',product_family:'fixed',technology:'Fiber',market_segment:'business',product_url:'https://example.com/old-offer'}]),JSON.stringify({parser_version:'home-isp-2',source_revision:2})]);
  // More than every former server/payload cap, including several fields from
  // the same scan and package. Every stored field is a separate feed row.
  await db.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,detected_at,change_type,field_name,old_value,new_value,scan_id)
    SELECT 'extend-wdsl','Extend','extend-wdsl|offer','Historical offer',$1,'field_changed','Aylık Ücret','900','950',1 FROM generate_series(1,620)`,[at(1)]);
  for(const [name,when] of [['seven-start',at(7)],['thirty-start',at(30)],['ninety-start',at(90)],['too-old',at(90.001)],['window-end',at(0)],['future',at(-1)]]){
    await db.query(`INSERT INTO home_internet_changes(source_slug,provider,product_name,detected_at,change_type)
      VALUES('extend-wdsl','Extend',$1,$2,'added')`,[name,when]);
  }
});
after(async()=>{await db?.close()});

test('7/30/90 day market history is complete, newest first, and uses inclusive start/exclusive end',async()=>{
  for(const [days,expected,names] of [[7,621,['seven-start']],[30,622,['seven-start','thirty-start']],[90,623,['seven-start','thirty-start','ninety-start']]]){
    const bounds=competitiveWindow(days,now),rows=await loadHomeInternetChanges(db,{start:bounds.window_start,end:bounds.window_end});
    assert.equal(rows.length,expected);
    assert.deepEqual(rows.filter(row=>row.product_name!=='Historical offer').map(row=>row.product_name),names);
    assert.ok(rows[0].id>rows[1].id,'ties retain descending event IDs');
    const market=await getHomeInternetMarket(db,{days,now});
    assert.equal(market.window_days,days);assert.equal(market.days,days);
    assert.equal(market.window_start,bounds.window_start);assert.equal(market.window_end,bounds.window_end);
    assert.deepEqual(market.changes,rows);assert.equal(market.metrics.changes_window,expected);
    assert.equal(market.metrics.changes_7d,621);
  }
});

test('field changes keep event-time attribution and raw values without exposing the full scan payload',async()=>{
  const rows=await loadHomeInternetChanges(db,{start:at(2),end:now}),row=rows[0];
  assert.equal(row.product_family,'fixed');assert.equal(row.market_segment,'business');
  assert.equal(row.technology,'Fiber');assert.equal(row.source_name,'Recorded Extend source');
  assert.equal(row.source_url,'https://example.com/old-packages');assert.equal(row.product_url,'https://example.com/old-offer');
  assert.equal(row.ownership_group,'Recorded owner');assert.equal(row.provider,'Extend');
  assert.equal(row.field_name,'Aylık Ücret');assert.equal(row.field_key,'price_monthly_try');
  assert.equal(row.old_value,'900');assert.equal(row.new_value,'950');
  assert.equal(Object.hasOwn(row,'_event_product'),false);assert.equal(Object.hasOwn(row,'payload_json'),false);
});

test('removed FWA offers and sources absent from the current catalogue retain their recorded family',async()=>{
  const removed={name:'Old mobile home',product_family:'fwa',brand:'Historic Red Box',technology:'5G FWA',market_segment:'business',source_url:'https://example.com/retired',product_url:'https://example.com/retired/plan'};
  await db.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,detected_at,change_type,old_value)
    VALUES('retired-provider','Old ISP','retired|1','Old mobile home',$1,'removed',$2)`,[at(.5),JSON.stringify(removed)]);
  await db.query(`INSERT INTO home_internet_changes(source_slug,provider,product_name,detected_at,change_type,old_value)
    VALUES('telsim-redbox','Telsim','Legacy Red Box',$1,'removed','legacy text')`,[at(.5)]);
  try{
    const rows=await loadHomeInternetChanges(db,{start:at(.75),end:now});
    assert.equal(rows.length,2);assert.ok(rows.every(row=>row.product_family==='fwa'));
    const row=rows.find(row=>row.source_slug==='retired-provider');
    assert.equal(row.market_segment,'business');assert.equal(row.brand,'Historic Red Box');
    assert.equal(row.source_url,removed.source_url);assert.equal(row.product_url,removed.product_url);
    assert.equal(row.old_value,JSON.stringify(removed));
    assert.equal(rows.find(row=>row.source_slug==='telsim-redbox').source_name,'Telsim Red Box');
  }finally{await db.query("DELETE FROM home_internet_changes WHERE source_slug IN ('retired-provider','telsim-redbox')")}
});

test('market payload no longer silently truncates complete history supplied by callers',()=>{
  const changes=Array.from({length:620},(_,i)=>({id:i,detected_at:at(1)}));
  const market=marketPayload([],changes,[],{days:90,now});
  assert.equal(market.changes.length,620);assert.equal(market.metrics.changes_window,620);
});

test('manual and first-time refresh windows include changes recorded while collection was running',async()=>{
  for(const mode of ['manual','initial','frozen']){
    let clock=+now,readCount=0,scanCount=0;
    const collected={id:1,detected_at:new Date(clock+1000).toISOString()};
    class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}}
    const pool={query:async()=>({rows:mode==='initial'&&readCount++===0?[]:[{source_slug:'extend-wdsl'}]})};
    const dependencies={Date:TestDate,competitiveWindow,PARSER_VERSION:'home-isp-2',
      scanHomeInternet:async()=>{scanCount++;clock+=2000},
      loadHomeInternetChanges:async(_,bounds)=>+new Date(collected.detected_at)<+new Date(bounds.end)?[collected]:[],
      marketPayload:(_,changes,__,options)=>({changes,...competitiveWindow(options.days,options.now)})};
    // Exercise the real orchestration without making paid/network collections.
    const getMarket=compileFunction(getHomeInternetMarket.toString()+'\nreturn getHomeInternetMarket;',Object.keys(dependencies))(...Object.values(dependencies));
    const market=await getMarket(pool,{refresh:mode!=='initial',...(mode==='frozen'?{now}:{} )});
    assert.equal(scanCount,1,mode);
    assert.equal(market.window_end,new Date(mode==='frozen'?+now:clock).toISOString(),mode);
    assert.equal(market.changes.length,mode==='frozen'?0:1,mode);
  }
});

test('both HTTP home history views pass the selected period and disable response caching',async()=>{
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const route=path=>{const start=source.indexOf("app.get('"+path+"'");assert.ok(start>=0);return source.slice(start,source.indexOf('\n\n',start))};
  const app=express(),calls=[];
  const dependencies={app,pool:db,competitiveWindow:days=>competitiveWindow(days,now),requireAdminForRefresh:(req,res,next)=>next(),
    getHomeInternetMarket:(pool,options)=>{calls.push(options);return getHomeInternetMarket(pool,{...options,now})},loadHomeInternetChanges};
  compileFunction(route('/api/home-internet')+'\n'+route('/api/home-internet/changes'),Object.keys(dependencies))(...Object.values(dependencies));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const days of [7,30,90]){
      const response=await fetch(base+'/api/home-internet?days='+days),market=await response.json();
      const historyResponse=await fetch(base+'/api/home-internet/changes?days='+days),history=await historyResponse.json();
      assert.equal(response.status,200);assert.equal(historyResponse.status,200);
      assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(historyResponse.headers.get('cache-control'),'private, no-store');
      assert.equal(calls.at(-1).days,days);assert.equal(calls.at(-1).refresh,false);
      assert.equal(history.window_days,days);assert.deepEqual(history.rows,market.changes);
      assert.equal(history.window_start,market.window_start);assert.equal(history.window_end,market.window_end);
    }
  }finally{await new Promise(resolve=>server.close(resolve))}
});
