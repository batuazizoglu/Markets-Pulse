import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {parseCards, rebaseCommercialTerms} from '../src/parser.js';

// Scanner persistence uses an injected, isolated database. Importing its default
// pool must not need production credentials or open a network connection.
const savedDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgres://test:test@localhost/unused_tariff_test';
const {processCards} = await import('../src/scanner.js');
const {pool: unusedPool} = await import('../src/db.js');
if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = savedDatabaseUrl;

function tariff({secondPrice=2099, nonStop=true, phases=true, price=1899}={}) {
  return `Super Cool Uni - Maxi
60 GB${nonStop ? ' (Non-Stop)' : ''}
+ 20 GB Özgür Pass
+ Sınırsız
Ada içi Sınırsız Konuşma + 700 Dk Türkiye yönüne ve 700 SMS
29 Yaş ve Altı için özel
${phases ? `İlk 6 ay ${price} TL, İkinci 6 ay ${secondPrice} TL` : ''}
₺
${price}
/ ay`;
}
function card(options) {return parseCards(tariff(options))[0]}
function legacyCard(options) {
  const parsed = card(options);
  return {...parsed, extras_json: [
    '+ 20 GB Özgür Pass', '+ Sınırsız',
    'Ada içi Sınırsız Konuşma + 700 Dk Türkiye yönüne ve 700 SMS',
    '29 Yaş ve Altı için özel'
  // Hash of this fixture's exact pre-upgrade canonical object (which omitted
  // both commercial terms). This also equals the current card with both absent.
  ], product_hash: '2da1e97a3e8952b1dab703be222033b8da3cea9cbf837a0846d753b5939a1793'};
}

let db, nextScan=1;
const source = {id:1, slug:'test-faturali', name:'Faturalı'};
before(async()=>{
  db = new PGlite();
  await db.exec(SCHEMA_SQL);
  await db.query("INSERT INTO sources(id,slug,name,url) VALUES(1,'test-faturali','Faturalı','https://example.test/tariffs')");
});
after(async()=>{await db?.close(); await unusedPool.end()});
async function scan(cards, baseline=false) {
  const scanId=nextScan++, at=new Date(Date.UTC(2030,0,1,scanId));
  await db.query("INSERT INTO scans(id,source_id,started_at,status) VALUES($1,1,$2,'ok')",[scanId,at]);
  return processCards(source,scanId,cards,baseline,at,db);
}

test('second-phase pricing and Non-Stop change the canonical card without changing base allowance or introductory price',()=>{
  const original=card(), secondPhase=card({secondPrice:2199}), noNonStop=card({nonStop:false});
  assert.equal(original.price_try,1899);
  assert.equal(secondPhase.price_try,1899);
  assert.equal(noNonStop.data_gb,60);
  assert.ok(original.extras_json.includes('İlk 6 ay: 1899 TL'));
  assert.ok(original.extras_json.includes('İkinci 6 ay: 2099 TL'));
  assert.ok(original.extras_json.includes('Non-Stop internet'));
  assert.notEqual(original.product_hash,secondPhase.product_hash);
  assert.notEqual(original.product_hash,noNonStop.product_hash);
  assert.equal(card().product_hash,original.product_hash);
  const split = parseCards(tariff().replace(', İkinci 6 ay', '\nİkinci 6 ay'))[0];
  assert.ok(split.extras_json.includes('İkinci 6 ay: 2099 TL'));
  assert.equal(split.product_hash,original.product_hash);
  const splitSon = parseCards(tariff().replace(', İkinci 6 ay', '\nSon 6 ay'))[0];
  const changedSon = parseCards(tariff({secondPrice:2199}).replace(', İkinci 6 ay', '\nSon 6 ay'))[0];
  assert.ok(splitSon.extras_json.includes('Son 6 ay: 2099 TL'));
  assert.notEqual(splitSon.product_hash,changedSon.product_hash);
});

