import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { ENGINE_VERSION, evaluateComparableProducts } from '../src/comparable-engine.js';
import { buildBenchmark } from '../src/kktcell-benchmark.js';
import { currentBenchmark } from '../src/live-benchmark.js';
import { ensureMatchReviewSchema } from '../src/match-review.js';
import { buildBenchmarkHistoryPayload, persistBenchmarkHistory } from '../src/benchmark-history.js';
import { collectMonthlyData } from '../src/monthly-report-data.js';
import { createEvidenceFixture } from './evidence-fixture.js';

const telsim=(id=1,extra={})=>({id,current_name:'Super Databol Medium',source_slug:'faturasiz',active:true,
  data_gb:20,bonus_data_gb:0,local_tr_minutes:1000,sms:1000,validity_days:30,price_try:500,...extra});
const kktcell=(extra={})=>({name:'Yeni GO M',product_url:'/go-m',source_slug:'kktcell-faturasiz',type:'prepaid',is_core:true,
  data_gb:20,bonus_data_gb:0,local_tr_minutes:1000,sms:1000,validity_days:30,price_try:500,...extra});

test('v2.4 golden families retain eligible pairs and reject cross-family, billing and eligibility matches',()=>{
  for(const [t,k] of [['Super Databol Medium','Yeni GO M'],['Super Databol Large','Yeni GO L'],
    ['Asker 2 GB','Asker Kıdemli 2GB'],['Asker 20 GB','Asker MAXİ'],['Super Cool Uni Midi','GNÇ Giga M'],
    ['Super World XSmall','Yeni GO World'],['Freezone 20 GB','GNÇ Giga M']]){
    const out=evaluateComparableProducts([telsim(1,{current_name:t})],[kktcell({name:k})]);
    assert.equal(out.rows[0].effective_status,'Primary',t+' / '+k);assert.equal(out.rows[0].effective_score,100);
  }
  for(const [t,k] of [['Super Databol Medium','Yeni GO World'],['Super World XSmall','Yeni GO XS'],
    ['Super World XSmall','Hoş Geldin S'],['Nigerian 20 GB','Yeni GO XS'],['Pakistan 20 GB','Yeni GO XS'],
    ['Sağlık Çalışanlarına Özel 10 GB','Turbo Star 60+'],['Super65','Turbo Extra Mega'],['Red Junior','GNÇ Lite']]){
    const out=evaluateComparableProducts([telsim(1,{current_name:t})],[kktcell({name:k})]);
    assert.equal(out.rows[0].effective_status,'Reject',t+' / '+k);assert.equal(out.catalog.eligible_pairs,0);
  }
  assert.equal(buildBenchmark([telsim()],[kktcell({type:'postpaid'})]).total_matches,0);
});

test('severe allowance mismatches, add-ons and closed products do not become scored matches',()=>{
  for(const extra of [{data_gb:200,local_tr_minutes:100},{is_core:false},{is_closed:true},{raw_text:'Yeni abone alımına kapalı'}]){
    assert.equal(buildBenchmark([telsim()],[kktcell(extra)]).total_matches,0);
  }
  assert.equal(buildBenchmark([telsim(1,{active:false})],[kktcell()]).total_matches,0);
  const out=buildBenchmark([telsim(1,{current_name:'Super Databol 5',validity_days:150})],[kktcell()]);
  assert.equal(out.total_matches,0);
});

test('mutual-best Primary alone drives scores; Secondary is a visible unscored alternative',()=>{
  const out=buildBenchmark([telsim(1),telsim(2,{current_name:'Super Databol Large'})],[kktcell()]);
  assert.equal(out.engine_version,ENGINE_VERSION);assert.equal(out.mode,'live');
  assert.equal(out.matches.length,1);assert.equal(out.secondary_matches.length,1);
  assert.equal(out.overall_score.match_count,1);assert.equal(out.counts.PARITY,1);
  assert.equal(out.matches[0].match_status,'Primary');assert.equal(out.secondary_matches[0].match_status,'Secondary');
  assert.equal(out.total_matches,out.matches.length);
});

test('saved admin choice, score and reasons are applied; rejection and secondary never affect the score',()=>{
  const rows=[kktcell(),kktcell({name:'Yeni GO L',product_url:'/go-l',data_gb:30,price_try:600})];
  const override={telsim_product_id:1,decision:'primary',kktcell_product_key:'/go-l',email:'private@example.test',note:'private note'};
  const review=evaluateComparableProducts([telsim()],rows,[override]);
  const out=buildBenchmark([telsim()],rows,[override]);
  assert.equal(out.matches[0].kktcell.name,'Yeni GO L');assert.equal(out.matches[0].match_origin,'admin');
  assert.equal(out.matches[0].match_score,review.rows[0].candidates.find(x=>x.product.key==='/go-l').score);
  assert.notEqual(out.matches[0].match_score,review.rows[0].engine_score);
  assert.ok(!JSON.stringify(out).includes('private'));
  for(const decision of ['secondary','reject'])assert.equal(buildBenchmark([telsim()],rows,[{...override,decision}]).total_matches,0);
  assert.equal(buildBenchmark([telsim()],rows).matches[0].kktcell.name,'Yeni GO M');
});

