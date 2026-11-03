import test from 'node:test';
import assert from 'node:assert/strict';
import {withOfficialSourceTransport as read} from '../src/official-source-transport.js';
import {fetchSource,HOME_INTERNET_SOURCES} from '../src/home-internet.js';
const source={url:'https://official.example/pricing'},hosts=new Set(['official.example']);
const env={AD_CAPTURE_PROXY_URL:'http://test-user:test-password@proxy.example:8080'};
const timeout=()=>Object.assign(new Error('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});
test('official source connection fallback runs once and releases its dispatcher',async()=>{
  let calls=0,destroyed=0;const agent={destroy:async()=>{destroyed++}};
  const result=await read(source,hosts,async dispatcher=>{calls++;if(!dispatcher)throw timeout();assert.equal(dispatcher,agent);return {ok:true,meta:{count:3}}},{env,createAgent:()=>agent});
  assert.equal(calls,2);assert.equal(destroyed,1);assert.equal(result.meta.transport,'proxy');assert.equal(result.meta.count,3);
  assert.doesNotMatch(JSON.stringify(result),/test-password|proxy.example/);
});
test('denials, TLS errors, absent DNS and unregistered origins never open a proxy',async()=>{
  let opened=0;const options={env,createAgent:()=>{opened++;throw Error('must not open')}};
  for(const error of [new Error('HTTP 403'),new Error('HTTP 429'),new Error('parse error'),Object.assign(new Error('TLS'),{cause:{code:'ERR_TLS_CERT_ALTNAME_INVALID'}}),Object.assign(new Error('DNS'),{cause:{code:'ENOTFOUND'}})])
    await assert.rejects(read(source,hosts,async()=>{throw error},options),e=>e===error);
  for(const url of ['https://other.example/','http://official.example/','https://user:pass@official.example/','https://official.example:8080/'])
    await assert.rejects(read({url},hosts,async()=>{throw timeout()},options));
  assert.equal(opened,0);
});
test('proxy failure is bounded and cannot expose credentials or rotate connections',async()=>{
  let calls=0,destroyed=0;
  await assert.rejects(read(source,hosts,async dispatcher=>{calls++;if(!dispatcher)throw timeout();throw Error('test-user:test-password@proxy.example 403')},{env,createAgent:()=>({destroy:async()=>{destroyed++}})}),e=>!e.message.includes('test-password')&&!e.message.includes('proxy.example'));
  assert.equal(calls,2);assert.equal(destroyed,1);
});
test('production source fetch refuses proxy redirects to HTTP, unrelated domains and alternate ports',async()=>{
  const originalFetch=globalThis.fetch,keys=['AD_CAPTURE_PROXY_URL','AD_CAPTURE_TRANSPORT','AD_CAPTURE_PROXIES'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.AD_CAPTURE_PROXY_URL=env.AD_CAPTURE_PROXY_URL;process.env.AD_CAPTURE_TRANSPORT='proxy';delete process.env.AD_CAPTURE_PROXIES;
    for(const location of ['http://nethouse.net/','https://unrelated.example/','https://nethouse.net:8443/']){
      let calls=0;globalThis.fetch=async(url,options)=>{calls++;if(!options.dispatcher)throw timeout();return new Response('',{status:302,headers:{location}})};
      const result=await fetchSource(HOME_INTERNET_SOURCES.find(s=>s.slug==='nethouse-home'));
      assert.equal(result.ok,false);assert.equal(calls,2);assert.doesNotMatch(JSON.stringify(result),/test-password|proxy.example/);
    }
  }finally{globalThis.fetch=originalFetch;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}}
});

test('fallback diagnostics expose a known status but never untrusted upstream text',async()=>{
  for(const [error,want] of [[new Error('HTTP 403'),'HTTP 403'],[Object.assign(new Error('secret endpoint'),{cause:{code:'ENOTFOUND'}}),'ENOTFOUND']]){
    await assert.rejects(read(source,hosts,async dispatcher=>{if(!dispatcher)throw timeout();throw error},{env,createAgent:()=>({destroy:async()=>{}})}),e=>e.message.includes(want)&&!e.message.includes('secret'));
  }
});
