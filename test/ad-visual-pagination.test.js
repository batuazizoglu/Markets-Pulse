import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {SCHEMA_SQL} from '../src/schema.js';
import {getAdVisuals,getPendingAdVisuals,registerAdVisualRoutes} from '../src/ad-visual.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';

async function archive(){
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const rows=Array.from({length:551},(_,i)=>({
    key:'164143610515:'+String(100000+i)+':1',ad_id:String(100000+i),page_id:'164143610515',variant_id:'1',
    brand:i>=450&&i<520||i===550?'Nethouse':'Telsim',category:i<520?'home':i===550?'mnp':'gsm',
    observed_at:'2026-09-20T00:00:00.123Z',title:'Görsel '+i,visual_summary:'İncelenmiş reklam',
    category_evidence:'Evde internet',images:[{sha256:'a'.repeat(64),captured_at:'2026-09-20T00:00:00.123Z'}]
  }));
  await db.query(`INSERT INTO ad_visual_items(ad_key,brand,category,first_seen_at,observed_at,meaning_hash,analysis_json)
    SELECT value->>'key',value->>'brand',value->>'category','2026-09-20T00:00:00.123456Z','2026-09-20T00:00:00.123456Z','seed',value FROM jsonb_array_elements($1::jsonb)`,[JSON.stringify(rows)]);
  return db;
}

test('archive keyset pages traverse every tied timestamp without overlap and count the full database',async()=>{
  const db=await archive();
  try{
    const initial=await getAdVisuals(db);assert.equal(initial.rows.length,400);assert.equal(initial.total,551);
    assert.deepEqual(initial.groups,{home:520,gsm:30,mnp:1,review:0});assert.equal(initial.brand_groups.Nethouse.home,70);
    assert.equal(initial.pagination.total,551);assert.equal(initial.pagination.has_more,true);
    const remainder=await getAdVisuals(db,{cursor:initial.pagination.next_cursor});assert.equal(remainder.rows.length,151);
    assert.equal(remainder.pagination.has_more,false);assert.equal(remainder.pagination.next_cursor,null);
    assert.equal(new Set([...initial.rows,...remainder.rows].map(r=>r.key)).size,551);
    let cursor,seen=[];
    do{
      const page=await getAdVisuals(db,{limit:73,...(cursor?{cursor}:{})});assert.ok(page.rows.length<=73);
      seen.push(...page.rows.map(row=>row.key));cursor=page.pagination.next_cursor;
    }while(cursor);
    assert.equal(seen.length,551);assert.equal(new Set(seen).size,551);
    const source=await getAdVisuals(db,{brand:'Nethouse',category:'home',limit:37});assert.equal(source.pagination.total,70);
    assert.ok(source.rows.every(row=>row.brand==='Nethouse'&&row.category==='home'));
    const last=await getAdVisuals(db,{brand:'Nethouse',category:'home',limit:37,cursor:source.pagination.next_cursor});assert.equal(last.rows.length,33);
    assert.equal(new Set([...source.rows,...last.rows].map(row=>row.key)).size,70);
    await assert.rejects(getAdVisuals(db,{category:'gsm',cursor:source.pagination.next_cursor}),/Geçersiz/);
    for(const options of [{limit:0},{limit:401},{limit:'1; SELECT 1'},{brand:['Telsim']},{brand:'bad\u0000brand'},{category:'other'},{cursor:'invalid'},{cursor:Buffer.from('{}').toString('base64url')}])await assert.rejects(getAdVisuals(db,options),/Geçersiz/);
    for(const change of [{t:'2026-02-30T00:00:00.000000Z'},{t:'0000-01-01T00:00:00.000000Z'},{k:'bad\u0000key'}]){
      const cursor=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(initial.pagination.next_cursor,'base64url').toString()),...change})).toString('base64url');await assert.rejects(getAdVisuals(db,{cursor}),/Geçersiz/);
    }
    assert.equal((await getAdVisuals(db,{brand:"' OR 1=1--"})).rows.length,0);
  }finally{await db.close()}
});

