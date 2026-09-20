import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {JSDOM} from 'jsdom';
import {createEvidenceFixture} from './evidence-fixture.js';
import {ENGINE_VERSION} from '../src/comparable-engine.js';
import {collectMonthlyData} from '../src/monthly-report-data.js';
import {monthlyOverviewHtml,monthlyPlainText} from '../src/monthly-report-content.js';
import {buildReportContext,reportDays,REPORT_NAMES,REPORT_TZ} from '../src/report-data.js';
import {renderReportHtml} from '../src/report-render.js';

let fixture,ctx;
const end=new Date(),start=new Date(end.getTime()-30*86400000);
before(async()=>{
  fixture=await createEvidenceFixture({count:120});const {pool}=fixture;
  await pool.query('DELETE FROM changes'); // Only this isolated, synthetic database.
  await pool.query(`INSERT INTO changes(source_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity)
    SELECT 1,1,$1::timestamptz,'field_changed','Fiyat','499','599','high' FROM generate_series(1,901)`,[new Date(end.getTime()-3600000).toISOString()]);
  for(const time of [start,new Date(start.getTime()-1),end])await pool.query(`INSERT INTO changes(source_id,scan_id,detected_at,change_type,new_value,severity) VALUES(1,1,$1,'added','Sınır paketi','critical')`,[time.toISOString()]);
  for(const [slug,name] of [['fixed-test','Sabit paket'],['telsim-redbox','Red Box']])await pool.query(`INSERT INTO home_internet_changes(source_slug,provider,product_name,detected_at,change_type,new_value)
    SELECT $1,'Örnek',$2,$3,'added','699' FROM generate_series(1,151)`,[slug,name,new Date(end.getTime()-3600000).toISOString()]);
  // Keep both score samples in one local week even when CI runs across Monday midnight.
  const trendAnchor=new Date(end.getTime()-86400000);trendAnchor.setUTCHours(12,0,0,0);
  await pool.query(`INSERT INTO competitive_position_history(bucket_at,segment,score) VALUES($1,'Genel',60),($2,'Genel',70),($3,'Genel',NULL)`,[new Date(trendAnchor.getTime()-7200000).toISOString(),new Date(trendAnchor.getTime()-3600000).toISOString(),end.toISOString()]);
  await pool.query("UPDATE competitive_position_history SET details_json=jsonb_build_object('engine_version',$1::text)",[ENGINE_VERSION]);
  const loaders={
    currentBenchmark:async()=>({overall_score:{segment:'Genel',score:70,level:'Örnek'},segment_scores:[]}),
    sourceHealth:async()=>[{name:'Örnek kaynak',last_status:'ok',http_status:200}],
    getHomeInternetMarket:async()=>({products:[{product_key:'fixed',product_family:'fixed',provider:'Turkcell Ev İnterneti',name:'Sabit 20 Mbps',effective_monthly_try:500,speed_down_mbps:20},{product_key:'fwa',product_family:'fwa',brand:'Superbox',name:'Superbox',effective_monthly_try:900}],sources:[],changes:[],opportunities:[]})
  };
  ctx=await buildReportContext(pool,'monthly',{days:7},loaders);
});
after(async()=>fixture?.db.close());

test('monthly always uses a fixed rolling 30-day window; existing report defaults remain unchanged',()=>{
  assert.equal(reportDays('monthly',7),30);assert.equal(reportDays('monthly',1),30);
  assert.equal(reportDays('daily',30),1);assert.equal(reportDays('weekly'),7);assert.equal(reportDays('home',14),14);
  assert.equal(ctx.days,30);assert.equal(new Date(ctx.period_end)-new Date(ctx.period_start),30*86400000);
});

test('monthly SQL includes start, excludes end and does not truncate at legacy 100/300/600/800 limits',async()=>{
  const data=await collectMonthlyData(fixture.pool,start,end);
  assert.equal(data.changes.length,902);assert.equal(data.homeChanges.length,302);
  assert.equal(data.trend.length,1);assert.equal(Number(data.trend[0].average_score),65);assert.equal(data.trend[0].samples,2);
  assert.equal(Object.keys(data.baseline).length,0);
  assert.equal(data.summary.evidence_total,data.summary.evidence_complete+data.summary.evidence_missing);
  assert.ok(data.evidence.length<=4);assert.ok(data.coverage.length>=3);
});

