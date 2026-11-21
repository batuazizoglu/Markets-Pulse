import {createHash} from 'node:crypto';
import {safeProviderImageUrl} from './ad-provider-client.js';
import {adLibraryUrl} from './ad-library-url.js';

const ID = /^\d{5,30}$/;
const object = value => value && typeof value==='object' && !Array.isArray(value);
const text = value => typeof value==='string' ? value.replace(/\s+/g,' ').trim().slice(0,8000) : object(value) ? text(value.text) : '';
const present = value => value !== null && value !== undefined;
function identity(values) {
  const ids=values.filter(present).map(value=>typeof value==='string' ? value : Number.isSafeInteger(value) ? String(value) : '');
  return {value:ids[0] || null,valid:ids.every(id=>ID.test(id)) && new Set(ids).size<=1};
}
function itemText(value) {
  if (!object(value)) return '';
  return [...new Set([value.body,value.title,value.caption,value.linkDescription].map(text).filter(Boolean))].join(' · ').slice(0,8000);
}
function errorCode(value) {
  const message=String(value || '');
  return /\b429\b|rate.?limit/i.test(message) ? 'PROVIDER_SOURCE_RATE_LIMITED' : /\b40[137]\b|access denied|captcha|log.?in|forbidden/i.test(message) ? 'PROVIDER_SOURCE_ACCESS_DENIED' : 'PROVIDER_SOURCE_ERROR';
}
function primaryPath(urls) {return new URL(urls[0]).pathname;}

export function normalizeProviderItem(item,source) {
  const result={kind:'invalid',assets:[],expected_count:null,complete:null,error:'PROVIDER_ITEM_INVALID'};
  if (!object(item) || !ID.test(String(source?.page_id || ''))) return result;
  const snapshot=object(item.snapshot) ? item.snapshot : {};
  const page=identity([item.pageID,item.pageId,item.page_id,snapshot.pageId,snapshot.pageID,snapshot.page_id]);
  const ad=identity([item.adArchiveID,item.adArchiveId,item.ad_archive_id,item.ad_id]);
  let inputPage=null;
  if (typeof item.inputUrl==='string') {
    try {inputPage=new URL(item.inputUrl).searchParams.get('view_all_page_id');} catch {return result;}
  }
  if (!page.valid || !ad.valid || (page.value && page.value!==String(source.page_id)) || (inputPage && inputPage!==String(source.page_id))) return {...result,error:'PROVIDER_IDENTITY_MISMATCH'};
  if (item.error || item.errorDescription) return {...result,kind:'error',error:errorCode(String(item.error || '')+' '+String(item.errorDescription || ''))};
  const totals=[item.totalCount,item.expected_ads].filter(present);
  const flags=[item.isResultComplete,item.coverage_complete].filter(present);
  const exact=totals.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647&&n===totals[0]);
  let sameScope=true;
  if(present(item.inputUrl)){
    const expected=new URL(adLibraryUrl(source)),actual=URL.canParse(item.inputUrl)?new URL(item.inputUrl):null;
    expected.searchParams.sort();actual?.searchParams.sort();
    sameScope=actual?.href===expected.href;
  }
  if(!exact || (present(item.totalCountIsMinimum)&&item.totalCountIsMinimum!==false) || !sameScope || flags.some(f=>typeof f!=='boolean'))result.complete=false;
  else {
    result.expected_count=totals[0]??null;
    if(flags.length)result.complete=flags.every(f=>f===true);
    if(!ad.value && result.complete===true && result.expected_count==null && !page.value && !inputPage)result.complete=null;
  }
  if (!ad.value) return result.expected_count!==null || result.complete!==null ? {...result,kind:'summary',page_id:page.value || String(source.page_id),error:null} : result;
  if (!page.value) return {...result,error:'PROVIDER_IDENTITY_MISSING'};
  const body=itemText(snapshot), assets=[], seen=new Map();
  function add(entry,kind,location) {
    const value=object(entry) ? entry : {};
    const candidates=kind==='video_preview' ? [value.videoPreviewImageUrl,value.video_preview_image_url,value.thumbnailUrl] : typeof entry==='string' ? [entry] : [value.originalImageUrl,value.resizedImageUrl,value.watermarkedResizedImageUrl,value.original_image_url,value.resized_image_url,value.url];
    const urls=[...new Set(candidates.map(safeProviderImageUrl).filter(Boolean))];
    const context=itemText(value), ad_text=[body,context].filter(Boolean).join(' · ').slice(0,8000);
    // Signed query strings change without a creative change; offer text distinguishes reuse of the same picture.
    const key=JSON.stringify([kind,urls.length ? primaryPath(urls) : 'missing:'+location,context || body]);
    if (seen.has(key)) return;
    const variant_id='p'+createHash('sha256').update(key).digest('hex').slice(0,28);
    const asset={variant_id,kind,urls,ad_text};
    assets.push(asset);seen.set(key,asset);
  }
  function each(name,kind) {
    const entries=snapshot[name];
    if (Array.isArray(entries)) entries.forEach((entry,index)=>add(entry,kind,name+':'+index));
    else if (present(entries)) add(entries,kind,name+':invalid');
  }
  each('images','image');
  if (Array.isArray(snapshot.cards)) snapshot.cards.forEach((entry,index)=>{
    const value=object(entry) ? entry : {};
    const hasVideo=['videoHdUrl','videoSdUrl','videoPreviewImageUrl','video_hd_url','video_sd_url','video_preview_image_url'].some(key=>Boolean(value[key]));
    const hasImage=typeof entry==='string' || ['originalImageUrl','resizedImageUrl','watermarkedResizedImageUrl','original_image_url','resized_image_url'].some(key=>Boolean(value[key]));
    if (hasImage || !hasVideo) add(entry,'image','cards:'+index);
    if (hasVideo) add(entry,'video_preview','cards:'+index);
  });
  else if (present(snapshot.cards)) add(snapshot.cards,'image','cards:invalid');
  each('videos','video_preview');each('extraImages','image');each('extraVideos','video_preview');
  if (!assets.length) add({}, /video/i.test(snapshot.displayFormat || '') ? 'video_preview' : 'image','snapshot:missing');
  const date=typeof item.startDateFormatted==='string' ? Date.parse(item.startDateFormatted) : Number.isFinite(item.startDate) ? item.startDate*1000 : NaN;
  const started_on=Number.isFinite(date) && date>=0 && date<=8640000000000000 ? new Date(date).toISOString().slice(0,10) : null;
  return {...result,kind:'ad',ad_id:ad.value,page_id:page.value,ad_status:item.isActive===true ? 'active' : item.isActive===false ? 'inactive' : 'unknown',started_on,ad_text:body,assets,error:null};
}
