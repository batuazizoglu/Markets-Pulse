import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {validateAdFeed,importAdFeed,getAdCategories,getAdVisuals,getAdReport} from '../src/ad-visual.js';
import {queueStoredAdReviews,analyzeNextCloudCandidate} from '../src/ad-cloud.js';
import {normalizeVision} from '../src/ad-cloud-vision.js';

const jpeg=Buffer.from([255,216,255,224,0,0,255,217]);
const hash=createHash('sha256').update(jpeg).digest('hex');
const observed=new Date(Date.now()-3600000).toISOString();
const offer={price_try:null,previous_price_try:null,data_gb:null,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'};
const ad={brand:'Telsim',page_id:'164143610515',ad_id:'88888888',variant_id:'1',category:'review',category_evidence:'Tablet tanıtımı',title:'Yeni tablet',visual_summary:'Tablet ürünü ve aksesuarları',ad_text:'Yeni tablet modelleri',ad_status:'active',source_url:'https://www.facebook.com/ads/library/?id=88888888',observed_at:observed,offer,conditions:[],uncertainties:[],images:[{sha256:hash,path:'evidence/'+hash+'.jpg',captured_at:observed}]};
const feedFor=(ads,producer='cloud-vision')=>({schema_version:1,producer,schedule:{enabled:true,description:'Bulutta günlük',timezone:'Asia/Famagusta'},run:{id:'category-test-'+ads[0].ad_id,checked_at:observed,status:'partial',coverage:[]},ads});
const dynamicResult=(label='Cihazlar')=>({category:'new',category_label:label,category_confidence:0.95,category_evidence:'Yeni tablet modelleri',title:'Yeni tablet',visible_text:'Yeni tablet modelleri',visual_summary:'Tablet ürünü ve aksesuarları',offer,field_evidence:Object.fromEntries(Object.keys(offer).map(k=>[k,''])),conditions:[],uncertainties:[]});
const validate=f=>validateAdFeed(f,HOME_INTERNET_SOURCES);

test('legacy other ads are reclassified once from stored evidence and create a durable filter without false market changes',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);let calls=0;
  try{
    const old=validate(feedFor([ad]));
    await importAdFeed(db,old,{fetcher:async()=>new Response(jpeg)});
    await queueStoredAdReviews(db,HOME_INTERNET_SOURCES);
    await db.query("UPDATE ad_cloud_candidates SET status='analyzed',review_round=3");
    const before=(await getAdVisuals(db)).rows[0];
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,1);
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,0,'pending work is not reset');
    await db.query("UPDATE ad_cloud_control SET lease_owner='category-test',lease_until=NOW()+INTERVAL '10 minutes'");
    const analysis=await analyzeNextCloudCandidate(db,HOME_INTERNET_SOURCES,'category-test',{
      env:{OPENAI_API_KEY:'synthetic',AD_VISION_DAILY_LIMIT:'1'},
      analyze:async(candidate,images,options)=>{
        calls++;assert.deepEqual(images,[jpeg]);assert.equal(options.categories.home,'Ev İnterneti');
        assert.equal(candidate.previous_analysis.category,'review');
        return normalizeVision(dynamicResult(),candidate,{categories:options.categories});
      }
    });
    assert.equal(analysis.status,'analyzed');assert.equal(calls,1);assert.equal(analysis.category,'auto-cihazlar');
    const categories=await getAdCategories(db);assert.equal(categories['auto-cihazlar'],'Cihazlar');
    const data=await getAdVisuals(db,{category:'auto-cihazlar',brand:'Telsim',limit:1});
    assert.equal(data.groups['auto-cihazlar'],1);assert.equal(data.groups.review,0);assert.equal(data.pagination.total,1);
    const updated=data.rows[0];assert.equal(updated.category_label,'Cihazlar');assert.equal(updated.taxonomy_version,2);
    assert.equal(updated.observed_at,before.observed_at);assert.deepEqual(updated.images,before.images);
    assert.equal((await getAdVisuals(db,{category:'home'})).rows.length,0);
    await assert.rejects(getAdVisuals(db,{category:'auto-unregistered'}),/Geçersiz/);
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,0);
    const versions=(await db.query('SELECT event_type FROM ad_visual_versions ORDER BY id')).rows.map(x=>x.event_type);
    assert.deepEqual(versions,['first_seen','analysis_updated']);
    const report=await getAdReport(db,new Date(Date.now()-7200000),new Date(Date.now()+60000));
    assert.equal(report.categories['auto-cihazlar'],'Cihazlar');assert.equal(report.rows.length,1);
    await db.exec(SCHEMA_SQL);
    assert.equal((await getAdCategories(db))['auto-cihazlar'],'Cihazlar','restart migration preserves custom categories');
  }finally{await db.close()}
});

test('custom category persistence is validated, atomic, reusable and supports categories outside presets',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const caption='Açıklama '.repeat(570)+'Gençlik konseri';
    const normalized=normalizeVision({...dynamicResult('Etkinlikler'),category_evidence:'Gençlik konseri',visible_text:'Konser görseli'}, {...ad,ad_text:caption});
    const candidate={...ad,ad_text:caption,...normalized};
    const feed=validate(feedFor([candidate]));assert.equal(feed.ads[0].category,'auto-etkinlikler');
    assert.ok(feed.ads[0].ad_text.length>5000);assert.match(feed.ads[0].ad_text,/Gençlik konseri$/);
    await assert.rejects(importAdFeed(db,feed,{fetcher:async()=>new Response('invalid image')}),/kanıt/);
    assert.equal((await db.query('SELECT * FROM ad_visual_categories')).rows.length,0);
    await importAdFeed(db,feed,{fetcher:async()=>new Response(jpeg)});
    const next={...candidate,ad_id:'88888889',category_label:'ETKİNLİKLER'};
    await importAdFeed(db,validate(feedFor([next])),{fetcher:async()=>{throw new Error('Evidence should already be stored')}});
    assert.equal((await db.query('SELECT * FROM ad_visual_categories')).rows.length,1);
    const page1=await getAdVisuals(db,{category:'auto-etkinlikler',limit:1});
    assert.equal(page1.pagination.total,2);assert.equal(page1.pagination.has_more,true);
    const page2=await getAdVisuals(db,{category:'auto-etkinlikler',limit:1,cursor:page1.pagination.next_cursor});
    assert.equal(page2.rows.length,1);assert.notEqual(page1.rows[0].key,page2.rows[0].key);
    assert.equal(page1.rows[0].category_label,'Etkinlikler');assert.equal(page2.rows[0].category_label,'Etkinlikler');
    for(const mutate of [
      a=>a.category_label='<script>alert(1)</script>',a=>a.category='auto-wrong',
      a=>a.category_evidence='Görselde bulunmayan alıntı',a=>a.category_confidence=0.2,
      a=>delete a.taxonomy_version,a=>a.category='__proto__'
    ]){const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>validate(feedFor([bad])))}
    assert.throws(()=>validate(feedFor([candidate],'chatgpt-browser-visual')));
  }finally{await db.close()}
});
