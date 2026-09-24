// Synthetic, read-only fixtures: no production, scraping or report delivery.
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import {marketPulseFromRows} from '../src/intelligence.js';

const now=new Date('2026-09-24T12:00:00Z'),rows=[];
for(let i=0;i<66;i++){
  const base={id:i*2+1,scan_id:i+1,product_id:i+1,detected_at:new Date(+now-(i+1)*86400000).toISOString(),source_name:'Resmi Telsim',source_slug:'test',source_url:'https://example.com/packages',product_name:i===0?'En yeni kaldırılan paket':i===1?'Yeni fiyat artışı':'Paket '+i,identity_base:'paket '+i,severity:i<2?'low':'medium',extras_json:{}};
  // Same-score, same-time groups exercise the server/client priority tie-break.
  if(i===3)base.detected_at=new Date(+now-3*86400000).toISOString();
  rows.push({...base,change_type:i===0?'removed':i===1?'field_changed':'added',field_name:i===1?'Fiyat':null,old_value:i===0?base.product_name:i===1?'100':null,new_value:i===0?null:i===1?'120':base.product_name});
  if(i>=2)rows.push({...base,id:i*2+2,change_type:'field_changed',field_name:'Ek Fayda / Koşul',old_value:'Eski koşul',new_value:'Yeni koşul '+i});
}
const requests=[],app=express();
app.get('/preview-competitive',async(_,res)=>{
  const html=(await readFile('public/index.html','utf8')).replace(/<script src="[^"]+"><\/script>/g,'');
  res.type('html').send(html.replace('</body>','<script>localStorage.setItem("marketPulseThemeMode","light")</script><script src="/access-ui.js"></script><script src="/market-state.js"></script><script src="/app.js"></script><script src="/market-pulse.js"></script><script src="/brand-ui.js"></script></body>'));
});
app.use('/api',(req,res,next)=>{requests.push({method:req.method,path:req.path,days:req.query.days});assert.equal(req.method,'GET','preview must never mutate');next()});
app.get('/api/auth/me',(_,res)=>res.json({user:{id:1,first_name:'Test',last_name:'Yönetici',role:'admin',username:'test'}}));
app.get('/api/market-pulse',(req,res)=>res.json(marketPulseFromRows(rows,Number(req.query.days),now)));
app.get('/api/summary',(_,res)=>res.json({active_products:64,changes_today:0,changes_24h:0,sources:[]}));
app.get('/api/packages',(_,res)=>res.json([]));
app.get('/api/comparison',(_,res)=>res.json({rows:[]}));
app.get('/api/value-index',(_,res)=>res.json([]));
app.get('/api/benchmark',(_,res)=>res.json({segment_scores:[],overall_score:{}}));
app.use(express.static('public'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser;
async function click(page,selector){
  await page.$eval(selector,el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await page.locator(selector).click();
}
try{
  const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await mkdir('test-output',{recursive:true});
  for(const width of [1440,390]){
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width,height:960});await page.goto(`http://127.0.0.1:${server.address().port}/preview-competitive#dashboard`);
    await page.waitForSelector('.mp-move');await page.waitForSelector('[data-executive-move]');
    assert.equal(await page.$$eval('.mp-move',els=>els.length),6);
    await click(page,'.mp-window [data-market-days="90"]');
    await page.waitForFunction(()=>window.MarketPulseData.getState().snapshot?.window_days===90&&!window.MarketPulseData.getState().loading);
    assert.match(await page.$eval('#mpMoveCount',el=>el.textContent),/66/);
    assert.match(await page.$eval('#mpSnapshotStatus',el=>el.textContent),/90 gün/);
    await page.select('#mpMoveOrder','recent');
    assert.match(await page.$eval('.mp-move',el=>el.textContent),/En yeni kaldırılan paket/);
    assert.match(await page.$eval('.mp-move:nth-child(2)',el=>el.textContent),/100.*120/s);
    await page.screenshot({path:`test-output/competitive-dashboard-${width}.png`,fullPage:true});
    await page.select('#mpMoveOrder','priority');
    const leader=await page.$eval('.mp-move',el=>el.dataset.moveKey);
    assert.equal(await page.$eval('[data-executive-move]',el=>el.dataset.executiveMove),leader);
    for(let count=6;count<66;count+=6)await click(page,'[data-market-more="moves"]');
    assert.equal(await page.$$eval('.mp-move',els=>els.length),66);
    assert.ok(await page.$$eval('.mp-move',els=>els.some(el=>el.textContent.includes('En yeni kaldırılan paket'))));
    await click(page,'[data-route="competitor"]');await page.waitForFunction(()=>document.body.dataset.view==='competitor');
    assert.equal(await page.$eval('#timelineTabs [aria-pressed="true"]',el=>el.dataset.marketDays),'90');
    assert.match(await page.$eval('#timelineCount',el=>el.textContent),/130/);
    assert.equal(await page.$$eval('.tl',els=>els.length),40);
    for(let count=40;count<130;count+=40){await click(page,'[data-market-more="timeline"]');await click(page,'[data-market-more="changes"]')}
    const timelineIds=await page.$$eval('.tl',els=>els.map(el=>el.dataset.changeId)),feedIds=await page.$$eval('.change',els=>els.map(el=>el.dataset.changeId));
    assert.equal(timelineIds.length,130);assert.deepEqual(feedIds,timelineIds);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Timeline overflow at '+width);
    // Refresh while Rakip Takip is active: selected period and expanded rows persist.
    const before=requests.filter(r=>r.path==='/market-pulse').length;
    await click(page,'.actions [onclick="loadAll()"]');
    await page.waitForFunction(()=>document.querySelector('#liveText')?.textContent==='Canlı • 60 sn');
    assert.ok(requests.filter(r=>r.path==='/market-pulse').length>before);
    assert.equal(requests.filter(r=>r.path==='/market-pulse').at(-1).days,'90');
    assert.equal(await page.$$eval('.tl',els=>els.length),130);
    await click(page,'[data-route="trends"]');
    assert.equal(await page.$eval('#timelineTabs [aria-pressed="true"]',el=>el.dataset.marketDays),'90');
    await click(page,'[data-route="dashboard"]');
    assert.equal(await page.$$eval('.mp-move',els=>els.length),66);
    assert.equal(await page.$eval('#mpMoveOrder',el=>el.value),'priority');
    assert.equal(await page.$eval('[data-executive-move]',el=>el.dataset.executiveMove),leader);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard overflow at '+width);
    assert.deepEqual(errors,[]);await page.close();console.log('COMPETITIVE_DATA_LAYOUT '+width+' OK');
  }
  assert.ok(requests.every(r=>r.path!=='/timeline'&&r.path!=='/changes'),'all views share one complete snapshot');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
