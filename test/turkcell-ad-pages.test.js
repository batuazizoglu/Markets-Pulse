import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {ISP_COMPANIES,socialDirectory,companyCoverage} from '../src/isp-registry.js';
import {adLibraryUrl} from '../src/ad-library-url.js';
import {verifiedCloudSources,queueNewCloudSources,queueProviderHandoff,queueCloudReview,getCloudStatus} from '../src/ad-cloud.js';
import {validateAdFeed} from '../src/ad-visual.js';

const ids={turkcell:'127496543986832',gnc:'321385064564918'};
const env={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'synthetic-test-token',APIFY_MAX_RUN_USD:'0.10',APIFY_DAILY_BUDGET_USD:'1.00'};

test('GNÇ is a distinct social advertiser while Turkcell home shares one capture and ISP scope stays unchanged',()=>{
  const directory=socialDirectory(HOME_INTERNET_SOURCES),verified=verifiedCloudSources(HOME_INTERNET_SOURCES);
  assert.equal(ISP_COMPANIES.length,29);
  assert.equal(companyCoverage(HOME_INTERNET_SOURCES,[]).length,29);
  assert.ok(!ISP_COMPANIES.some(company=>company.brand==='GNÇ Kıbrıs'));
  assert.ok(!HOME_INTERNET_SOURCES.some(source=>source.provider==='GNÇ Kıbrıs'));
  assert.equal(directory.filter(source=>source.brand==='GNÇ Kıbrıs').length,1);
  assert.equal(verified.length,10);
  assert.equal(new Set(verified.map(source=>source.page_id)).size,10);
  assert.equal(verified.find(source=>source.page_id===ids.turkcell).brand,'KKTCELL');
  assert.equal(verified.find(source=>source.page_id===ids.gnc).brand,'GNÇ Kıbrıs');
  assert.equal(directory.find(source=>source.brand==='Turkcell Ev İnterneti').page_id,ids.turkcell);
  assert.ok(!verified.some(source=>source.brand==='Turkcell Ev İnterneti'));
});

test('new Turkcell pages register once beside eight existing pages, then join daily scans without duplicate aliases or provider spend',async()=>{
  const db=new PGlite(),verified=verifiedCloudSources(HOME_INTERNET_SOURCES);
  try{
    await db.exec(SCHEMA_SQL);
    await db.query("UPDATE ad_cloud_control SET lease_owner='turkcell-page-test',lease_until=NOW()+INTERVAL '10 minutes' WHERE id=1");
    const existing=verified.filter(source=>!Object.values(ids).includes(source.page_id));
    assert.equal(existing.length,8);
    for(const source of existing)await db.query('INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES($1,$2,$3::jsonb)',
      ['source-'+source.page_id,source.brand,JSON.stringify(source)]);
    for(const brand of ['KKTCELL','Turkcell Ev İnterneti'])await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,note) VALUES('historical-keyword',$1,$2::jsonb,'unverified','Historical unverified result')",
      [brand,JSON.stringify({brand,ad_library_url:adLibraryUrl({brand}),ad_library_type:'brand_search'})]);
    const history=(await db.query("SELECT * FROM ad_cloud_jobs WHERE batch_key='historical-keyword' ORDER BY id")).rows;
    assert.deepEqual((await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'turkcell-page-test')).sort(),['GNÇ Kıbrıs','KKTCELL']);
    assert.deepEqual(await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'turkcell-page-test'),[]);
    assert.deepEqual(await queueProviderHandoff(db,HOME_INTERNET_SOURCES,'turkcell-page-test',{env}),{recovered:0,queued:0,brands:[]});
    const queued=(await db.query("SELECT brand,source_json->>'page_id' page_id FROM ad_cloud_jobs WHERE status='queued'")).rows;
    assert.equal(queued.length,10);
    assert.equal(new Set(queued.map(source=>source.page_id)).size,10);
    assert.equal(queued.filter(source=>source.page_id===ids.turkcell).length,1);
    assert.deepEqual((await db.query("SELECT * FROM ad_cloud_jobs WHERE batch_key='historical-keyword' ORDER BY id")).rows,history);
    assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,now:new Date('2030-07-01T09:00:00Z')})).queued,0);
    await db.query("UPDATE ad_cloud_jobs SET status='no_ads',finished_at=NOW() WHERE status='queued'");
    const daily=await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,now:new Date('2030-07-02T09:00:00Z')});
    assert.equal(daily.queued,10);
    const next=(await db.query("SELECT brand,source_json->>'page_id' page_id FROM ad_cloud_jobs WHERE batch_key=$1",[daily.batch_key])).rows;
    assert.equal(new Set(next.map(source=>source.page_id)).size,10);
    for(const id of Object.values(ids))assert.equal(next.filter(source=>source.page_id===id).length,1);
    assert.equal((await queueCloudReview(db,HOME_INTERNET_SOURCES,{env,now:new Date('2030-07-02T10:00:00Z')})).queued,0);
    assert.equal((await getCloudStatus(db,{env,sources:HOME_INTERNET_SOURCES})).schedule.verified_pages_count,10);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_runs')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_budget')).rows[0].n,0);
  }finally{await db.close()}
});

test('visual analysis accepts both Turkcell advertiser identities and rejects cross-attributed pages',()=>{
  const seen='2026-09-24T00:00:00.000Z',hash='0'.repeat(64);
  const feed={schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Synthetic test',timezone:'Asia/Famagusta'},
    run:{id:'turkcell-page-identity',checked_at:seen,status:'partial',coverage:[]},ads:[]};
  for(const [index,[brand,page_id]] of [['KKTCELL',ids.turkcell],['GNÇ Kıbrıs',ids.gnc],['Turkcell Ev İnterneti',ids.turkcell]].entries()){
    const source_url=adLibraryUrl({brand,page_id});
    feed.run.coverage.push({brand,source_url,country:'CY',status:'partial',checked_at:seen,reviewed_ads:1,note:'Synthetic'});
    feed.ads.push({brand,page_id,ad_id:String(900000000000000+index),variant_id:'1',category:'review',category_evidence:'Synthetic creative',title:'Synthetic creative',
      source_url,ad_status:'active',observed_at:seen,ad_text:'Synthetic creative',visual_summary:'Synthetic creative',conditions:[],uncertainties:[],
      offer:{price_try:null,previous_price_try:null,data_gb:null,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'},
      images:[{sha256:hash,path:'evidence/'+hash+'.jpg',captured_at:seen}]});
  }
  assert.deepEqual(validateAdFeed(feed,HOME_INTERNET_SOURCES,new Date(seen)).ads.map(ad=>ad.brand),['KKTCELL','GNÇ Kıbrıs','Turkcell Ev İnterneti']);
  const wrong=structuredClone(feed);wrong.ads[1].page_id=ids.turkcell;
  assert.throws(()=>validateAdFeed(wrong,HOME_INTERNET_SOURCES,new Date(seen)),/Marka ve sayfa kimliği uyuşmuyor/);
});
