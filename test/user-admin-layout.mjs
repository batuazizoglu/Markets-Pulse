// All accounts, mutations and endpoints below are synthetic. No mail transport or production access.
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
const at='2026-09-24T07:00:00.000Z';
const original=[
  {id:1,first_name:'Batu',last_name:'Test',email:'admin@example.com',username:'admin.test',role:'admin',active:true,active_sessions:2},
  {id:2,first_name:'İpek',last_name:'Uzun Soyisimli Yönetici',email:'uzun.kullanici.adresi.ornek@example.com',username:'ipek.yonetici',role:'standard',active:true,active_sessions:3,must_change_password:true},
  {id:3,first_name:'Deniz',last_name:'Örnek',email:'deniz@example.com',username:'deniz.ornek',role:'standard',active:false,active_sessions:0},
  {id:4,first_name:'Silinmiş',last_name:'Hesap',email:'silinen@example.com',username:'silinen.hesap',role:'standard',active:false,active_sessions:0,deleted_at:at},
  {id:5,first_name:'<script>Test</script>',last_name:'Güvenli Görünüm',email:'test@example.com',username:'guvenli.test',role:'admin',active:true,active_sessions:1},
].map(u=>({...u,created_at:at,invite_sent_at:at,last_login_at:at}));
let users=structuredClone(original);const mutations=[];
const app=express();app.use(express.json());app.use(express.static('public'));
app.get('/preview-users',(_,res)=>res.type('html').send(`<!doctype html><html lang="tr" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/brand.css"><body><main class="shell"><header class="topbar"><div class="topbar-inner"><div class="brand"></div><div class="actions"></div></div></header></main><script>localStorage.setItem('marketPulseThemeMode','light')</script><script src="/user-admin.js"></script><script src="/brand-ui.js"></script></body></html>`));
app.get('/api/auth/me',(_,res)=>res.json({user:users[0]}));
app.get('/api/benchmark',(_,res)=>res.json({segment_scores:[],overall_score:{}}));
app.get('/api/market-pulse',(_,res)=>res.json({top_threats:[]}));
app.get('/api/admin/users',(req,res)=>res.json({users:users.filter(u=>Boolean(u.deleted_at)===(req.query.deleted==='1'))}));
app.use('/api/admin/users',(req,res,next)=>{if(req.method!=='GET'){assert.ok(req.is('application/json'));mutations.push({path:req.path,method:req.method,body:req.body})}next()});
app.patch('/api/admin/users/:id',(req,res)=>{const user=users.find(u=>u.id===Number(req.params.id));Object.assign(user,req.body);res.json({ok:true,user})});
app.delete('/api/admin/users/:id',(req,res)=>{const user=users.find(u=>u.id===Number(req.params.id));Object.assign(user,{deleted_at:at,active:false,active_sessions:0});res.json({ok:true,user})});
app.post('/api/admin/users/:id/restore',(req,res)=>{const user=users.find(u=>u.id===Number(req.params.id));Object.assign(user,{deleted_at:null,active:false});res.json({ok:true,user})});
// Invitation endpoints intentionally absent: accidental calls must fail this check.
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{
  const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await mkdir('test-output',{recursive:true});
  for(const width of [1440,390]){
    users=structuredClone(original);const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('dialog',d=>d.accept());
    await page.setViewport({width,height:960});await page.goto(`http://127.0.0.1:${server.address().port}/preview-users#settings`);await page.waitForSelector('.um-user');
    assert.equal(await page.$$eval('.um-user',els=>els.length),4);assert.equal(await page.$$eval('#userManagement script',els=>els.length),0);
    assert.equal(await page.$$eval('[data-user-id="1"][data-user-action="delete"]',els=>els.length),0);
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(bounds.scroll<=width+1,'user list overflow: '+JSON.stringify(bounds));
    await page.screenshot({path:`test-output/users-list-${width}.png`,fullPage:true});
    await page.type('#umSearch','ipek');assert.equal(await page.$$eval('.um-user',els=>els.length),1);await page.evaluate(()=>{const el=document.querySelector('#umSearch');el.value='';el.dispatchEvent(new Event('input'))});
    await page.locator('[data-user-id="2"][data-user-action="edit"]').click();await page.waitForSelector('dialog[open]');
    assert.ok(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'native dialog focuses content');
    const dialogBounds=await page.$eval('dialog',el=>({scroll:el.scrollWidth,client:el.clientWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));assert.ok(dialogBounds.scroll<=dialogBounds.client+1&&dialogBounds.left>=0&&dialogBounds.right<=width,'dialog overflow at '+width);
    await page.screenshot({path:`test-output/users-edit-${width}.png`,fullPage:true});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.$('dialog'),null);assert.equal(await page.evaluate(()=>document.activeElement?.dataset.userAction),'edit');
    await page.locator('[data-user-id="1"][data-user-action="edit"]').click();assert.ok(await page.$eval('#umEditRole',el=>el.disabled));assert.ok(await page.$eval('#umActive',el=>el.disabled));
    await page.$eval('#umFirst',el=>el.value='Batu Güncel');await page.locator('dialog [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
    assert.equal(await page.$eval('.app-user-mini b',el=>el.textContent),'Batu Güncel Test');assert.equal(await page.$eval('.user-chip b',el=>el.textContent),'Batu Güncel Test');
    await page.locator('[data-user-id="2"][data-user-action="delete"]').click();assert.ok(await page.$eval('dialog [type="submit"]',el=>el.disabled));await page.type('#umDeleteName','İpek Uzun Soyisimli Yönetici');
    await page.screenshot({path:`test-output/users-delete-${width}.png`,fullPage:true});await page.locator('dialog [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog')&&!document.querySelector('[data-user-id="2"]'));
    await page.locator('[data-um-view="deleted"]').click();await page.waitForSelector('[data-user-id="2"][data-user-action="restore"]');await page.screenshot({path:`test-output/users-deleted-${width}.png`,fullPage:true});
    // Center the physical click above the mobile fixed bottom navigation. Visibility alone
    // does not guarantee that Puppeteer's click target is not covered by that navigation.
    const restoreSelector='[data-user-id="2"][data-user-action="restore"]';
    await page.$eval(restoreSelector,el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    const restoreHit=await page.$eval(restoreSelector,el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {onTarget:el===hit||el.contains(hit),targetTop:r.top,targetBottom:r.bottom,hitTag:hit?.tagName,hitClass:hit?.className,hitText:hit?.textContent?.slice(0,100)}});
    assert.ok(restoreHit.onTarget,'restore action covered: '+JSON.stringify(restoreHit));
    try{
      await page.locator(restoreSelector).click();await page.waitForFunction(()=>!document.querySelector('[data-user-id="2"]'));
    }catch(error){
      const diagnostic=await page.evaluate(()=>({view:document.querySelector('[data-um-view][aria-pressed="true"]')?.dataset.umView,notice:document.querySelector('.um-notice')?.textContent,dialog:document.querySelector('dialog')?.textContent,userButtons:[...document.querySelectorAll('[data-user-id="2"]')].map(el=>({action:el.dataset.userAction,disabled:el.disabled,text:el.textContent}))}));
      console.error('USER_RESTORE_FAILURE '+JSON.stringify({width,restoreHit,diagnostic,mutations:mutations.slice(-3),record:users.find(u=>u.id===2)}));
      await page.screenshot({path:`test-output/users-restore-failure-${width}.png`,fullPage:true});throw error;
    }
    await page.locator('[data-um-view="current"]').click();await page.waitForSelector('[data-user-id="2"][data-user-action="access"]');assert.equal(await page.$eval('[data-user-id="2"][data-user-action="access"]',el=>el.textContent),'Aktifleştir');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'restored list overflow');assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:')));assert.deepEqual(errors,[]);await page.close();console.log('USER_ADMIN_LAYOUT '+width+' OK');
  }
  assert.ok(mutations.every(m=>m.method!=='POST'||m.path.endsWith('/restore')),'no invitation delivery');assert.equal(mutations.length,6);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
