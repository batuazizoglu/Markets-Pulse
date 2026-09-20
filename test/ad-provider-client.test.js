import test from 'node:test';
import assert from 'node:assert/strict';
import {providerConfig,providerStatus,startProviderRun,getProviderRun,getProviderItems,fetchProviderImage,safeProviderImageUrl} from '../src/ad-provider-client.js';

const env={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'secret-test-token',APIFY_MAX_RUN_USD:'0.50',APIFY_DAILY_BUDGET_USD:'2'};
const source={brand:'Verified provider',page_id:'159064954156749'};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const run={id:'runABC12345',status:'RUNNING',defaultDatasetId:'dataABC12345',usageTotalUsd:0};
const asset={kind:'image',urls:['https://scontent.xx.fbcdn.net/ad.jpg?oh=signed']};
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,0]);

test('provider requires an explicit account token and cost ceilings; status never exposes the token',()=>{
  assert.equal(providerConfig({}).mode,'browser');
  assert.equal(providerConfig({AD_CAPTURE_PROVIDER:'apify'}).code,'PROVIDER_TOKEN_MISSING');
  for (const override of [{APIFY_MAX_RUN_USD:''},{APIFY_DAILY_BUDGET_USD:'0'},{APIFY_MAX_RUN_USD:'11'},{APIFY_DAILY_BUDGET_USD:'101'},{APIFY_MAX_RUN_USD:'3'},{APIFY_MAX_RUN_USD:'Infinity'},{APIFY_MAX_RUN_USD:'0.00001'},{APIFY_MAX_RUN_USD:'0.001'},{APIFY_DAILY_BUDGET_USD:'1.001'}]) {
    assert.equal(providerConfig({...env,...override}).code,'PROVIDER_BUDGET_REQUIRED');
  }
  assert.equal(providerConfig({AD_CAPTURE_PROVIDER:'unknown'}).configured,false);
  assert.equal(providerConfig({AD_CAPTURE_PROVIDER:'unknown'}).mode,'unknown');
  assert.equal(providerConfig(env).configured,true);
  assert.equal(providerStatus(env).maxRunUsd,0.5);
  assert.equal(JSON.stringify(providerStatus(env)).includes(env.APIFY_TOKEN),false);
});

test('one async run requests every active CY creative with a hard budget and bearer token only',async()=>{
  let calls=0;
  const result=await startProviderRun(source,{env,fetcher:async(url,options)=>{
    calls++;
    const parsed=new URL(url),input=JSON.parse(options.body),adUrl=new URL(input.startUrls[0].url);
    assert.equal(parsed.origin,'https://api.apify.com');
    assert.equal(parsed.pathname,'/v2/actors/apify~facebook-ads-scraper/runs');
    assert.equal(parsed.searchParams.get('maxTotalChargeUsd'),'0.5');
    assert.equal(parsed.searchParams.get('timeout'),'900');
    assert.equal(parsed.searchParams.get('restartOnError'),'false');
    assert.equal(parsed.searchParams.has('token'),false);
    assert.equal(options.headers.Authorization,'Bearer '+env.APIFY_TOKEN);
    assert.equal(options.redirect,'manual');
    assert.equal(options.method,'POST');
    assert.equal(adUrl.searchParams.get('view_all_page_id'),source.page_id);
    assert.equal(adUrl.searchParams.get('country'),'CY');
    assert.equal(adUrl.searchParams.get('media_type'),'all');
    assert.equal(Object.hasOwn(input,'resultsLimit'),false);
    assert.equal(input.onlyTotal,false);
    assert.equal(input.enrichWithEcommerceData,false);
    return json({data:run},201);
  }});
  assert.deepEqual(result,run);assert.equal(calls,1);
});

test('ambiguous create failure is marked and never retried; provider error text is redacted',async()=>{
  let calls=0;
  await assert.rejects(startProviderRun(source,{env,fetcher:async()=>{calls++;throw new Error('connection '+env.APIFY_TOKEN);}}),error=>{
    assert.equal(error.ambiguous,true);assert.equal(error.code,'PROVIDER_CONNECTION_FAILED');
    assert.equal(String(error).includes(env.APIFY_TOKEN),false);return true;
  });
  assert.equal(calls,1);
  for (const response of [json({error:'server '+env.APIFY_TOKEN},503),json({},408),new Response(null,{status:302}),new Response('<html>'+env.APIFY_TOKEN+'</html>'),json({data:{id:'invalid'}})]) {
    await assert.rejects(startProviderRun(source,{env,fetcher:async()=>response}),error=>error.ambiguous===true && !String(error).includes(env.APIFY_TOKEN));
  }
});

test('authentication and rate restrictions do not become ambiguous retries; long Retry-After is preserved',async()=>{
  await assert.rejects(startProviderRun(source,{env,fetcher:async()=>json({error:env.APIFY_TOKEN},403)}),error=>error.code==='PROVIDER_AUTH_FAILED' && !error.ambiguous && !String(error).includes(env.APIFY_TOKEN));
  await assert.rejects(startProviderRun(source,{env,fetcher:async()=>json({},429,{'retry-after':'172800'})}),error=>error.code==='PROVIDER_RATE_LIMITED' && error.retry_after_ms===172800000 && !error.ambiguous);
});