test('old raw text rebases only commercial comparison terms and keeps identity, existing fields and historical hash intact',()=>{
  const old={...legacyCard(),id:123,current_name:'Historical identity',identity_base:'historical-identity'};
  const saved=structuredClone(old), rebased=rebaseCommercialTerms(old,card());
  assert.deepEqual(rebased.extras_json,card().extras_json);
  assert.equal(rebased.id,123);
  assert.equal(rebased.current_name,'Historical identity');
  assert.equal(rebased.identity_base,'historical-identity');
  assert.equal(rebased.product_hash,old.product_hash);
  assert.deepEqual(old,saved);
  const changed=rebaseCommercialTerms(old,card({secondPrice:2199}));
  assert.ok(changed.extras_json.includes('İkinci 6 ay: 2099 TL'));
  assert.ok(!changed.extras_json.includes('İkinci 6 ay: 2199 TL'));
});

test('phase line wrapping, ordering, Turkish currency grouping and currency position preserve the same hash',()=>{
  const phaseRow='İlk 6 ay 1899 TL, İkinci 6 ay 2099 TL';
  const original=card();
  const variants=[
    'İlk 6 ay 1899 TL\nİkinci 6 ay 2099 TL',
    'İlk 6 ay 1.899,00 TL, İkinci 6 ay 2.099 TL',
    'İlk 6 ay ₺1.899, İkinci 6 ay ₺2.099',
    'İlk 6 ay 1 899 TL, İkinci 6 ay 2 099,00 TL',
    'İkinci 6 ay 2099 TL; İlk 6 ay 1899 TL',
    'İlk 6 ay\n1899 TL\nİkinci 6 ay\n2099 TL'
  ];
  for(const row of variants){
    const changed=parseCards(tariff().replace(phaseRow,row))[0];
    assert.deepEqual(changed.extras_json,original.extras_json,row);
    assert.equal(changed.product_hash,original.product_hash,row);
    assert.deepEqual(rebaseCommercialTerms({...legacyCard(),raw_text:changed.raw_text},original).extras_json,original.extras_json,row);
  }
  const decimal=parseCards(tariff().replace('İkinci 6 ay 2099 TL','İkinci 6 ay 2099.5 TL'))[0];
  const groupedDecimal=parseCards(tariff().replace('İkinci 6 ay 2099 TL','İkinci 6 ay 2.099,50 TL'))[0];
  assert.equal(decimal.product_hash,groupedDecimal.product_hash);
  assert.ok(decimal.extras_json.includes('İkinci 6 ay: 2099,5 TL'));
  assert.notEqual(decimal.product_hash,original.product_hash,'a real half-lira difference remains observable');
});

