import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {HOME_INTERNET_SOURCES,parserFor,scanHomeInternet,marketPayload} from '../src/home-internet.js';
import {parseFixnetCampaigns} from '../src/isp-parsers.js';
import {SCHEMA_SQL} from '../src/schema.js';

const source=slug=>HOME_INTERNET_SOURCES.find(s=>s.slug===slug);
const table=(heading,headers,cells)=>'<table><tr><th>Hız</th>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr><tr><th>'+heading+'</th>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr></table>';
const campaign=(name,date,body='Koşullar')=>'<div class="group"><span>'+date+'</span><h3>'+name+'</h3><p>'+body+'</p></div>';
test('all requested catalogs are configured with explicit current or legacy addresses',()=>{
  const paths={
    'extend-wdsl':'/urunler-wdsl.php','extend-vdsl':'/urunler-vdsl.php','extend-fiber':'/urunler-fibernet.php','extend-gamepack':'/urunler-gamepack.php',
    'broadmax-fiber':'/fiberoptik-internet-fiyat','broadmax-apartment':'/apartman-fiyat2/',
    'fixnet-flex-super-internet':'/tarifeler/flex-super-internet','fixnet-oyuncu-paketleri':'/tarifeler/oyuncu-paketleri','fixnet-campaigns':'/kampanyalar',
    'multimax-apartment':'/ev-apartman.php','multimax-ozgur':'/ozgur-paketler.php','multimax-business':'/kurumsal-paketler.php',
    'towernet-home':'/paketler/','surface-home':'/packages','xrealnet-home':'/internet-paketlerimiz/',
    'comtech-home':'/comtech_fibernet.html','comtech-wireless':'/comtech_wireless.html'
  };
  for(const [slug,path] of Object.entries(paths)){
    const s=source(slug);assert.ok(s,slug);assert.ok([s.url,...(s.aliases||[])].some(u=>new URL(u).pathname===path),slug);
  }
  assert.equal(new URL(source('xrealnet-home').url).hostname,'xrealinternet.com');
  assert.match(source('multimax-ozgur').coverage_note,/eşdeğeri doğrulanamadı/);
  assert.notEqual(source('multimax-ozgur').url,source('multimax-plus').url);
});
test('Extend reads table headers, row headings, upload speeds and current installation terms',()=>{
  const game=parserFor(source('extend-gamepack'),table('25Mb download / 5Mb upload',['3 Ay','6 Ay','12 Ay'],['4975 TL','9450 TL','17450 TL'])+'<p>6 AY VE YILLIKLARDA KURULUM ÜCRETİ YOK</p>').products;
  assert.deepEqual(game.map(p=>p.duration_months),[3,6,12]);
  assert.ok(game.every(p=>p.speed_up_mbps===5&&p.bonus_months===0));
  assert.deepEqual(game.map(p=>p.install_fee_try),[null,0,0]);
  const [vdsl]=parserFor(source('extend-vdsl'),table('VDSL 16 Mb / 4 Mb',['1 Ay'],['1120 TL'])).products;
  assert.equal(vdsl.technology,'VDSL');assert.equal(vdsl.speed_up_mbps,4);
  const wdsl=parserFor(source('extend-wdsl'),table('10 Mbit',['1 Ay','3 Ay','6 +2 Ay','12 +4 Ay'],['990 TL','','5360 TL','9900 TL'])+'<p>1 ve 3 aylık aboneliklerde 990 TL kurulum ücreti alınır.</p>').products;
  assert.deepEqual(wdsl.map(p=>p.duration_months),[1,6,12]);
  assert.deepEqual(wdsl.map(p=>p.bonus_months),[0,2,4]);assert.equal(wdsl[0].install_fee_try,990);
  assert.equal(wdsl[1].install_fee_try,null);
});
test('Comtech prices are period totals and Fiber capabilities do not invent priced packages',()=>{
  const rows=parserFor(source('comtech-wireless'),table('4 MB',['3 AY','6 AY','12 AY'],['2500 TL','3600 TL','4800 TL'])+'<p>Yıllık abonelikte kurulum bedeli alınmaz. Yıllık dışındaki aboneliklerde KDV dahil 500 TL kurulum bedeli tahsil edilir.</p>').products;
  assert.deepEqual(rows.map(p=>p.effective_monthly_try),[833.33,600,400]);
  assert.deepEqual(rows.map(p=>p.install_fee_try),[500,500,0]);
  const [fiber]=parserFor(source('comtech-home'),'<h1>Comtech Fiber İnternet</h1><p>100Mbps ve 1Gbps hızlar fiber ile mümkün.</p>').products;
  assert.equal(fiber.total_price_try,null);assert.equal(fiber.speed_down_mbps,null);assert.equal(fiber.price_status,'not_published');
});
test('Xreal packages preserve download/upload pairs and never borrow a neighbouring price',()=>{
  const html='<article><h3>10 Mbps Kablosuz</h3><p>₺ 1000/Aylık</p><li>3 Mbps’e Kadar Upload</li></article><article><h3>15 Mbps Kablosuz</h3><p>₺ 1200/Aylık</p><li>4 Mbps’e Kadar Upload</li></article><article><h3>20 Mbps Kablosuz</h3></article>';
  const rows=parserFor(source('xrealnet-home'),html).products;
  assert.deepEqual(rows.map(p=>[p.speed_down_mbps,p.speed_up_mbps,p.total_price_try]),[[10,3,1000],[15,4,1200]]);
});
test('campaigns have explicit validity and cannot masquerade as priced offers or a healthy error page',()=>{
  const s=source('fixnet-campaigns');
  const r=parseFixnetCampaigns('<h1>Kampanyalar</h1>'+campaign('Eski +6 ay','Süresi Doldu - 30.07.2025')+campaign('Yeni','31.12.2026')+campaign('Teyitsiz',''),s,new Date('2026-09-18T12:00:00Z'));
  assert.equal(r.campaigns_verified,true);assert.deepEqual(r.campaigns.map(c=>c.availability),['expired','active','unconfirmed']);
  assert.equal(parseFixnetCampaigns('<h1>Kampanyalar</h1><p>Bir hata oluştu</p>',s).campaigns_verified,false);
  assert.equal(parseFixnetCampaigns('<h1>Kampanyalar</h1><p>Henüz kampanya bulunmamaktadır.</p>',s).campaigns_verified,true);
  assert.equal(parserFor(s,'<h1>Kampanyalar</h1>'+campaign('Eski','Süresi Doldu - 30.07.2025')).products.length,0);
});
test('Multimax corporate services are quote-only and Fiber requires a published service option',()=>{
  const html='<h2>DEDİKE BAĞLANTI</h2><p>Paketlere adil kullanım kotası uygulanmaz.</p><select name="s_kurumsal_basvur_hizmet"><option>Dedike Bağlantı</option><option>Fiber</option></select>';
  const rows=parserFor(source('multimax-business'),html).products;
  assert.deepEqual(rows.map(p=>p.technology),['Dedike','Fiber']);
  assert.ok(rows.every(p=>p.market_segment==='business'&&p.price_status==='quote'&&p.effective_monthly_try===null&&p.speed_down_mbps===null));
});
test('campaign snapshots survive failures, track changed conditions and stay out of offer metrics',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const s=source('fixnet-campaigns'),make=body=>({ok:true,status:'ok',http_status:200,response_ms:1,...parserFor(s,'<h1>Kampanyalar</h1>'+campaign('Hediye','Süresi Doldu - 30.07.2025',body))});
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>make('Eski koşul')});
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>({ok:false,status:'error',http_status:503,response_ms:1,products:[],meta:{}})});
    const scans=(await db.query('SELECT * FROM home_internet_scans ORDER BY id DESC')).rows;
    const m=marketPayload([scans[0]],[],[scans[1]]);
    assert.equal(m.campaigns.length,1);assert.equal(m.campaigns[0].stale,true);assert.equal(m.products.length,0);assert.equal(m.metrics.priced_products,0);
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>make('Yeni koşul')});
    const changes=(await db.query('SELECT * FROM home_internet_changes')).rows;
    assert.equal(changes.length,1);assert.equal(changes[0].field_name,'Kampanya koşulları');
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>({ok:true,http_status:200,response_ms:1,products:[],meta:{campaigns_verified:true,campaigns:[]}})});
    assert.equal((await db.query("SELECT * FROM home_internet_scans ORDER BY id DESC LIMIT 1")).rows[0].status,'ok');
  }finally{await db.close()}
});
test('source revisions reset only corrected catalogs without false market changes',async()=>{
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  try{
    const s=source('extend-wdsl'),products=parserFor(s,table('10 Mb',['1 Ay'],['990 TL'])).products;
    const fetcher=async()=>({ok:true,products,meta:{},http_status:200,response_ms:1});
    await scanHomeInternet(db,{sources:[{...s,revision:1}],fetcher});
    const old=(await db.query('SELECT * FROM home_internet_scans')).rows;
    assert.equal(marketPayload(old,[],old).products.length,0);
    await scanHomeInternet(db,{sources:[s],fetcher:async()=>({...await fetcher(),products:products.map(p=>({...p,install_fee_try:990}))})});
    assert.equal((await db.query('SELECT * FROM home_internet_changes')).rows.length,0);
    const rows=(await db.query('SELECT * FROM home_internet_scans ORDER BY id DESC')).rows;
    assert.equal(marketPayload([rows[0]],[]).products.length,1);
  }finally{await db.close()}
});
