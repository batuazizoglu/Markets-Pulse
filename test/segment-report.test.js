import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {JSDOM} from 'jsdom';
import {evaluateComparableProducts} from '../src/comparable-engine.js';
import {buildBenchmark} from '../src/kktcell-benchmark.js';
import {renderReportHtml} from '../src/report-render.js';
import {REPORT_NAMES,REPORT_TZ} from '../src/report-data.js';
import {monthlyOverviewHtml} from '../src/monthly-report-content.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/segment-catalog.json',import.meta.url),'utf8'));
const benchmark=buildBenchmark(fixture.telsim,fixture.kktcell,[],{sources:fixture.sources});
const segment=name=>benchmark.segment_scores.find(x=>x.segment===name);

test('real Super Red tariffs with included extra apps enter matching; actual add-on names remain excluded',()=>{
  const out=evaluateComparableProducts(fixture.telsim,fixture.kktcell);
  assert.equal(out.segment_coverage['Premium / Platinum'].telsim_core,10);
  assert.equal(out.segment_coverage['Premium / Platinum'].kktcell_core,4);
  const red=out.rows.find(x=>x.telsim.name==='Super Red 100');
  assert.equal(red.telsim.core_data_gb,50);assert.equal(red.telsim.bonus_data_gb,50);
  assert.equal(red.candidates.length,4);assert.equal(red.engine_status,'Review');
  const t={...fixture.telsim[0],current_name:'Ek İnternet 30 GB'};
  const k={...fixture.kktcell.find(x=>x.is_core),name:'Platinum Ek 30 GB',is_core:true};
  const addons=evaluateComparableProducts([t],[k]);
  assert.equal(addons.catalog.telsim_core,0);assert.equal(addons.catalog.kktcell_core,0);
});

test('Premium reports pending review and Diaspora reports absent peer instead of generic insufficient data',()=>{
  const premium=segment('Premium / Platinum'),diaspora=segment('Uluslararası / Diaspora');
  assert.equal(premium.score,null);assert.equal(premium.availability,'review_required');
  assert.equal(premium.level,'EŞLEŞME İNCELENMELİ');assert.match(premium.rationale,/3 aday/);
  assert.equal(diaspora.score,null);assert.equal(diaspora.availability,'no_peer');
  assert.equal(diaspora.level,'KARŞILIK BULUNAMADI');assert.match(diaspora.rationale,/2 Telsim \/ 0 KKTCELL/);
  assert.equal(benchmark.matches.filter(x=>['Premium / Platinum','Uluslararası / Diaspora'].includes(x.segment)).length,0);
});

test('catalog failures are distinct from legitimate no-peer cases and manual rejection is preserved',()=>{
  const failed=buildBenchmark(fixture.telsim,fixture.kktcell,[],{sources:fixture.sources.map(s=>({...s,ok:s.slug!=='kktcell-faturasiz'}))});
  assert.equal(failed.segment_scores.find(x=>x.segment==='Uluslararası / Diaspora').availability,'source_error');
  assert.equal(failed.segment_scores.find(x=>x.segment==='Premium / Platinum').availability,'review_required');
  const overrides=fixture.telsim.filter(x=>x.name.startsWith('Super Red')).map(x=>({telsim_product_id:x.id,decision:'reject'}));
  const rejected=buildBenchmark(fixture.telsim,fixture.kktcell,overrides).segment_scores.find(x=>x.segment==='Premium / Platinum');
  assert.equal(rejected.availability,'no_approved_match');assert.equal(rejected.score,null);assert.match(rejected.rationale,/10 eşleşme yönetici tarafından reddedilmiş/);
});

test('daily email and PDF include the actual missing-score reasons without sending a message',()=>{
  const ctx={type:'daily',title:REPORT_NAMES.daily,days:1,period_start:'2026-09-16T05:00:00Z',period_end:'2026-09-17T05:00:00Z',generated_at:'2026-09-17T05:00:00Z',
    benchmark,market:{pressure_index:0,pressure_level:'DÜŞÜK',executive_summary:'Örnek',top_threats:[]},stats:{total:0,added:0,removed:0},sources:[],changes:[],evidence:[],
    score_deltas:benchmark.segment_scores.map(x=>({segment:x.segment,current:x.score,baseline:null,delta:null,level:x.level,confidence:x.confidence,rationale:x.rationale}))};
  const source=readFileSync(new URL('../src/report-email.js',import.meta.url),'utf8');
  const helpers=source.split('\n').filter(line=>line.startsWith('function esc(')||line.startsWith('function localDate(')).join('\n');
  const body=source.slice(source.indexOf('function signed('),source.indexOf('export async function sendReportEmail('));
  const render=compileFunction(helpers+'\n'+body+'\nreturn emailHtml(type,ctx,attachments);',['type','ctx','attachments','REPORT_NAMES','REPORT_TZ','monthlyOverviewHtml']);
  for(const html of [render('daily',ctx,[],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml),renderReportHtml(ctx)]){
    const dom=new JSDOM(html),text=dom.window.document.body.textContent;
    assert.match(text,/Premium \/ Platinum/);assert.match(text,/EŞLEŞME İNCELENMELİ/);assert.match(text,/3 aday inceleme bekliyor/);
    assert.match(text,/Uluslararası \/ Diaspora/);assert.match(text,/KARŞILIK BULUNAMADI/);assert.match(text,/İzlenen KKTCELL kataloğunda aynı segmente uygun ana tarife bulunamadı/);
    assert.ok(!text.includes('VERİ YETERSİZ'));assert.ok(!text.includes('NaN'));dom.window.close();
  }
  ctx.score_deltas[0].rationale='<script>unsafe()</script>';
  const dom=new JSDOM(render('daily',ctx,[],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml));
  assert.equal(dom.window.document.querySelector('script'),null);assert.match(dom.window.document.body.textContent,/<script>unsafe/);dom.window.close();
});
