import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {SOURCE_DEFS} from '../src/config.js';
import {acquisitionMenus,buildTariffIdentitySnapshot,readTariffIdentityPage} from '../src/tariff-identity.js';
import {planLegacyBindings,previewScopedChanges} from '../src/tariff-identity-plan.js';
import {stageTariffBindings} from '../src/tariff-identity-migration.js';

const [port,customer,conversion]=Object.keys(acquisitionMenus);
function page(source,items,menu=null) {
  const path=new URL(SOURCE_DEFS.find(s=>s.slug===source).url).pathname;
  const choices=[null,...(source==='diger-faturali'?Object.keys(acquisitionMenus):[])];
  const links=choices.map(m=>`<a class="${m===menu?'active_filter':''}" href="${path}${m?'?menu='+m:''}">${m?acquisitionMenus[m][1]:'Tümü'}</a>`).join('');
  const wrap=(id,props)=>['$','div',String(id),{children:['$','$L1',null,props]}];
  const entries=items.map((item,i)=>wrap(i,{activeMenu:path.split('/').at(-1),packageData:{id:item.id,
    attributes:{title:item.name,Internet_Quota:item.red?'4.5G':'30 GB',Price:item.price}}}));
  const grid=['$','div',null,{className:'max-w-4xl grid grid-cols-1',children:entries.map((_,i)=>'$L'+(i+16).toString(16))}];
  const flight='0:'+JSON.stringify(grid)+'\n'+entries.map((e,i)=>(i+16).toString(16)+':'+JSON.stringify(e)+'\n').join('');
  const cards=items.map(x=>`<div><div class="shadow-full"><div class="rounded-t">${x.name}</div><div>
    <h1 class="text-2xl">${x.red?'4.5G':'30 GB'}</h1>${x.red?'<p>12 Ay Tarifeye Ek</p><p>'+x.red+' GB</p>':'<p>Aşım Yok</p>'}
    <p>500 DK Ada İçi &amp; TR ve 100 SMS</p><div><span>₺</span><h1 class="text-4xl">${x.price}</h1> / ay</div>
    <button>Detayları Göster</button><button>Hemen Başvur</button></div></div></div>`).join('');
  return '<html><body><nav>'+links+'</nav><div class="grid">'+cards+'</div><script>self.__next_f.push('+JSON.stringify([1,flight])+')</script></body></html>';
}
const item=(id,name='Super Simple 30',price=999)=>({id,name,price});
const general=(items,source='faturali')=>buildTariffIdentitySnapshot(source,{catalogue:page(source,items)});
function bundle(items) {
  const source='diger-faturali';
  return Object.fromEntries([[ 'catalogue',page(source,items)],...[port,customer,conversion].map(m=>[m,page(source,items.filter(x=>x.menu===m),m)])]);
}
const previous=s=>s.offers.map((o,i)=>({...o,productId:String(i+1),active:true,missingCount:0}));
const legacy=(snapshot,o,id,scan=1)=>({source:snapshot.source,id,versions:[{...o.card,id,scan_id:scan}]});

test('equal terms in three channels stay distinct, reordered cards and crossed prices retain exact IDs',()=>{
  const source='diger-faturali';
  const a=[{...item(549),menu:port},{...item(595),menu:conversion},{...item(700),menu:customer}];
  const before=buildTariffIdentitySnapshot(source,bundle(a)), prior=previous(before);
  assert.deepEqual(before.offers.map(o=>o.channel),['port-in','postpaid-conversion','new-customer']);
  const now=[{...a[2],price:799},{...a[1],price:999},{...a[0],price:1799}];
  const snapshot=buildTariffIdentitySnapshot(source,bundle(now));
  const changes=previewScopedChanges(snapshot,prior).events;
  assert.deepEqual(changes.map(e=>[e.productId,e.field,e.before,e.after]),[['3','Fiyat',999,799],['1','Fiyat',999,1799]]);
  assert.equal(previewScopedChanges(snapshot,previous(snapshot)).events.length,0);
  assert.notEqual(general([item(549)],'faturali').offers[0].key,general([item(549)],'faturasiz').offers[0].key);
});

test('missing or inconsistent channel, multiple memberships and supplier/DOM disagreement stop the source',()=>{
  const source='diger-faturali',a=[{...item(549),menu:port},{...item(595),menu:conversion},{...item(700),menu:customer}];
  const b=bundle(a);
  assert.throws(()=>buildTariffIdentitySnapshot(source,{catalogue:b.catalogue}),/missing/);
  assert.throws(()=>buildTariffIdentitySnapshot(source,{...b,[port]:b[conversion]}),/filter/);
  assert.throws(()=>buildTariffIdentitySnapshot(source,{...b,[port]:page(source,[a[0],a[1]],port)}),/multiple/);
  assert.throws(()=>buildTariffIdentitySnapshot(source,{...b,[port]:page(source,[{...a[0],price:1200}],port)}),/inconsistent/);
  assert.throws(()=>readTariffIdentityPage(b.catalogue.replace('class="text-4xl">999','class="text-4xl">333'),source),/disagree/);
  assert.throws(()=>general([item(1),item(1,'Super Simple 20')]),/conflicting/);
});

