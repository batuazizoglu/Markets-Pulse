import test from 'node:test';
import assert from 'node:assert/strict';
import {readOfficialHtml} from '../src/official-source-browser.js';
const source={url:'https://flynet.net/'};
function fixture({error,status=200,final=source.url}={}){
  const state={closed:0,requests:[],settings:[]},frame={};let requestHandler;
  const page={setUserAgent:async()=>{},setJavaScriptEnabled:async v=>state.settings.push(['js',v]),setCacheEnabled:async v=>state.settings.push(['cache',v]),setRequestInterception:async()=>{},
    on:(_event,handler)=>{requestHandler=handler;},mainFrame:()=>frame,close:async()=>{state.closed++;},
    goto:async(url,options)=>{state.requests.push({url,options});if(error)throw error;return {ok:()=>status===200,status:()=>status,url:()=>final,text:async()=>'<h1>Public packages</h1>'};}};
  return {state,browser:{newPage:async()=>page},request:async(url,{main=true}={})=>{let result;requestHandler({url:()=>url,isNavigationRequest:()=>main,frame:()=>frame,continue:async()=>{result='continued';},abort:async()=>{result='blocked';}});return result;}};
}
test('official browser reads stay on the verified HTTPS host and avoid scripts, cached responses and third parties',async()=>{
  const f=fixture();assert.equal((await readOfficialHtml(f.browser,source)).http_status,200);
  assert.deepEqual(f.state.settings,[['js',false],['cache',false]]);assert.equal(f.state.closed,1);
  assert.equal(await f.request('https://www.flynet.net/plans'),'continued');
  for(const url of ['http://flynet.net/','https://other.example/','https://flynet.net:8443/','https://user:pass@flynet.net/'])assert.equal(await f.request(url),'blocked');
  assert.equal(await f.request(source.url,{main:false}),'blocked');
});
test('certificate failures, access denials and unrelated final URLs remain failures with no second navigation',async()=>{
  for(const options of [{error:new Error('net::ERR_CERT_AUTHORITY_INVALID')},{status:403},{final:'https://other.example/'}]){
    const f=fixture(options);await assert.rejects(readOfficialHtml(f.browser,source));assert.equal(f.state.requests.length,1);assert.equal(f.state.closed,1);
  }
});
