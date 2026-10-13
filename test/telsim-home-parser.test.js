import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as cheerio from 'cheerio';
import {PGlite} from '@electric-sql/pglite';
import {HOME_INTERNET_SOURCES,parserFor,scanHomeInternet} from '../src/home-internet.js';
import {SCHEMA_SQL} from '../src/schema.js';

const source=HOME_INTERNET_SOURCES.find(row=>row.slug==='telsim-home');
const fixture=readFileSync(new URL('./fixtures/telsim-home-cards.html',import.meta.url),'utf8');
const parse=html=>parserFor(source,html).products;
const ordered=rows=>[...rows].sort((a,b)=>a.product_key.localeCompare(b.product_key));
const cards=()=>{
  const $=cheerio.load(fixture);
  return $('article').toArray().map(el=>$.html(el));
};

test('Telsim minified React cards preserve 32 real offers and their own prices and terms',()=>{
  const rows=parse(fixture);
  assert.equal(rows.length,32);
  assert.equal(new Set(rows.map(row=>row.product_key)).size,32);
  const expected=[
    ['Tarifeye Ek',5,12,2,840],['Tarifeye Ek',10,12,2,945],['Tarifeye Ek',20,12,2,1065],['Tarifeye Ek',30,12,0,1365],
    ['Peşin',5,1,0,905],['Peşin',10,1,0,1145],['Peşin',20,1,0,1525],
    ['Peşin',5,3,0,2465],['Peşin',10,3,0,3215],['Peşin',20,3,0,4235],
    ['Peşin',5,6,1,4365],['Peşin',10,6,1,5745],['Peşin',20,6,1,7775],
    ['Peşin',5,12,2,7695],['Peşin',10,12,2,9995],['Peşin',20,12,2,12995],['Peşin',30,12,0,16995],
    ['ADSL',1,3,0,695],['ADSL',1,6,0,1215],['ADSL',1,12,0,2245],
    ['ADSL',2,3,0,1055],['ADSL',2,6,0,1935],['ADSL',2,12,0,3715],
    ['ADSL',4,3,0,1175],['ADSL',4,6,0,2575],['ADSL',4,12,0,4675],
    ['ADSL',8,3,0,2005],['ADSL',8,6,0,3745],['ADSL',8,12,0,6725],
    ['ADSL',10,3,0,2055],['ADSL',10,6,0,3885],['ADSL',10,12,0,7425]
  ];
  for(const [i,[variant,speed,duration,bonus,price]] of expected.entries()){
    const row=rows[i],type=variant==='ADSL'?'Peşin':variant;
    assert.equal(row.name,`${type} Evde ${speed}`);
    assert.equal(row.speed_down_mbps,speed);
    assert.equal(row.duration_months,duration);
    assert.equal(row.bonus_months,bonus);
    assert.equal(row.technology,variant==='ADSL'?'ADSL':'WDSL');
    assert.equal(row[variant==='Tarifeye Ek'?'price_monthly_try':'total_price_try'],price);
    assert.equal(row.install_fee_try,variant==='Tarifeye Ek'?0:null);
    assert.equal(row.product_key,`telsim-home|${type}|${speed}|${duration}|${bonus}${variant==='ADSL'?'|ADSL':''}`);
  }
  assert.equal(rows.find(row=>row.product_key==='telsim-home|Peşin|5|6|1').effective_monthly_try,623.57);
});

test('reordered, omitted and isolated Telsim cards retain identical identities and economics',()=>{
  const original=parse(fixture),parts=cards();
  assert.deepEqual(ordered(parse('<main>'+[...parts].reverse().join('')+'</main>')),ordered(original));
  // Evde 2's three-month ADSL card used to inherit the previous card's 12-month term.
  const omitted=20;
  assert.deepEqual(ordered(parse('<main>'+parts.filter((_,i)=>i!==omitted).join('')+'</main>')),
    ordered(original.filter((_,i)=>i!==omitted)));
  for(const [i,card] of parts.entries())assert.deepEqual(parse(card),[original[i]],`isolated card ${i}`);
  const navigation='<nav><h1>Tarifeye Ek</h1>12 Ay Sözünüze + 9 Ay Hediye ₺1 / ay Kurulum Ücretsiz ADSL</nav>';
  assert.deepEqual(parse(navigation+parts[4]+navigation),[original[4]]);
});

test('same-speed WDSL and ADSL variants survive independently when their counterpart disappears',()=>{
  const parts=cards(),wdsl=parse(parts[8])[0],adsl=parse(parts[29])[0];
  assert.equal(wdsl.speed_down_mbps,10);assert.equal(adsl.speed_down_mbps,10);
  assert.equal(wdsl.duration_months,3);assert.equal(adsl.duration_months,3);
  assert.notEqual(wdsl.product_key,adsl.product_key);
  assert.deepEqual(ordered(parse(parts[29]+parts[8])),ordered([wdsl,adsl]));
});

test('Telsim source revision replaces corrupt baseline silently, then records only genuine changes',async()=>{
  assert.equal(source.revision,2);
  assert.equal(HOME_INTERNET_SOURCES.find(row=>row.slug==='telsim-redbox').revision,undefined);
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  const result=products=>({ok:true,products,meta:{},http_status:200,response_ms:1});
  try{
    const correct=parse(fixture);
    // The former parser produced 18 rows, including joined names and inherited terms.
    const legacy=correct.slice(0,18).map((row,i)=>({...row,product_key:'legacy-corrupt-'+i,name:i===0?'Tarifeye Ek Evde 512':row.name}));
    await scanHomeInternet(db,{sources:[{...source,revision:1}],fetcher:async()=>result(legacy)});
    const baseline=await scanHomeInternet(db,{sources:[source],fetcher:async()=>result(correct)});
    assert.equal(baseline.sources[0].changes,0);
    assert.equal((await db.query('SELECT * FROM home_internet_changes')).rows.length,0);
    await scanHomeInternet(db,{sources:[source],fetcher:async()=>result(parse(cards().reverse().join('')))});
    assert.equal((await db.query('SELECT * FROM home_internet_changes')).rows.length,0);
    const $=cheerio.load(fixture);
    $('article').first().find('span').filter((_,el)=>$(el).text()==='840').text('850');
    await scanHomeInternet(db,{sources:[source],fetcher:async()=>result(parse($.html()))});
    const changed=(await db.query('SELECT * FROM home_internet_changes')).rows;
    assert.ok(changed.length>0);
    assert.ok(changed.every(row=>row.change_type==='field_changed'&&row.product_key==='telsim-home|Tarifeye Ek|5|12|2'));
    assert.ok(changed.some(row=>row.field_name==='Aylık Ücret'));
    $('article').eq(20).remove();
    await scanHomeInternet(db,{sources:[source],fetcher:async()=>result(parse($.html()))});
    const removals=(await db.query("SELECT * FROM home_internet_changes WHERE change_type='removed'")).rows;
    assert.equal(removals.length,1);
    assert.equal(removals[0].product_key,'telsim-home|Peşin|2|3|0|ADSL');
    assert.equal((await db.query("SELECT * FROM home_internet_changes WHERE change_type='added'")).rows.length,0);
  }finally{await db.close()}
});
