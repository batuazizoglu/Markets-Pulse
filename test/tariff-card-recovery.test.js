import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {parseCards,sha256} from '../src/parser.js';

const savedDatabaseUrl=process.env.DATABASE_URL;
process.env.DATABASE_URL='postgres://test:test@localhost/unused_recovery_test';
const {processCards}=await import('../src/scanner.js');
const {pool:unusedPool}=await import('../src/db.js');
if(savedDatabaseUrl===undefined)delete process.env.DATABASE_URL;
else process.env.DATABASE_URL=savedDatabaseUrl;

const mini=`Super Cool Uni - Mini\n5 GB\nAda İçi ve TR yönüne 50 DK ve 50 SMS\n29 Yaş ve Altı için özel\nİlk 6 ay 499 TL, İkinci 6 ay 599 TL\n₺\n499\n/ ay\nDetayları Göster\nHemen Başvur`;
const junior=`Red Junior\n10 GB\n+ 5 GB Özgür Pass\n+ Sınırsız ek uygulamalar\n500 Dk Ada içi & TR + Telsim’liler ile sınırsız konuşma ve 1000 SMS\nFatura aşımı yoktur. 6-17 yaş aralığındakiler faydalanabilir.\n₺\n569\n/ ay\nDetayları Göster\nHemen Başvur`;
function oldMini(juniorText=junior){
  const own=parseCards(mini)[0], neighbor=parseCards(juniorText)[0];
  const extras=[...own.extras_json.filter(x=>!x.startsWith('İlk ')&&!x.startsWith('İkinci ')),...neighbor.extras_json,...own.extras_json.filter(x=>x.startsWith('İlk ')||x.startsWith('İkinci '))];
  return {...own,bonus_data_gb:5,extras_json:extras,raw_text:`${own.raw_text} | ${neighbor.raw_text}`,product_hash:sha256(`legacy Mini with neighbor ${juniorText}`)};
}

let db,nextScan=1;
const source={id:1,slug:'test-faturali',name:'Faturalı'};
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query("INSERT INTO sources(id,slug,name,url) VALUES(1,'test-faturali','Faturalı','https://example.test/tariffs')");
});
after(async()=>{await db?.close();await unusedPool.end()});
async function reset(){await db.query('DELETE FROM changes');await db.query('DELETE FROM product_versions');await db.query('DELETE FROM products')}
async function scan(cards,baseline=false){
  const id=nextScan++,at=new Date(Date.UTC(2030,0,1,id));
  await db.query("INSERT INTO scans(id,source_id,started_at,status) VALUES($1,1,$2,'ok')",[id,at]);
  return processCards(source,id,cards,baseline,at,db);
}

test('boundary upgrade separates current products, recovers dated Junior evidence and emits no artificial market change',async()=>{
  await reset();await scan([oldMini()],true);
  const original=(await db.query('SELECT * FROM product_versions')).rows[0];
  assert.equal(await scan(parseCards(`${mini}\n${junior}`)),0);
  const products=(await db.query('SELECT * FROM products ORDER BY id')).rows;
  assert.equal(products.length,2);
  assert.equal(Number(products[0].id),Number(original.product_id));
  const recovered=products.find(p=>p.current_name==='Red Junior');
  assert.equal(+recovered.first_seen_at,+original.captured_at);
  const juniorVersions=(await db.query('SELECT * FROM product_versions WHERE product_id=$1 ORDER BY captured_at',[recovered.id])).rows;
  assert.equal(juniorVersions.length,2);
  assert.equal(+juniorVersions[0].captured_at,+original.captured_at);
  assert.equal(Number(juniorVersions[0].scan_id),Number(original.scan_id));
  assert.equal(Number(juniorVersions[0].data_gb),10);
  assert.ok(!juniorVersions[0].raw_text.includes('Super Cool Uni'));
  const currentMini=(await db.query('SELECT * FROM product_versions WHERE product_id=$1 ORDER BY captured_at DESC LIMIT 1',[original.product_id])).rows[0];
  assert.equal(currentMini.bonus_data_gb,null);
  assert.ok(!currentMini.raw_text.includes('Red Junior'));
  assert.deepEqual((await db.query('SELECT * FROM product_versions WHERE id=$1',[original.id])).rows[0],original);
  assert.equal(await scan(parseCards(`${mini}\n${junior}`)),0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM product_versions')).rows[0].n,4);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM changes')).rows[0].n,0);
});

test('first upgraded scan retains genuine simultaneous changes in both the donor and recovered tariff',async()=>{
  await reset();await scan([oldMini()],true);
  const changed=parseCards(`${mini.replace('50 DK','60 DK')}\n${junior.replace('\n569\n','\n599\n')}`);
  assert.equal(await scan(changed),2);
  const events=(await db.query('SELECT c.*,p.current_name FROM changes c JOIN products p ON p.id=c.product_id ORDER BY c.id')).rows;
  assert.deepEqual(events.map(e=>[e.current_name,e.field_name,e.old_value,e.new_value]),[
    ['Super Cool Uni - Mini','Ada İçi + TR Dakika','50','60'],['Red Junior','Fiyat','569','599']
  ]);
  assert.equal(await scan(changed),0);
});

test('recovery survives a previous scan cleaning the donor before it reached Junior',async()=>{
  await reset();await scan([oldMini()],true);
  const original=(await db.query('SELECT * FROM product_versions')).rows[0];
  assert.equal(await scan(parseCards(mini)),0);
  assert.equal(await scan(parseCards(`${mini}\n${junior}`)),0);
  const recovered=(await db.query("SELECT * FROM products WHERE current_name='Red Junior'")).rows[0];
  assert.equal(+recovered.first_seen_at,+original.captured_at);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM changes')).rows[0].n,0);
});

test('latest proven embedded observation supplies the recovery baseline, and real additions without evidence remain additions',async()=>{
  await reset();await scan([oldMini()],true);
  const original=(await db.query('SELECT * FROM product_versions')).rows[0];
  const newer=oldMini(junior.replace('\n569\n','\n579\n'));
  await db.query(`INSERT INTO product_versions(product_id,scan_id,captured_at,name,card_position,data_gb,bonus_data_gb,local_tr_minutes,
    international_minutes,sms,validity_days,red_passport_days,price_try,extras_json,raw_text,product_hash)
    SELECT product_id,scan_id,captured_at+INTERVAL '30 minutes',name,card_position,data_gb,bonus_data_gb,local_tr_minutes,
      international_minutes,sms,validity_days,red_passport_days,price_try,extras_json,$1,$2
    FROM product_versions WHERE id=$3`,[newer.raw_text,newer.product_hash,original.id]);
  assert.equal(await scan(parseCards(`${mini}\n${junior.replace('\n569\n','\n599\n')}`)),1);
  const event=(await db.query('SELECT * FROM changes')).rows[0];
  assert.equal(event.old_value,'579');assert.equal(event.new_value,'599');
  await reset();await scan(parseCards(mini),true);
  assert.equal(await scan(parseCards(`${mini}\n${junior}`)),1);
  const added=(await db.query('SELECT * FROM changes')).rows[0];
  assert.equal(added.change_type,'added');assert.equal(added.new_value,'Red Junior');
});
