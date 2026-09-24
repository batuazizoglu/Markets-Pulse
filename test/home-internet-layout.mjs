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
data.campaigns=[{provider:'FixNet',name:'Yıllık paketlere özel hediye kampanyası',availability:'expired',expires_at:'2025-07-30',campaign_text:'Bu kampanya sona erdi. Paket fiyatlarına uygulanmaz.',verified_at:new Date().toISOString(),url:'https://www.fixnetbroadband.com/kampanyalar'}];
const app=express();app.use(express.static('public'));
app.get('/preview-home',(_,res)=>res.type('html').send('<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><main class="shell"></main><script>window.MarketPulseAccess={ready:Promise.resolve({role:"admin"}),isAdmin:()=>true};</script><script src="/home-internet.js"></script></html>'));
app.get('/api/home-internet',(_,res)=>res.json(data));
app.get('/api/home-internet/social-observations',(_,res)=>res.json({rows:[]}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
let browser;
try{
 const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
 browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mkdir('test-output',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewport({width,height:960});await page.goto('http://127.0.0.1:'+server.address().port+'/preview-home?width='+width+'#home');
  await page.waitForSelector('#hiCompanies tr');
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
   await page.screenshot({path:'test-output/home-'+view+'-'+width+'.png',fullPage:true});
   console.log('HOME_LAYOUT '+JSON.stringify({view,...bounds}));
  }
 }
 assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
