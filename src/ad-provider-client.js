import {adLibraryUrl} from './ad-library-url.js';

const API = 'https://api.apify.com/v2';
const RUN_ID = /^[A-Za-z0-9]{5,64}$/;
const PAGE_ID = /^\d{5,30}$/;
const RUN_STATES = new Set(['READY','RUNNING','SUCCEEDED','FAILED','TIMING-OUT','TIMED-OUT','ABORTING','ABORTED']);

function failure(code, details = {}) {
  return Object.assign(new Error(code), {code, ...details});
}
function budget(raw, maximum) {
  if (typeof raw !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0.01 && value <= maximum ? value : null;
}
export function providerConfig(env = process.env) {
  const requested = String(env.AD_CAPTURE_PROVIDER || 'browser').trim().toLowerCase();
  const base = {mode:requested,configured:false,code:null,maxRunUsd:0,dailyBudgetUsd:0};
  if (!['browser','apify'].includes(requested)) return {...base,code:'PROVIDER_CONFIG_INVALID'};
  if (requested === 'browser') return {...base,configured:true};
  const token = String(env.APIFY_TOKEN || '').trim();
  if (!token || /[\r\n]/.test(token)) return {...base,code:'PROVIDER_TOKEN_MISSING'};
  const maxRunUsd = budget(env.APIFY_MAX_RUN_USD,10), dailyBudgetUsd = budget(env.APIFY_DAILY_BUDGET_USD,100);
  if (maxRunUsd === null || dailyBudgetUsd === null || maxRunUsd > dailyBudgetUsd) return {...base,code:'PROVIDER_BUDGET_REQUIRED'};
  return {...base,configured:true,token,maxRunUsd,dailyBudgetUsd};
}
export function providerStatus(env = process.env) {
  const {token, ...status} = providerConfig(env);
  return status;
}
function configured(env) {
  const config = providerConfig(env);
  if (!config.configured || config.mode !== 'apify') throw failure(config.code || 'PROVIDER_NOT_SELECTED');
  return config;
}
function retryDelay(value) {
  const raw = String(value || '').trim();
  const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw)*1000 : Date.parse(raw)-Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : 60000;
}
function httpFailure(status, headers, prefix, ambiguous = false) {
  const code = [401,403,407].includes(status) ? prefix+'_AUTH_FAILED' : status === 429 ? prefix+'_RATE_LIMITED' : prefix+'_HTTP_ERROR';
  return failure(code,{http_status:status,...(status === 429 ? {retry_after_ms:retryDelay(headers?.get?.('retry-after'))} : {}),...(ambiguous ? {ambiguous:true} : {})});
}
async function limitedBody(response, maximum, signal) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel?.().catch(()=>{});
    throw failure('RESPONSE_TOO_LARGE');
  }
  if (!response.body?.getReader) throw failure('RESPONSE_BODY_INVALID');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const cancel = () => {reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    for (;;) {
      if (signal.aborted) throw failure('REQUEST_TIMEOUT');
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {await reader.cancel().catch(()=>{});throw failure('RESPONSE_TOO_LARGE');}
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,size);
  } finally {signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
async function deadline(operation, ms = 20000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('REQUEST_TIMEOUT'));},ms);});
  try {return await Promise.race([operation(controller.signal),timeout]);}
  finally {clearTimeout(timer);controller.abort();}
}
async function apiRequest(path, {env,fetcher=fetch,method='GET',body,maxBytes=8*1024*1024} = {}) {
  const config = configured(env);
  try {
    return await deadline(async signal => {
      const response = await fetcher(API+path,{method,redirect:'manual',signal,headers:{Authorization:'Bearer '+config.token,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
      if (!response.ok) {
        await response.body?.cancel?.().catch(()=>{});
        throw httpFailure(response.status,response.headers,'PROVIDER',method==='POST' && (response.status>=500 || response.status===408 || (response.status>=300 && response.status<400)));
      }
      const bytes = await limitedBody(response,maxBytes,signal);
      let value;
      try {value=JSON.parse(bytes.toString('utf8'));} catch {throw failure('PROVIDER_RESPONSE_INVALID');}
      return {value,headers:response.headers};
    });
  } catch (error) {
    const known = /^PROVIDER_(?:AUTH_FAILED|RATE_LIMITED|HTTP_ERROR)$/.test(error?.code || '');
    if (known) throw error;
    const code = error?.code === 'REQUEST_TIMEOUT' ? 'PROVIDER_TIMEOUT' : error?.code === 'RESPONSE_TOO_LARGE' ? 'PROVIDER_RESPONSE_TOO_LARGE' : error?.code === 'PROVIDER_RESPONSE_INVALID' || error?.code === 'RESPONSE_BODY_INVALID' ? 'PROVIDER_RESPONSE_INVALID' : 'PROVIDER_CONNECTION_FAILED';
    throw failure(code,method==='POST' ? {ambiguous:true} : {});
  }
}
function safeRun(value, ambiguous = false) {
  const data = value?.data;
  if (!data || !RUN_ID.test(data.id || '') || !RUN_STATES.has(data.status) || (data.defaultDatasetId != null && !RUN_ID.test(data.defaultDatasetId))) throw failure('PROVIDER_RESPONSE_INVALID',ambiguous ? {ambiguous:true} : {});
  return {id:data.id,status:data.status,defaultDatasetId:data.defaultDatasetId || null,usageTotalUsd:Number.isFinite(data.usageTotalUsd) && data.usageTotalUsd>=0 ? data.usageTotalUsd : null};
}
export async function startProviderRun(source, {env=process.env,fetcher=fetch} = {}) {
  const config = configured(env);
  if (!PAGE_ID.test(String(source?.page_id || ''))) throw failure('PROVIDER_SOURCE_INVALID');
  const body = {startUrls:[{url:adLibraryUrl(source,{allowKeyword:false})}],onlyTotal:false,includeAboutPage:false,isDetailsPerAd:false,enrichWithEcommerceData:false};
  const params = new URLSearchParams({waitForFinish:'0',timeout:'900',maxTotalChargeUsd:String(config.maxRunUsd),restartOnError:'false'});
  // A create request is deliberately issued once. The caller persists a creation fence before invoking it.
  const {value} = await apiRequest('/actors/apify~facebook-ads-scraper/runs?'+params,{env,fetcher,method:'POST',body,maxBytes:1024*1024});
  return safeRun(value,true);
}
export async function getProviderRun(id, {env=process.env,fetcher=fetch} = {}) {
  if (!RUN_ID.test(String(id || ''))) throw failure('PROVIDER_ID_INVALID');
  const {value} = await apiRequest('/actor-runs/'+id,{env,fetcher,maxBytes:1024*1024});
  const run = safeRun(value);
  if (run.id !== id) throw failure('PROVIDER_RESPONSE_INVALID');
  return run;
}
export async function getProviderItems(datasetId, {offset=0,limit=100,env=process.env,fetcher=fetch} = {}) {
  if (!RUN_ID.test(String(datasetId || '')) || !Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>1000) throw failure('PROVIDER_ID_INVALID');
  const query = new URLSearchParams({format:'json',offset:String(offset),limit:String(limit),clean:'false'});
  const {value,headers} = await apiRequest('/datasets/'+datasetId+'/items?'+query,{env,fetcher});
  const integerHeader = name => {const raw=headers.get(name);return raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;};
  const total=integerHeader('x-apify-pagination-total'),returnedOffset=integerHeader('x-apify-pagination-offset'),count=integerHeader('x-apify-pagination-count');
  if (!Array.isArray(value) || total===null || returnedOffset!==offset || count!==value.length || value.length>limit || offset+count>total || (!count && offset<total)) throw failure('PROVIDER_RESPONSE_INVALID');
  return {items:value,total,offset:returnedOffset,count};
}

export function safeProviderImageUrl(raw) {
  if (typeof raw !== 'string' || raw.length>8192) return null;
  try {
    const url=new URL(raw);
    if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !['fbcdn.net','fbsbx.com'].some(host=>url.hostname===host || url.hostname.endsWith('.'+host))) return null;
    url.hash='';
    return url.href;
  } catch {return null;}
}
const IMAGE_MIMES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
function validImageBytes(bytes,mime) {
  if (mime==='image/jpeg') return bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (mime==='image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime==='image/gif') return /^(GIF87a|GIF89a)$/.test(bytes.subarray(0,6).toString('ascii'));
  if (mime==='image/webp') return bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP';
  return mime==='image/avif' && bytes.subarray(4,8).toString('ascii')==='ftyp' && /avif|avis/.test(bytes.subarray(8,40).toString('ascii'));
}
export async function fetchProviderImage(asset, {fetcher=fetch} = {}) {
  if (!asset || !['image','video_preview'].includes(asset.kind) || !Array.isArray(asset.urls) || !asset.urls.length || asset.urls.length>10) throw failure('MEDIA_URL_MISSING');
  // Validate the entire alternatives list before sending any request.
  const urls=asset.urls.map(safeProviderImageUrl);
  if (urls.some(url=>!url)) throw failure('MEDIA_URL_INVALID');
  try {
    return await deadline(async signal => {
      let lastError=failure('MEDIA_DOWNLOAD_FAILED');
      for (const initial of urls) {
        let url=initial;
        try {
          for (let hop=0;hop<=3;hop++) {
            const response=await fetcher(url,{redirect:'manual',credentials:'omit',signal,headers:{Accept:'image/jpeg,image/png,image/webp,image/gif,image/avif'}});
            if ([301,302,303,307,308].includes(response.status)) {
              await response.body?.cancel?.().catch(()=>{});
              if (hop===3) throw failure('MEDIA_REDIRECT_LIMIT');
              const location=response.headers.get('location');
              try {url=location && safeProviderImageUrl(new URL(location,url).href);} catch {url=null;}
              if (!url) throw failure('MEDIA_URL_INVALID');
              continue;
            }
            if (!response.ok) {await response.body?.cancel?.().catch(()=>{});throw httpFailure(response.status,response.headers,'MEDIA');}
            const mime=String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (!IMAGE_MIMES.has(mime)) {await response.body?.cancel?.().catch(()=>{});throw failure('MEDIA_TYPE_INVALID');}
            const bytes=await limitedBody(response,8*1024*1024,signal);
            if (!validImageBytes(bytes,mime)) throw failure('MEDIA_TYPE_INVALID');
            return {bytes,mime,url};
          }
        } catch (error) {
          if (['MEDIA_AUTH_FAILED','MEDIA_RATE_LIMITED','MEDIA_URL_INVALID','MEDIA_REDIRECT_LIMIT','REQUEST_TIMEOUT'].includes(error?.code)) throw error;
          lastError=failure(error?.code === 'RESPONSE_TOO_LARGE' ? 'MEDIA_TOO_LARGE' : error?.code==='MEDIA_TYPE_INVALID' ? 'MEDIA_TYPE_INVALID' : 'MEDIA_DOWNLOAD_FAILED');
        }
      }
      throw lastError;
    });
  } catch (error) {
    if (/^MEDIA_[A-Z_]+$/.test(error?.code || '')) throw error;
    throw failure(error?.code==='REQUEST_TIMEOUT' ? 'MEDIA_TIMEOUT' : 'MEDIA_DOWNLOAD_FAILED');
  }
}
