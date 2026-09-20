import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeProviderJpeg} from '../src/ad-provider-image.js';

test('provider PNG/WebP creatives decode to bounded JPEG evidence',async()=>{
  for(const format of ['png','webp']){
    const bytes=await sharp({create:{width:3000,height:1500,channels:4,background:'#c1282860'}})[format]().toBuffer();
    const jpeg=await normalizeProviderJpeg({bytes,mime:'image/'+format});
    const meta=await sharp(jpeg).metadata();
    assert.equal(meta.format,'jpeg');assert.equal(meta.width,2000);assert.equal(meta.height,1000);
    assert.ok(jpeg.length<1500000);assert.equal(meta.exif,undefined);
  }
});
test('invalid, oversized and mislabeled document responses cannot become evidence',async()=>{
  for(const input of [
    {bytes:Buffer.from('<html>login required</html>'),mime:'image/jpeg'},
    {bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>'),mime:'image/png'},
    {bytes:Buffer.alloc(8*1024*1024+1),mime:'image/jpeg'},
    {bytes:Buffer.from('%PDF'),mime:'application/pdf'}
  ])await assert.rejects(()=>normalizeProviderJpeg(input),e=>/^PROVIDER_IMAGE_/.test(e.code));
});
