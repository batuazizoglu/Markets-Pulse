import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {validateAdFeed,importAdFeed,getAdVisuals} from '../src/ad-visual.js';
import {repairReviewCategories,queueStoredAdReviews,analyzeNextCloudCandidate} from '../src/ad-cloud.js';
import {proposeStoredCategory} from '../src/ad-category-evidence.js';
import {verifiedFixedIspPageId} from '../src/isp-registry.js';

const jpeg=Buffer.from([255,216,255,224,0,0,255,217]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const imageHash=sha(jpeg),observed=new Date(Date.now()-3600000).toISOString();
const offer={price_try:799,previous_price_try:null,data_gb:25,bonus_data_gb:null,minutes:null,speed_mbps:null,commitment_months:null,billing_period:'unknown'};
const owner='category-repair-test';
function advertisement(id='99999999',overrides={}){
  return {brand:'Telsim',page_id:'164143610515',ad_id:id,variant_id:'1',category:'review',category_evidence:'Önceki sınıflandırma belirsiz',
    title:'Numaranızı taşıyın',visual_summary:'Numara taşıma teklifi ve paket fiyatı',ad_text:'Numaranızı Telsim’e taşıyın. 25 GB 799 TL',
    visible_text:'Numaranızı Telsim’e taşıyın. 25 GB 799 TL',taxonomy_version:2,ad_status:'active',source_url:'https://www.facebook.com/ads/library/?id='+id,
    observed_at:observed,offer,conditions:['Koşullar resmi sayfadan doğrulanmalı.'],uncertainties:['Taahhüt süresi görselde okunmuyor.'],review_required:true,
    ai_analysis:{status:'completed',analyzed_at:observed,model:'synthetic-existing-model',pass:3},
    images:[{sha256:imageHash,path:'evidence/'+imageHash+'.jpg',captured_at:observed}],...overrides};
}
async function fixture(){
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query("UPDATE ad_cloud_control SET lease_owner=$1,lease_until=NOW()+INTERVAL '10 minutes',vision_day='2026-09-27',vision_calls=22",[owner]);
  return db;
}
async function seed(db,ad,{candidate=true,status='analyzed',candidatePatch={}}={}){
  const feed=validateAdFeed({schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Günlük bulut taraması',timezone:'Asia/Famagusta'},
    run:{id:'seed-category-'+ad.ad_id,checked_at:observed,status:'partial',coverage:[]},ads:[ad]},HOME_INTERNET_SOURCES);
  await importAdFeed(db,feed,{fetcher:async()=>new Response(jpeg)});
  const saved=feed.ads[0];
  if(candidate){
    const payload={...saved},fingerprint=sha(JSON.stringify({images:payload.images.map(x=>x.sha256),text:payload.ad_text}));
    const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status) VALUES($1,'Telsim','{}'::jsonb,'imported') RETURNING id",['seed-'+ad.ad_id])).rows[0];
    await db.query(`INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,status,attempts,analysis_json,observed_at,analyzed_at,review_round)
      VALUES($1,$2,$3,$4::jsonb,$5,2,$6::jsonb,$7,$8,2)`,
    [saved.key,job.id,fingerprint,JSON.stringify({...payload,...candidatePatch}),status,JSON.stringify(saved),candidatePatch.observed_at||saved.observed_at,saved.ai_analysis?.analyzed_at||observed]);
  }
  return saved;
}
const semanticContent=ad=>Object.fromEntries(Object.entries(ad).filter(([key])=>!['category','category_label','category_evidence','category_assignment'].includes(key)));

test('stored category correction is atomic, preserves observation and AI facts, and spends no inference budget',async()=>{
  const db=await fixture();
  try{
    const before=await seed(db,advertisement());
    const priorSync=(await db.query('SELECT * FROM ad_visual_sync')).rows[0];
    const priorCandidate=(await db.query('SELECT * FROM ad_cloud_candidates')).rows[0];
    const priorControl=(await db.query('SELECT * FROM ad_cloud_control')).rows[0];
    const result=await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner);
    assert.deepEqual(result,{reclassified:1,categories:{mnp:1}});
    const saved=(await db.query('SELECT analysis_json FROM ad_visual_items')).rows[0].analysis_json;
    assert.equal(saved.category,'mnp');assert.equal(saved.category_assignment.method,'stored_evidence');
    assert.equal(saved.category_assignment.previous_category,'review');assert.equal(saved.category_assignment.version,1);
    assert.deepEqual(semanticContent(saved),semanticContent(before),'all offer, uncertainty, image and AI data stay byte-for-byte equivalent');
    assert.deepEqual((await db.query('SELECT * FROM ad_visual_sync')).rows[0],priorSync,'classification must not claim a fresh scan');
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_control')).rows[0],priorControl,'no spend, attempt or schedule reset');
    const candidate=(await db.query('SELECT * FROM ad_cloud_candidates')).rows[0];
    assert.deepEqual({...candidate,analysis_json:null},{...priorCandidate,analysis_json:null});
    assert.deepEqual(semanticContent(candidate.analysis_json),semanticContent(priorCandidate.analysis_json));
    assert.equal(candidate.analysis_json.category,'mnp');
    assert.deepEqual((await db.query('SELECT event_type FROM ad_visual_versions ORDER BY id')).rows.map(x=>x.event_type),['first_seen','category_updated']);
    assert.equal((await getAdVisuals(db)).groups.mnp,1);
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES)).queued,0,'corrected completed evidence must not buy a new AI pass');
    assert.equal((await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner)).reclassified,0,'a second worker tick is idempotent');
  }finally{await db.close()}
});

