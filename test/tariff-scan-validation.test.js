import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {SOURCE_DEFS} from '../src/config.js';
import {sourceHealth} from '../src/report-data.js';
import {queueGsmChangeNotification} from '../src/gsm-change-email.js';

const savedDatabaseUrl=process.env.DATABASE_URL;
process.env.DATABASE_URL='postgres://test:test@localhost/unused_validation_test';
const {scanSource}=await import('../src/scanner.js');
const {pool:unusedPool}=await import('../src/db.js');
if(savedDatabaseUrl===undefined)delete process.env.DATABASE_URL;
else process.env.DATABASE_URL=savedDatabaseUrl;

const source={id:1,...SOURCE_DEFS[0]};
let db;
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query('INSERT INTO sources(id,slug,name,url) VALUES($1,$2,$3,$4)',[source.id,source.slug,source.name,source.url]);
});
after(async()=>{await db?.close();await unusedPool.end()});

function card({name='Super Simple 30',data='30 GB',price='999',extra='Aşım Yok',cta='Hemen Başvur'}={}){
  return `<div class="flex flex-col bg-white shadow-full max-w-[310px] min-w-[290px] toRightShowAnimation">
    <div class="w-full p-3 rounded-t"><div class="text-white text-lg">${name}</div></div>
    <div class="w-full p-4"><h1 class="text-2xl font-bold">${data}</h1><p class="pt-4 text-xl">${extra}</p>
      <div class="flex gap-1 pt-3 border-t border-b pb-3"><div class="text-lg">500 DK Ada İçi &amp; TR ve 100 SMS</div></div>
      <div class="w-full pt-3 flex justify-start items-end"><span class="text-xl">₺</span><h1 class="text-4xl font-extrabold mx-1">${price}</h1> / ay</div>
      <div><button>Detayları Göster</button></div><div><button>${cta}</button></div>
    </div></div>`;
}
const second=()=>card({name:'Super Simple 20',data:'20 GB',price:'899'});
const page=(cards)=>`<!doctype html><html><body><h1>Faturalı</h1><div class="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">${cards}</div></body></html>`;
const captureEvidence=async()=>({fullPage:Buffer.from('full'),focused:Buffer.from('focus'),meta:{test:true}});
async function scan(html,options={}){
  return scanSource(source,{db,fetchPage:async()=>({ok:true,status:200,text:async()=>html}),captureEvidence,...options});
}
async function reset(){
  await db.query('DELETE FROM gsm_change_notifications');
  await db.query('DELETE FROM snapshots');
  await db.query('DELETE FROM changes');
  await db.query('DELETE FROM product_versions');
  await db.query('DELETE FROM products');
  await db.query('DELETE FROM scans');
}
async function catalogueState(){
  const result={};
  for(const table of ['products','product_versions','changes'])result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return result;
}
function failingDatabase(pattern){
  return {
    query:(...args)=>db.query(...args),
    transaction:callback=>db.transaction(tx=>callback({query(sql,args){
      if(pattern.test(sql))throw new Error('Injected publication failure');
      return tx.query(sql,args);
    }}))
  };
}

test('a malformed card rejects the whole scan, preserving catalogue and absence counters without emailing a change',async()=>{
  await reset();
  const baseline=await scan(page(card()+second()));
  assert.equal(baseline.ok,true);assert.equal(baseline.baseline,true);assert.equal(baseline.changes,0);
  // A previous valid absence has already started the removal counter. Failed
  // validation must not turn the next observation into a confirmed removal.
  await db.query("UPDATE products SET missing_count=1 WHERE current_name='Super Simple 20'");
  const before=await catalogueState();
  let captures=0;
  for(const malformed of [card({name:'Super Simple 20',price:'',data:'20 GB'}),card({name:'Super Simple 20',data:'',price:'899'})]){
    const result=await scan(page(card({price:'1099'})+malformed),{captureEvidence:async()=>{captures++;return captureEvidence()}});
    assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
    assert.deepEqual(await catalogueState(),before);
    const failed=(await db.query('SELECT * FROM scans WHERE id=$1',[result.scan_id])).rows[0];
    assert.equal(failed.status,'error');assert.ok(failed.finished_at);assert.match(failed.error,/TARIFF_CONTRACT_ERROR/);
    assert.match(failed.page_hash,/^[a-f0-9]{64}$/);
    const queue=await queueGsmChangeNotification(db,[result.scan_id]);
    assert.equal(queue.status,'no_changes');assert.equal(queue.queued,false);
  }
  assert.equal(captures,0);
  const health=(await sourceHealth(db))[0];
  assert.equal(health.last_status,'error');assert.match(health.last_error,/TARIFF_CONTRACT_ERROR/);
  assert.ok(health.last_success_at);assert.equal(health.active_products,2);
});

