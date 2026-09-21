import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {JSDOM} from 'jsdom';
import {cropAdReportImage,prepareAdReportImages} from '../src/ad-report-images.js';
import {adVisualReportHtml} from '../src/ad-visual-report.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const at='2026-09-21T06:00:00Z';
async function creative({width=600,height=800,border=0}={}){
  // The blue footer stands for small-print conditions at the creative's edge.
  const picture=await sharp({create:{width:width-border*2,height:height-border*2,channels:3,background:'#c43a53'}}).composite([{input:await sharp({create:{width:width-border*2,height:24,channels:3,background:'#163dba'}}).png().toBuffer(),top:height-border*2-24,left:0}]).png().toBuffer();
  return sharp({create:{width,height,channels:3,background:'white'}}).composite([{input:picture,top:border,left:border}]).jpeg({quality:96,chromaSubsampling:'4:4:4'}).toBuffer();
}
function row(id,images,category='home'){
  return {event_type:'first_seen',observed_at:at,analysis_json:{key:'111111:'+id+':1',ad_id:String(id),brand:'Telsim',title:'Ev interneti',category,source_url:'https://www.facebook.com/ads/library/?id='+id,observed_at:at,visual_summary:'Paket görseli',offer:{price_try:499,billing_period:'monthly',speed_mbps:20},conditions:['İlk 12 ay'],uncertainties:['Kurulum bedeli okunamadı'],images:images.map(item=>typeof item==='string'?{sha256:item}:item)}};
}
function poolFor(assets,{pairs=[],throwAssets=false}={}){
  const calls=[];return {calls,query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('ad_cloud_candidates'))return {rows:pairs};
    assert.match(sql,/SELECT sha256,jpeg FROM ad_visual_evidence WHERE sha256=ANY/);
    if(throwAssets)throw new Error('Archive unavailable');
    return {rows:params[0].filter(id=>assets.has(id)).map(id=>({sha256:id,jpeg:assets.get(id)}))};
  }};
}

test('report crop removes only a uniform border, retains edge fine print and never upscales',async()=>{
  const source=await creative({width:600,height:800,border:12}),output=await cropAdReportImage(source);
  assert.equal(output.cropped,true);assert.ok(output.width<600&&output.height<800);assert.ok(output.width>=576&&output.height>=776);
  const {data,info}=await sharp(output.content).raw().toBuffer({resolveWithObject:true});
  const offset=((info.height-12)*info.width+Math.floor(info.width/2))*info.channels;
  assert.ok(data[offset+2]>data[offset]+70,'blue small-print footer was retained');
  const small=await cropAdReportImage(await creative({width:120,height:180}));
  assert.equal(small.width,120);assert.equal(small.height,180);assert.equal(small.cropped,false);
  const edge=await cropAdReportImage(await creative());assert.equal(edge.cropped,false);assert.equal(edge.width,600);assert.equal(edge.height,800);
});

test('large creatives respect JPEG byte and dimension bounds without cover cropping',async()=>{
  const input=await creative({width:1500,height:2000}),output=await cropAdReportImage(input);
  assert.ok(output.content.length<=153600);assert.ok(output.width<=960&&output.height<=1280);
  assert.equal(output.width/output.height,1500/2000);assert.equal(output.cropped,false);
});

test('archive selection prefers explicit creative roles, deduplicates derivatives and preserves evidence bytes',async()=>{
  const card=await creative({width:400,height:1000}),image=await creative({border:12});
  const assets=new Map([[hash(card),card],[hash(image),image]]),pool=poolFor(assets);
  const first=row(123456,[{sha256:hash(card),role:'ad_card'},{sha256:hash(image),role:'creative'}]);
  const second=row(123457,[{sha256:hash(image),role:'creative'}],'gsm');
  const original={checked_at:at,status:'ok',rows:[first,second]},prepared=await prepareAdReportImages(pool,original);
  assert.equal(prepared.images.length,1);assert.equal(prepared.data.image_summary.prepared,2);assert.equal(first.report_image,undefined);
  assert.equal(prepared.data.rows[0].report_image.source_sha256,hash(image));assert.equal(prepared.data.rows[0].report_image.selection,'creative');
  assert.equal(prepared.images[0].sha256,hash(prepared.images[0].content));assert.equal(prepared.images[0].cid,prepared.images[0].filename);
  assert.notEqual(prepared.images[0].sha256,hash(image));assert.deepEqual(assets.get(hash(image)),image);
  const cardOnly=row(123458,[{sha256:hash(card),role:'ad_card'}]);cardOnly.analysis_json.media_kind='image';
  const guarded=await prepareAdReportImages(pool,{rows:[cardOnly]});assert.equal(guarded.data.rows[0].report_image.selection,'evidence');
});