test('monthly context combines all report families without summing overlapping reports',()=>{
  assert.ok(ctx.stats.total>900);assert.equal(ctx.market.move_count,ctx.stats.total);
  assert.equal(ctx.daily_home.fixed.stats.total,151);assert.equal(ctx.daily_home.fwa.stats.total,151);
  assert.equal(ctx.monthly.total_changes,ctx.stats.total+302);
  assert.equal(ctx.score_deltas[0].baseline,null);assert.equal(ctx.score_deltas[0].delta,null);
  assert.ok(ctx.monthly.evidence_total>0);
  const plain=monthlyPlainText(ctx);assert.match(plain,/Ev İnterneti: 151/);assert.match(plain,/Superbox \/ Red Box: 151/);assert.match(plain,/Kanıt Arşivi/);
});

test('monthly PDF HTML contains every section, explicit sampling and missing-history notes',()=>{
  const html=renderReportHtml(ctx),document=new JSDOM(html).window.document;
  const text=document.body.textContent;
  for(const title of ['Birleşik Aylık Yönetici Özeti','Haftalık Rekabet Pozisyonu Seyri','Mobil Rekabet ve Paket Hareketleri','Turkcell Ev İnterneti • Aylık Detay','Superbox / Red Box • Aylık Detay','Kanıt Arşivi • 30 Günlük Kapsam','Gelecek 30 Gün İçin Önerilen Aksiyonlar','Kaynak Bazında Veri Kapsamı'])assert.ok(text.includes(title),title);
  assert.match(text,/Kapanmış takvim ayı raporu değildir/);assert.match(text,/40 \/ 90/);assert.match(text,/35 \/ 151/);
  assert.ok(!text.includes('NaN'));assert.ok(!text.includes('undefined'));assert.ok(!text.includes('Günlük Özet'));
  document.defaultView.close();
});

test('production email formatter includes monthly home/FWA blocks and consolidated evidence summary without sending',async()=>{
  const source=await readFile(new URL('../src/report-email.js',import.meta.url),'utf8');
  // Execute only pure formatting functions; transport, DB startup timers and mail sending are never imported/executed.
  const helpers=source.split('\n').filter(line=>line.startsWith('function esc(')||line.startsWith('function localDate(')).join('\n');
  const body=source.slice(source.indexOf('function signed('),source.indexOf('export async function sendReportEmail('));
  const render=compileFunction(helpers+'\n'+body+'\nreturn emailHtml(type,ctx,attachments);',['type','ctx','attachments','REPORT_NAMES','REPORT_TZ','monthlyOverviewHtml']);
  const html=render('monthly',ctx,[{filename:'aylik-rapor.pdf'}],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml);
  const document=new JSDOM(html).window.document,text=document.body.textContent;
  assert.match(text,/Turkcell Ev İnterneti • 30 Günlük Özet/);assert.match(text,/Superbox \/ Red Box • 30 Günlük Özet/);
  assert.match(text,/Kanıt Arşivi • 30 Günlük Kapsam/);assert.match(text,/aylik-rapor.pdf/);assert.ok(!text.includes('NaN'));
  document.defaultView.close();
  for(const type of ['daily','weekly'])assert.ok(!render(type,{...ctx,type},[],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml).includes('NaN'));
});

test('monthly summary escapes stored text and report buttons target the authenticated manual endpoints',async()=>{
  const malicious={...ctx,market:{top_threats:[{product_name:'<img src=x onerror=bad()>',action:'<script>bad()</script>'}]}};
  const document=new JSDOM(monthlyOverviewHtml(malicious)).window.document;
  assert.equal(document.querySelector('script,img'),null);assert.match(document.body.textContent,/<script>/);document.defaultView.close();
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8'),ui=await readFile(new URL('../public/brand-ui.js',import.meta.url),'utf8');
  assert.match(ui,/reportDownload\('monthly'\)/);assert.match(ui,/sendReport\('monthly',this\)/);
  assert.match(server,/sendPersonalReportEmail\(pool,type,req.appUser\?\.email,\{days:reportDays\(type\)\}\)/);
  assert.ok(!server.includes("scheduledReportEmail('monthly')"));
});