test('an invalid first scan creates no baseline; the first complete recovery does not announce every package as new',async()=>{
  await reset();
  const rejected=await scan(page(card()+card({name:'Broken offer',data:''})));
  assert.equal(rejected.ok,false);
  assert.deepEqual(await catalogueState(),{products:[],product_versions:[],changes:[]});
  const recovered=await scan(page(card()+second()));
  assert.equal(recovered.ok,true);assert.equal(recovered.baseline,true);assert.equal(recovered.changes,0);
  assert.equal((await catalogueState()).products.length,2);
});

test('an unsupported card shape cannot silently remove a tariff that is already tracked',async()=>{
  await reset();await scan(page(card()+second()));
  const before=await catalogueState();
  const result=await scan(page(card()+card({name:'Super Simple 20',data:'500 MB',price:'899'})));
  assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
  assert.deepEqual(await catalogueState(),before);
  assert.ok(result.validation?.excluded.some(item=>item.name==='Super Simple 20'));
});

test('a Red Box card changing to an excluded quota preserves its tracked legacy body identity',async()=>{
  await reset();
  const numeric=card({name:'Red Box 200 GB',data:'4.5G',extra:'12 Ay Tarifeye Ek</p><p>200 GB',price:'1299'});
  const baseline=await scan(page(card()+numeric));
  assert.equal(baseline.ok,true);
  const legacy=(await db.query("SELECT current_name,identity_base FROM products WHERE current_name='12 Ay Tarifeye Ek'")).rows[0];
  assert.deepEqual(legacy,{current_name:'12 Ay Tarifeye Ek',identity_base:'12-ay-tarifeye-ek'});
  const before=await catalogueState();
  const excluded=card({name:'Red Box 200 GB',data:'500 MB',extra:'12 Ay Tarifeye Ek',price:'1299'});
  const result=await scan(page(card()+excluded));
  assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
  assert.deepEqual(await catalogueState(),before);
  assert.deepEqual(result.validation.excluded[0].protected_identity_bases,['12-ay-tarifeye-ek']);
  assert.equal((await queueGsmChangeNotification(db,[result.scan_id])).status,'no_changes');
});

test('the known unlimited Red Box exclusion coexists with a supported numeric legacy identity',async()=>{
  await reset();
  const numeric=price=>card({name:'Red Box 200 GB',data:'4.5G',extra:'12 Ay Tarifeye Ek</p><p>200 GB',price});
  const unlimited=card({name:'Red Box Sınırsız',data:'4.5G',extra:'Sınırsız',price:'1799'});
  const baseline=await scan(page(numeric('1299')+unlimited));
  assert.equal(baseline.ok,true);assert.equal(baseline.parsed_count,1);assert.equal(baseline.validation.excluded.length,1);
  const next=await scan(page(numeric('1399')+unlimited));
  assert.equal(next.ok,true);assert.equal(next.changes,1);
  assert.deepEqual((await db.query('SELECT current_name,active,missing_count FROM products')).rows,
    [{current_name:'12 Ay Tarifeye Ek',active:true,missing_count:0}]);
  assert.deepEqual((await db.query('SELECT field_name,old_value,new_value FROM changes')).rows,
    [{field_name:'Fiyat',old_value:'1299',new_value:'1399'}]);
});