test('normalizing previously verbatim phase extras preserves unrelated conditions and produces no formatting-only scanner events',async()=>{
  await db.query('DELETE FROM changes');
  await db.query('DELETE FROM product_versions');
  await db.query('DELETE FROM products');
  const oldRow='12 ay Taahhütlü, İlk 6 ay 1899 TL, İkinci 6 ay 2099 TL';
  const originalText=tariff().replace('İlk 6 ay 1899 TL, İkinci 6 ay 2099 TL',oldRow);
  const currentText=tariff().replace('İlk 6 ay 1899 TL, İkinci 6 ay 2099 TL','12 ay Taahhütlü\nİlk 6 ay 1.899,00 TL\nİkinci 6 ay 2.099 TL');
  const original=legacyCard(), canonical=parseCards(currentText)[0];
  original.extras_json.push(oldRow,'Non-Stop internet');
  original.raw_text=parseCards(originalText)[0].raw_text;
  assert.deepEqual(rebaseCommercialTerms(original,canonical).extras_json,canonical.extras_json);
  assert.ok(canonical.extras_json.includes('12 ay Taahhütlü'));
  assert.equal(await scan([original],true),0);
  const historical=(await db.query('SELECT * FROM product_versions')).rows[0];
  assert.equal(await scan([canonical]),0);
  const combined=parseCards(originalText)[0];
  assert.equal(combined.product_hash,canonical.product_hash);
  assert.equal(await scan([combined]),0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM changes')).rows[0].n,0);
  assert.deepEqual((await db.query('SELECT * FROM product_versions WHERE id=$1',[historical.id])).rows[0],historical);
  const changed=parseCards(currentText.replace('2.099 TL','2.199 TL'))[0];
  assert.equal(await scan([changed]),1);
  const actual=(await db.query('SELECT * FROM changes')).rows[0];
  assert.ok(JSON.parse(actual.old_value).includes('12 ay Taahhütlü'));
  assert.ok(JSON.parse(actual.new_value).includes('12 ay Taahhütlü'));
  assert.ok(JSON.parse(actual.old_value).includes('İkinci 6 ay: 2099 TL'));
  assert.ok(JSON.parse(actual.new_value).includes('İkinci 6 ay: 2199 TL'));
  const untouched={...legacyCard(),extras_json:['Happy Avantajlar.'],raw_text:'Happy Avantajlar.'};
  assert.deepEqual(rebaseCommercialTerms(untouched,canonical).extras_json,['Happy Avantajlar.']);
});

test('raw evidence corrects a legacy phase-currency headline misread without a false price change and preserves actual headline changes',async()=>{
  const scenarios=[{
    text:tariff().replace('İlk 6 ay 1899 TL, İkinci 6 ay 2099 TL','İlk 6 ay ₺1.899, İkinci 6 ay ₺2.099'),
    headline:1899,oldPrice:1.899,headlineRow:'\n₺\n1899\n',
    hash:'fa10a418b330128067c36a6e4277cd028c532d330afaf98d34aaf9aed65ad7db',
    renderHeadline:price=>`\n₺\n${price}\n`
  },{
    text:tariff().replace('\n₺\n1899\n','\n2499 TL\n'),
    headline:2499,oldPrice:1899,headlineRow:'\n2499 TL\n',
    hash:'2da1e97a3e8952b1dab703be222033b8da3cea9cbf837a0846d753b5939a1793',
    renderHeadline:price=>`\n${price} TL\n`
  }];
  for(const scenario of scenarios){
    const old={...legacyCard(),price_try:scenario.oldPrice,raw_text:parseCards(scenario.text)[0].raw_text,product_hash:scenario.hash};
    assert.equal(rebaseCommercialTerms(old,parseCards(scenario.text)[0]).price_try,scenario.headline);
    assert.equal(rebaseCommercialTerms({...old,price_try:777},parseCards(scenario.text)[0]).price_try,777,'unproven stored values are not rewritten');
    for(const headline of [scenario.headline,scenario.headline+100]){
    await db.query('DELETE FROM changes');
    await db.query('DELETE FROM product_versions');
    await db.query('DELETE FROM products');
    assert.equal(await scan([old],true),0);
    const historical=(await db.query('SELECT * FROM product_versions')).rows[0];
    const current=parseCards(scenario.text.replace(scenario.headlineRow,scenario.renderHeadline(headline)))[0];
    assert.equal(current.price_try,headline);
    assert.equal(await scan([current]),headline===scenario.headline?0:1);
    const events=(await db.query('SELECT * FROM changes')).rows;
    if(headline===scenario.headline)assert.equal(events.length,0);
    else{
      assert.equal(events[0].field_name,'Fiyat');
      assert.equal(Number(events[0].old_value),scenario.headline);
      assert.equal(Number(events[0].new_value),headline);
    }
    assert.deepEqual((await db.query('SELECT * FROM product_versions WHERE id=$1',[historical.id])).rows[0],historical);
    assert.equal(await scan([current]),0,'the reconstructed comparison is idempotent');
    }
  }
});

test('scanner enriches a current version without fake events, then persists real staged-price and Non-Stop changes exactly once',async()=>{
  await db.query('DELETE FROM changes');
  await db.query('DELETE FROM product_versions');
  await db.query('DELETE FROM products');
  assert.equal(await scan([legacyCard()],true),0);
  const historical=(await db.query('SELECT * FROM product_versions ORDER BY id')).rows[0];
  const productBefore=(await db.query('SELECT id,first_seen_at,identity_base,current_name FROM products')).rows[0];
  assert.equal(await scan([card()]),0,'parser enrichment is not a market change');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM changes')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM product_versions')).rows[0].n,2);
  assert.deepEqual((await db.query('SELECT * FROM product_versions WHERE id=$1',[historical.id])).rows[0],historical);
  assert.deepEqual((await db.query('SELECT id,first_seen_at,identity_base,current_name FROM products')).rows[0],productBefore);
  assert.equal(await scan([card()]),0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM product_versions')).rows[0].n,2,'unchanged rescan is idempotent');

  assert.equal(await scan([card({secondPrice:2199})]),1);
  const priceChange=(await db.query('SELECT * FROM changes ORDER BY id')).rows[0];
  assert.equal(priceChange.field_name,'Ek Fayda / Koşul');
  assert.ok(JSON.parse(priceChange.old_value).includes('İkinci 6 ay: 2099 TL'));
  assert.ok(JSON.parse(priceChange.new_value).includes('İkinci 6 ay: 2199 TL'));
  assert.equal(await scan([card({secondPrice:2199})]),0);

  assert.equal(await scan([card({secondPrice:2199,nonStop:false})]),1);
  const nonStopChange=(await db.query('SELECT * FROM changes ORDER BY id DESC LIMIT 1')).rows[0];
  assert.equal(nonStopChange.field_name,'Ek Fayda / Koşul');
  assert.ok(JSON.parse(nonStopChange.old_value).includes('Non-Stop internet'));
  assert.ok(!JSON.parse(nonStopChange.new_value).includes('Non-Stop internet'));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM products')).rows[0].n,1);
});