test('missing, ineligible or ambiguous override peers move to Review without automatic fallback',()=>{
  const o={telsim_product_id:1,decision:'primary',kktcell_product_key:'/selected'};
  const variants=[[],[kktcell({product_url:'/selected',name:'Yeni GO World'})],
    [kktcell({product_url:'/selected',is_core:false})],[kktcell({product_url:'/selected'}),kktcell({product_url:'/selected',name:'Yeni GO L'})]];
  for(const extra of variants){
    const out=buildBenchmark([telsim()],[kktcell(),...extra],[o]);
    assert.equal(out.total_matches,0);assert.equal(out.matching.effective_counts.Review,1);
    assert.equal(out.matching.stale_override_count,1);assert.equal(out.secondary_matches.length,0);
  }
});

test('shared SQL loader uses latest product versions and persisted decisions for live and report output',async()=>{
  const {db,pool}=await createEvidenceFixture({count:0});
  try{
    await ensureMatchReviewSchema(pool);
    await pool.query("INSERT INTO products(id,source_id,identity_base,current_name,active,first_seen_at,last_seen_at) VALUES(1,2,'fixture','Super Databol Medium',TRUE,NOW(),NOW())");
    await pool.query("INSERT INTO scans(id,source_id,started_at,status) VALUES(1,2,NOW(),'ok')");
    await pool.query("INSERT INTO product_versions(product_id,scan_id,product_hash,captured_at,name,data_gb,price_try,local_tr_minutes,sms,validity_days) VALUES(1,1,'old',NOW()-INTERVAL '1 hour','Super Databol Medium',1,999,10,10,1),(1,1,'latest',NOW(),'Super Databol Medium',20,500,1000,1000,30)");
    const getCatalog=async()=>({rows:[kktcell()],sources:[{ok:true}],error:null});
    assert.equal((await currentBenchmark(pool,{getCatalog})).matches[0].match_score,100);
    await pool.query("INSERT INTO product_match_overrides(telsim_product_id,decision) VALUES(1,'reject')");
    const out=await currentBenchmark(pool,{getCatalog});
    assert.equal(out.total_matches,0);assert.equal(out.matching.override_count,1);assert.equal(out.matching.effective_counts.Reject,1);
  }finally{await db.close();}
});

test('score capture preserves legacy hourly rows, upserts same-engine scores and isolates history',async()=>{
  const {db,pool}=await createEvidenceFixture({count:0});
  pool.connect=async()=>({...pool,release(){}});
  const now=new Date('2026-09-16T12:15:00Z');
  try{
    const benchmark=buildBenchmark([telsim()],[kktcell()]);
    await pool.query("INSERT INTO competitive_position_history(bucket_at,segment,score) VALUES('2026-09-16T12:00:00Z','Toplam',91)");
    await persistBenchmarkHistory(pool,benchmark,{now});
    let old=(await pool.query("SELECT * FROM competitive_position_history WHERE segment='Toplam'")).rows[0];
    assert.equal(old.score,91);assert.equal(old.details_json,null);
    await persistBenchmarkHistory(pool,benchmark,{now:new Date('2026-09-16T13:15:00Z')});
    benchmark.overall_score.score=52;
    await persistBenchmarkHistory(pool,benchmark,{now:new Date('2026-09-16T13:30:00Z')});
    const rows=(await pool.query("SELECT * FROM competitive_position_history WHERE segment='Toplam' ORDER BY bucket_at")).rows;
    assert.equal(rows.length,2);assert.equal(rows[1].score,52);assert.equal(rows[1].details_json.engine_version,ENGINE_VERSION);
    const payload=buildBenchmarkHistoryPayload(rows,30);
    assert.equal(payload.record_count,1);assert.equal(payload.trends.Toplam.latest.score,52);assert.equal(payload.trends.Toplam.deltas['7d'],null);
  }finally{await db.close();}
});

test('monthly baseline and weekly averages exclude older engine scores',async()=>{
  const {db,pool}=await createEvidenceFixture({count:0});
  try{
    const start=new Date('2026-08-17T12:00:00Z'),end=new Date('2026-09-16T12:00:00Z');
    await pool.query("INSERT INTO competitive_position_history(bucket_at,segment,score) VALUES('2026-08-16T12:00:00Z','Toplam',99),('2026-09-15T12:00:00Z','Toplam',99)");
    await pool.query("INSERT INTO competitive_position_history(bucket_at,segment,score,details_json) VALUES('2026-09-15T13:00:00Z','Toplam',50,jsonb_build_object('engine_version',$1::text))",[ENGINE_VERSION]);
    const out=await collectMonthlyData(pool,start,end);
    assert.equal(out.baseline.Toplam,undefined);assert.equal(out.trend.length,1);assert.equal(Number(out.trend[0].average_score),50);assert.equal(out.trend[0].samples,1);
  }finally{await db.close();}
});

test('live comparison renders Primary and Secondary labels, reasons and escaped names',async()=>{
  const dom=new JSDOM('<div id="bmTabs"></div><div id="bmBox"></div>',{runScripts:'outside-only'});
  try{
    const src=await readFile(new URL('../public/benchmark.js',import.meta.url),'utf8');
    dom.window.eval(src.replace('installBenchmark();setInterval(()=>loadBenchmark(false),15*60*1000);',''));
    const data=buildBenchmark([telsim(),telsim(2,{current_name:'Super Databol <img src=x onerror=bad()>'})],[kktcell()]);
    dom.window.renderBenchmark(data);
    const doc=dom.window.document,text=doc.body.textContent;
    assert.match(text,/Primary/);assert.match(text,/Secondary/);assert.match(text,/2.4-live/);
    assert.match(text,/Super Databol <img/);assert.equal(doc.querySelector('img'),null);
    assert.equal(doc.querySelectorAll('.bm-table tbody tr').length,2);
    assert.ok(!text.includes('NaN'));assert.ok(!text.includes('undefined'));
  }finally{dom.window.close();}
});