test('pending evidence has bounded pages, only stored media, and an unclassified main-page gallery before AI runs',async()=>{
  const db=await archive();
  const job=(await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json) VALUES('pending-gallery','Nethouse','{}') RETURNING id")).rows[0].id;
  await db.query('INSERT INTO ad_visual_evidence(sha256,jpeg) VALUES($1,$2)',['b'.repeat(64),Buffer.from([255,216,255,217])]);
  const candidates=Array.from({length:65},(_,i)=>({key:'pending:'+String(100000+i),brand:i<55?'Nethouse':'Telsim',ad_id:String(200000+i),variant_id:String(i+1),source_url:'https://www.facebook.com/ads/library/?id='+String(200000+i),media_kind:i===0?'video_preview':'image',ad_text:'<script>source()</script>',secret:'must not leak',media_url:'https://cdn.example/private?token=secret',images:[{sha256:'b'.repeat(64),captured_at:'2026-09-20T00:00:00Z'},{sha256:'c'.repeat(64)}]}));
  const known=(await db.query('SELECT ad_key,analysis_json FROM ad_visual_items ORDER BY ad_key LIMIT 1')).rows[0];
  const all=[...candidates,{...candidates[0],key:'missing-evidence',images:[{sha256:'c'.repeat(64)}]},{...candidates[0],key:known.ad_key}];
  await db.query(`INSERT INTO ad_cloud_candidates(ad_key,job_id,fingerprint,payload,status,observed_at)
    SELECT value->>'key',$1,'seed',value,CASE WHEN value->>'key'='pending:100001' THEN 'error' ELSE 'pending' END,'2026-09-20T00:00:00.123456Z' FROM jsonb_array_elements($2::jsonb)`,[job,JSON.stringify(all)]);
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'}),requests=[];
  dom.window.fetch=async url=>{requests.push(url);const parsed=new URL(url,'https://www.marketspulse.cloud');return {ok:true,json:async()=>parsed.pathname.endsWith('/pending')?getPendingAdVisuals(db,Object.fromEntries(parsed.searchParams)):getAdVisuals(db,Object.fromEntries(parsed.searchParams))}};
  const settled=async()=>{await new Promise(r=>setTimeout(r,0));await dom.window.AdVisualUI.load()};
  try{
    const overview=await getAdVisuals(db);assert.deepEqual(overview.pending_media,{total:65,brand_totals:{Nethouse:55,Telsim:10}});
    const first=await getPendingAdVisuals(db);assert.equal(first.rows.length,50);assert.equal(first.pagination.total,65);assert.equal(first.rows[0].images.length,1);
    assert.equal(first.rows[0].secret,undefined);assert.equal(first.rows[0].media_url,undefined);assert.equal(first.rows[0].category,undefined);assert.equal(first.rows[0].offer,undefined);
    const next=await getPendingAdVisuals(db,{cursor:first.pagination.next_cursor});assert.equal(next.rows.length,15);assert.equal(next.pagination.has_more,false);assert.equal(new Set([...first.rows,...next.rows].map(row=>row.key)).size,65);
    const brand=await getPendingAdVisuals(db,{brand:'Nethouse'});assert.equal(brand.pagination.total,55);await assert.rejects(getPendingAdVisuals(db,{limit:101}),/en fazla 100/);
    dom.window.eval(await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8'));await settled();await dom.window.AdVisualUI.mountHome();const d=dom.window.document;
    assert.match(d.querySelector('.av-pending>summary').textContent,/65/);assert.equal(requests.filter(url=>url.includes('/pending')).length,0);assert.equal(d.querySelector('#hiAdVisualMount .av-pending'),null);
    d.querySelector('.av-pending').open=true;await settled();assert.equal(d.querySelectorAll('.av-pending-item').length,50);assert.equal(d.querySelectorAll('.av-pending .av-card,.av-pending .av-offer').length,0);
    assert.match(d.querySelector('.av-pending-item').textContent,/AI incelemesi bekliyor.*Kategori doğrulanmadı/s);assert.match(d.querySelector('.av-pending-item').textContent,/videonun tamamı incelenmedi/);assert.equal(d.querySelector('.av-pending script'),null);
    assert.match(d.querySelector('.av-pending img').src,/\/api\/ad-visuals\/evidence\/b{64}\.jpg$/);
    d.querySelector('[data-av-pending-more]').click();await settled();assert.equal(d.querySelectorAll('.av-pending-item').length,65);assert.equal(d.querySelector('[data-av-pending-more]'),null);
    const filter=d.querySelector('#ad-visual-section [data-av-brand]');filter.value='Telsim';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settled();
    assert.equal(d.querySelectorAll('.av-pending-item').length,10);assert.match(requests.filter(url=>url.includes('/pending')).at(-1),/brand=Telsim/);assert.equal(d.querySelector('.av-pending').open,true);
  }finally{dom.window.close();await db.close()}
});

test('archive route serves filter pages and rejects malformed or mismatched cursors as client errors',async()=>{
  const db=await archive(),{default:express}=await import('express'),app=express();registerAdVisualRoutes(app,db,HOME_INTERNET_SOURCES);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/ad-visuals';
  try{
    const response=await fetch(url+'?category=home&brand=Nethouse&limit=20'),data=await response.json();assert.equal(response.status,200);assert.equal(data.rows.length,20);assert.equal(data.pagination.total,70);
    for(const query of ['limit=500','category=unknown','brand[]=Nethouse','cursor=%25','category=gsm&cursor='+data.pagination.next_cursor]){
      const bad=await fetch(url+'?'+query);assert.equal(bad.status,400);assert.match((await bad.json()).error,/Geçersiz/);
    }
  }finally{await new Promise(r=>server.close(r));await db.close()}
});

test('UI exposes the full archive with bounded load-more and server filters while preserving home and main views',async()=>{
  const db=await archive(),requests=[];
  const dom=new JSDOM('<main class="shell"><div id="hiAdVisualMount"></div></main>',{url:'https://www.marketspulse.cloud/#ads',runScripts:'outside-only'});
  dom.window.fetch=async url=>{
    requests.push(url);const q=new URL(url,'https://www.marketspulse.cloud').searchParams;
    const data=await getAdVisuals(db,Object.fromEntries(q));return {ok:true,json:async()=>data};
  };
  const settled=async()=>{await dom.window.AdVisualUI.load();await new Promise(r=>setTimeout(r,0))};
  try{
    dom.window.eval(await readFile(new URL('../public/ad-visual.js',import.meta.url),'utf8'));await settled();const d=dom.window.document;
    assert.equal(requests.length,2);assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,100);
    assert.match(d.querySelector('.av-pagination').textContent,/100 \/ 520/);assert.match(d.querySelector('[data-av-category="gsm"]').textContent,/30/);
    await settled();assert.equal(requests.length,2,'no unbounded background pagination');
    for(const size of [200,300,400,500,520]){
      d.querySelector('#ad-visual-section [data-av-more]').click();await settled();assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,size);
    }
    assert.equal(d.querySelector('#ad-visual-section [data-av-more]'),null);assert.equal(requests.length,7);
    await dom.window.AdVisualUI.mountHome();assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,520);
    const brand=d.querySelector('#ad-visual-section [data-av-brand]');brand.value='Nethouse';brand.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settled();
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,70);assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,70);
    assert.match(requests.at(-1),/brand=Nethouse/);assert.match(d.querySelector('.av-source-focus').textContent,/Arşivdeki analiz: 71/);
    await dom.window.AdVisualUI.setCategory('mnp');assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,70);
    await dom.window.AdVisualUI.load(true);assert.equal(d.querySelector('[data-av-brand]').value,'Nethouse');assert.equal(d.querySelector('[data-av-category="mnp"]').getAttribute('aria-pressed'),'true');
    assert.equal(d.querySelectorAll('#ad-visual-section .av-card').length,1);assert.equal(d.querySelectorAll('#hiAdVisualMount .av-card').length,70);
  }finally{dom.window.close();await db.close()}
});
