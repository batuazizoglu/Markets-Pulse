import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import express from 'express';
import sharp from 'sharp';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {SCHEMA_SQL} from '../src/schema.js';
import {buildAdReportSection,registerReportMediaRoutes} from '../src/report-ad-media.js';
import {REPORT_NAMES,REPORT_TZ} from '../src/report-data.js';
import {monthlyOverviewHtml} from '../src/monthly-report-content.js';

test('email and PDF use the same prepared creative; public route exposes only report derivatives',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);let server;
  try{
    const jpeg=await sharp({create:{width:600,height:800,channels:3,background:'#184fa0'}}).jpeg().toBuffer();
    const sourceHash=createHash('sha256').update(jpeg).digest('hex');
    const at=new Date(),start=new Date(+at-1000),end=new Date(+at+1000);
    const ad={key:'123456:789012:1',brand:'Telsim',category:'home',title:'20 Mbps ev interneti',ad_id:'789012',ad_status:'active',observed_at:at.toISOString(),source_url:'https://www.facebook.com/ads/library/?id=789012',offer:{price_try:779,speed_mbps:20,billing_period:'monthly'},conditions:['Kurulum şartları geçerlidir.'],uncertainties:[],visual_summary:'Mavi zemin üzerinde ev interneti teklifi.',images:[{sha256:sourceHash,role:'creative',captured_at:at.toISOString()}]};
    await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',[sourceHash,jpeg]);
    await db.query("INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,'test',$5)",[ad.key,ad.brand,ad.category,at,JSON.stringify(ad)]);
    await db.query("INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,'first_seen',$3)",[ad.key,at,JSON.stringify(ad)]);
    const ctx=await buildAdReportSection(db,'daily',start,end);
    const html=new JSDOM(ctx.ad_analysis_html),pdf=new JSDOM(ctx.ad_analysis_html_pdf);
    const emailSrc=html.window.document.querySelector('.ad-report-image').src;
    assert.match(emailSrc,/^https:\/\/www\.marketspulse\.cloud\/report-media\/[a-f0-9]{64}\.jpg$/);
    assert.doesNotMatch(ctx.ad_analysis_html,/src="(?:data:|cid:|\/api\/)/);
    const embedded=pdf.window.document.querySelector('.ad-report-image').src;
    assert.match(embedded,/^data:image\/jpeg;base64,/);
    const bytes=Buffer.from(embedded.split(',')[1],'base64'),derivedHash=emailSrc.match(/([a-f0-9]{64})\.jpg$/)[1];
    assert.equal(createHash('sha256').update(bytes).digest('hex'),derivedHash);
    assert.equal(ctx.ad_report_image_summary.prepared,1);
    await buildAdReportSection(db,'daily',start,end);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_report_image_assets')).rows[0].n,1);
    const app=express();registerReportMediaRoutes(app,db);app.use((req,res)=>res.status(401).end());
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const image=await fetch(base+'/report-media/'+derivedHash+'.jpg');
    assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/^image\/jpeg/);
    assert.match(image.headers.get('cache-control'),/immutable/);assert.equal(image.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
    assert.equal((await fetch(base+'/report-media/'+'f'.repeat(64)+'.jpg')).status,404);
    assert.equal((await fetch(base+'/report-media/not-a-hash.jpg')).status,404);
    assert.equal((await fetch(base+'/api/ad-visuals/evidence/'+sourceHash+'.jpg')).status,401);
    html.window.close();pdf.window.close();
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close()}
});

test('all HTML email families retain the illustrated ad section without sending email',async()=>{
  const source=await readFile(new URL('../src/report-email.js',import.meta.url),'utf8');
  const helpers=source.split('\n').filter(line=>line.startsWith('function esc(')||line.startsWith('function localDate(')).join('\n');
  const body=source.slice(source.indexOf('function signed('),source.indexOf('export async function sendReportEmail('));
  const render=compileFunction(helpers+'\n'+body+'\nreturn emailHtml(type,ctx,attachments);',['type','ctx','attachments','REPORT_NAMES','REPORT_TZ','monthlyOverviewHtml']);
  const at=new Date().toISOString();
  const ctx={days:1,period_start:at,period_end:at,home:{products:[],sources:[],changes:[]},market:{},benchmark:{},stats:{},sources:[],score_deltas:[],ad_analysis_html:'<section class="ad-report"><img alt="Reklam" src="https://www.marketspulse.cloud/report-media/'+'a'.repeat(64)+'.jpg"></section>'};
  for(const type of ['daily','weekly','monthly','home','fwa']){
    const dom=new JSDOM(render(type,ctx,[],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml));
    assert.equal(dom.window.document.querySelectorAll('.ad-report img').length,1,type);
    dom.window.close();
  }
});

