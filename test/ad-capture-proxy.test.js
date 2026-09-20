import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {captureTransportConfig,captureTransportStatus,allowedAdRequest,openCaptureProxy} from '../src/ad-capture-proxy.js';
import {captureCloudAds,markAdCards,captureRetryDelay} from '../src/ad-cloud-capture.js';

// These fixtures never connect to Meta: the local upstream itself terminates
// CONNECT and echoes the synthetic tunnel payload.
async function upstreamFixture({status=200,retryAfter,plans}={}){
  const requests=[],payloads=[],sockets=new Set();
  const server=http.createServer((req,res)=>res.writeHead(405).end());
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{})});
  server.on('connect',(req,socket,head)=>{
    requests.push({target:req.url,headers:req.headers});
    const plan=plans?.[requests.length-1]||{status,retryAfter};
    if(plan.status!==200){
      const body='synthetic-upstream-private-error';
      const respond=()=>socket.end(`HTTP/1.1 ${plan.status} Denied\r\n${plan.retryAfter?'Retry-After: '+plan.retryAfter+'\r\n':''}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      if(plan.delay)setTimeout(respond,plan.delay);else respond();
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const receive=chunk=>{payloads.push(chunk.toString());socket.write(chunk)};
    if(head.length)receive(head);
    socket.on('data',receive);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {
    url:`http://127.0.0.1:${server.address().port}`,requests,payloads,
    async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}
  };
}

async function connectThrough(proxyUrl,target){
  const proxy=new URL(proxyUrl);
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:proxy.hostname,port:proxy.port,method:'CONNECT',path:target,headers:{Host:target},agent:false});
    req.setTimeout(3000,()=>req.destroy(new Error('synthetic CONNECT timed out')));
    req.once('error',reject);
    req.once('connect',(res,socket,head)=>{socket.on('error',()=>{});resolve({status:res.statusCode,socket,head})});
    req.end();
  });
}

async function echoThrough(socket,payload){
  return new Promise((resolve,reject)=>{
    let received='';
    const timer=setTimeout(()=>{cleanup();reject(new Error('synthetic tunnel timed out'))},3000);
    const onData=chunk=>{received+=chunk.toString();if(received.length>=payload.length){cleanup();resolve(received)}};
    const onError=error=>{cleanup();reject(error)};
    const cleanup=()=>{clearTimeout(timer);socket.off('data',onData);socket.off('error',onError)};
    socket.on('data',onData);socket.once('error',onError);socket.write(payload);
  });
}

test('capture transport defaults and invalid proxy configuration fail closed without exposing secrets',async()=>{
  assert.equal(captureTransportConfig({}).mode,'direct');
  assert.equal(captureTransportConfig({}).configured,true);
  const selected=captureTransportConfig({AD_CAPTURE_PROXY_URL:'http://proxy.example.test:8080'});
  assert.equal(selected.mode,'proxy');assert.equal(selected.configured,true);
  const missing={AD_CAPTURE_TRANSPORT:'proxy'};
  assert.equal(captureTransportConfig(missing).configured,false);
  assert.equal(captureTransportConfig(missing).code,'PROXY_CONFIG_MISSING');
  await assert.rejects(openCaptureProxy(captureTransportConfig(missing)),/PROXY_CONFIG_MISSING/);
  const invalidCases=[
    {AD_CAPTURE_PROXY_URL:'socks5://proxy.example.test:1080'},
    {AD_CAPTURE_PROXY_URL:'not a proxy URL'},
    {AD_CAPTURE_PROXY_URL:'http://proxy.example.test:8080',AD_CAPTURE_PROXY_USERNAME:'synthetic-private-user'},
    {AD_CAPTURE_PROXY_URL:'http://proxy.example.test:8080',AD_CAPTURE_PROXY_PASSWORD:'synthetic-private-password'},
    {AD_CAPTURE_PROXY_URL:'http://inline-user:inline-password@proxy.example.test:8080',AD_CAPTURE_PROXY_USERNAME:'synthetic-private-user',AD_CAPTURE_PROXY_PASSWORD:'synthetic-private-password'}
  ];
  for(const values of invalidCases){
    const env={AD_CAPTURE_TRANSPORT:'proxy',...values};
    const config=captureTransportConfig(env),status=captureTransportStatus(env);
    assert.equal(config.mode,'proxy');assert.equal(config.configured,false);assert.equal(config.code,'PROXY_CONFIG_INVALID');
    assert.deepEqual(Object.keys(status).sort(),['code','configured','message','mode','proxy_count']);
    assert.equal(status.configured,false);assert.equal(status.code,'PROXY_CONFIG_INVALID');
    assert.doesNotMatch(JSON.stringify(status),/inline-user|inline-password|synthetic-private|proxy\.example|socks5/);
    await assert.rejects(openCaptureProxy(config),error=>error.message==='PROXY_CONFIG_INVALID');
  }
  const privateEnv={AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:'http://private-user:private-password@proxy.example.test:8080'};
  const publicStatus=captureTransportStatus(privateEnv);
  assert.equal(publicStatus.configured,true);
  assert.deepEqual(Object.keys(publicStatus).sort(),['code','configured','message','mode','proxy_count']);
  assert.doesNotMatch(JSON.stringify(publicStatus),/private-user|private-password|proxy\.example|8080/);
});

