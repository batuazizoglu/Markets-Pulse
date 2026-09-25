import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {marketPulseFromRows} from '../src/intelligence.js';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const scripts=await Promise.all(['access-ui','market-state','app','market-pulse','brand-ui'].map(name=>readFile(new URL('../public/'+name+'.js',import.meta.url),'utf8')));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(condition){
  const deadline=Date.now()+2000;
  while(!condition()){if(Date.now()>deadline)assert.fail('Expected navigation state was not reached');await new Promise(resolve=>setTimeout(resolve,5));}
}
async function fixture(role='standard',hash='#dashboard'){
  // Enable the application's inline navigation handlers; external resources are not loaded.
  const dom=new JSDOM(html,{url:'https://www.marketspulse.cloud/?keep=1'+hash,runScripts:'dangerously'}),w=dom.window,d=w.document,requests=[];
  w.scrollTo=()=>{};w.setInterval=()=>0;w.alert=()=>{};
  d.querySelector('main.shell').insertAdjacentHTML('beforeend','<section id="benchmark-section"></section><section id="home-internet-section"></section><section id="ad-visual-section"></section><section id="trend-analysis-section"></section>');
  const benchmarkSegments=[];w.setBmSegment=segment=>benchmarkSegments.push(segment);
  const trendActivations=[];w.MarketPulseTrends={activate:()=>{trendActivations.push(w.location.hash);return Promise.resolve()}};
  w.fetch=async raw=>{
    const url=new URL(raw,w.location.href);requests.push(url);
    const data={
      '/api/auth/me':{user:{id:1,role,first_name:'Test',last_name:'User',username:'test'}},
      '/api/summary':{sources:[]},'/api/packages':[],'/api/comparison':{rows:[]},'/api/value-index':[],
      '/api/benchmark':{segment_scores:[],overall_score:{}},'/api/reports/status':{email:{configured:false},recent_runs:[]}
    }[url.pathname];
    if(url.pathname==='/api/market-pulse')return {ok:true,json:async()=>marketPulseFromRows([],Number(url.searchParams.get('days')),new Date())};
    assert.notEqual(data,undefined,'Unexpected endpoint '+url.pathname);
    return {ok:true,json:async()=>data};
  };
  for(const script of scripts)w.eval(script);
  await w.loadAll();await tick();await tick();
  return {dom,w,d,requests,benchmarkSegments,trendActivations};
}
function assertHeader(f,title){
  const header=f.d.querySelector('.topbar .brand.page-brand #viewTitle');
  assert.ok(header,'Page heading belongs in the top content header');
  assert.equal(header.querySelector('h1').textContent,title);
  assert.ok(header.querySelector('p').textContent.trim());
  assert.equal(f.d.querySelectorAll('#viewTitle').length,1);
  assert.equal(f.d.querySelectorAll('main.shell h1').length,1);
  assert.equal(f.d.querySelector('main.shell>.view-title'),null);
  assert.equal(f.d.getElementById('marketPulseTopLogo'),null);
  assert.ok(f.d.querySelector('.app-side-brand img'),'Sidebar keeps its brand identity');
  assert.equal(f.d.getElementById('competitorViews').classList.contains('route-visible'),['competitor','trends'].includes(f.d.body.dataset.view));
  assert.equal(f.d.getElementById('trend-analysis-section').classList.contains('route-visible'),f.d.body.dataset.view==='trends');
  return header;
}
function assertCompetitorView(f,view){
  assert.equal(f.d.body.dataset.view,view);
  assertHeader(f,'Rakip Takip');
  assert.equal(f.d.querySelector('.app-nav-btn.active').dataset.route,'competitor');
  assert.equal(f.d.querySelector('.app-nav-btn.active').getAttribute('aria-current'),'page');
  assert.equal(f.d.querySelector('.app-nav-btn[data-route="trends"]'),null);
  const tab=f.d.querySelector('#competitorViews [data-competitor-view="'+view+'"]');
  assert.ok(tab.classList.contains('active'));
  assert.equal(tab.getAttribute('aria-pressed'),'true');
  assert.equal(f.d.querySelectorAll('#competitorViews .active').length,1);
  assert.equal(f.d.querySelector('#competitorViews [data-competitor-view="trends"]').textContent.trim(),'Trend Analizi');
  assert.equal(f.d.getElementById('changes-section').classList.contains('route-visible'),view==='competitor');
  assert.equal(f.d.getElementById('benchmark-section').classList.contains('route-visible'),false);
  if(view==='trends')assert.deepEqual([...f.d.querySelectorAll('[data-route-section].route-visible')].map(el=>el.id).sort(),['competitorViews','trend-analysis-section'],'Trend analysis has isolated content');
}

