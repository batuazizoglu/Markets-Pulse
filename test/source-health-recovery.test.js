import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {HOME_INTERNET_SOURCES,loadHomeInternetChanges,parserFor,scanHomeInternet,marketPayload} from '../src/home-internet.js';
import {providerCoverageReasons} from '../src/ad-provider-worker.js';
import {SCHEMA_SQL} from '../src/schema.js';
const source=slug=>HOME_INTERNET_SOURCES.find(s=>s.slug===slug);

test('current Superbox hub preserves three different offers and exact commitments',async()=>{
  const html=await readFile(new URL('./fixtures/kktcell-superbox-hub.html',import.meta.url),'utf8');
  const rows=parserFor(source('kktcell-superbox'),html).products;
  assert.equal(rows.length,3);assert.equal(new Set(rows.map(p=>p.product_key)).size,3);
  assert.equal(parserFor(source('kktcell-superbox'),html+html).products.length,3);
  assert.deepEqual(rows.map(p=>[p.name,p.speed_down_mbps,p.duration_months,p.price_monthly_try]),[
    ['Superbox Sınırsız (6+6 Ay)',null,12,1699],['Superbox Evde 10Mbps',10,12,799],['Superbox Evde 20Mbps',20,6,899]]);
  assert.ok(rows.every(p=>p.product_family==='fwa'&&p.brand==='Superbox'&&p.bonus_months===0));
  assert.equal(rows[0].unlimited,true);assert.equal(rows[1].unlimited,null);
  assert.equal(parserFor(source('kktcell-home'),html).products.length,0);
});

test('Superbox fallback ignores accessibility and navigation wrappers around real package links',()=>{
  const packageLink=(id,name,benefit,duration,price)=>`<a href="https://online.lifecelldigital.com/ev-interneti-basvurusu?priceId=${id}">${name} ${benefit} ${duration} Ay Taahhüt ${price} TL/AY İncele</a>`;
  const valid=[
    packageLink(397,'Superbox Sınırsız (6+6 Ay)','4.5G Hızında',12,1699),
    packageLink(302,'Superbox Evde 10Mbps','10 Mbps',12,799),
    packageLink(385,'Superbox Evde 20Mbps','20 Mbps',6,899)
  ];
  const chrome='Görme engelliler için erişilebilirliği etkinleştirin Enter Erişilebilirlik menüsünü aç Enter Web sitesinin sayfa yapısını açın Enter Evim İçin İşim İçin Türkçe English Ev İnterneti';
  const wrapped=`<a href="/internet-paketleri">${chrome} ${valid.join(' ')}</a><a href="/superbox">${chrome} Superbox Evde 50Mbps 50 Mbps 12 Ay Taahhüt 1099 TL/AY</a>`;
  const rows=parserFor(source('kktcell-superbox'),wrapped+valid.join('')).products;
  assert.deepEqual(rows.map(p=>[p.name,p.speed_down_mbps,p.duration_months,p.price_monthly_try,p.product_key]),[
    ['Superbox Sınırsız (6+6 Ay)',null,12,1699,'kktcell-superbox|397|12'],
    ['Superbox Evde 10Mbps',10,12,799,'kktcell-superbox|302|12'],
    ['Superbox Evde 20Mbps',20,6,899,'kktcell-superbox|385|6']
  ]);
  assert.ok(rows.every(p=>!SUPERBOX_PAGE_CHROME_FOR_TEST.test(p.raw_text)));
});

const SUPERBOX_PAGE_CHROME_FOR_TEST=/görme engelliler|erişilebilirlik menüsü|web sitesinin sayfa yapısı/i;

