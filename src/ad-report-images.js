import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {displayedAdReportRows,reportCategories} from './ad-visual-report.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bounds={maxImages:24,maxBytes:150*1024,maxWidth:960,maxHeight:1280};
const jpegOptions={limitInputPixels:16000000,failOn:'error'};

// Remove only an unbroken, nearly uniform outer border. Never infer a subject
// bounding box or center-crop a creative: prices and small print can be at any edge.
function uniformBorder(data,width,height,channels){
  const pixel=(x,y)=>Array.from(data.subarray((y*width+x)*channels,(y*width+x)*channels+3));
  const background=pixel(0,0);
  if(!background.every(value=>value>=248)&&!background.every(value=>value<=7))return null;
  const same=(x,y)=>pixel(x,y).every((value,i)=>Math.abs(value-background[i])<=2);
  if(!same(width-1,0)||!same(0,height-1)||!same(width-1,height-1))return null;
  const line=(axis,at)=>{const end=axis==='row'?width:height;for(let i=0;i<end;i++)if(!same(axis==='row'?i:at,axis==='row'?at:i))return false;return true};
  const xMax=Math.floor(width*0.1),yMax=Math.floor(height*0.1);
  let left=0,right=0,top=0,bottom=0;
  while(top<yMax&&line('row',top))top++;
  while(bottom<yMax&&line('row',height-bottom-1))bottom++;
  while(left<xMax&&line('column',left))left++;
  while(right<xMax&&line('column',width-right-1))right++;
  // Keep a small safety margin and reject a broad/plain background whose actual
  // boundary was not reached. The retained area is at least 85% of the original.
  if(top===yMax||bottom===yMax||left===xMax||right===xMax)return null;
  top=Math.max(0,top-2);bottom=Math.max(0,bottom-2);left=Math.max(0,left-2);right=Math.max(0,right-2);
  const crop={left,top,width:width-left-right,height:height-top-bottom};
  return (left+right+top+bottom>=8&&crop.width*crop.height>=width*height*0.85)?crop:null;
}

export async function cropAdReportImage(bytes,{maxBytes=bounds.maxBytes,maxWidth=bounds.maxWidth,maxHeight=bounds.maxHeight}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length>1500000||bytes[0]!==255||bytes[1]!==216)throw new Error('AD_REPORT_INVALID_IMAGE');
  maxBytes=Math.max(16384,Math.min(bounds.maxBytes,Number(maxBytes)||bounds.maxBytes));
  maxWidth=Math.max(160,Math.min(bounds.maxWidth,Number(maxWidth)||bounds.maxWidth));
  maxHeight=Math.max(160,Math.min(bounds.maxHeight,Number(maxHeight)||bounds.maxHeight));
  const raw=await sharp(bytes,jpegOptions).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=raw.info;
  if(width<32||height<32)throw new Error('AD_REPORT_IMAGE_TOO_SMALL');
  const crop=uniformBorder(raw.data,width,height,channels);
  for(const [scale,quality] of [[1,84],[1,74],[1,64],[0.8,64],[0.65,60]]){
    let image=sharp(raw.data,{raw:{width,height,channels}});if(crop)image=image.extract(crop);
    const encoded=await image.resize({width:Math.round(maxWidth*scale),height:Math.round(maxHeight*scale),fit:'inside',withoutEnlargement:true}).jpeg({quality,mozjpeg:true}).toBuffer({resolveWithObject:true});
    if(encoded.data.length<=maxBytes)return {content:encoded.data,width:encoded.info.width,height:encoded.info.height,cropped:Boolean(crop),crop:crop||null};
  }
  throw new Error('AD_REPORT_IMAGE_TOO_LARGE');
}

function orderedRows(data){
  const displayed=displayedAdReportRows(data),groups=reportCategories(data).map(([key])=>displayed.filter(row=>row.analysis_json?.category===key));
  const result=[];for(let index=0;groups.some(group=>group[index]);index++)for(const group of groups)if(group[index])result.push(group[index]);
  return result;
}
function imagesOf(row){return (Array.isArray(row.analysis_json?.images)?row.analysis_json.images:[]).filter(image=>validHash(image.sha256)).slice(0,3)}

