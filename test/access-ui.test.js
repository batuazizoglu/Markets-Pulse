import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/access-ui.css',import.meta.url),'utf8');
const names=['access-ui','market-state','app','market-pulse','brand-ui'];
const scripts=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')])));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function fixture(modules=names){
  const dom=new JSDOM(html,{url:'https://www.marketspulse.cloud/#dashboard',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[];
  let resolveAuth,rejectAuth;
  const auth=new Promise((resolve,reject)=>{resolveAuth=resolve;rejectAuth=reject;});
  const style=d.createElement('style');style.textContent=css;d.head.append(style);
  w.scrollTo=()=>{};w.setInterval=()=>0;w.alert=()=>{};w.console.error=()=>{};
  w.fetch=async(raw,options={})=>{
    const url=new URL(raw,w.location.href);requests.push({url,method:options.method||'GET'});
    if(url.pathname==='/api/auth/me')return auth;
    const data={
      '/api/summary':{sources:[]},'/api/packages':[],'/api/comparison':{rows:[]},'/api/value-index':[],
      '/api/benchmark':{segment_scores:[],overall_score:{}},'/api/scan':{sources:[]},
      '/api/market-pulse':{window_days:Number(url.searchParams.get('days')),generated_at:new Date().toISOString(),changes:[],moves:[]}
    }[url.pathname];
    assert.notEqual(data,undefined,'Unexpected endpoint '+url.pathname);
    return {ok:true,json:async()=>data};
  };
  for(const name of modules)w.eval(scripts[name]);
  const release=(role='standard')=>resolveAuth({ok:true,json:async()=>({user:{id:1,role,first_name:'Test',last_name:'User',username:'test'}})});
  const ready=async()=>{await w.MarketPulseAccess.ready;if(w.loadAll)await w.loadAll();await tick();await tick();};
  return {dom,w,d,requests,release,ready,resolveAuth,rejectAuth};
}

test('shared access defers all dashboard consumers and standard scan cannot issue a POST',async()=>{
  const f=fixture();try{
    const {w,d,requests}=f,seen=[];
    const unsubscribe=w.MarketPulseAccess.subscribe(user=>seen.push(user));
    let scanFinished=false;const pendingScan=w.scanNow().then(()=>{scanFinished=true;});
    await tick();
    assert.equal(d.documentElement.dataset.userRole,'pending');
    assert.equal(w.MarketPulseAccess.isAdmin(),false);
    assert.equal(w.MarketPulseAccess.getUser(),null);
    assert.equal(scanFinished,false);
    assert.equal(w.getComputedStyle(d.getElementById('scanBtn')).display,'none');
    assert.equal(w.getComputedStyle(d.querySelector('main.shell')).visibility,'hidden');
    assert.deepEqual(requests.map(request=>request.url.pathname),['/api/auth/me']);
    assert.equal(d.querySelector('.app-sidebar'),null);
    assert.equal(seen.length,0);
    f.release();await f.ready();await pendingScan;await w.scanNow();await w.loadAll();
    assert.equal(d.documentElement.dataset.userRole,'standard');
    assert.equal(w.MarketPulseAccess.getUser().role,'standard');
    assert.equal(w.MarketPulseAccess.isAdmin(),false);
    assert.equal(seen.length,1);assert.equal(seen[0].role,'standard');unsubscribe();
    const late=[];w.MarketPulseAccess.subscribe(user=>late.push(user));assert.equal(late[0],w.MarketPulseAccess.getUser());
    assert.equal(requests.filter(request=>request.url.pathname==='/api/auth/me').length,1);
    assert.equal(requests.some(request=>request.method==='POST'),false);
    assert.equal(w.getComputedStyle(d.getElementById('scanBtn')).display,'none');
    assert.equal(d.querySelector('.app-nav-btn[data-route="settings"]'),null);
    assert.ok(d.querySelector('.app-nav-btn[data-route="dashboard"]'));
    assert.ok(d.getElementById('mpContent'));
  }finally{f.dom.window.close()}
});

test('admin access reveals scan and preserves its authorized POST without another auth request',async()=>{
  const f=fixture();try{
    f.release('admin');await f.ready();
    assert.equal(f.d.documentElement.dataset.userRole,'admin');
    assert.equal(f.w.MarketPulseAccess.isAdmin(),true);
    assert.notEqual(f.w.getComputedStyle(f.d.getElementById('scanBtn')).display,'none');
    assert.ok(f.d.querySelector('.app-nav-btn[data-route="settings"]'));
    await f.w.scanNow();
    assert.equal(f.requests.filter(request=>request.url.pathname==='/api/scan'&&request.method==='POST').length,1);
    assert.equal(f.requests.filter(request=>request.url.pathname==='/api/auth/me').length,1);
  }finally{f.dom.window.close()}
});

test('failed auth and unexpected roles keep admin controls closed',async t=>{
  for(const scenario of ['denied','network','invalid JSON','unknown role'])await t.test(scenario,async()=>{
    const f=fixture(['access-ui']);try{
      if(scenario==='network')f.rejectAuth(new Error('offline'));
      else if(scenario==='denied')f.resolveAuth({ok:false});
      else if(scenario==='invalid JSON')f.resolveAuth({ok:true,json:async()=>{throw new Error('invalid JSON');}});
      else f.release('owner');
      await f.ready();
      assert.equal(f.w.MarketPulseAccess.isAdmin(),false);
      assert.equal(f.d.documentElement.dataset.userRole,'standard');
      assert.equal(f.w.getComputedStyle(f.d.getElementById('scanBtn')).display,'none');
      if(scenario!=='unknown role')assert.equal(f.w.MarketPulseAccess.getUser(),null);
      assert.equal(f.requests.length,1);
    }finally{f.dom.window.close()}
  });
});

test('standard benefit details preserve old and new values as safe HTML while admin keeps raw detail',async()=>{
  for(const role of ['standard','admin']){
    const f=fixture();try{
      f.release(role);await f.ready();
      const change={change_type:'field_changed',field_name:'extras_json',old_value:'["Sınırsız WhatsApp","<img src=x onerror=bad()>"]',new_value:'{"Hediye":["10 GB","<script>bad()</script>"]}'};
      const box=f.d.createElement('div');box.innerHTML=f.w.MarketPulseData.changeMarkup(change);f.d.body.append(box);
      assert.equal(box.querySelector('img,script,[onerror]'),null);
      assert.match(box.textContent,/Sınırsız WhatsApp/);assert.match(box.textContent,/10 GB/);
      assert.match(box.textContent,/<img src=x onerror=bad\(\)>/);assert.match(box.textContent,/<script>bad\(\)<\/script>/);
      if(role==='standard'){
        assert.ok(box.querySelector('details.change-detail'));
        assert.deepEqual([...box.querySelectorAll('.change-values strong')].map(node=>node.textContent),['Önce','Şimdi']);
        assert.doesNotMatch(box.textContent,/\["Sınırsız|\{"Hediye/);
      }else{
        assert.equal(box.querySelector('details'),null);
        assert.match(box.textContent,/\["Sınırsız/);assert.match(box.textContent,/\{"Hediye/);
      }
      f.w.renderTimeline([{...change,id:1,detected_at:new Date().toISOString(),source_name:'Kaynak',severity:'low'}]);
      const title=f.d.querySelector('.tl-content>b');
      if(role==='standard')assert.equal(title.textContent,'Paket');
      else assert.equal(title.textContent,change.old_value);
    }finally{f.dom.window.close()}
  }
});