test('Red Box uses the supplier ID and physical title while ambiguous legacy body names are held',()=>{
  const a={...item(701,'Red Box 50GB',550),red:50}, b={...item(704,'Red Box 200GB',999),red:200};
  assert.throws(()=>general([{...a,red:200}]),/Red Box header/);
  const base=general([a,b]), now=general([{...b,price:1499},a]);
  assert.deepEqual(base.offers.map(o=>[o.offerId,o.title,o.card.name]),[['701','Red Box 50GB','12 Ay Tarifeye Ek'],['704','Red Box 200GB','12 Ay Tarifeye Ek']]);
  const events=previewScopedChanges(now,previous(base)).events;
  assert.deepEqual(events.map(e=>[e.productId,e.field,e.after]),[['2','Fiyat',1499]]);
  assert.equal(planLegacyBindings('faturali',[legacy(base,base.offers[1],1)],new Map([['1',base]])).ready,false);
});

test('historical ambiguity, ID replacements and missing archives cannot manufacture events',()=>{
  const base=general([item(10)]), a=legacy(base,base.offers[0],1);
  assert.equal(planLegacyBindings('faturali',[a],new Map()).ready,false);
  assert.equal(planLegacyBindings('faturali',[{...a,versions:[{...a.versions[0],price_try:123}]}],new Map([['1',base]])).ready,false);
  assert.equal(planLegacyBindings('faturali',[a,{...a,id:2}],new Map([['1',base]])).bindings.length,0);
  const next=general([item(12)]), v=legacy(next,next.offers[0],2,2).versions[0];
  assert.equal(planLegacyBindings('faturali',[{...a,versions:[...a.versions,v]}],new Map([['1',base],['2',next]])).ready,false);
  assert.throws(()=>previewScopedChanges(next,previous(base)),/replacement/);
  const prior=previous(general([item(10),item(11,'Second name')]));
  assert.equal(previewScopedChanges(base,prior).events.length,0);
  prior[1].missingCount=1;
  assert.equal(previewScopedChanges(base,prior).events[0].type,'removed');
});

test('two channels exchanging existing prices stay with their original products, and a channel move is held',()=>{
  const source='diger-faturali',a=[{...item(549,'Super Simple 30',1099),menu:port},
    {...item(595),menu:conversion},{...item(700,'Another offer'),menu:customer}];
  const prior=previous(buildTariffIdentitySnapshot(source,bundle(a)));
  const next=[{...a[1],price:1099},{...a[0],price:999},a[2]];
  const current=buildTariffIdentitySnapshot(source,bundle(next));
  assert.deepEqual(previewScopedChanges(current,prior).events.map(e=>[e.productId,e.before,e.after]),
    [['2',999,1099],['1',1099,999]]);
  const moved=[{...a[0],menu:customer},a[1],a[2],{...item(800,'Other port-in'),menu:port}];
  assert.throws(()=>previewScopedChanges(buildTariffIdentitySnapshot(source,bundle(moved)),prior),/transfer/);
});

test('staging migration is atomic, repeatable and leaves the product, scan, evidence and event history intact',async()=>{
  const db=new PGlite();
  try {
    await db.exec(SCHEMA_SQL);await db.exec(await readFile(new URL('../docs/sql/tariff-product-identities.sql',import.meta.url),'utf8'));
    await db.exec("INSERT INTO sources(slug,name,url) VALUES('faturali','Faturalı','https://example.com'); INSERT INTO scans(source_id,started_at,status) VALUES(1,NOW(),'ok'); INSERT INTO products(source_id,identity_base,current_name,first_seen_at,last_seen_at) VALUES(1,'super-simple-30','Super Simple 30',NOW(),NOW())");
    const html=page('faturali',[item(543)]), card=general([item(543)]).offers[0].card;
    await db.query('INSERT INTO product_versions(product_id,scan_id,captured_at,name,raw_text,product_hash,data_gb,local_tr_minutes,sms,price_try,extras_json) VALUES(1,1,NOW(),$1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[card.name,card.raw_text,card.product_hash,card.data_gb,card.local_tr_minutes,card.sms,card.price_try,JSON.stringify(card.extras_json)]);
    const run=writeBindings=>db.transaction(tx=>stageTariffBindings(tx,'faturali',{writeBindings}));
    assert.equal((await run(true)).ready,false);
    await db.query("INSERT INTO snapshots(source_id,scan_id,captured_at,kind,html_gzip) VALUES(1,1,NOW(),'baseline',$1)",[gzipSync(html)]);
    await db.query("INSERT INTO changes(source_id,product_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity) VALUES(1,1,1,NOW(),'field_changed','Fiyat','899','999','critical')");
    const history=async()=>Promise.all(['scans','snapshots','products','product_versions','changes'].map(async table=>(await db.query('SELECT * FROM '+table+' ORDER BY id')).rows));
    const before=await history();
    assert.equal((await run(false)).ready,true);
    assert.equal((await db.query('SELECT * FROM tariff_product_identities')).rows.length,0);
    await run(true);await run(true);
    const bindings=(await db.query('SELECT supplier_offer_id FROM tariff_product_identities')).rows;
    assert.deepEqual(bindings,[{supplier_offer_id:'543'}]);assert.deepEqual(await history(),before);
  } finally {await db.close();}
});
