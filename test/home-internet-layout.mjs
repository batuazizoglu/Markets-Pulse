// Browser smoke check with synthetic data. Never connects to production.
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {HOME_INTERNET_SOURCES,marketPayload} from '../src/home-internet.js';
import {normalizeOffer} from '../src/isp-economics.js';
const s=HOME_INTERNET_SOURCES.find(x=>x.slug==='kibrisonline-home');
const rows=Array.from({length:5},(_,i)=>normalizeOffer({source_slug:s.slug,provider:s.provider,name:'Premium '+(i+1),technology:'WDSL',speed_down_mbps:10+i*5,duration_months:12,bonus_months:2,total_price_try:9995+i*1000,product_key:'demo'+i,source_url:s.url}));
const data=marketPayload([{source_slug:s.slug,status:'ok',captured_at:new Date().toISOString(),payload_json:rows,parsed_count:rows.length,source_meta_json:{parser_version:'home-isp-2'}}],[]);
const variants=[
 {change_type:'added',new_value:JSON.stringify({technology:'Fiber',effective_monthly_try:799,speed_down_mbps:100,duration_months:12})},
 {field_key:'effective_monthly_try',field_name:'Efektif Aylık Ücret',old_value:'649',new_value:'799'},
 {field_key:'speed_down_mbps',field_name:'Download Hızı',old_value:'50',new_value:'100'},
 {field_key:'data_limit_gb',field_name:'Kota',old_value:'500',new_value:'1000'},
 {field_key:'duration_months',field_name:'Taahhüt / Ödeme Süresi',old_value:'12',new_value:'24'},
 {field_key:'bonus_months',field_name:'Hediye Ay',old_value:'0',new_value:'2'},
 {field_key:'technology',field_name:'Teknoloji',old_value:'WDSL',new_value:'Fiber'},
 {change_type:'removed',old_value:JSON.stringify({technology:'WDSL',effective_monthly_try:399,speed_down_mbps:10})},
 {field_name:'Modem koşulu',old_value:'Ayrı ücretli',new_value:'Pakete dahil'}
];
data.changes=Array.from({length:48},(_,i)=>({id:i+1,source_slug:s.slug,source_name:s.name,source_url:s.url,provider:s.provider,product_key:'demo'+i,product_family:'fixed',product_name:i%3===0?'Fiber Ev 100 Mbps':'Premium '+(i+1),change_type:'field_changed',severity:'high',detected_at:new Date(Date.now()-i*3600000).toISOString(),...variants[i%variants.length]}));
data.campaigns=[{provider:'FixNet',name:'Yıllık paketlere özel hediye kampanyası',availability:'expired',expires_at:'2025-07-30',campaign_text:'Bu kampanya sona erdi. Paket fiyatlarına uygulanmaz.',verified_at:new Date().toISOString(),url:'https://www.fixnetbroadband.com/kampanyalar'}];
const app=express();app.use(express.static('public'));
app.get('/preview-home',(req,res)=>res.type('html').send('<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><main class="shell"></main><script>window.MarketPulseAccess={ready:Promise.resolve({role:"'+(req.query.role||'admin')+'"}),isAdmin:()=>'+(req.query.role!=='standard')+'};</script><script src="/home-internet.js"></script></html>'));
app.get('/api/home-internet',(req,res)=>res.json({...data,window_days:Number(req.query.days)||30}));
app.get('/api/home-internet/social-observations',(_,res)=>res.json({rows:[]}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
let browser;
try{
 const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
 browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mkdir('test-output',{recursive:true});
 for(const role of ['admin','standard'])for(const width of [1440,390]){
  await page.setViewport({width,height:960});await page.goto('http://127.0.0.1:'+server.address().port+'/preview-home?width='+width+'&role='+role+'#home');
  await page.waitForSelector('#hiProducts [data-pick]');
  await page.waitForSelector('#hiChanges [data-change-id]');
  assert.equal(await page.$$eval('#hiChanges [data-change-id]',els=>els.length),40);
  await page.locator('#hiTimelineMore').click();
  assert.equal(await page.$$eval('#hiChanges [data-change-id]',els=>els.length),48);
  await page.locator('[data-hi-days="90"]').click();
  await page.waitForFunction(()=>document.querySelector('#hiChangeStatus').textContent.includes('Son 90 gün'));
  assert.equal(await page.$eval('#hiTimelinePanel',el=>el.hidden),false);
  assert.equal(await page.$$eval('[data-hi-category]',els=>els.length),10);
  await page.locator('[data-hi-category="price"]').click();
  assert.equal(await page.$$eval('#hiChanges [data-change-category="price"]',els=>els.length),6);
  assert.equal(await page.$$eval('#hiChangeFeed [data-change-category="price"]',els=>els.length),6);
  await page.locator('[data-hi-category="all"]').click();
  const targets=await page.$$eval('.hi-category-chip',els=>els.map(el=>el.getBoundingClientRect().height));
  assert.ok(targets.every(h=>h>=38),'category tap targets');
  for(const view of ['tracking','compare','social']){
   await page.evaluate(view=>window.HomeInternetUI.setView(view),view);
   if(view==='compare'){
    await page.locator('[data-pick="demo0"]').click();await page.locator('[data-pick="demo1"]').click();
    assert.equal(await page.$$eval('.hi-comparison thead th',els=>els.length),3);
   }
   await page.waitForFunction(()=>!document.querySelector('#hiScanBtn').disabled);
   if(view==='tracking')await page.locator('#hiCampaigns summary').click();
   const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.hi-subnav button')].map(x=>({text:x.textContent,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height}))}));
   assert.ok(bounds.scroll<=width+1,view+' horizontal overflow at '+width+': '+bounds.scroll);
   assert.ok(bounds.buttons.every(x=>x.width>=60&&x.height>=32),'navigation tap targets');
   await page.screenshot({path:'test-output/home-'+role+'-'+view+'-'+width+'.png',fullPage:true});
   console.log('HOME_LAYOUT '+JSON.stringify({role,view,...bounds}));
   if(view==='tracking'){
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const colors=await page.evaluate(()=>({dot:getComputedStyle(document.querySelector('#hiChanges .hi-cat-price .tl-dot')).backgroundColor,badge:getComputedStyle(document.querySelector('#hiChangeFeed .hi-cat-price .hi-category-badge')).color}));
    assert.equal(colors.dot,colors.badge,'timeline and feed use the same category color');
    for(const theme of ['light','dark']){
     const border=await page.evaluate(theme=>{
      document.documentElement.dataset.theme=theme;document.body.classList.add('branded-app');
      const row=document.querySelector('#hiChangeFeed .hi-cat-price'),badge=row.querySelector('.hi-category-badge');
      const colors={stripe:getComputedStyle(row).borderInlineStartColor,badge:getComputedStyle(badge).borderColor};
      document.body.classList.remove('branded-app');return colors;
     },theme);
     assert.equal(border.stripe,border.badge,'category stripe survives full app theme in '+theme);
    }
    await page.screenshot({path:'test-output/home-'+role+'-categories-dark-'+width+'.png',fullPage:true});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
   }
   if(view==='tracking'&&role==='standard'){
    await page.locator('[data-hi-change-view="feed"]').click();
    assert.equal(await page.$eval('#hiTimelinePanel',el=>el.hidden),true);
    assert.equal(await page.$eval('#hiFeedPanel',el=>el.hidden),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'test-output/home-standard-feed-'+width+'.png',fullPage:true});
   }
  }
 }
 assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
