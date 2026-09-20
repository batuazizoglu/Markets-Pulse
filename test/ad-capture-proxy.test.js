import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {captureTransportConfig,captureTransportStatus,allowedAdRequest,openCaptureProxy} from '../src/ad-capture-proxy.js';
import {captureCloudAds,markAdCards} from '../src/ad-cloud-capture.js';

// These fixtures never connect to Meta: the local upstream itself terminates
// CONNECT and echoes the synthetic tunnel payload.
async function upstreamFixture({status=200}={}){
  const requests=[],payloads=[],sockets=new Set();
  const server=http.createServer((req,res)=>res.writeHead(405).end());
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{})});
  server.on('connect',(req,socket,head)=>{
    requests.push({target:req.url,headers:req.headers});
    if(status!==200){
      const body='synthetic-upstream-private-error';
      socket.end(`HTTP/1.1 ${status} Denied\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
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
    assert.deepEqual(Object.keys(status).sort(),['code','configured','message','mode']);
    assert.equal(status.configured,false);assert.equal(status.code,'PROXY_CONFIG_INVALID');
    assert.doesNotMatch(JSON.stringify(status),/inline-user|inline-password|synthetic-private|proxy\.example|socks5/);
    await assert.rejects(openCaptureProxy(config),error=>error.message==='PROXY_CONFIG_INVALID');
  }
  const privateEnv={AD_CAPTURE_TRANSPORT:'proxy',AD_CAPTURE_PROXY_URL:'http://private-user:private-password@proxy.example.test:8080'};
  const publicStatus=captureTransportStatus(privateEnv);
  assert.equal(publicStatus.configured,true);
  assert.deepEqual(Object.keys(publicStatus).sort(),['code','configured','message','mode']);
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
function captureFixture({status=403,url='https://www.facebook.com/ads/library/',gotoError=null,failure=null}={}){
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
    async openProxy(config){calls.proxyOpens++;assert.equal(config.mode,'proxy');return {server:'http://127.0.0.1:43210',async close(){calls.proxyCloses++},getFailure:()=>failure}}
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