test('same-name tracked offers converging to identical terms cannot collapse into a false removal',async()=>{
  await reset();
  const baseline=await scan(page(card({price:'999'})+card({price:'1099'})));
  assert.equal(baseline.ok,true);assert.equal(baseline.parsed_count,2);
  const before=await catalogueState();
  assert.equal(before.products.length,2);
  for(let attempt=0;attempt<2;attempt++){
    const result=await scan(page(card({price:'1099'})+card({price:'1099'})));
    assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
    assert.deepEqual(await catalogueState(),before);
    assert.equal((await queueGsmChangeNotification(db,[result.scan_id])).status,'no_changes');
  }
});

test('convergence remains ambiguous when another same-name variant is also absent',async()=>{
  await reset();
  const baseline=await scan(page(card({price:'999'})+card({price:'1099'})+card({price:'1199'})));
  assert.equal(baseline.ok,true);assert.equal(baseline.parsed_count,3);
  const before=await catalogueState();
  for(let attempt=0;attempt<2;attempt++){
    const result=await scan(page(card({price:'1099'})+card({price:'1099'})));
    assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
    assert.deepEqual(await catalogueState(),before);
    assert.equal((await queueGsmChangeNotification(db,[result.scan_id])).status,'no_changes');
  }
});

test('repeated identical static markup continues to represent a single known offer',async()=>{
  await reset();
  const html=page(card()+card());
  const baseline=await scan(html);
  assert.equal(baseline.ok,true);assert.equal(baseline.parsed_count,1);assert.equal(baseline.changes,0);
  const repeated=await scan(html);
  assert.equal(repeated.ok,true);assert.equal(repeated.parsed_count,1);assert.equal(repeated.changes,0);
  assert.equal((await catalogueState()).products.length,1);
  assert.equal((await catalogueState()).product_versions.length,1);
  assert.equal((await catalogueState()).changes.length,0);
});

test('a redirect to another tariff page or host is rejected before mutation while canonical trailing slash is accepted',async()=>{
  await reset();await scan(page(card()));
  const before=await catalogueState();
  const html=page(card({price:'1099'}));
  for(const url of [SOURCE_DEFS[1].url,'https://untrusted.example/tr/tarifeler/tarifeler/faturali','http://www.kktctelsim.com/tr/tarifeler/tarifeler/faturali']){
    const result=await scan(html,{fetchPage:async()=>({ok:true,status:200,url,text:async()=>html})});
    assert.equal(result.ok,false);assert.match(result.error,/TARIFF_CONTRACT_ERROR/);
    assert.equal(result.error.match(/TARIFF_CONTRACT_ERROR/g).length,1);
    assert.deepEqual(await catalogueState(),before);
  }
  const accepted=await scan(html,{fetchPage:async()=>({ok:true,status:200,url:source.url+'/',text:async()=>html})});
  assert.equal(accepted.ok,true);assert.equal(accepted.changes,1);
});

test('publication failure after a written price change rolls back versions, events, names and absence counters',async()=>{
  await reset();await scan(page(card()+second()));
  const before=await catalogueState();
  // Absence processing happens after processCards has appended the real price
  // event. Failing there exercises rollback of more than the first SQL write.
  const result=await scan(page(card({price:'1099'})),{db:failingDatabase(/UPDATE products SET missing_count/)});
  assert.equal(result.ok,false);assert.match(result.error,/Injected publication failure/);
  assert.deepEqual(await catalogueState(),before);
  assert.equal((await db.query('SELECT status FROM scans WHERE id=$1',[result.scan_id])).rows[0].status,'error');
  assert.equal((await queueGsmChangeNotification(db,[result.scan_id])).status,'no_changes');
});