test('historical second image requires an exact ordered browser-capture proof',async()=>{
  const card=await creative({width:400,height:1000}),image=await creative(),assets=new Map([[hash(card),card],[hash(image),image]]);
  const first=row(123456,[hash(card),hash(image)]),second=row(123457,[hash(card),hash(image)]),third=row(123458,[hash(card),hash(image)]);
  const pool=poolFor(assets,{pairs:[{ad_key:first.analysis_json.key,images:[{sha256:hash(card)},{sha256:hash(image)}]},{ad_key:third.analysis_json.key,images:[{sha256:hash(image)},{sha256:hash(card)}]}]});
  const {data}=await prepareAdReportImages(pool,{rows:[first,second,third]});
  assert.equal(data.rows[0].report_image.source_sha256,hash(image));assert.equal(data.rows[0].report_image.selection,'browser_creative');
  assert.equal(data.rows[1].report_image.source_sha256,hash(card));assert.equal(data.rows[2].report_image.source_sha256,hash(card));
  assert.match(pool.calls[0].sql,/j.status<>'imported'/);assert.match(pool.calls[0].sql,/NOT EXISTS\(SELECT 1 FROM ad_provider_runs/);
});

test('missing, corrupt and hash-mismatched assets fall back without suppressing report text',async()=>{
  const image=await creative(),corrupt=Buffer.from([255,216,10,20,30]),missing='a'.repeat(64),mismatch='b'.repeat(64);
  const assets=new Map([[hash(image),image],[hash(corrupt),corrupt],[mismatch,image]]);
  const rows=[row(123456,[missing]),row(123457,[hash(corrupt)]),row(123458,[mismatch]),row(123459,[{sha256:hash(corrupt),role:'creative'},{sha256:hash(image),role:'ad_card'}])];
  const {data,images}=await prepareAdReportImages(poolFor(assets),{rows});
  assert.equal(data.image_summary.prepared,1);assert.equal(data.image_summary.unavailable,3);assert.equal(images.length,1);
  assert.equal(data.rows[3].report_image.selection,'evidence');assert.equal(data.rows.length,4);
  const failed=await prepareAdReportImages(poolFor(assets,{throwAssets:true}),{rows});assert.equal(failed.data.image_summary.unavailable,4);
  const html=adVisualReportHtml(data);assert.match(html,/3 kaydın görseli hazırlanamadı/);assert.match(html,/123456/);
});

test('global image budget is shared across categories and matches displayed rows only',async()=>{
  const image=await creative(),id=hash(image),rows=[...Array.from({length:13},(_,index)=>row(100000+index,[id])),row(200000,[id],'gsm'),row(300000,[id],'mnp')];
  const {data}=await prepareAdReportImages(poolFor(new Map([[id,image]])),{rows},{maxImages:3});
  assert.equal(data.image_summary.prepared,3);assert.equal(data.image_summary.limited,11);
  assert.equal(data.rows.filter(item=>item.report_image).length,3);assert.ok(data.rows[0].report_image);assert.ok(data.rows[13].report_image);assert.ok(data.rows[14].report_image);assert.equal(data.rows[12].report_image,undefined);
  const html=adVisualReportHtml(data);assert.match(html,/İlk 12 \/ 13 kayıt/);assert.match(html,/11 kayıt, rapor boyutunu sınırlamak/);
});

test('report uses bounded embedded or own public media only and escapes every analysis field',()=>{
  const sample=row(123456,[]),digest='a'.repeat(64);sample.report_image={cid:'ad-'+digest+'.jpg',selection:'creative',cropped:true};
  sample.analysis_json.title='<img src=x onerror=alert(1)>';sample.analysis_json.visual_summary='<script>bad()</script>';sample.analysis_json.source_url='javascript:bad()';
  const data={checked_at:at,rows:[sample]};
  for(const src of ['cid:ad-'+digest+'.jpg','data:image/jpeg;base64,/9j/2Q==','https://www.marketspulse.cloud/report-media/'+digest+'.jpg']){
    const dom=new JSDOM(adVisualReportHtml(data,{imageSrc:()=>src}));
    try{assert.equal(dom.window.document.querySelectorAll('img').length,1);assert.equal(dom.window.document.querySelector('script,[onerror],a[href^="javascript:"]'),null);assert.ok(dom.window.document.body.textContent.includes('<script>bad()</script>'))}finally{dom.window.close()}
  }
  for(const src of ['https://scontent.fbcdn.net/private.jpg?token=secret','https://www.marketspulse.cloud/api/ad-visuals/evidence/'+digest,'data:image/svg+xml;base64,AAAA','javascript:bad()','https://www.marketspulse.cloud/report-media/'+digest+'.jpg?token=secret']){
    const dom=new JSDOM(adVisualReportHtml(data,{imageSrc:()=>src}));try{assert.equal(dom.window.document.querySelector('img'),null)}finally{dom.window.close()}
  }
});

test('long PDF details continue outside the intact card without dropping conditions or uncertainty',()=>{
  const sample=row(123456,[]);sample.analysis_json.visual_summary='Başlangıç '+('uzun görsel açıklaması '.repeat(60))+' SONÖZET';
  sample.analysis_json.conditions=['Koşul '+('bütün ayrıntılar '.repeat(60))+' SONKOŞUL'];sample.analysis_json.uncertainties=['SONBELİRSİZLİK'];
  const dom=new JSDOM(adVisualReportHtml({rows:[sample]},{mode:'pdf'}));
  try{const d=dom.window.document;assert.ok(d.querySelector('.ad-report-continuation'));assert.ok(d.querySelector('.ad-report-card').textContent.length<1000);for(const text of ['SONÖZET','SONKOŞUL','SONBELİRSİZLİK'])assert.ok(d.querySelector('.ad-report-continuation').textContent.includes(text));assert.ok([...d.querySelectorAll('.ad-report-continuation p')].every(el=>el.textContent.length<=550))}finally{dom.window.close()}
});
