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
// Public client code reveals the package endpoint used by the pricing page.
const scripts=[
'https://www.alemnet.net/_next/static/chunks/app/pricing/page-7c8e67ef6b22edf4.js',
'https://www.mmcyp.com/?page=customer&action=hizmetler',
'https://www.broadmax.net/?page=customer&action=hizmetler-wdsl'
];
for(const url of scripts)try{
const r=await fetch(url,{signal:AbortSignal.timeout(15000)}),text=await r.text();
if(url.includes('alemnet'))console.log('ISP_DYNAMIC '+JSON.stringify({url,fragments:[...text.matchAll(/.{0,120}(?:fetch\(|axios|\/api\/|https:).{0,200}/g)].slice(0,20).map(x=>x[0])}));
else{const m=text.match(/const a_wdsl_hizmet\s*=\s*/);if(m){const d=jsonLiteral(text,m.index+m[0].length);console.log('ISP_DYNAMIC '+JSON.stringify({url,record:d.a_data?.a_services?.[0]}))}}
}catch(e){console.log('ISP_DYNAMIC '+JSON.stringify({url,error:e.message}))}

for(const url of [
'https://www.alemnet.net/pricing',
'https://towernet.net/paketler/',
'https://www.extendbroadband.com/urunler-wdsl-kurumsal.php',
'https://www.fixnetbroadband.com/tarifeler/flex-super-internet'
])try{
const r=await fetch(url,{signal:AbortSignal.timeout(15000)}),html=await r.text();
const ch=await import('cheerio'),$=ch.load(html);
const data={url,status:r.status,forms:$('select').map((_,s)=>({name:$(s).attr('name'),options:$(s).find('option').map((__,o)=>({value:$(o).attr('value'),text:$(o).text()})).get()})).get()};
if(url.includes('alemnet')){
const paths=$('script[src]').map((_,s)=>$(s).attr('src')).get().filter(s=>s.startsWith('/_next/')&&!/polyfill|main-app|4bd1b696|webpack/.test(s));
data.fragments=[];
for(const path of paths){const js=await (await fetch(new URL(path,url),{signal:AbortSignal.timeout(10000)})).text();data.fragments.push(...[...js.matchAll(/.{0,100}(?:fetch\(|axios|\/api\/|https:).{0,150}/g)].map(x=>x[0]).filter(x=>!/facebook|schema.org|google|reactjs|w3.org|nextjs/.test(x)).slice(0,15))}
}
else{
data.scripts=$('script:not([src])').map((_,s)=>$(s).text()).get().filter(s=>/package|paket|price|duration|plan|period|pricing/i.test(s)).map(s=>s.slice(0,12000));
data.tables=$('table').map((_,t)=>$(t).text().replace(/\s+/g,' ').slice(0,2500)).get();
$('script,style,nav,header,footer,svg').remove();$('br').replaceWith(' ');data.text=$.root().text().replace(/\s+/g,' ').slice(0,9000);
}
console.log('ISP_MORE '+JSON.stringify(data));
}catch(e){console.log('ISP_MORE '+JSON.stringify({url,error:e.message,cause:e.cause?.code}))}