test('unverified archive screenshots stay PDF-only even if another row proves the same image',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const at=new Date(),start=new Date(+at-1000),end=new Date(+at+1000);
    const images=await Promise.all(['#184fa0','#e8b54c'].map(background=>sharp({create:{width:600,height:800,channels:3,background}}).jpeg().toBuffer()));
    const hashes=images.map(bytes=>createHash('sha256').update(bytes).digest('hex'));
    for(let index=0;index<images.length;index++)await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',[hashes[index],images[index]]);
    const rows=[{id:'789012',image:hashes[0],role:'creative'},{id:'789013',image:hashes[1]},{id:'789014',image:hashes[0]}];
    for(const row of rows){
      const ad={key:'123456:'+row.id+':1',brand:'Telsim',category:'home',title:'Reklam '+row.id,ad_id:row.id,ad_status:'active',observed_at:at.toISOString(),source_url:'https://www.facebook.com/ads/library/?id='+row.id,offer:{price_try:779,billing_period:'monthly'},conditions:[],uncertainties:[],visual_summary:'Arşivdeki teklif.',images:[{sha256:row.image,...(row.role?{role:row.role}:{})}]};
      await db.query("INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,'test',$5)",[ad.key,ad.brand,ad.category,at,JSON.stringify(ad)]);
      await db.query("INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,'first_seen',$3)",[ad.key,at,JSON.stringify(ad)]);
    }
    const result=await buildAdReportSection(db,'daily',start,end),email=new JSDOM(result.ad_analysis_html),pdf=new JSDOM(result.ad_analysis_html_pdf);
    try{
      const cards=[...email.window.document.querySelectorAll('.ad-report-card')];
      assert.equal(cards.length,3);assert.equal(email.window.document.querySelectorAll('.ad-report-image').length,1);
      for(const id of ['789013','789014'])assert.equal(cards.find(card=>card.textContent.includes(id)).querySelector('img'),null);
      assert.equal(pdf.window.document.querySelectorAll('.ad-report-image').length,3);
      assert.equal((await db.query('SELECT count(*)::int n FROM ad_report_image_assets')).rows[0].n,1);
      assert.equal(result.ad_report_image_summary.prepared,1);assert.equal(result.ad_report_image_summary.unavailable,2);
      assert.match(email.window.document.body.textContent,/1 kayıtta reklam görseli kullanıldı/);
      assert.match(pdf.window.document.body.textContent,/3 kayıtta reklam görseli kullanıldı/);
    }finally{email.window.close();pdf.window.close()}
  }finally{await db.close()}
});

test('a public-media write failure preserves the report and PDF with a text-only email fallback',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const at=new Date(),start=new Date(+at-1000),end=new Date(+at+1000),jpeg=await sharp({create:{width:400,height:600,channels:3,background:'#184fa0'}}).jpeg().toBuffer();
    const digest=createHash('sha256').update(jpeg).digest('hex');
    const ad={key:'123456:789012:1',brand:'Telsim',category:'home',title:'Korunan reklam',ad_id:'789012',observed_at:at.toISOString(),source_url:'https://www.facebook.com/ads/library/?id=789012',offer:{price_try:779,billing_period:'monthly'},conditions:[],uncertainties:[],images:[{sha256:digest,role:'creative'}]};
    await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',[digest,jpeg]);
    await db.query("INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json) VALUES($1,$2,$3,$4,$4,'test',$5)",[ad.key,ad.brand,ad.category,at,JSON.stringify(ad)]);
    await db.query("INSERT INTO ad_visual_versions(ad_key,observed_at,event_type,analysis_json) VALUES($1,$2,'first_seen',$3)",[ad.key,at,JSON.stringify(ad)]);
    const pool={query:async(sql,values)=>{if(sql.startsWith('INSERT INTO ad_report_image_assets'))throw new Error('Simulated media write failure');return db.query(sql,values)}};
    const result=await buildAdReportSection(pool,'daily',start,end),email=new JSDOM(result.ad_analysis_html),pdf=new JSDOM(result.ad_analysis_html_pdf);
    try{
      assert.equal(email.window.document.querySelector('.ad-report-image'),null);assert.match(email.window.document.body.textContent,/Korunan reklam/);
      assert.match(pdf.window.document.querySelector('.ad-report-image').src,/^data:image\/jpeg;base64,/);
      assert.equal(result.ad_report_image_summary.prepared,0);assert.equal(result.ad_report_image_summary.unavailable,1);
      assert.equal((await db.query('SELECT count(*)::int n FROM ad_report_image_assets')).rows[0].n,0);
    }finally{email.window.close();pdf.window.close()}
  }finally{await db.close()}
});