test('run lookup validates identity and accepts running jobs without treating them as empty',async()=>{
  assert.equal((await getProviderRun(run.id,{env,fetcher:async()=>json({data:run})})).status,'RUNNING');
  await assert.rejects(getProviderRun('../users/me',{env,fetcher:()=>assert.fail('invalid ID must not fetch')}),{code:'PROVIDER_ID_INVALID'});
  await assert.rejects(getProviderRun(run.id,{env,fetcher:async()=>json({data:{...run,id:'wrongABC1234'}})}),{code:'PROVIDER_RESPONSE_INVALID'});
});

test('dataset pagination reads raw arrays beyond twelve ads and checks transport counts',async()=>{
  const all=Array.from({length:27},(_,i)=>({adArchiveId:String(100000+i)}));
  const fetcher=async(url)=>{
    const query=new URL(url).searchParams,offset=Number(query.get('offset')),limit=Number(query.get('limit')),items=all.slice(offset,offset+limit);
    assert.equal(query.get('clean'),'false');
    return json(items,200,{'x-apify-pagination-total':'27','x-apify-pagination-offset':String(offset),'x-apify-pagination-count':String(items.length)});
  };
  const first=await getProviderItems('dataset12345',{env,offset:0,limit:20,fetcher});
  const second=await getProviderItems('dataset12345',{env,offset:first.count,limit:20,fetcher});
  assert.equal(first.total,27);assert.deepEqual([...first.items,...second.items],all);
  await assert.rejects(getProviderItems('dataset12345',{env,fetcher:async()=>json([])}),{code:'PROVIDER_RESPONSE_INVALID'});
  await assert.rejects(getProviderItems('dataset12345',{env,fetcher:async()=>json([] ,200,{'x-apify-pagination-total':'2','x-apify-pagination-offset':'0','x-apify-pagination-count':'0'})}),{code:'PROVIDER_RESPONSE_INVALID'});
});

test('media URL validation excludes private hosts, lookalikes, credentials and unsafe protocols',()=>{
  assert.equal(safeProviderImageUrl('https://scontent.xx.fbcdn.net/a.jpg'), 'https://scontent.xx.fbcdn.net/a.jpg');
  assert.equal(safeProviderImageUrl('https://platform-lookaside.fbsbx.com/a.jpg#fragment'),'https://platform-lookaside.fbsbx.com/a.jpg');
  for (const raw of ['http://scontent.xx.fbcdn.net/a.jpg','https://fbcdn.net.evil.test/a.jpg','https://127.0.0.1/a.jpg','https://169.254.169.254/','https://user:pass@fbcdn.net/a','https://fbcdn.net:8080/a','file:///etc/passwd','data:image/png;base64,AAA']) assert.equal(safeProviderImageUrl(raw),null,raw);
});

test('media downloads original bytes without API credentials and follows only validated HTTPS Meta redirects',async()=>{
  const requests=[];
  const result=await fetchProviderImage(asset,{fetcher:async(url,options)=>{
    requests.push(url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    assert.equal(Object.hasOwn(options.headers,'Authorization'),false);assert.equal(Object.hasOwn(options.headers,'Cookie'),false);
    return requests.length===1 ? new Response(null,{status:302,headers:{location:'https://scontent.yy.fbcdn.net/creative.jpg'}}) : new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  }});
  assert.deepEqual(result.bytes,jpeg);assert.equal(result.mime,'image/jpeg');assert.equal(requests.length,2);
  let calls=0;
  await assert.rejects(fetchProviderImage(asset,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}});}}),{code:'MEDIA_URL_INVALID'});
  assert.equal(calls,1);
});

test('media redirects are bounded and access/rate denials stop before trying another alternative',async()=>{
  let calls=0;
  await assert.rejects(fetchProviderImage(asset,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'/again.jpg'}});}}),{code:'MEDIA_REDIRECT_LIMIT'});
  assert.equal(calls,4);
  for (const status of [403,429]) {
    calls=0;
    await assert.rejects(fetchProviderImage({...asset,urls:[...asset.urls,'https://scontent.xx.fbcdn.net/alt.jpg']},{fetcher:async()=>{calls++;return new Response(null,{status,headers:{'retry-after':'120'}});}}),error=>error.code===(status===403 ? 'MEDIA_AUTH_FAILED' : 'MEDIA_RATE_LIMITED'));
    assert.equal(calls,1);
  }
});

test('media is bounded by streamed size and actual image signature; an unavailable resolution can fall back',async()=>{
  await assert.rejects(fetchProviderImage(asset,{fetcher:async()=>new Response('<html>not an image</html>',{headers:{'content-type':'image/jpeg'}})}),{code:'MEDIA_TYPE_INVALID'});
  await assert.rejects(fetchProviderImage(asset,{fetcher:async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg','content-length':String(8*1024*1024+1)}})}),{code:'MEDIA_TOO_LARGE'});
  await assert.rejects(fetchProviderImage(asset,{fetcher:async()=>new Response(Buffer.alloc(8*1024*1024+1),{headers:{'content-type':'image/jpeg'}})}),{code:'MEDIA_TOO_LARGE'});
  let calls=0;
  const result=await fetchProviderImage({...asset,urls:[...asset.urls,'https://scontent.xx.fbcdn.net/smaller.jpg']},{fetcher:async()=>{calls++;return calls===1 ? new Response(null,{status:404}) : new Response(jpeg,{headers:{'content-type':'image/jpeg'}});}});
  assert.deepEqual(result.bytes,jpeg);assert.equal(calls,2);
});