test('first upgraded scan records a real price-phase change against pre-upgrade raw evidence, without attributing existing Non-Stop as new',async()=>{
  await db.query('DELETE FROM changes');
  await db.query('DELETE FROM product_versions');
  await db.query('DELETE FROM products');
  assert.equal(await scan([legacyCard()],true),0);
  assert.equal(await scan([card({secondPrice:2299})]),1);
  const change=(await db.query('SELECT * FROM changes')).rows[0];
  assert.equal(change.field_name,'Ek Fayda / Koşul');
  assert.ok(JSON.parse(change.old_value).includes('İkinci 6 ay: 2099 TL'));
  assert.ok(JSON.parse(change.new_value).includes('İkinci 6 ay: 2299 TL'));
  assert.ok(JSON.parse(change.old_value).includes('Non-Stop internet'));
  assert.ok(JSON.parse(change.new_value).includes('Non-Stop internet'));
});

test('first upgraded scan detects removed untracked terms even when the current hash equals the actual legacy hash',async()=>{
  for (const options of [{nonStop:true,phases:true},{nonStop:false,phases:true},{nonStop:true,phases:false}]) {
    await db.query('DELETE FROM changes');
    await db.query('DELETE FROM product_versions');
    await db.query('DELETE FROM products');
    const before=legacyCard(options), after=card({nonStop:false,phases:false});
    assert.equal(before.product_hash,after.product_hash,'real legacy hash collision reproduces the upgrade edge case');
    assert.equal(await scan([before],true),0);
    const historical=(await db.query('SELECT * FROM product_versions')).rows[0];
    assert.equal(await scan([after]),1);
    const change=(await db.query('SELECT * FROM changes')).rows[0];
    assert.equal(change.field_name,'Ek Fayda / Koşul');
    assert.equal(JSON.parse(change.old_value).includes('Non-Stop internet'),options.nonStop);
    assert.equal(JSON.parse(change.old_value).includes('İkinci 6 ay: 2099 TL'),options.phases);
    assert.deepEqual(JSON.parse(change.new_value),after.extras_json);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM product_versions')).rows[0].n,2);
    assert.deepEqual((await db.query('SELECT * FROM product_versions WHERE id=$1',[historical.id])).rows[0],historical);
    assert.equal(await scan([after]),0,'removal is not duplicated on a subsequent scan');
  }
});

test('missing legacy raw text cannot prove newly extracted terms, while known commercial terms and real base-price changes remain comparable',async()=>{
  const legacy={...legacyCard(),raw_text:null};
  assert.deepEqual(rebaseCommercialTerms(legacy,card()).extras_json,card().extras_json);
  const known={...card(),raw_text:null};
  assert.deepEqual(rebaseCommercialTerms(known,card({secondPrice:2399})).extras_json,card().extras_json);
  await db.query('DELETE FROM changes');
  await db.query('DELETE FROM product_versions');
  await db.query('DELETE FROM products');
  assert.equal(await scan([legacy],true),0);
  assert.equal(await scan([card({price:1999})]),1);
  const change=(await db.query('SELECT * FROM changes')).rows[0];
  assert.equal(change.field_name,'Fiyat');
  assert.equal(Number(change.old_value),1899);
  assert.equal(Number(change.new_value),1999);
});
