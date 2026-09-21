// Isolated synthetic UI verification; no production APIs or messages.
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const app=express();app.use(express.static('public'));
const at=new Date().toISOString(),hash='a'.repeat(64);
const categories={home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'Diğer / Belirsiz','auto-cihazlar':'Cihazlar','auto-kurumsal':'Kurumsal Çözümler ve Dijital Dönüşüm Hizmetleri','auto-etkinlikler':'Etkinlikler'};
const rows=Object.keys(categories).map((category,i)=>({key:'164143610515:123456'+i+':1',ad_id:'123456'+i,brand:'Telsim',category,category_label:categories[category],title:category==='review'?'Teklif konusu net okunamayan reklam':category==='auto-cihazlar'?'Tablet ve cihaz tanıtımı':category==='mnp'?'Numara Taşıma Özel 25 + 25 GB':category==='home'?'Tarifeye Ek Ev İnterneti 20 Mbps':category.startsWith('auto-')?categories[category]:'Red Junior 25 GB',
  category_evidence:category==='home'?'Evde İnternet':category==='mnp'?'Numaranızı taşıyın':'Mobil tarife',ad_status:'active',observed_at:at,first_seen_at:at,stale:false,review_required:true,
  ai_queue_status:'analyzed',ai_analysis:{status:'completed',analyzed_at:at,pass:category==='review'?2:1},
  source_url:'https://www.facebook.com/kktctelsim',offer:{price_try:779,previous_price_try:995,speed_mbps:category==='home'?20:null,data_gb:category==='home'?null:25,billing_period:'unknown'},conditions:['Tarifeye ek ücret; kampanya koşulları ayrıca doğrulanmalı.'],uncertainties:['Küçük yazılar okunamadı.'],visual_summary:'Fiyat, hız ve teklif koşulları farklı bilgi alanlarında saklanır.',images:[{sha256:hash,captured_at:at}]}));
app.get('/preview-ads',(_,res)=>res.type('html').send('<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><main class="shell"></main><script src="/ad-visual.js"></script></html>'));
app.get('/preview-home-ads',(_,res)=>res.type('html').send('<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><main class="shell"><div id="hiAdVisualMount"></div></main><script src="/ad-visual.js"></script><script>AdVisualUI.mountHome()</script></html>'));
const source_directory=[['Telsim','164143610515'],['Nethouse','159064954156749'],['Kıbrıs Online','107418628779416']].map(([brand,page_id])=>({brand,page_id,country:'CY',ad_library_type:'page',ad_library_url:'https://www.facebook.com/ads/library/?country=CY&view_all_page_id='+page_id}));
const sendVisuals=(_,res)=>res.json({rows,categories,source_directory,groups:Object.fromEntries(Object.keys(categories).map(key=>[key,1])),cloud:{vision_configured:true,worker_online:true,worker_heartbeat:at,message:'Görseller sunucuda analiz edilir.',candidates:{analyzed:12},sources:[{brand:'Telsim',status:'partial',captured:12,note:'Test kaydı'},...['Nethouse','Kıbrıs Online'].map(brand=>({brand,status:'blocked',captured:0,finished_at:at,note:'Ad Library erişimi HTTP 403 ile sonuçlandı. Reklam yok olarak yorumlanmadı.'}))]},monitoring:{status:'partial',checked_at:at,imported_at:at,schedule:{enabled:true,description:'Bulutta her gün 06:00'},coverage:[{brand:'Telsim',status:'partial',country:'CY',checked_at:at,source_url:'https://www.facebook.com/kktctelsim',note:'Test kaydı'},{brand:'Nethouse',status:'no_ads',country:'CY',checked_at:at,source_url:source_directory[1].ad_library_url,note:'Eski taramada reklam yok.'}]}});
app.get('/api/ad-visuals',sendVisuals);
app.post('/api/ad-visuals/sync',sendVisuals);
app.post('/api/ad-visuals/scan',(_,res)=>res.status(202).json({queued:7,message:'Tarama sunucu kuyruğuna alındı; sayfayı kapatabilirsiniz.'}));
app.post('/api/ad-visuals/analyze',(_,res)=>res.status(202).json({queued:1,message:'1 kayıt AI inceleme kuyruğuna alındı.'}));
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
    await page.locator('[data-av-refresh]').click();await page.waitForFunction(()=>!document.querySelector('[data-av-refresh]').disabled);
    await page.locator('[data-av-scan]').click();await page.waitForFunction(()=>document.querySelector('.av-job-message').textContent.includes('kuyruğuna'));
    await page.locator('.av-cloud summary').click();
    for(const category of Object.keys(categories)){
      await page.locator('[data-av-category="'+category+'"]').click();
      await page.locator('.av-card details summary').click();await page.locator('[data-av-history]').click();await page.waitForSelector('.av-history b');
      const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(scroll<=width+1,category+' overflow '+width+': '+scroll);
      assert.equal(await page.$$eval('.av-card',els=>els.length),1);
      assert.ok((await page.$eval('.av-brand',el=>el.textContent)).includes(categories[category]));
      assert.ok((await page.$eval('.av-flags',el=>el.textContent)).includes('AI incelemesi tamamlandı'));
      if(category==='review'){
        await page.locator('.av-card [data-av-analyze]').click();await page.waitForFunction(()=>document.querySelector('.av-job-message').textContent.includes('AI inceleme kuyruğuna'));
        assert.ok(await page.$eval('.av-card details',el=>el.open));
      }
      await page.screenshot({path:'test-output/ads-'+category+'-'+width+'.png',fullPage:true});console.log('AD_LAYOUT '+category+' '+width+' OK');
    }
    await page.select('#ad-visual-section [data-av-brand]','Nethouse');
    assert.equal(await page.$$eval('#ad-visual-section .av-card',els=>els.length),0);
    assert.match(await page.$eval('#ad-visual-section .av-source-focus',el=>el.textContent),/HTTP 403/);
    assert.doesNotMatch(await page.$eval('#ad-visual-section .av-source-focus',el=>el.textContent),/Eski taramada reklam yok/);
    await page.locator('#ad-visual-section .av-coverage>summary').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'ISP status overflow '+width);
    await page.screenshot({path:'test-output/ads-isp-status-'+width+'.png',fullPage:true});console.log('AD_LAYOUT ISP status '+width+' OK');
    await page.goto('http://127.0.0.1:'+server.address().port+'/preview-home-ads#home');await page.waitForSelector('#hiAdVisualMount .av-card');
    await page.select('#hiAdVisualMount [data-av-brand]','Kıbrıs Online');
    assert.equal(await page.$$eval('#hiAdVisualMount .av-card',els=>els.length),0);
    assert.match(await page.$eval('#hiAdVisualMount .av-source-focus',el=>el.textContent),/HTTP 403/);
    assert.match(await page.$eval('#hiAdVisualMount .av-source-focus a',el=>el.href),/107418628779416/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'home ISP status overflow '+width);
    await page.screenshot({path:'test-output/ads-home-isp-status-'+width+'.png',fullPage:true});
    await page.select('#hiAdVisualMount [data-av-brand]','all');assert.equal(await page.$$eval('#hiAdVisualMount .av-card',els=>els.length),1);
    console.log('AD_LAYOUT home ISP filter '+width+' OK');
  }
  assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