test('repair skips unfinished, newer or mismatched captures and missing evidence while allowing completed legacy records',async()=>{
  const db=await fixture();
  try{
    await seed(db,advertisement('99999990'),{status:'pending'});
    await seed(db,advertisement('99999991'),{candidatePatch:{observed_at:new Date(+new Date(observed)+60000).toISOString()}});
    await seed(db,advertisement('99999992'),{candidatePatch:{ad_text:'Başka bir reklamın metni'}});
    await seed(db,advertisement('99999993',{ai_analysis:undefined}),{candidate:false});
    await seed(db,advertisement('99999994',{ad_text:'Marka duyurusu',visible_text:'Marka duyurusu'}));
    await seed(db,advertisement('99999995'),{candidate:false});
    await seed(db,advertisement('99999998',{taxonomy_version:undefined}),{candidate:false});
    const result=await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner);
    assert.equal(result.reclassified,1);
    const rows=(await db.query('SELECT analysis_json FROM ad_visual_items ORDER BY ad_key')).rows.map(x=>x.analysis_json);
    assert.deepEqual(rows.map(x=>x.category),['review','review','review','review','review','mnp','review']);
    await seed(db,advertisement('99999996'));
    await db.query('DELETE FROM ad_visual_evidence');
    assert.equal((await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner)).reclassified,0);
  }finally{await db.close()}
});

test('a lost lease or failed candidate update cannot partially publish a correction',async()=>{
  const db=await fixture();
  try{
    await seed(db,advertisement());
    await assert.rejects(repairReviewCategories(db,HOME_INTERNET_SOURCES,'wrong-owner'),/CLOUD_LEASE_LOST/);
    const guarded={query:async(sql,params)=>{
      if(sql.includes("UPDATE ad_cloud_candidates SET analysis_json=COALESCE"))throw new Error('synthetic candidate write failure');
      return db.query(sql,params);
    }};
    await assert.rejects(repairReviewCategories(guarded,HOME_INTERNET_SOURCES,owner),/synthetic candidate write failure/);
    assert.equal((await db.query('SELECT category FROM ad_visual_items')).rows[0].category,'review');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM ad_visual_versions')).rows[0].n,1);
    assert.equal((await db.query('SELECT analysis_json FROM ad_cloud_candidates')).rows[0].analysis_json.category,'review');
  }finally{await db.close()}
});

