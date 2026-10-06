import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {buildReportContext} from '../src/report-data.js';

test('daily context freezes all change windows and preserves dated campaigns and event-time families',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const end='2026-10-06T05:00:00.000Z',start='2026-10-05T05:00:00.000Z';
  let homeOptions;
  const changed={id:1,product_key:'historical-fwa',product_name:'Red Box',product_family:'fwa',source_slug:'legacy-source',change_type:'field_changed',field_name:'Aylık fiyat',old_value:'800',new_value:'900',detected_at:'2026-10-05T10:00:00.000Z'};
  const loaders={
    currentBenchmark:async()=>({overall_score:{segment:'Toplam',score:null},segment_scores:[]}),
    sourceHealth:async()=>[],
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
    assert.equal(ctx.period_start,start);assert.equal(ctx.period_end,end);
    assert.equal(ctx.daily_home.fixed.changes.length,0,'current catalogue family cannot overwrite the historical family');
    assert.deepEqual(ctx.daily_home.fwa.changes.map(x=>x.id),[1],'exclusive end is respected');
    assert.equal(ctx.daily_home.fixed.campaigns[0].expires_at,'2026-10-08');
    assert.equal(ctx.daily_home.fwa.campaigns[0].expires_at,'2026-10-07');
    assert.deepEqual(ctx.ad_report_data.rows,[]);assert.equal(ctx.ad_report_data.status,'pending');
  }finally{await db.close()}
});
