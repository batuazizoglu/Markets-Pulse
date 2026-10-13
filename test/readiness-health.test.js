import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {once} from 'node:events';
import express from 'express';
import {registerAuth} from '../src/auth.js';

test('Railway readiness is public, checks the database and exposes no database errors or private routes',async t=>{
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const config=JSON.parse(await readFile(new URL('../railway.json',import.meta.url),'utf8'));
  const marker="app.get('/api/health'",at=source.indexOf(marker);
  assert.ok(at>=0&&at<source.indexOf('registerAuth(app,'),'readiness must register before application authentication');
  assert.equal(source.indexOf(marker,at+1),-1,'there is only one readiness handler');
  assert.equal(config.deploy.healthcheckPath,'/api/health');
  const route=source.slice(at,source.indexOf('\n\n',at));
  const queries=[];let fail=false;
  const pool={async query(sql){queries.push(sql);assert.equal(sql,'SELECT 1');if(fail)throw new Error('postgres://private-user:private-secret@private-host/db');return {rows:[{ready:1}]}}};
  const app=express();compileFunction(route,['app','pool'])(app,pool);
  registerAuth(app,pool,'/unused');
  app.get('/api/reports/status',(req,res)=>res.json({private:true}));
  app.get('/api/packages',(req,res)=>res.json({private:true}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const ready=await fetch(origin+'/api/health');assert.equal(ready.status,200);assert.equal(ready.headers.get('cache-control'),'no-store');
  const body=await ready.json();assert.equal(body.ok,true);assert.ok(Number.isFinite(+new Date(body.now)));assert.deepEqual(Object.keys(body).sort(),['now','ok']);
  for(const path of ['/api/reports/status','/api/packages']){
    const denied=await fetch(origin+path);assert.equal(denied.status,401);assert.equal((await denied.json()).code,'AUTH_REQUIRED');
  }
  fail=true;const unavailable=await fetch(origin+'/api/health');assert.equal(unavailable.status,503);
  assert.equal(unavailable.headers.get('cache-control'),'no-store');assert.deepEqual(await unavailable.json(),{ok:false});
  assert.deepEqual(queries,['SELECT 1','SELECT 1'],'readiness executes no application data queries');
});
