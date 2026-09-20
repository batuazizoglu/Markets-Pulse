import sharp from 'sharp';

// Decode before admission to the evidence archive; a MIME header is insufficient.
export async function normalizeProviderJpeg({bytes,mime}){
  const fail=code=>Object.assign(new Error(code),{code});
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw fail('PROVIDER_IMAGE_SIZE');
  if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(mime))throw fail('PROVIDER_IMAGE_TYPE');
  try{
    const decoded=sharp(bytes,{limitInputPixels:40000000,failOn:'warning',animated:false});
    const meta=await decoded.metadata();
    if(!['jpeg','png','webp','gif','avif','heif'].includes(meta.format)||!meta.width||!meta.height)throw fail('PROVIDER_IMAGE_INVALID');
    // Static preview only. No hidden metadata or animated frames leave this decoder.
    const base=decoded.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'});
    let result=await base.clone().jpeg({quality:88,mozjpeg:true}).toBuffer();
    if(result.length>1500000)result=await base.clone().resize({width:1500,height:1500,fit:'inside',withoutEnlargement:true}).jpeg({quality:75,mozjpeg:true}).toBuffer();
    if(result.length>1500000)throw fail('PROVIDER_IMAGE_SIZE');
    return result;
  }catch(e){
    if(/^PROVIDER_IMAGE_/.test(e.code||''))throw e;
    throw fail('PROVIDER_IMAGE_INVALID');
  }
}
