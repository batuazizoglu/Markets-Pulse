import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {registerCloudRoutes} from '../src/ad-cloud.js';
import {registerAdVisualRoutes} from '../src/ad-visual.js';
import {registerSocialWatchRoutes} from '../src/social-watch.js';
import {requireOperationalAdmin,requireAdminForRefresh,reportStatusForUser,standardAdVisuals} from '../src/operational-access.js';

let db,server,base,operations=0,reportReads=0;
const hash='a'.repeat(64),adKey='164143610515:123456789:1',seen=new Date().toISOString(),deliveries=[];
const emailStatus={configured:true,from:'sender@example.com',smtp_host:'smtp.example.com',recipients:['private-recipient@example.com']};
const cloud={worker_online:true,vision_configured:true,candidates:{pending:1},capture_transport:{configured:true,proxy_names:['internal-proxy']},
  capture_provider:{enabled:true,configured:true,daily_budget_usd:50,reserved_today_usd:10,runs:[{brand:'Telsim',state:'running',coverage_complete:false}]},sources:[{brand:'Telsim',status:'running',note:'Internal provider detail'}]};

before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  const ad={key:adKey,brand:'Telsim',category:'gsm',title:'Published package',observed_at:seen,offer:{price_try:499},images:[{sha256:hash}],taxonomy_version:'internal-taxonomy',ai_analysis:{status:'completed',model:'internal-model',pass:2}};
  await db.query("INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,'Telsim','gsm',$2,$2,'fixture',$3::jsonb)",[adKey,seen,JSON.stringify(ad)]);
  await db.query("INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,'first_seen',$3::jsonb)",[adKey,seen,JSON.stringify(ad)]);
  await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',[hash,Buffer.from([255,216,255,217])]);
  await db.query("INSERT INTO ad_visual_sync(id,status,checked_at,last_error) VALUES(1,'ok',$1,NULL) ON CONFLICT(id) DO UPDATE SET status='ok',checked_at=$1,last_error=NULL",[seen]);
  const pool={query(sql,args){if(/FROM report_runs/.test(sql))reportReads++;return db.query(sql,args)}};
  const app=express();app.use(express.json());app.use((req,res,next)=>{
    const role=req.get('x-test-role');if(role)req.appUser={id:role==='admin'?2:1,role,email:role==='admin'?'admin@example.com':'reader@example.com'};next();
  });
  registerCloudRoutes(app,pool,HOME_INTERNET_SOURCES);
  registerSocialWatchRoutes(app,pool,HOME_INTERNET_SOURCES);
  registerAdVisualRoutes(app,pool,HOME_INTERNET_SOURCES,{cloudStatus:async()=>cloud,sync:()=>assert.fail('No external sync in authorization tests')});
  // Register the real server route bodies without starting schedulers, mail or
  // network scrapers. Only their business dependencies are isolated test doubles.
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const route=(method,path)=>{const at=source.indexOf("app."+method+"('"+path+"'");assert.ok(at>=0,path);return source.slice(at,source.indexOf('\n\n',at))};
  const routes=[['get','/api/home-internet'],['post','/api/home-internet/scan'],['get','/api/kktcell-catalog'],['get','/api/benchmark'],['post','/api/scan'],['get','/api/scans'],['get','/api/reports/status'],['get','/api/reports/:type/download'],['post','/api/reports/:type/email']].map(([method,path])=>route(method,path)).join('\n');
  const artifact={ctx:{period_start:seen,period_end:seen},fileName:'synthetic.pdf',contentType:'application/pdf',buffer:Buffer.from('PDF')};
  const dependencies={app,pool,requireOperationalAdmin,requireAdminForRefresh,reportStatusForUser,
    scanAll:async()=>{operations++;return {sources:[]}},scanHomeInternet:async()=>{operations++;return {ok:true}},
    getHomeInternetMarket:async(_,options={})=>{if(options.refresh)operations++;return {products:[]}},
    getKktcellCatalog:async force=>{if(force)operations++;return {at:Date.now(),sources:[],rows:[]}},
    buildCurrentBenchmark:async force=>{if(force)operations++;return {matches:[]}},getReportEmailStatus:()=>emailStatus,
    generateReportPdf:async()=>artifact,generateEvidencePack:async()=>artifact,reportDays:()=>7,logReportRun:async()=>{},
    sendPersonalReportEmail:async(_,type,email)=>{deliveries.push({type,email});return {...artifact,recipients:[email],delivery_to:email,subject:'Synthetic report',message_id:'test-message',total_bytes:3}}
  };
  compileFunction(routes,Object.keys(dependencies))(...Object.values(dependencies));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db?.close()});
