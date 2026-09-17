// Read-only verification against configured official package pages. No credentials.
import {HOME_INTERNET_SOURCES,fetchSource} from '../src/home-internet.js';
import {jsonLiteral} from '../src/isp-parsers.js';
const pending=HOME_INTERNET_SOURCES.filter(s=>!s.parser.includes('dynamic'));
const results=[];
async function worker(){while(pending.length){const source=pending.shift();const r=await fetchSource(source);
const summary={slug:source.slug,status:r.status,count:r.products.length,error:r.error,sample:r.products.slice(0,2)};
results.push(summary);console.log('ISP_LIVE '+JSON.stringify(summary));}}
await Promise.all(Array.from({length:4},worker));
console.log('ISP_TOTAL '+JSON.stringify({sources:results.length,healthy:results.filter(x=>x.count).length,products:results.reduce((a,x)=>a+x.count,0)}));

for(const url of ['https://www.alemnet.net/pricing','https://www.fixnetbroadband.com/tarifeler/flex-super-internet','https://towernet.net/paketler/','https://cypking.net/']){
try{
const r=await fetch(url,{signal:AbortSignal.timeout(15000)}),html=await r.text(),ch=await import('cheerio'),$=ch.load(html);
const result={url,status:r.status};
if(url.includes('alemnet')){
result.fragments=[];
for(const src of $('script[src]').map((_,s)=>$(s).attr('src')).get().filter(x=>x.startsWith('/_next/')&&!/polyfill|main-app|4bd1b696|webpack|255-/.test(x))){
const js=await (await fetch(new URL(src,url),{signal:AbortSignal.timeout(10000)})).text();
if(/getPackages|\/packages|package[s_]|pricing/i.test(js)){
result.fragments.push({src,parts:[...js.matchAll(/.{0,150}(?:getPackages|\/packages|["']packages["']|price_month|pricing|packagePrice|packageApi|api\/).{0,280}/gi)].map(m=>m[0]).slice(0,20)});
}
}
}else if(url.includes('fixnet')){
result.tabs=$('.pricing-tab').map((_,x)=>$(x).toString()).get();
result.snapshots=$('[wire\\:snapshot]').map((_,x)=>$(x).attr('wire:snapshot').slice(0,40000)).get();
result.data=$('[x-data]').map((_,x)=>$(x).attr('x-data')).get().filter(x=>/price|pack|duration/.test(x)).map(x=>x.slice(0,20000));
}else {result.html=html.slice(0,12000);}
console.log('ISP_DETAIL '+JSON.stringify(result));
}catch(e){console.log('ISP_DETAIL '+JSON.stringify({url,error:e.message,cause:e.cause?.code}))}
}
