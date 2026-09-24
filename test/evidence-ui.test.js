import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// DOM integration only: real archive code + SQL/API fixture, no rendered browser.
// Native dialog, clipboard and download navigation are adapted below.
let server,base,html,scripts;
const windows=[];
before(async()=>{
  process.env.EVIDENCE_PREVIEW_BUILD='1';
  const {app}=await import('./preview-evidence.js');
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+server.address().port;
  html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  scripts=await Promise.all(['evidence.js','brand-ui.js'].map(name=>readFile(new URL('../public/'+name,import.meta.url),'utf8')));
});
after(async()=>{for(const window of windows)window.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function until(condition){
  const deadline=Date.now()+5000;
  while(!condition()){if(Date.now()>deadline)assert.fail('Expected archive UI state was not reached');await new Promise(resolve=>setTimeout(resolve,10));}
}
async function screen(query='',{role='admin',beforeAccessReady}={}){
  const dom=new JSDOM(html,{url:base+'/'+query+'#evidence',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;windows.push(w);const requests=[],downloads=[],blobs=new Map();
  const user={id:1,role,first_name:'Örnek',last_name:'Kullanıcı',username:'preview'};
  let resolveAccess,accessUser=null;
  w.MarketPulseAccess={ready:new Promise(resolve=>{resolveAccess=resolve;}),isAdmin:()=>accessUser?.role==='admin',getUser:()=>accessUser,subscribe(){return()=>{};}};
  w.document.documentElement.dataset.userRole='pending';
  w.fetch=(url,options)=>{requests.push(String(url));return String(url)==='/api/auth/me'?Promise.resolve(new Response(JSON.stringify({user}))):fetch(new URL(url,base),options);};
  w.AbortController=AbortController;w.AbortSignal=AbortSignal;
  w.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.URL.createObjectURL=blob=>{const url='blob:test-'+blobs.size;blobs.set(url,blob);return url;};
  w.URL.revokeObjectURL=url=>blobs.delete(url);
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)});};
  w.navigator.clipboard={writeText:async text=>{w.copiedLink=text;}};
  // Unrelated dynamic dashboard modules are outside this test's scope.
  w.eval(scripts[0].replace(/^import\(.*$/gm,''));w.eval(scripts[1]);
  await beforeAccessReady?.({w,requests});
  accessUser=user;w.document.documentElement.dataset.userRole=role;resolveAccess(user);
  const $=id=>w.document.getElementById(id);
  await until(()=>$('evPageInfo')?.textContent.startsWith('Sayfa')||($('evMessage')&&!$('evMessage').hidden));
  assert.equal($('evMessage').hidden,true,$('evMessage').textContent);
  const submit=()=>{$('evFilters').dispatchEvent(new w.Event('submit',{cancelable:true}));};
  const ready=()=>until(()=>$('evResults').getAttribute('aria-busy')==='false');
  return {w,$,requests,downloads,submit,ready};
}

test('archive navigation, filters, empty results and pagination work together',async()=>{
  const {w,$,submit,ready}=await screen();
  assert.equal(w.document.body.dataset.view,'evidence');
  assert.ok(w.document.querySelector('.app-nav-btn[data-route="evidence"].active'));
  assert.equal(w.document.querySelectorAll('.ev-card').length,24);
  $('evNext').click();await ready();assert.equal($('evPageInfo').textContent,'Sayfa 2 / 4');
  $('evListView').click();assert.equal($('evResults').dataset.view,'list');
  $('evFilter-q').value='havalimani';submit();await ready();
  assert.match($('evResultCount').textContent,/25 kayıt/);
  assert.ok([...w.document.querySelectorAll('.ev-card h3')].every(el=>el.textContent==='Faturasız'));
  assert.match(w.location.search,/ev_q=havalimani/);
  $('evFilter-q').value='bulunamayan';submit();await ready();assert.ok($('evEmptyReset'));
  $('evEmptyReset').click();await ready();assert.match($('evResultCount').textContent,/75 kayıt/);
  $('evFilter-availability').value='missing';submit();await ready();
  assert.match($('evResultCount').textContent,/10 kayıt/);
  assert.ok([...w.document.querySelectorAll('.ev-card')].every(el=>el.querySelector('.ev-file.missing')));
  w.close();
});

test('selections survive pagination, downloads contain ZIP data, and refresh preserves draft filters',async()=>{
  const {w,$,downloads,ready}=await screen();
  const select=w.document.querySelector('[data-select]');select.click();assert.equal($('evSelection').hidden,false);
  $('evNext').click();await ready();w.document.querySelector('[data-select]').click();assert.equal($('evSelectedCount').textContent,'2 kayıt seçili');
  $('evPrev').click();await ready();assert.equal(w.document.querySelector('[data-select]').checked,true);
  $('evExport').click();await until(()=>downloads.length===1);
  assert.equal(downloads[0].name,'markets-pulse-kanit-2-kayit.zip');
  assert.equal((await downloads[0].blob.arrayBuffer()).byteLength>1000,true);
  $('evFilter-source').value='faturasiz';$('evRefresh').click();await ready();assert.equal($('evFilter-source').value,'faturasiz');
  const actualFetch=w.fetch;w.fetch=async url=>String(url).startsWith('/api/evidence?')?new Response(JSON.stringify({error:'Test bağlantı hatası'}),{status:503}):actualFetch(url);
  $('evNext').click();await ready();assert.equal($('evNext').disabled,false);assert.match($('evMessage').textContent,/Test bağlantı hatası/);
  w.fetch=actualFetch;$('evNext').click();await ready();assert.equal($('evPageInfo').textContent,'Sayfa 2 / 4');
  w.close();
});

test('record deep links expose packages, scan changes, previous evidence and original files',async()=>{
  const {w,$}=await screen('?evidence=4');await until(()=>!!$('evTab-focus'));
  assert.equal($('evDialog').open,true);assert.match($('evDetailTitle').textContent,/Faturalı/);
  $('evTab-packages').click();assert.equal($('evPackageRows').children.length,3);
  assert.match($('evPackageRows').textContent,/30 günlük kullanım/);assert.match($('evPackageRows').textContent,/3 gün/);
  $('evPackageSearch').value='50 GB';$('evPackageSearch').dispatchEvent(new w.Event('input'));assert.equal($('evPackageRows').children.length,1);
  $('evTab-changes').click();assert.match($('evDetailBody').textContent,/599/);assert.match($('evDetailBody').textContent,/699/);
  $('evTab-compare').click();assert.match($('evDetailBody').textContent,/#7/);
  assert.equal(w.document.querySelectorAll('.ev-compare img').length,2);
  assert.ok([...w.document.querySelectorAll('.ev-compare img')].every(img=>img.src.endsWith('/image')));
  assert.equal(w.document.querySelectorAll('.ev-detail-files a[download]').length,4);
  $('evCopyLink').click();await until(()=>!!w.copiedLink);assert.match(w.copiedLink,/evidence=4#evidence/);
  $('evOpenPrevious').click();await until(()=>$('evDialog').textContent.includes('KANIT #7'));
  assert.equal($('evTab-focus').disabled,true);assert.equal($('evTab-full').getAttribute('aria-selected'),'true');
  $('evClose').click();assert.equal($('evDialog').open,false);assert.equal(w.location.search,'');
  w.close();
});

test('a record without images or JSON opens an enabled tab and escaped package text stays inert',async()=>{
  const {w,$}=await screen();const actualFetch=w.fetch;
  w.fetch=async(url,options)=>{
    const response=await actualFetch(url,options);
    if(String(url)==='/api/evidence/3'){
      const row=await response.json();row.has_focus=false;row.has_screenshot=false;row.has_json=false;
      row.packages=[{name:'<img src=x onerror="alert(1)">',price_try:1}];
      return new Response(JSON.stringify(row),{headers:{'content-type':'application/json'}});
    }
    return response;
  };
  w.document.querySelector('[data-open="3"]').click();await until(()=>!!$('evTab-changes'));
  assert.equal($('evTab-packages').disabled,true);assert.equal($('evTab-changes').getAttribute('aria-selected'),'true');
  $('evTab-compare').click();assert.match($('evDetailBody').textContent,/Bu kayıtta görsel bulunmuyor/);
  $('evClose').click();
  // Stored package names are untrusted text, including in the parsed-data table.
  w.fetch=async(url,options)=>{
    const response=await actualFetch(url,options);
    if(String(url)!=='/api/evidence/3')return response;
    const row=await response.json();row.packages=[{name:'<img src=x onerror="alert(1)">',extras:['<script>bad()</script>']}];
    return new Response(JSON.stringify(row),{headers:{'content-type':'application/json'}});
  };
  w.document.querySelector('[data-open="3"]').click();await until(()=>!!$('evTab-packages'));$('evTab-packages').click();
  assert.match($('evPackageRows').textContent,/<img src=x/);assert.equal($('evPackageRows').querySelector('img,script'),null);
  w.close();
});

test('standard archive waits for access and keeps proof, history and image downloads without technical controls',async()=>{
  const {w,$,requests,downloads}=await screen('?ev_availability=complete&evidence=4',{role:'standard',beforeAccessReady:async({w,requests})=>{
    w.EvidenceArchive.activate();await Promise.resolve();
    assert.equal(w.document.getElementById('evExport'),null);
    assert.equal(w.document.querySelector('.ev-file-row'),null);
    assert.equal(requests.some(url=>url.startsWith('/api/evidence')),false);
  }});
  await until(()=>!!$('evTab-focus'));
  assert.equal(w.document.querySelectorAll('.ev-stat').length,2);
  assert.deepEqual([...$('evFilter-availability').options].map(option=>option.value),['','visual','no_visual']);
  assert.equal(new URL(requests.find(url=>url.startsWith('/api/evidence?')),base).searchParams.get('availability'),'');
  assert.equal(w.document.querySelector('#evExport,#evDownloadOne,#evSelection,[data-select],.ev-file-row,.ev-record-id'),null);
  assert.doesNotMatch($('evidenceArchive').textContent,/HTML|JSON|ZIP|dosya hazır|Eksiksiz kayıt/);
  assert.doesNotMatch($('evDialog').textContent,/HTML|JSON|ZIP|dosya eksik/);
  const links=[...w.document.querySelectorAll('.ev-detail-files a[download]')];
  assert.equal(links.length,2);
  assert.ok(links.every(link=>/\/(focus|image)\?download=1$/.test(link.href)));
  links[0].click();assert.equal(downloads.length,1);
  assert.match(w.document.querySelector('.ev-detail-actions a').href,/kktctelsim\.com/);
  $('evTab-packages').click();assert.equal($('evPackageRows').children.length,3);
  $('evTab-changes').click();assert.match($('evDetailBody').textContent,/599/);assert.match($('evDetailBody').textContent,/699/);
  $('evTab-compare').click();assert.equal(w.document.querySelectorAll('.ev-compare img').length,2);
  assert.doesNotMatch($('evDetailBody').textContent,/#7/);
  $('evOpenPrevious').click();await until(()=>$('evTab-full')?.getAttribute('aria-selected')==='true');
  assert.equal($('evDownloadOne'),null);
  assert.equal(w.document.querySelectorAll('.ev-detail-files a[download]').length,1);
  assert.equal(requests.some(url=>url.startsWith('/api/evidence/export')),false);
  w.close();
});

test('standard archive reports unavailable images without file diagnostics',async()=>{
  const {w,$,submit,ready}=await screen('',{role:'standard'});
  $('evFilter-availability').value='no_visual';submit();await ready();
  assert.match($('evResultCount').textContent,/5 kayıt/);
  assert.ok([...w.document.querySelectorAll('.ev-card')].every(card=>card.textContent.includes('Görsel bulunmuyor')));
  w.document.querySelector('[data-open="14"]').click();await until(()=>!!$('evTab-packages'));
  assert.equal($('evTab-packages').getAttribute('aria-selected'),'true');
  assert.match(w.document.querySelector('.ev-detail-files').textContent,/Görsel bulunmuyor/);
  assert.equal(w.document.querySelectorAll('.ev-detail-files a').length,0);
  assert.doesNotMatch($('evDialog').textContent,/HTML|JSON|ZIP|eksik|dosya/);
  $('evTab-compare').click();assert.match($('evDetailBody').textContent,/Bu kayıtta görsel bulunmuyor/);
  const comparisonImage=w.document.querySelector('.ev-compare img');comparisonImage.dispatchEvent(new w.Event('error'));
  assert.match($('evDetailBody').textContent,/Görsel yüklenemedi\. Kaydı yeniden açarak tekrar deneyebilirsiniz\./);
  w.close();
});

test('standard archive presents benefit changes and failed requests in plain language',async()=>{
  const {w,$,ready}=await screen('',{role:'standard'});const actualFetch=w.fetch;
  w.fetch=async(url,options)=>{
    const response=await actualFetch(url,options);
    if(String(url)!=='/api/evidence/4')return response;
    const row=await response.json();
    row.changes=[{change_type:'field_changed',field_name:'extras_json',old_value:'["Sınırsız WhatsApp"]',new_value:'["Sınırsız WhatsApp","10 GB hediye","<img src=x onerror=alert(1)>"]'}];
    return new Response(JSON.stringify(row),{headers:{'content-type':'application/json'}});
  };
  w.document.querySelector('[data-open="4"]').click();await until(()=>!!$('evTab-changes'));$('evTab-changes').click();
  assert.match($('evDetailBody').textContent,/Sınırsız WhatsApp · 10 GB hediye/);
  assert.doesNotMatch($('evDetailBody').textContent,/\["Sınırsız/);
  assert.equal($('evDetailBody').querySelector('img'),null);
  $('evClose').click();
  w.fetch=async()=>new Response(JSON.stringify({error:'storage backend: secret technical detail'}),{status:503});
  $('evRefresh').click();await ready();
  assert.equal($('evMessage').textContent,'Kayıtlar alınamadı. Yeniden deneyin.');
  w.close();
});