const request=(path,{role='standard',method='GET',body}={})=>fetch(base+path,{method,headers:{...(role?{'x-test-role':role}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});

test('manual scans, AI reanalysis and pending review require admin before invoking any operational work',async()=>{
  const paths=['/api/scan','/api/home-internet/scan','/api/ad-visuals/scan','/api/ad-visuals/analyze','/api/ad-visuals/sync','/api/home-internet/social-observations'];
  const before=operations;
  for(const path of paths)for(const [role,status] of [['standard',403],[null,401]]){
    const response=await request(path,{role,method:'POST',body:{}});
    assert.equal(response.status,status,path);assert.equal((await response.json()).code,role?'ADMIN_REQUIRED':'AUTH_REQUIRED');
  }
  assert.equal((await request('/api/ad-visuals/pending')).status,403);
  assert.equal((await request('/api/ad-visuals/pending',{role:null})).status,401);
  assert.equal((await request('/api/ad-visuals/pending',{role:'admin'})).status,200);
  assert.equal((await request('/api/scans')).status,403);
  assert.equal((await request('/api/scans',{role:null})).status,401);
  assert.equal((await request('/api/scans',{role:'admin'})).status,200);
  assert.equal(operations,before);
  assert.equal((await db.query('SELECT count(*)::int n FROM ad_cloud_jobs')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_runs')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM social_watch_observations')).rows[0].n,0);
  assert.equal((await request('/api/home-internet/social-observations')).status,200);
  assert.equal((await request('/api/scan',{role:'admin',method:'POST',body:{}})).status,200);
  assert.equal((await request('/api/home-internet/scan',{role:'admin',method:'POST',body:{}})).status,200);
  assert.equal((await request('/api/ad-visuals/sync',{role:'admin',method:'POST',body:{}})).status,409);
  assert.equal(operations,before+2);
});

test('standard product reads remain allowed while forced collection is admin-only',async()=>{
  for(const path of ['/api/home-internet','/api/kktcell-catalog','/api/benchmark']){
    const before=operations;
    assert.equal((await request(path)).status,200);
    assert.equal((await request(path+'?refresh=0')).status,200);
    assert.equal((await request(path+'?refresh=1')).status,403);
    assert.equal((await request(path+'?refresh=1',{role:null})).status,401);
    assert.equal(operations,before);
    assert.equal((await request(path+'?refresh=1',{role:'admin'})).status,200);
    assert.equal(operations,before+1);
  }
});

test('standard published ad results retain business data and evidence without provider, queue or source diagnostics',async()=>{
  const response=await request('/api/ad-visuals'),data=await response.json();assert.equal(response.status,200);
  assert.equal(data.rows[0].title,'Published package');assert.equal(data.rows[0].offer.price_try,499);
  assert.equal(data.pagination.total,1);assert.equal(data.groups.gsm,1);assert.equal(data.brand_groups.Telsim.gsm,1);
  assert.deepEqual(data.display_status,{incomplete:true,updated_at:seen});
  for(const key of ['cloud','monitoring','pending_media'])assert.ok(!Object.hasOwn(data,key));
  for(const key of ['ai_queue_status','ai_analysis','taxonomy_version'])assert.ok(!Object.hasOwn(data.rows[0],key));
  const source=data.source_directory.find(row=>row.brand==='KKTCELL');assert.equal(source.page_id,'127496543986832');
  assert.ok(!Object.hasOwn(source,'research_note'));
  assert.doesNotMatch(JSON.stringify(data),/internal-proxy|daily_budget_usd|reserved_today_usd|internal-model|Internal provider detail/);
  const history=await request('/api/ad-visuals/history?key='+encodeURIComponent(adKey));assert.equal(history.status,200);
  const version=(await history.json()).rows[0];assert.equal(version.event_type,'first_seen');
  assert.equal(version.analysis_json.title,'Published package');assert.equal(version.analysis_json.offer.price_try,499);
  for(const key of ['ai_queue_status','ai_analysis','taxonomy_version'])assert.ok(!Object.hasOwn(version.analysis_json,key));
  const adminHistory=await (await request('/api/ad-visuals/history?key='+encodeURIComponent(adKey),{role:'admin'})).json();
  assert.equal(adminHistory.rows[0].analysis_json.ai_analysis.model,'internal-model');
  assert.equal(adminHistory.rows[0].analysis_json.taxonomy_version,'internal-taxonomy');
  assert.equal((await request('/api/ad-visuals/evidence/'+hash+'.jpg')).status,200);
  const admin=await (await request('/api/ad-visuals',{role:'admin'})).json();
  assert.equal(admin.cloud.capture_provider.daily_budget_usd,50);assert.equal(admin.rows[0].ai_analysis.model,'internal-model');
});

test('standard report status is minimal while downloads and delivery to the signed-in user remain available',async()=>{
  const before=reportReads;
  const status=await (await request('/api/reports/status')).json();assert.deepEqual(status,{email:{configured:true},recent_runs:[]});
  assert.equal(reportReads,before);
  const admin=await (await request('/api/reports/status',{role:'admin'})).json();assert.deepEqual(admin.email,emailStatus);assert.equal(reportReads,before+1);
  assert.equal((await request('/api/reports/weekly/download')).status,200);
  const sent=await request('/api/reports/weekly/email',{method:'POST',body:{recipient:'another-person@example.com'}});
  assert.equal(sent.status,200);assert.deepEqual((await sent.json()).recipients,['reader@example.com']);
  assert.deepEqual(deliveries.at(-1),{type:'weekly',email:'reader@example.com'});
});

test('plain completeness reflects stale analysis, waiting work and partial supplier coverage without exposing reasons',()=>{
  const complete={rows:[],monitoring:{status:'ok',stale:false,checked_at:seen},pending_media:{total:0},cloud:{worker_online:true,vision_configured:true,candidates:{},sources:[],capture_provider:{enabled:true,configured:true,runs:[{coverage_complete:true}]}}};
  assert.equal(standardAdVisuals(complete).display_status.incomplete,false);
  const cases=[{monitoring:{status:'partial',checked_at:seen}},{monitoring:{status:'ok',stale:true,checked_at:seen}},{pending_media:{total:1}},
    {cloud:{...complete.cloud,worker_online:false}},{cloud:{...complete.cloud,candidates:{retry:1}}},{cloud:{...complete.cloud,sources:[{status:'blocked'}]}},
    {cloud:{...complete.cloud,capture_provider:{enabled:true,configured:true,runs:[{coverage_complete:false}]}}}];
  for(const patch of cases)assert.equal(standardAdVisuals({...complete,...patch}).display_status.incomplete,true);
});