test('successful complete scans still publish genuine prices and require two complete absences for removal',async()=>{
  await reset();await scan(page(card()+second()));
  const first=await scan(page(card({price:'1099'})));
  assert.equal(first.ok,true);assert.equal(first.changes,1);
  assert.equal(first.validation.contract_version,'telsim-dom-v2');
  const evidence=(await db.query('SELECT screenshot_meta FROM snapshots WHERE scan_id=$1',[first.scan_id])).rows[0];
  assert.equal(evidence.screenshot_meta.validation.contract_version,'telsim-dom-v2');
  assert.deepEqual((await db.query('SELECT field_name,old_value,new_value FROM changes')).rows,[{field_name:'Fiyat',old_value:'999',new_value:'1099'}]);
  const waiting=(await db.query("SELECT active,missing_count FROM products WHERE current_name='Super Simple 20'")).rows[0];
  assert.deepEqual(waiting,{active:true,missing_count:1});
  const rejected=await scan(page(card({price:''})));
  assert.equal(rejected.ok,false);
  assert.deepEqual((await db.query("SELECT active,missing_count FROM products WHERE current_name='Super Simple 20'")).rows[0],waiting);
  const secondScan=await scan(page(card({price:'1099'})));
  assert.equal(secondScan.ok,true);assert.equal(secondScan.changes,1);
  assert.deepEqual((await db.query("SELECT active,missing_count FROM products WHERE current_name='Super Simple 20'")).rows[0],{active:false,missing_count:2});
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM changes WHERE change_type='removed'")).rows[0].n,1);
  const queue=await queueGsmChangeNotification(db,[first.scan_id,secondScan.scan_id]);
  assert.equal(queue.queued,true);assert.equal(queue.change_count,2);
});

test('post-commit evidence storage failure cannot invalidate a validated published catalogue',async()=>{
  await reset();await scan(page(card()));
  const evidenceFailure={
    query(sql,args){if(/INSERT INTO snapshots/.test(sql))throw new Error('Injected evidence save failure');return db.query(sql,args)},
    transaction:callback=>db.transaction(callback)
  };
  const result=await scan(page(card({price:'1099'})),{db:evidenceFailure});
  assert.equal(result.ok,true);assert.equal(result.changes,1);assert.match(result.evidence_error,/Injected evidence save failure/);
  const published=(await db.query('SELECT status,error FROM scans WHERE id=$1',[result.scan_id])).rows[0];
  assert.deepEqual(published,{status:'ok',error:null});
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM changes WHERE scan_id=$1',[result.scan_id])).rows[0].n,1);
  assert.equal((await queueGsmChangeNotification(db,[result.scan_id])).change_count,1);
});

test('retired Super Red duplicate cannot replace a tracked live card or generate a false price alert',async()=>{
  await reset();
  const other={id:2,...SOURCE_DEFS[2]};
  await db.query('INSERT INTO sources(id,slug,name,url) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[other.id,other.slug,other.name,other.url]);
  const red=(price='669')=>card({name:'Super Red 10',data:'10 GB',price,extra:'+ 15 GB Özgür Pass'});
  const retired=card({name:'Super Red 10',data:'10 GB + 15 GB Özgür Pass',price:'2109',extra:'Bu tarife sonlanmıştır',cta:''});
  const run=html=>scanSource(other,{db,fetchPage:async()=>({ok:true,status:200,text:async()=>page(html)}),captureEvidence});
  assert.equal((await run(red()+second())).ok,true);
  const recovery=await run(red()+second()+retired);
  assert.equal(recovery.ok,true);assert.equal(recovery.changes,0);
  const changed=await run(red('699')+second()+retired);
  assert.equal(changed.ok,true);assert.equal(changed.changes,1);
  const before=await catalogueState();
  assert.equal(before.products.filter(row=>row.current_name==='Super Red 10').length,1);
  const missing=await run(second()+retired);
  assert.equal(missing.ok,false);assert.match(missing.error,/Super Red 10/);
  const withoutPurchaseControl=await run(red('699').replace('Hemen Başvur','')+second()+retired);
  assert.equal(withoutPurchaseControl.ok,false);assert.match(withoutPurchaseControl.error,/Super Red 10/);
  const ambiguous=await run(red('699')+red('759')+second()+retired);
  assert.equal(ambiguous.ok,false);assert.match(ambiguous.error,/Super Red 10/);
  assert.deepEqual(await catalogueState(),before);
});