for(const role of ['standard','admin'])test(role+' navigation nests trends and keeps one current-page heading across routes',async()=>{
  const f=await fixture(role);try{
    const {w,d}=f;
    assertHeader(f,'Dashboard');
    assert.equal(d.querySelector('.app-nav-btn[data-route="trends"]'),null);
    d.querySelector('.app-nav-btn[data-route="competitor"]').click();await tick();
    assertCompetitorView(f,'competitor');
    const competitorDescription=d.querySelector('#viewTitle p').textContent;
    const activationsBefore=f.trendActivations.length;
    d.querySelector('#competitorViews [data-competitor-view="trends"]').click();await tick();
    assert.equal(w.location.hash,'#competitor/trends');
    assert.equal(w.location.search,'?keep=1');
    assertCompetitorView(f,'trends');
    assert.notEqual(d.querySelector('#viewTitle p').textContent,competitorDescription);
    assert.ok(f.trendActivations.length>activationsBefore,'Entering trend analysis activates its own module');
    assert.ok(!f.benchmarkSegments.includes('Tümü'),'Trend analysis must not change the product comparison segment');
    d.querySelector('#competitorViews [data-competitor-view="competitor"]').click();await tick();
    assert.equal(w.location.hash,'#competitor');assertCompetitorView(f,'competitor');
    const routes=[['dashboard','Dashboard'],['home','Ev İnterneti'],['ads','Reklam Analizi'],['compare','Ürün Karşılaştırma'],['segment','Segment Analizi'],['evidence','Kanıt Arşivi'],['reports','Raporlar']];
    if(role==='admin')routes.push(['settings','Ayarlar']);
    for(const [route,title] of routes){
      w.MarketPulseUI.go(route);await tick();assertHeader(f,title);
      assert.equal(d.querySelector('.app-nav-btn.active').dataset.route,route);
      if(route==='reports'){
        assert.match(d.querySelector('#viewTitle p').textContent,/Raporları indirin veya kendi e-posta adresinize gönderin/);
        assert.equal(d.querySelector('#reports-section .section-title h2,#reports-section .section-title p'),null);
        assert.doesNotMatch(d.getElementById('reports-section').textContent,/Rapor Merkezi/);
        assert.ok(d.getElementById('reportEmailBadge'));
      }
    }
    w.MarketPulseUI.cycleTheme();assertHeader(f,role==='admin'?'Ayarlar':'Raporlar');
    if(role==='standard'){
      assert.equal(d.querySelector('.app-nav-btn[data-route="settings"]'),null);
      w.MarketPulseUI.go('settings');assertHeader(f,'Dashboard');
    }
  }finally{f.dom.window.close()}
});

for(const role of ['standard','admin'])test(role+' legacy trends deep links normalize and browser history restores the parent and nested tab',async()=>{
  const f=await fixture(role,'#trends');try{
    const {w}=f;
    assert.equal(w.location.hash,'#competitor/trends');assert.equal(w.location.search,'?keep=1');assertCompetitorView(f,'trends');
    f.d.querySelector('.app-nav-btn[data-route="dashboard"]').click();await tick();assertHeader(f,'Dashboard');
    f.d.querySelector('.app-nav-btn[data-route="competitor"]').click();await tick();assertCompetitorView(f,'competitor');
    w.history.back();await until(()=>f.d.body.dataset.view==='dashboard');assertHeader(f,'Dashboard');
    w.history.back();await until(()=>f.d.body.dataset.view==='trends');
    assert.equal(w.location.hash,'#competitor/trends');assertCompetitorView(f,'trends');
    w.history.forward();await until(()=>f.d.body.dataset.view==='dashboard');assertHeader(f,'Dashboard');
    w.history.forward();await until(()=>f.d.body.dataset.view==='competitor');assertCompetitorView(f,'competitor');
    w.location.hash='#reports';await until(()=>f.d.body.dataset.view==='reports');assertHeader(f,'Raporlar');
    w.history.back();await until(()=>f.d.body.dataset.view==='competitor');assertCompetitorView(f,'competitor');
  }finally{f.dom.window.close()}
});

test('the shared 7/30/90-day selection survives Dashboard and nested trend navigation',async()=>{
  const f=await fixture();try{
    const {w,d}=f;
    for(const days of [7,30,90]){
      await w.MarketPulseData.selectDays(days);
      const selected=w.MarketPulseData.getState().snapshot;
      const before=f.requests.filter(url=>url.pathname==='/api/market-pulse').length;
      for(const route of ['competitor','trends','dashboard']){
        w.MarketPulseUI.go(route);await tick();
        if(route!=='dashboard')assertCompetitorView(f,route);
        assert.equal(w.MarketPulseData.getState().days,days);
        assert.equal(w.MarketPulseData.getState().snapshot,selected);
        assert.equal(d.querySelector('#timelineTabs [aria-pressed="true"]').dataset.marketDays,String(days));
        assert.equal(d.querySelector('.mp-window [aria-pressed="true"]').dataset.marketDays,String(days));
      }
      assert.equal(f.requests.filter(url=>url.pathname==='/api/market-pulse').length,before,'Route switches keep the existing shared snapshot');
      assertHeader(f,'Dashboard');
      assert.ok(d.getElementById('market-pulse-section').classList.contains('route-visible'));
    }
    assert.ok(!f.benchmarkSegments.includes('Tümü'),'Shared market navigation does not mutate the independent benchmark');
  }finally{f.dom.window.close()}
});
