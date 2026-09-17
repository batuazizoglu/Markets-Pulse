import * as cheerio from 'cheerio';
for(const url of [
'https://www.alemnet.net/_next/static/chunks/app/pricing/page-7c8e67ef6b22edf4.js',
'https://www.alemnet.net/_next/static/chunks/989-d4e4817f73be6036.js',
'https://towernet.net/','https://cypking.net/'
])try{
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),text=await r.text();
 if(url.endsWith('.js')){
   const parts=url.includes('/pricing/')?[text.slice(0,18000)]:[...text.matchAll(/.{0,180}(?:getDocs|collection\(|price_one|price_two|price_three|package_name|[.(]get\(|[.(]post\().{0,200}/g)].map(x=>x[0]).slice(0,30);
   console.log('ISP_FOCUS '+JSON.stringify({url,status:r.status,parts}));continue;
 }
 const $=cheerio.load(text);
 const scripts=$('script:not([src])').map((_,s)=>$(s).text()).get().filter(t=>/price|pricing|plan|850|1000/i.test(t));
 const sources=$('script[src]').map((_,s)=>$(s).attr('src')).get().filter(t=>!/^https?:/.test(t)||t.includes(new URL(url).host));
 const snapshots=$('[wire\\:snapshot]').map((_,x)=>$(x).attr('wire:snapshot')).get();
 $('script,style,nav,footer,header,svg').remove();$('br').replaceWith(' ');$('h1,h2,h3,h4,p,li,button').append(' ');
 const body=$.root().text().replace(/\s+/g,' ');
 const heads=$('h2,h3,h4').map((_,h)=>({text:$(h).text(),parent:$(h).parent().toString().slice(0,4500)})).get().filter(x=>/Mbps|Mbit|WDSL|ADSL|VDSL|Mega|Lite|Plus|Standart|Pro|Fiber/i.test(x.text)).slice(0,16);
 console.log('ISP_FOCUS '+JSON.stringify({url,status:r.status,body,scripts:scripts.map(s=>s.slice(0,18000)),sources,snapshots,heads}));
 for(const src of sources.filter(s=>/script|app|main/.test(s)&&!s.includes('livewire'))){
 const js=await (await fetch(new URL(src,url),{signal:AbortSignal.timeout(15000)})).text();
 if(url.includes('towernet'))console.log('ISP_ASSET '+JSON.stringify({url:new URL(src,url).href,code:js.slice(0,24000)}));
 }
}catch(e){console.log('ISP_FOCUS '+JSON.stringify({url,error:e.message,cause:e.cause?.code}))}