test('Superbox page chrome is excluded from current products and change history',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const s=source('kktcell-superbox'),valid={product_key:'kktcell-superbox|302|12',source_slug:s.slug,name:'Superbox Evde 10Mbps',brand:'Superbox',product_family:'fwa'};
    const bogus={product_key:'kktcell-superbox|noise',source_slug:s.slug,name:'Görme engelliler için erişilebilirliği etkinleştirin Enter Ev İnterneti',brand:'Superbox',product_family:'fwa'};
    const scan=(await db.query(`INSERT INTO home_internet_scans(source_slug,provider,source_name,source_url,status,parsed_count,payload_json,source_meta_json)
      VALUES($1,$2,$3,$4,'ok',2,$5::jsonb,$6::jsonb) RETURNING id,captured_at`,[s.slug,s.provider,s.name,s.url,JSON.stringify([valid,bogus]),JSON.stringify({parser_version:'home-isp-2',source_revision:s.revision})])).rows[0];
    await db.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,change_type,new_value,scan_id)
      VALUES($1,$2,$3,$4,'added',$5,$6),($1,$2,$7,$8,'added',$9,$6)`,[s.slug,s.provider,valid.product_key,valid.name,JSON.stringify(valid),scan.id,bogus.product_key,bogus.name,JSON.stringify(bogus)]);
    const market=marketPayload([{...scan,...s,source_slug:s.slug,status:'ok',parsed_count:2,payload_json:[valid,bogus],source_meta_json:{parser_version:'home-isp-2',source_revision:s.revision}}],[],[]);
    assert.deepEqual(market.products.map(p=>p.name),[valid.name]);
    const changes=await loadHomeInternetChanges(db,{start:new Date(+new Date(scan.captured_at)-1000),end:new Date(+new Date(scan.captured_at)+1000)});
    assert.deepEqual(changes.map(change=>change.product_name),[valid.name]);
  }finally{await db.close()}
});

test('shared catalogs are collected once and archived sources cannot create false removals',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const canonical=source('lifecell-digital-home'),alias=source('kktcell-home'),retired=source('multimax-ozgur');
    const p={product_key:'life-20',source_slug:canonical.slug,provider:canonical.provider,name:'Life 20',speed_down_mbps:20,effective_monthly_try:900};
    const called=[];
    await scanHomeInternet(db,{sources:[canonical,alias,retired],fetcher:async s=>{called.push(s.slug);return {ok:true,status:'ok',products:[p],http_status:200,response_ms:1}}});
    assert.deepEqual(called,[canonical.slug]);
    const scans=(await db.query('SELECT * FROM home_internet_scans')).rows;
    const data=marketPayload(scans,[],scans);
    assert.equal(data.products.length,1);
    assert.deepEqual(data.products[0].company_ids,['lifecell','kktcell']);
    const shared=data.sources.find(s=>s.slug===alias.slug);
    assert.equal(shared.status,'shared');assert.equal(shared.parsed_count,0);assert.equal(shared.shared_count,1);
    assert.equal(data.sources.find(s=>s.slug===retired.slug).status,'archived');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM home_internet_changes')).rows[0].n,0);
    const failed=marketPayload([{...scans[0],status:'error',error:'HTTP 503'}],[],scans);
    assert.equal(failed.sources.find(s=>s.slug===alias.slug).status,'error');
    assert.equal(failed.products.length,1);assert.equal(failed.products[0].stale,true);
    assert.equal(failed.sources.find(s=>s.slug===alias.slug).shared_count,0);
  }finally{await db.close()}
});

test('registry aliases have real independent canonical catalogs and retain legal-company attribution',()=>{
  for(const s of HOME_INTERNET_SOURCES.filter(s=>s.catalog_source)){
    const target=source(s.catalog_source);assert.ok(target);assert.ok(!target.retired&&!target.catalog_source);assert.notEqual(s.slug,target.slug);
  }
  assert.equal(source('vodafone-evde-home').catalog_source,'telsim-home');
  assert.equal(source('flytom-home').url,'https://flynet.net/');
  assert.ok(source('flytom-home').aliases.includes('https://www.flytom.net/'));
});

test('Flynet package families never turn a range or a picture into a priced single-speed offer',()=>{
  const html=['FLY','PRO','ULTRA'].map(n=>`<article><h4>${n} Paket</h4><ul><li>5 Mbps - 20 Mbps Hız Seçenekleri</li><li>Kotasız ve Taahhütsüz Kullanım</li></ul></article>`).join('')+'<h4>Fiyat Listesi</h4><img src="prices.jpg">';
  const rows=parserFor(source('flytom-home'),html).products;
  assert.equal(rows.length,3);assert.ok(rows.every(p=>p.price_status==='not_published'&&p.effective_monthly_try===null&&p.speed_down_mbps===null&&p.duration_months===null));
  assert.equal(parserFor(source('flytom-home'),'<h1>404</h1>').products.length,0);
});

test('provider diagnostics keep complete media separate from unconfirmed source coverage',()=>{
  const run={state:'partial',expected_ads:null,source_exhausted:true,coverage_complete:false};
  const tally={ads:11,pending:0,missing:0,errors:0};
  assert.deepEqual(providerCoverageReasons(run,tally),['expected_count_missing']);
  assert.deepEqual(providerCoverageReasons({...run,expected_ads:11},tally),['supplier_confirmation_missing']);
  assert.deepEqual(providerCoverageReasons({...run,expected_ads:12},tally),['count_mismatch']);
  assert.deepEqual(providerCoverageReasons({...run,state:'complete'},tally),[]);
  assert.deepEqual(providerCoverageReasons({...run,expected_ads:11,coverage_denied:true},tally),['supplier_incomplete']);
});