test('ad request allowlist accepts Meta HTTPS hosts and rejects deceptive hosts and ports',()=>{
  for(const url of ['https://www.facebook.com/ads/library/','https://facebook.com/','https://scontent.example.fbcdn.net/image.jpg','https://cdn.fbsbx.com/asset','https://connect.facebook.net/en_US/sdk.js'])assert.equal(allowedAdRequest(url),true,url);
  for(const url of ['http://www.facebook.com/','https://www.facebook.com:8443/','https://www.facebook.com.evil.test/','https://evilfacebook.com/','https://127.0.0.1/','https://169.254.169.254/latest/meta-data/','file:///tmp/ad.jpg','not-a-url'])assert.equal(allowedAdRequest(url),false,url);
});

test('proxy CONNECT sends credentials only to the upstream and preserves the origin payload',async()=>{
  const upstream=await upstreamFixture();let bridge,connection;
  const username='synthetic user',password='synthetic:p@ss/word+';
  const url=new URL(upstream.url);url.username=username;url.password=password;
  try{
    bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:url.href}));
    assert.equal(new URL(bridge.server).hostname,'127.0.0.1');
    connection=await connectThrough(bridge.server,'www.facebook.com:443');
    assert.equal(connection.status,200);
    const payload='GET /synthetic-ad-evidence HTTP/1.1\r\nHost: www.facebook.com\r\nX-Test: isolated\r\n\r\n';
    assert.equal(await echoThrough(connection.socket,payload),payload);
    assert.equal(upstream.requests.length,1);
    assert.equal(upstream.requests[0].target,'www.facebook.com:443');
    assert.equal(upstream.requests[0].headers['proxy-authorization'],`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
    assert.equal(upstream.payloads.join(''),payload);
    assert.doesNotMatch(upstream.payloads.join(''),/Proxy-Authorization|synthetic user|synthetic:p@ss/);
    assert.equal(bridge.getFailure(),null);
  }finally{connection?.socket.destroy();if(bridge)await bridge.close();await upstream.close()}
});

test('separate proxy credentials support the same upstream authentication',async()=>{
  const upstream=await upstreamFixture();let bridge,connection;
  try{
    bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:upstream.url,AD_CAPTURE_PROXY_USERNAME:'separate-user',AD_CAPTURE_PROXY_PASSWORD:'separate:password'}));
    connection=await connectThrough(bridge.server,'scontent.example.fbcdn.net:443');
    assert.equal(connection.status,200);
    assert.equal(upstream.requests[0].headers['proxy-authorization'],`Basic ${Buffer.from('separate-user:separate:password').toString('base64')}`);
  }finally{connection?.socket.destroy();if(bridge)await bridge.close();await upstream.close()}
});

test('off-allowlist CONNECT targets are denied before the upstream is contacted',async()=>{
  const upstream=await upstreamFixture();let bridge;
  try{
    bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:upstream.url}));
    for(const target of ['example.org:443','www.facebook.com.evil.test:443','127.0.0.1:443','www.facebook.com:80','www.facebook.com:8443']){
      const connection=await connectThrough(bridge.server,target);
      try{assert.notEqual(connection.status,200,target)}finally{connection.socket.destroy()}
    }
    assert.equal(upstream.requests.length,0);
  }finally{if(bridge)await bridge.close();await upstream.close()}
});

for(const [status,code] of [[403,'PROXY_ACCESS_DENIED'],[407,'PROXY_AUTH_FAILED']]){
  test(`upstream ${status} ends the request with a safe failure code and no retry or fallback`,async()=>{
    const upstream=await upstreamFixture({status});let bridge,connection;
    try{
      bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:upstream.url}));
      connection=await connectThrough(bridge.server,'www.facebook.com:443');
      assert.notEqual(connection.status,200);
      assert.equal(bridge.getFailure(),code);
      assert.equal(upstream.requests.length,1);
      assert.equal(upstream.payloads.length,0);
      assert.doesNotMatch(bridge.getFailure(),/synthetic-upstream-private-error|127\.0\.0\.1|http:/);
      connection.socket.destroy();
      connection=await connectThrough(bridge.server,'scontent.example.fbcdn.net:443');
      assert.notEqual(connection.status,200);
      assert.equal(bridge.getFailure(),code);
      assert.equal(upstream.requests.length,1,'a rejected upstream must not be contacted again');
    }finally{connection?.socket.destroy();if(bridge)await bridge.close();await upstream.close()}
  });
}

const syntheticSource={brand:'Synthetic test',page_id:'164143610515'};
const syntheticProxyEnv={AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:'http://synthetic-user:synthetic-password@proxy.example.test:8080'};
function captureFixture({status=403,url='https://www.facebook.com/ads/library/',gotoError=null,failure=null,details=null}={}){
  const calls={launches:[],proxyOpens:0,browserCloses:0,proxyCloses:0,evaluates:0,gotos:[],interception:null,handlers:{}};
  const page={
    async setViewport(){},async setRequestInterception(value){calls.interception=value},
    on(event,handler){calls.handlers[event]=handler},
    async goto(target){calls.gotos.push(target);if(gotoError)throw gotoError;return {status:()=>status,headers:()=>({})}},
    url:()=>url,
    async evaluate(){calls.evaluates++;throw new Error('unexpected DOM evaluation')},
    async waitForFunction(){}
  };
  return {calls,page,options:{env:syntheticProxyEnv,
    async launch(options){calls.launches.push(options);return {async newPage(){return page},async close(){calls.browserCloses++}}},
    async openProxy(config){calls.proxyOpens++;calls.selected=config;assert.equal(config.mode,'proxy');return {server:'http://127.0.0.1:43210',async close(){calls.proxyCloses++},getFailure:()=>failure,getFailureDetails:()=>details}}
  }};
}

test('required but missing proxy prevents browser launch and direct fallback',async()=>{
  let launches=0,opens=0,captures=0;
  const result=await captureCloudAds(syntheticSource,async()=>{captures++},{env:{AD_CAPTURE_TRANSPORT:'proxy'},launch:async()=>{launches++;throw new Error('must not launch')},openProxy:async()=>{opens++;throw new Error('must not open')}});
  assert.equal(result.status,'blocked');assert.equal(result.reason,'PROXY_CONFIG_MISSING');assert.equal(result.captured,0);
  assert.equal(launches,0);assert.equal(opens,0);assert.equal(captures,0);
});

test('capture uses only the local proxy endpoint and closes both resources on HTTP 403',async()=>{
  const fixture=captureFixture();let captures=0;
  const result=await captureCloudAds(syntheticSource,async()=>{captures++},fixture.options);
  assert.equal(result.status,'blocked');assert.equal(result.reason,'HTTP_403');assert.equal(result.http_status,403);assert.equal(captures,0);
  assert.equal(fixture.calls.proxyOpens,1);assert.equal(fixture.calls.launches.length,1);assert.equal(fixture.calls.gotos.length,1);
  const launch=fixture.calls.launches[0];
  assert.ok(launch.args.includes('--proxy-server=http://127.0.0.1:43210'));
  assert.ok(launch.args.includes('--proxy-bypass-list=<-loopback>'));
  assert.doesNotMatch(JSON.stringify(launch),/synthetic-user|synthetic-password|proxy\.example\.test/);
  assert.equal(fixture.calls.interception,true);assert.equal(fixture.calls.evaluates,0);
  assert.equal(fixture.calls.browserCloses,1);assert.equal(fixture.calls.proxyCloses,1);
  const decisions=[];
  for(const url of ['https://www.facebook.com/ads/library/','https://outside.example.test/']){
    fixture.calls.handlers.request({url:()=>url,async continue(){decisions.push('continue')},async abort(){decisions.push('abort')}});
  }
  assert.deepEqual(decisions,['continue','abort']);
});

test('HTTP 200 login and checkpoint redirects stop before interacting with the DOM',async()=>{
  for(const url of ['https://www.facebook.com/login/?next=ads','https://www.facebook.com/login.php','https://www.facebook.com/checkpoint/123','https://www.facebook.com/challenge/123']){
    const fixture=captureFixture({status:200,url});let captures=0;
    const result=await captureCloudAds(syntheticSource,async()=>{captures++},fixture.options);
    assert.equal(result.status,'blocked',url);assert.equal(result.reason,'ACCESS_RESTRICTED',url);
    assert.equal(captures,0);assert.equal(fixture.calls.evaluates,0);
    assert.equal(fixture.calls.launches.length,1);assert.equal(fixture.calls.gotos.length,1);
    assert.equal(fixture.calls.browserCloses,1);assert.equal(fixture.calls.proxyCloses,1);
  }
});

test('capture reports the safe bridge failure code without exposing upstream credentials',async()=>{
  const fixture=captureFixture({gotoError:new Error('net::ERR_TUNNEL_CONNECTION_FAILED http://synthetic-user:synthetic-password@proxy.example.test:8080'),failure:'PROXY_AUTH_FAILED'});
  const result=await captureCloudAds(syntheticSource,async()=>{throw new Error('must not capture')},fixture.options);
  assert.equal(result.status,'blocked');assert.equal(result.reason,'PROXY_AUTH_FAILED');assert.equal(result.captured,0);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-user|synthetic-password|proxy\.example\.test|ERR_TUNNEL/);
  assert.equal(fixture.calls.launches.length,1);assert.equal(fixture.calls.proxyOpens,1);assert.equal(fixture.calls.gotos.length,1);
  assert.equal(fixture.calls.browserCloses,1);assert.equal(fixture.calls.proxyCloses,1);
});

test('an access restriction appearing after a scroll ends capture without another card pass',async()=>{
  const fixture=captureFixture({status:200});let cardsChecked=0,scrolled=false,bodyReads=0,captures=0;
  fixture.page.evaluate=async fn=>{
    if(fn===markAdCards){cardsChecked++;return []}
    const code=String(fn);
    if(code.includes('document.body.innerText')){bodyReads++;return scrolled?'Access denied':'Library ID: 12345678'}
    if(code.includes('window.scrollBy'))scrolled=true;
  };
  const result=await captureCloudAds(syntheticSource,async()=>{captures++},fixture.options);
  assert.equal(result.status,'blocked');assert.equal(result.reason,'ACCESS_RESTRICTED');assert.equal(result.captured,0);
  assert.equal(cardsChecked,1);assert.equal(bodyReads,2);assert.equal(captures,0);
  assert.equal(fixture.calls.launches.length,1);assert.equal(fixture.calls.gotos.length,1);
  assert.equal(fixture.calls.browserCloses,1);assert.equal(fixture.calls.proxyCloses,1);
});

test('proxy pool validates the complete list, canonical endpoints and private health keys',()=>{
  const entries=[{id:'one',url:'http://private-user:private-password@PROXY.example.test:80'},{id:'two',url:'https://second.example.test:8443',username:'second-user',password:'second-password'}];
  const env={AD_CAPTURE_PROXIES:JSON.stringify(entries)},config=captureTransportConfig(env);
  assert.equal(config.configured,true);assert.equal(config.mode,'proxy');assert.equal(config.proxies.length,2);
  assert.equal(config.proxies[0].upstreamUrl,'http://private-user:private-password@proxy.example.test/');
  assert.equal(config.upstreamUrl,config.proxies[0].upstreamUrl);
  for(const proxy of config.proxies)assert.match(proxy.key,/^[a-f0-9]{64}$/);
  const same=captureTransportConfig({AD_CAPTURE_PROXIES:JSON.stringify([{id:'renamed',url:'http://private-user:private-password@proxy.example.test/'}])});
  assert.equal(same.proxies[0].key,config.proxies[0].key,'health identity is stable across public label edits');
  const rotated=captureTransportConfig({AD_CAPTURE_PROXIES:JSON.stringify([{...entries[0],url:'http://private-user:new-password@proxy.example.test/'}])});
  assert.notEqual(rotated.proxies[0].key,config.proxies[0].key,'updated credentials have a distinct health identity');
  const safe=captureTransportStatus(env);
  assert.equal(safe.proxy_count,2);
  assert.doesNotMatch(JSON.stringify(safe),/private-user|private-password|second-user|second-password|example\.test|upstreamUrl|"key"/);
  for(const pool of [[],{},null,Array(6).fill(entries[0]),[entries[0],{...entries[1],id:'one'}],[{...entries[0],id:'private user'}],[{...entries[0],id:'x'.repeat(33)}],[{...entries[0],password:42}],[{...entries[0],unused:true}],[entries[0],{id:'duplicate',url:'http://other:credentials@proxy.example.test/'}],[entries[0],{id:'bad',url:'socks5://proxy.example.test:8080'}]]){
    const invalid=captureTransportConfig({AD_CAPTURE_PROXIES:JSON.stringify(pool)});
    assert.equal(invalid.configured,false);assert.equal(invalid.code,'PROXY_CONFIG_INVALID');assert.equal(invalid.proxies,undefined);
  }
  for(const extra of [{AD_CAPTURE_PROXY_URL:entries[0].url},{AD_CAPTURE_PROXY_USERNAME:'unused'},{AD_CAPTURE_PROXY_PASSWORD:'unused'}])assert.equal(captureTransportConfig({...env,...extra}).code,'PROXY_CONFIG_INVALID');
  assert.equal(captureTransportConfig({AD_CAPTURE_PROXIES:'secret malformed JSON'}).code,'PROXY_CONFIG_INVALID');
  assert.equal(captureTransportConfig({...env,AD_CAPTURE_TRANSPORT:'direct'}).mode,'direct');
});

for(const [status,reason,transportOnly] of [[401,'PROXY_ACCESS_DENIED',false],[429,'PROXY_RATE_LIMITED',false],[451,'PROXY_ACCESS_DENIED',false],[500,'PROXY_FAILED',false],[502,'PROXY_CONNECTION_FAILED',true],[503,'PROXY_CONNECTION_FAILED',true],[504,'PROXY_CONNECTION_FAILED',true]]){
  test(`upstream CONNECT ${status} has precise transport eligibility and closes further requests`,async()=>{
    const upstream=await upstreamFixture({status,retryAfter:'172800'});let bridge,connection;
    try{
      bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_PROXY_URL:upstream.url}));
      connection=await connectThrough(bridge.server,'www.facebook.com:443');
      assert.notEqual(connection.status,200);assert.equal(bridge.getFailure(),reason);
      assert.equal(bridge.getFailureDetails().transport_only,transportOnly);
      if(status===429)assert.equal(bridge.getFailureDetails().retry_after_ms,172800000,'48-hour provider limit must not be shortened to24hours');
      connection.socket.destroy();connection=await connectThrough(bridge.server,'cdn.fbcdn.net:443');
      assert.notEqual(connection.status,200);assert.equal(upstream.requests.length,1);
    }finally{connection?.socket.destroy();await bridge?.close();await upstream.close()}
  });
}

test('actual upstream connection refusal is eligible for failover without guessing from browser text',async()=>{
  const upstream=await upstreamFixture(),url=upstream.url;await upstream.close();
  const bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_PROXY_URL:url}));let connection;
  try{
    connection=await connectThrough(bridge.server,'www.facebook.com:443');
    assert.notEqual(connection.status,200);
    assert.deepEqual(bridge.getFailureDetails(),{reason:'PROXY_CONNECTION_FAILED',transport_only:true});
  }finally{connection?.socket.destroy();await bridge.close()}
});

for(const statuses of [[403,502],[502,403],[429,503],[500,429]]){
  test(`concurrent CONNECT ${statuses.join(' then ')} keeps the terminal restriction latched`,async()=>{
    const upstream=await upstreamFixture({plans:statuses.map((status,i)=>({status,delay:40+i*40,retryAfter:'7200'}))});let bridge,connections=[];
    try{
      bridge=await openCaptureProxy(captureTransportConfig({AD_CAPTURE_PROXY_URL:upstream.url}));
      connections=await Promise.all([connectThrough(bridge.server,'www.facebook.com:443'),connectThrough(bridge.server,'cdn.fbcdn.net:443')]);
      assert.equal(upstream.requests.length,2);
      assert.equal(bridge.getFailure(),statuses.includes(403)?'PROXY_ACCESS_DENIED':'PROXY_RATE_LIMITED');
      assert.equal(bridge.getFailureDetails().transport_only,false);
      if(statuses.includes(429))assert.equal(bridge.getFailureDetails().retry_after_ms,7200000);
    }finally{for(const connection of connections)connection.socket.destroy();await bridge?.close();await upstream.close()}
  });
}

test('capture uses the explicitly selected pool member exactly once',async()=>{
  const fixture=captureFixture(),selected={mode:'proxy',configured:true,code:null,id:'second',upstreamUrl:'https://other-user:other-password@other.example.test:8443/',key:'synthetic-key'};
  const result=await captureCloudAds(syntheticSource,async()=>{}, {...fixture.options,proxyConfig:selected});
  assert.equal(result.reason,'HTTP_403');assert.equal(fixture.calls.selected,selected);assert.equal(fixture.calls.proxyOpens,1);
  assert.doesNotMatch(JSON.stringify(fixture.calls.launches),/other-user|other-password|other\.example|synthetic-key/);
});

test('only a proved connection failure before navigation can allow pool failover',async()=>{
  for(const details of [null,{reason:'PROXY_CONNECTION_FAILED',transport_only:true},{reason:'PROXY_CONNECTION_FAILED',transport_only:false},{reason:'PROXY_AUTH_FAILED',transport_only:false},{reason:'PROXY_RATE_LIMITED',transport_only:false,retry_after_ms:7200000}]){
    const fixture=captureFixture({gotoError:new Error('net::ERR_TUNNEL_CONNECTION_FAILED private details'),details});
    const result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
    assert.equal(result.transport_only,details?.transport_only===true);
    assert.equal(result.reason,details?.reason||'PROXY_FAILED');
    assert.equal(result.status,details?.reason==='PROXY_RATE_LIMITED'?'rate_limited':'blocked');
    if(details?.reason==='PROXY_RATE_LIMITED')assert.equal(result.retry_after_ms,7200000);
    assert.doesNotMatch(JSON.stringify(result),/private details|ERR_TUNNEL/);assert.equal(fixture.calls.proxyOpens,1);
  }
});

test('source access responses and redirects outrank concurrent asset connection failures',async()=>{
  const details={reason:'PROXY_CONNECTION_FAILED',transport_only:true};
  for(const status of [401,403,407,429,451]){
    const fixture=captureFixture({status,details}),result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
    assert.equal(result.reason,'HTTP_'+status);assert.equal(result.transport_only,false);assert.equal(fixture.calls.evaluates,0);
  }
  const login=captureFixture({status:200,url:'https://www.facebook.com/login/',details});
  assert.equal((await captureCloudAds(syntheticSource,async()=>{},login.options)).reason,'ACCESS_RESTRICTED');
  for(const body of ['Access denied','No matching DOM structure here']){
    const fixture=captureFixture({status:200,details});
    fixture.page.evaluate=async fn=>String(fn).includes('document.body.innerText')?body:undefined;
    const result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
    assert.equal(result.reason,body==='Access denied'?'ACCESS_RESTRICTED':'CARDS_NOT_FOUND');assert.notEqual(result.transport_only,true);
  }
});

test('an observed origin denial wins even when main navigation subsequently throws',async()=>{
  const fixture=captureFixture({details:{reason:'PROXY_CONNECTION_FAILED',transport_only:true}});
  fixture.page.goto=async()=>{
    fixture.calls.handlers.response({url:()=> 'https://cdn.fbcdn.net/image.jpg',status:()=>403,headers:()=>({})});
    throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
  };
  const result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
  assert.equal(result.reason,'HTTP_403');assert.equal(result.transport_only,false);
});

test('a successful main response before navigation timeout prevents asset outage failover',async()=>{
  const fixture=captureFixture({details:{reason:'PROXY_CONNECTION_FAILED',transport_only:true}}),mainFrame={};
  fixture.page.mainFrame=()=>mainFrame;
  fixture.page.goto=async()=>{
    fixture.calls.handlers.response({url:()=> 'https://www.facebook.com/ads/library/',status:()=>200,request:()=>({isNavigationRequest:()=>true,frame:()=>mainFrame}),headers:()=>({})});
    throw new Error('Navigation timeout with unrelated asset outage');
  };
  const result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
  assert.equal(result.reason,'PROXY_CONNECTION_FAILED');assert.equal(result.transport_only,false);
});

test('capture deadline returns while proxy setup is pending and disposes a late bridge',async()=>{
  let resolveProxy,closed=0,launched=0;
  const pending=new Promise(resolve=>{resolveProxy=resolve});
  const result=await captureCloudAds(syntheticSource,async()=>{}, {env:syntheticProxyEnv,timeoutMs:10,openProxy:()=>pending,launch:async()=>{launched++;throw new Error('must not launch')}});
  assert.equal(result.status,'error');assert.notEqual(result.transport_only,true);assert.equal(launched,0);
  resolveProxy({async close(){closed++}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,1);assert.equal(launched,0);
});

test('a browser navigation timeout is not a proxy outage even without a main response',async()=>{
  const fixture=captureFixture({gotoError:Object.assign(new Error('Navigation timeout'),{name:'TimeoutError'}),details:{reason:'PROXY_CONNECTION_FAILED',transport_only:true}});
  const result=await captureCloudAds(syntheticSource,async()=>{},fixture.options);
  assert.equal(result.transport_only,false);assert.equal(fixture.calls.proxyOpens,1);
});

test('source Retry-After preserves48-hour delays and safely bounds unrepresentable dates',()=>{
  const now=Date.parse('2026-09-20T00:00:00.000Z');
  assert.equal(captureRetryDelay('172800',now),172800000);
  assert.equal(captureRetryDelay('Tue, 22 Sep 2026 00:00:00 GMT',now),172800000);
  assert.equal(captureRetryDelay('not-a-date',now),900000);
  assert.equal(captureRetryDelay('1e300',now),8640000000000000-now);
});
