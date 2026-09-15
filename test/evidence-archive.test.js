import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { registerEvidenceRoutes } from '../src/evidence-archive.js';
import { createEvidenceFixture } from './evidence-fixture.js';

let fixture,server,base;
before(async()=>{
  fixture=await createEvidenceFixture({count:120});
  const app=express();app.use((req,res,next)=>{if(req.headers['x-test-user']==='authorized')req.appUser={id:1,role:'standard'};next();});
  registerEvidenceRoutes(app,fixture.pool);
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await fixture?.db.close();});
const request=(path,authorized=true)=>fetch(base+path,{headers:authorized?{'x-test-user':'authorized'}:{}});
const data=async path=>{const response=await request(path);assert.equal(response.status,200,await response.clone().text());return response.json();};

test('archive metadata, detail, original assets and ZIP require a signed-in user',async()=>{
  for(const path of ['/api/evidence','/api/evidence/1','/api/evidence/export?ids=1','/api/snapshots','/api/snapshots/1/focus'])assert.equal((await request(path,false)).status,401);
});
test('pagination reaches beyond the old 18-card and 100-record caps with stable ordering',async()=>{
  const ids=[];for(let page=1;page<=5;page++){const result=await data('/api/evidence?page='+page);assert.equal(result.total,120);assert.equal(result.pages,5);ids.push(...result.items.map(row=>String(row.id)));}
  assert.equal(new Set(ids).size,120);assert.deepEqual(ids.slice(0,3),['3','2','1']);assert.ok(ids.includes('120'));
  const bounded=await data('/api/evidence?page=999');assert.equal(bounded.page,5);
});
test('source, Turkish package search and literal wildcards match stored names',async()=>{
  const result=await data('/api/evidence?q='+encodeURIComponent('havalimani')+'&source=faturasiz');assert.equal(result.total,40);assert.ok(result.items.every(row=>row.source_slug==='faturasiz'));
  assert.equal((await data('/api/evidence?q='+encodeURIComponent("Öğrenci 'Özel'"))).total,40);
  assert.equal((await data('/api/evidence?q=%25')).total,0);
  assert.equal((await data('/api/evidence?q=%27%20OR%201%3D1--')).total,0);
});
test('local dates include both boundaries in Asia/Famagusta, including winter offset',async()=>{
  await fixture.pool.query("UPDATE snapshots SET captured_at='2026-01-10T21:59:59Z' WHERE id=1");
  await fixture.pool.query("UPDATE snapshots SET captured_at='2026-01-10T22:00:00Z' WHERE id=2");
  const winter=await data('/api/evidence?from=2026-01-11&to=2026-01-11');assert.deepEqual(winter.items.map(row=>String(row.id)),['2']);
  await fixture.pool.query("UPDATE snapshots SET captured_at='2026-09-15T05:00:00Z' WHERE id IN(1,2)");
  const summer=await data('/api/evidence?from=2026-09-15&to=2026-09-15');assert.equal(summer.total,3);
  assert.equal((await request('/api/evidence?from=2026-09-16&to=2026-09-15')).status,400);
  assert.equal((await request('/api/evidence?from=2026-02-30')).status,400);
});
test('file coverage and change-only filters use the full matching archive',async()=>{
  const all=await data('/api/evidence'),missing=await data('/api/evidence?availability=missing'),complete=await data('/api/evidence?availability=complete');
  assert.equal(missing.total+complete.total,all.total);assert.equal(all.summary.missing,missing.total);
  assert.ok(missing.items.every(row=>!row.has_focus));assert.ok(complete.items.every(row=>row.has_focus&&row.has_screenshot&&row.has_html&&row.has_json));
  const changes=await data('/api/evidence?kind=change');assert.ok(changes.total>0);assert.ok(changes.items.every(row=>row.kind==='change'&&row.change_count===1));
});
test('detail links the preceding saved record of the same source and its scan changes',async()=>{
  const detail=await data('/api/evidence/4');assert.equal(detail.packages.length,3);assert.equal(detail.changes.length,1);assert.equal(detail.changes[0].old_value,'599');assert.equal(detail.previous.source_slug,detail.source_slug);assert.equal(String(detail.previous.id),'7');
  assert.equal((await data('/api/evidence/118')).previous,null);assert.equal((await request('/api/evidence/999999')).status,404);
});
test('all assets download correctly and archived HTML is served as non-executable text',async()=>{
  for(const [mode,type] of [['focus','image/png'],['image','image/png'],['json','application/json'],['html','text/plain']]){const response=await request('/api/snapshots/1/'+mode+'?download=1');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),new RegExp(type));assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
  assert.equal((await request('/api/snapshots/14/image')).status,404);assert.equal((await request('/api/snapshots/7/focus')).status,404);
});
test('ZIP contains every available original asset, changes and verifiable manifest',async()=>{
  const response=await request('/api/evidence/export?ids=1,7');assert.equal(response.status,200);const zip=Buffer.from(await response.arrayBuffer());
  const check=spawnSync('python3',['-c',`import sys,io,zipfile,json,hashlib\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nm=json.loads(z.read('manifest.json'))\nassert len(m['records'])==2\nfor r in m['records']:\n base=next(n.rsplit('/',1)[0]+'/' for n in z.namelist() if n.endswith('-'+r['id']+'/kayit.json'))\n for f in r['files']:\n  b=z.read(base+f['name']);assert len(b)==f['bytes'];assert hashlib.sha256(b).hexdigest()==f['sha256']\n assert 'sayfa.html' in [f['name'] for f in r['files']]\n assert 'tam-sayfa.png' in [f['name'] for f in r['files']]\n if r['id']=='7':assert 'paket-gorunumu.png' in r['missing']\nprint('verified')`],{input:zip,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/verified/);
});
test('invalid ids, repeated filter arguments and excessive exports are rejected',async()=>{
  for(const path of ['/api/evidence?page=-1','/api/evidence?limit=101','/api/evidence?kind=anything','/api/evidence?q=a&q=b','/api/evidence/not-an-id','/api/evidence/export?ids=1%3Bselect','/api/evidence/export?ids='+Array.from({length:11},(_,i)=>i+1).join(',')])assert.equal((await request(path)).status,400,path);
  assert.equal((await request('/api/evidence/export?ids=1,99999')).status,404);
});
