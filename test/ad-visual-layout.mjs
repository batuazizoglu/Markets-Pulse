// Isolated synthetic UI verification; no production APIs or messages.
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const app=express();app.use(express.static('public'));
const at=new Date().toISOString(),hash='a'.repeat(64);
const rows=['home','gsm','mnp'].map((category,i)=>({key:'demo'+i,ad_id:'123456'+i,brand:'Telsim',category,title:category==='mnp'?'Numara Taşıma Özel 25 + 25 GB':category==='home'?'Tarifeye Ek Ev İnterneti 20 Mbps':'Red Junior 25 GB',
  category_evidence:category==='home'?'Evde İnternet':category==='mnp'?'Numaranızı taşıyın':'Mobil tarife',ad_status:'active',observed_at:at,first_seen_at:at,stale:false,review_required:true,
  source_url:'https://www.facebook.com/kktctelsim',offer:{price_try:779,previous_price_try:995,speed_mbps:category==='home'?20:null,data_gb:category==='home'?null:25,billing_period:'unknown'},conditions:['Tarifeye ek ücret; kampanya koşulları ayrıca doğrulanmalı.'],uncertainties:['Küçük yazılar okunamadı.'],visual_summary:'Fiyat, hız ve teklif koşulları farklı bilgi alanlarında saklanır.',images:[{sha256:hash,captured_at:at}]}));
app.get('/preview-ads',(_,res)=>res.type('html').send('<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><main class="shell"></main><script src="/ad-visual.js"></script></html>'));
app.get('/api/ad-visuals',(_,res)=>res.json({rows,groups:{home:1,gsm:1,mnp:1},monitoring:{status:'partial',checked_at:at,imported_at:at,schedule:{enabled:true,description:'Her sabah'},coverage:[{brand:'Telsim',status:'partial',country:'CY',checked_at:at,source_url:'https://www.facebook.com/kktctelsim',note:'Test kaydı'}]}}));
app.get('/api/ad-visuals/history',(_,res)=>res.json({rows:[{observed_at:at,event_type:'first_seen',analysis_json:rows[0]}]}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{
  const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // One real JPEG for the synthetic evidence endpoint.
  const blank=await browser.newPage();await blank.setContent('<h1>Reklam görseli test kanıtı</h1><p>779 TL • 20 Mbps</p>');const jpeg=await blank.screenshot({type:'jpeg'});await blank.close();
  app.get('/api/ad-visuals/evidence/:hash.jpg',(_,res)=>res.type('jpeg').send(jpeg));
  await mkdir('test-output',{recursive:true});
  for(const width of [1440,390]){
    await page.setViewport({width,height:960});await page.goto('http://127.0.0.1:'+server.address().port+'/preview-ads#ads');await page.waitForSelector('.av-card');
    for(const category of ['home','gsm','mnp']){
      await page.locator('[data-av-category="'+category+'"]').click();
      await page.locator('.av-card details summary').click();await page.locator('[data-av-history]').click();await page.waitForSelector('.av-history b');
      const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(scroll<=width+1,category+' overflow '+width+': '+scroll);
      assert.equal(await page.$$eval('.av-card',els=>els.length),1);
      await page.screenshot({path:'test-output/ads-'+category+'-'+width+'.png',fullPage:true});console.log('AD_LAYOUT '+category+' '+width+' OK');
    }
  }
  assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