export async function prepareAdReportImages(pool,data,{maxImages=bounds.maxImages,...options}={}){
  if(!data)return {data,images:[]};
  maxImages=Math.max(0,Math.min(bounds.maxImages,Math.floor(Number(maxImages)||0)));
  const rows=(data.rows||[]).map(row=>{const {report_image,...rest}=row;return rest}),result={...data,rows};
  const displayed=orderedRows(result),selected=displayed.slice(0,maxImages),images=[],cache=new Map();
  const summary={prepared:0,unavailable:0,limited:Math.max(0,displayed.length-selected.length),total_bytes:0};
  result.image_summary=summary;
  if(!selected.length)return {data:result,images};
  // A historical pair is used as card + creative only when the durable browser
  // capture itself proves that exact ordered pair. Imported/manual evidence is
  // not assumed to follow that convention, nor is a later version substituted.
  let browserPairs=new Map();
  const keys=[...new Set(selected.filter(row=>imagesOf(row).length===2&&!imagesOf(row).some(image=>image.role==='creative')).map(row=>row.analysis_json?.key).filter(Boolean))];
  if(keys.length)try{
    const found=await pool.query(`SELECT c.ad_key,c.payload->'images' images FROM ad_cloud_candidates c
      JOIN ad_cloud_jobs j ON j.id=c.job_id WHERE c.ad_key=ANY($1::text[]) AND j.status<>'imported'
      AND NOT EXISTS(SELECT 1 FROM ad_provider_runs p WHERE p.job_id=j.id)`,[keys]);
    browserPairs=new Map(found.rows.map(row=>[row.ad_key,(row.images||[]).map(image=>image.sha256)]));
  }catch{/* Provenance unavailable: retain the first evidence image. */}
  // Before explicit roles were stored, the provider persisted one downloaded
  // creative per candidate. media_kind also exists on imported/manual records,
  // so it is not proof: require the exact candidate image and a provider-run job.
  let providerImages=new Map();
  const providerKeys=[...new Set(selected.filter(row=>imagesOf(row).length===1&&!imagesOf(row)[0].role).map(row=>row.analysis_json?.key).filter(Boolean))];
  if(providerKeys.length)try{
    const found=await pool.query(`SELECT c.ad_key,c.payload->'images' images FROM ad_cloud_candidates c
      JOIN ad_cloud_jobs j ON j.id=c.job_id JOIN ad_provider_runs p ON p.job_id=j.id
      WHERE c.ad_key=ANY($1::text[]) AND j.status<>'imported'`,[providerKeys]);
    providerImages=new Map(found.rows.map(row=>[row.ad_key,Array.isArray(row.images)?row.images:[]]));
  }catch{/* No durable provider proof: the image remains archive evidence only. */}
  const plans=selected.map(row=>{
    const candidates=imagesOf(row),explicit=candidates.find(image=>image.role==='creative'),pair=browserPairs.get(row.analysis_json?.key),provider=providerImages.get(row.analysis_json?.key);
    const browserCreative=pair?.length===2&&candidates.length===2&&candidates[1].role!=='ad_card'&&candidates.every((image,index)=>image.sha256===pair[index]);
    const providerCreative=provider?.length===1&&candidates.length===1&&!candidates[0].role&&provider[0]?.role!=='ad_card'&&provider[0]?.sha256===candidates[0].sha256;
    const chosen=explicit||(browserCreative?candidates[1]:candidates[0]);
    return {row,candidates:chosen?[chosen,...candidates.filter(image=>image.sha256!==chosen.sha256)]:[],selection:explicit||providerCreative?'creative':browserCreative?'browser_creative':'evidence'};
  });
  // Bounded, hash-addressed archive reads only. No CDN or authenticated HTTP URL
  // is fetched, and the original evidence in the archive is never changed.
  const hashes=[...new Set(plans.flatMap(plan=>plan.candidates.map(image=>image.sha256)))];
  let stored=new Map();
  if(hashes.length)try{const found=await pool.query('SELECT sha256,jpeg FROM ad_visual_evidence WHERE sha256=ANY($1::text[])',[hashes]);stored=new Map(found.rows.map(row=>[row.sha256,Buffer.from(row.jpeg)]))}catch{/* A missing archive must not suppress the report. */}
  for(const plan of plans){
    let prepared=null;
    for(const [index,image] of plan.candidates.entries()){
      if(!cache.has(image.sha256)){
        const bytes=stored.get(image.sha256);
        try{cache.set(image.sha256,bytes&&sha(bytes)===image.sha256?await cropAdReportImage(bytes,options):null)}catch{cache.set(image.sha256,null)}
      }
      const output=cache.get(image.sha256);if(!output)continue;
      const hash=sha(output.content),cid='ad-'+hash+'.jpg';
      if(!images.some(item=>item.sha256===hash)){images.push({sha256:hash,cid,filename:cid,contentType:'image/jpeg',content:output.content,width:output.width,height:output.height});summary.total_bytes+=output.content.length}
      prepared={sha256:hash,source_sha256:image.sha256,cid,width:output.width,height:output.height,selection:index?'evidence':plan.selection,cropped:output.cropped};break;
    }
    if(prepared){plan.row.report_image=prepared;summary.prepared++}else summary.unavailable++;
  }
  return {data:result,images};
}
