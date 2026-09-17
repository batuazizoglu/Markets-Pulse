// Read-only diagnostics for verified public package pages. No credentials or browser automation.
import * as cheerio from 'cheerio';
const jobs=[
['kol','https://www.kibrisonline.com/?page=customer&action=hizmetler'],
['multimax','https://www.mmcyp.com/?page=customer&action=hizmetler'],
['broadmax','https://www.broadmax.net/?page=customer&action=hizmetler-wdsl'],
['broadmax-fiber','https://www.broadmax.net/?page=customer&action=hizmetler-fiber'],
['nethouse','https://nethouse.net/tr/'],
['haypem','https://www.haypem.com/'],
['surface','https://www.surfacenetcy.com/packages'],
['prime','https://www.primenet.com.tr/bireysel-internet-cozumleri/'],
['royal','https://royalnetcyprus.com/'],
['alem','https://www.alemnet.net/pricing'],
['enson','https://www.ensonnet.com/standard-tr.html'],
['enson-adsl','https://www.ensonnet.com/adslvdsl-tr.html'],
['analiz','https://www.analiz.net/internet.html'],
['cypking','https://cypking.net/fiyatlarimiz/'],
['goldsurf','https://www.gold-surf.com/'],
['mahir','https://mahir.com/hizmetler'],
['fixnet','https://www.fixnetbroadband.com/tarifeler/flex-super-internet']
];
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
async function worker(){while(jobs.length){const [key,url]=jobs.shift();try{
const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'user-agent':'Mozilla/5.0'}});
const html=await r.text();const $=cheerio.load(html);
const js=$('script').map((_,s)=>({src:$(s).attr('src'),text:$(s).text().slice(0,600)})).get();
const data=html.match(/(?:const|var|let)\s+o_services\s*=\s*JSON.parse\('((?:\\.|[^'\\])*)'\)/);
const tables=$('table').map((_,t)=>$(t).find('tr').map((__,tr)=>[$(tr).find('th,td').map((___,td)=>clean($(td).text())).get()]).get()).get();
$('script,style,noscript,svg,header,footer,nav').remove();
const heads=$('h1,h2,h3,h4').map((_,x)=>({tag:x.tagName,text:clean($(x).text()),parent:$(x).parent().attr('class'),html:$(x).parent().toString().slice(0,1400)})).get().slice(0,12);
$('br').replaceWith(' ');$('td,th,li,h1,h2,h3,h4,h5,h6,p').append(' ');
console.log('ISP_AUDIT '+JSON.stringify({key,status:r.status,url:r.url,text:clean($.root().text()).slice(0,18000),tables,heads,js,data:data?data[1].slice(0,3000):null}));
}catch(e){console.log('ISP_AUDIT '+JSON.stringify({key,error:e.message}))}}}
await Promise.all(Array.from({length:4},worker));