test('category evidence provenance cannot bypass source identity or change commercial facts',async()=>{
  const db=await fixture();
  try{
    const before=await seed(db,advertisement('99999997',{ad_text:'My Vodafone, size özel fırsatlarıyla 7/24 hizmetinizde :)',visible_text:'Vodafone'}));
    const proposal=proposeStoredCategory(before),now=new Date().toISOString();
    const updated={...before,category:proposal.category,category_label:proposal.category_label,category_evidence:proposal.category_evidence,
      category_assignment:{method:'stored_evidence',rule:proposal.classification_rule,version:1,evidence_source:proposal.evidence_source,previous_category:'review',reviewed_at:now}};
    const feed={schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Günlük tarama',timezone:'Asia/Famagusta'},run:{id:'repair-validation-test',checked_at:now,status:'partial',coverage:[]},ads:[updated]};
    const existingLabel=structuredClone(feed);existingLabel.ads[0].category_label='DİJİTAL HİZMETLER';
    assert.equal(validateAdFeed(existingLabel,HOME_INTERNET_SOURCES).ads[0].category_label,'DİJİTAL HİZMETLER');
    for(const mutate of [a=>a.category_assignment.rule='arbitrary',a=>a.category_assignment.version=999,a=>a.category_assignment.evidence_source='visible_text',a=>a.category_evidence='Uydurma alıntı',a=>a.category='home']){
      const bad=structuredClone(feed);mutate(bad.ads[0]);assert.throws(()=>validateAdFeed(bad,HOME_INTERNET_SOURCES),/kanıt/);
    }
    const valid=validateAdFeed(feed,HOME_INTERNET_SOURCES);valid.ads[0].offer.price_try=999;
    await assert.rejects(importAdFeed(db,valid,{reanalysis:true,preserveSync:true}),/teklif, gözlem veya AI/);
    assert.equal((await db.query('SELECT category FROM ad_visual_items')).rows[0].category,'review');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM ad_visual_versions')).rows[0].n,1);
    assert.equal(verifiedFixedIspPageId({brand:'Nethouse',page_id:'159064954156749'},HOME_INTERNET_SOURCES),'159064954156749');
    for(const ad of [{brand:'Nethouse',page_id:'164143610515'},{brand:'Telsim',page_id:'164143610515'},{brand:'Turkcell Ev İnterneti',page_id:'127496543986832'}])assert.equal(verifiedFixedIspPageId(ad,HOME_INTERNET_SOURCES),undefined);
  }finally{await db.close()}
});

test('fresh AI reading of a repaired archive card does not inherit the old category assignment',async()=>{
  const db=await fixture();
  try{
    const before=await seed(db,advertisement('99999989'),{candidate:false});
    await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner);
    assert.equal((await queueStoredAdReviews(db,HOME_INTERNET_SOURCES,{manual:true,key:before.key})).queued,1);
    const result=await analyzeNextCloudCandidate(db,HOME_INTERNET_SOURCES,owner,{
      env:{OPENAI_API_KEY:'synthetic',AD_VISION_DAILY_LIMIT:'40'},
      analyze:async()=>({...before,category:'mnp',category_evidence:'Numaranızı Telsim’e taşıyın',title:'Yeniden okunan teklif'})
    });
    assert.equal(result.status,'analyzed');
    const ad=(await db.query('SELECT analysis_json FROM ad_visual_items')).rows[0].analysis_json;
    assert.equal(ad.category,'mnp');assert.equal(ad.category_assignment,undefined);
    assert.equal(ad.title,'Yeniden okunan teklif');
    assert.deepEqual((await db.query('SELECT event_type FROM ad_visual_versions ORDER BY id')).rows.map(x=>x.event_type),['first_seen','category_updated','analysis_updated']);
  }finally{await db.close()}
});

test('durable repair cursor passes 400 ambiguous cards and resumes after the 100-correction cap without gaps',async()=>{
  const db=await fixture();
  try{
    const ads=Array.from({length:501},(_,index)=>advertisement(String(70000000+index),index<400?
      {ad_text:'Marka duyurusu',visible_text:'Marka duyurusu'}:{}));
    for(let start=0;start<ads.length;start+=400){
      const feed=validateAdFeed({schema_version:1,producer:'cloud-vision',schedule:{enabled:true,description:'Günlük bulut taraması',timezone:'Asia/Famagusta'},
        run:{id:'seed-cursor-page-'+start,checked_at:observed,status:'partial',coverage:[]},ads:ads.slice(start,start+400)},HOME_INTERNET_SOURCES);
      await importAdFeed(db,feed,{fetcher:async()=>new Response(jpeg)});
    }
    const controlBefore=(await db.query('SELECT * FROM ad_cloud_control')).rows[0];
    const first=await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner);
    assert.equal(first.reclassified,0);
    assert.equal((await db.query('SELECT category_repair_after FROM ad_cloud_control')).rows[0].category_repair_after,'164143610515:70000399:1');
    await db.exec(SCHEMA_SQL);
    assert.equal((await db.query('SELECT category_repair_after FROM ad_cloud_control')).rows[0].category_repair_after,'164143610515:70000399:1','restart migration retains progress');
    const second=await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner);
    assert.equal(second.reclassified,100);
    assert.equal((await db.query('SELECT category_repair_after FROM ad_cloud_control')).rows[0].category_repair_after,'164143610515:70000499:1','cursor ends at the last processed item, not the fetched page end');
    assert.equal((await db.query("SELECT category FROM ad_visual_items WHERE ad_key='164143610515:70000500:1'")).rows[0].category,'review');
    assert.equal((await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner)).reclassified,1);
    assert.equal((await db.query('SELECT category_repair_after FROM ad_cloud_control')).rows[0].category_repair_after,null);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM ad_visual_items WHERE category='mnp'")).rows[0].n,101);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM ad_visual_versions WHERE event_type='category_updated'")).rows[0].n,101);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_control')).rows[0],controlBefore,'a completed pass leaves budgets and schedule unchanged');
    await db.query("UPDATE ad_cloud_control SET category_repair_after='999999999999999999999999999999:999999999999999999999999999999:zz'");
    assert.equal((await repairReviewCategories(db,HOME_INTERNET_SOURCES,owner)).reclassified,0);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_control')).rows[0],controlBefore,'an empty end resets only the scan cursor');
  }finally{await db.close()}
});
