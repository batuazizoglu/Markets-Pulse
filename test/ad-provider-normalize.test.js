import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProviderItem} from '../src/ad-provider-normalize.js';

const source={brand:'Nethouse',page_id:'159064954156749'};
const url=(name,signature='one')=>'https://scontent.xx.fbcdn.net/'+name+'.jpg?oh='+signature;
const item=(snapshot={})=>({pageID:source.page_id,pageId:source.page_id,adArchiveID:'123456789012345',adArchiveId:'123456789012345',isActive:true,startDateFormatted:'2026-09-20T08:00:00Z',snapshot:{pageId:source.page_id,...snapshot}});

test('verified IDs agree across every supplied alias; brand name alone is never accepted',()=>{
  const good=normalizeProviderItem(item({images:[{originalImageUrl:url('one')}]}),source);
  assert.equal(good.kind,'ad');assert.equal(good.page_id,source.page_id);assert.equal(good.ad_status,'active');assert.equal(good.started_on,'2026-09-20');
  for (const bad of [{...item(),pageId:'9999999999'},{...item(),snapshot:{pageId:'88888888'}},{...item(),adArchiveId:'2222222222'},{...item(),adArchiveID:9007199254740992},{...item(),inputUrl:'https://www.facebook.com/ads/library/?view_all_page_id=9999999999'}]) {
    assert.equal(normalizeProviderItem(bad,source).error,'PROVIDER_IDENTITY_MISMATCH');
  }
  assert.equal(normalizeProviderItem({pageName:'Nethouse',adArchiveID:'1234567890'},source).error,'PROVIDER_IDENTITY_MISSING');
  // adId is a separate provider identifier, not the archive identity.
  assert.equal(normalizeProviderItem({...item(),adId:'9999999999'},source).ad_id,'123456789012345');
});

test('all image/card/video/extra creatives are retained while resolution alternatives share one asset',()=>{
  const normalized=normalizeProviderItem(item({body:{text:'Ev interneti'},images:[{originalImageUrl:url('original'),resizedImageUrl:url('resized')}],cards:[{originalImageUrl:url('card1'),body:'20 Mbps 600 TL'},{originalImageUrl:url('card2'),body:'40 Mbps 900 TL'},{videoHdUrl:'https://video.xx.fbcdn.net/video.mp4',videoPreviewImageUrl:url('cardpreview')}],videos:[{videoPreviewImageUrl:url('preview')}],extraImages:[url('extra')],extraVideos:[{videoPreviewImageUrl:url('extraPreview')}],pageProfilePictureUrl:url('profile'),pageCoverPhoto:url('cover')}),source);
  assert.equal(normalized.assets.length,7);
  assert.equal(normalized.assets.filter(asset=>asset.kind==='video_preview').length,3);
  assert.deepEqual(normalized.assets[0].urls,[url('original'),url('resized')]);
  assert.equal(normalized.assets.some(asset=>asset.urls.some(value=>/profile|cover/.test(value))),false);
  assert.match(normalized.assets[1].ad_text,/20 Mbps 600 TL/);
});

test('signatures do not change stable creative IDs; different offers reusing one picture remain separate',()=>{
  const first=normalizeProviderItem(item({cards:[{originalImageUrl:url('same','first'),body:'600 TL'},{originalImageUrl:url('same','first'),body:'900 TL'}]}),source);
  const later=normalizeProviderItem(item({cards:[{originalImageUrl:url('same','later'),body:'600 TL'},{originalImageUrl:url('same','later'),body:'900 TL'}]}),source);
  assert.equal(first.assets.length,2);assert.notEqual(first.assets[0].variant_id,first.assets[1].variant_id);
  assert.deepEqual(first.assets.map(asset=>asset.variant_id),later.assets.map(asset=>asset.variant_id));
  const repeated=normalizeProviderItem(item({images:[{originalImageUrl:url('same')},{originalImageUrl:url('same')}]}),source);
  assert.equal(repeated.assets.length,1);
  const alternate=normalizeProviderItem(item({images:[{originalImageUrl:'https://scontent.yy.fbcdn.net/same.jpg?oh=new',resizedImageUrl:url('new-thumbnail')}]}),source);
  assert.equal(alternate.assets[0].variant_id,repeated.assets[0].variant_id);
});

test('missing and rejected creative URLs remain explicit manifest entries',()=>{
  const normalized=normalizeProviderItem(item({images:[{originalImageUrl:'https://evil.test/image.jpg'},{}],cards:[{videoHdUrl:'https://video.xx.fbcdn.net/only-video.mp4'}],videos:[{}]}),source);
  assert.equal(normalized.assets.length,4);assert.equal(normalized.assets.every(asset=>asset.urls.length===0),true);
  assert.equal(normalized.assets.filter(asset=>asset.kind==='video_preview').length,2);
  assert.equal(new Set(normalized.assets.map(asset=>asset.variant_id)).size,4);
  assert.equal(normalizeProviderItem(item(),source).assets.length,1);
  assert.equal(normalizeProviderItem(item({displayFormat:'VIDEO'}),source).assets[0].kind,'video_preview');
});

test('error and completeness records never masquerade as a successful empty result',()=>{
  assert.deepEqual(normalizeProviderItem({pageId:source.page_id,totalCount:0,isResultComplete:true},source),{kind:'summary',assets:[],expected_count:0,complete:true,error:null,page_id:source.page_id});
  const denied=normalizeProviderItem({pageId:source.page_id,error:'Request failed',errorDescription:'Status code 403 private-token'},source);
  assert.equal(denied.kind,'error');assert.equal(denied.error,'PROVIDER_SOURCE_ACCESS_DENIED');assert.equal(JSON.stringify(denied).includes('private-token'),false);
  const partial=normalizeProviderItem({...item({images:[url('one')]}),totalCount:42,isResultComplete:false},source);
  assert.equal(partial.expected_count,42);assert.equal(partial.complete,false);
  assert.equal(normalizeProviderItem({},source).kind,'invalid');
});

test('the normalizer has no twelve-ad or first-creative truncation',()=>{
  const records=Array.from({length:30},(_,index)=>({...item({images:Array.from({length:15},(_,creative)=>url('ad'+index+'creative'+creative))}),adArchiveID:String(10000000+index),adArchiveId:String(10000000+index)}));
  const normalized=records.map(record=>normalizeProviderItem(record,source));
  assert.equal(normalized.length,30);assert.equal(normalized.reduce((sum,record)=>sum+record.assets.length,0),450);
  assert.equal(normalized.every(record=>record.kind==='ad'),true);
});
