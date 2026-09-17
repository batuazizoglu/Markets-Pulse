// Read-only catalog verification against configured official sources.
// Optional ISP_AUDIT_SOURCES=slug,slug narrows the run. No applications or messages are submitted.
import {HOME_INTERNET_SOURCES,fetchSource,closeHomeInternetBrowser} from '../src/home-internet.js';
const chosen=process.env.ISP_AUDIT_SOURCES?.split(',').filter(Boolean);
const pending=HOME_INTERNET_SOURCES.filter(s=>!chosen||chosen.includes(s.slug)),results=[];
async function worker(){while(pending.length){const s=pending.shift(),r=await fetchSource(s);
const summary={slug:s.slug,provider:s.provider,company_ids:s.company_ids,status:r.status,error:r.error,count:r.products.length,
 priced:r.products.filter(x=>x.effective_monthly_try>0).length,terms:[...new Set(r.products.map(x=>x.duration_months+'+'+x.bonus_months))],
 sample:r.products.slice(0,1).map(x=>({name:x.name,total:x.total_price_try,monthly:x.effective_monthly_try,bonus:x.bonus_months}))};
results.push(summary);console.log('ISP_AUDIT '+JSON.stringify(summary));}}
try{await Promise.all(Array.from({length:3},worker));}
finally{await closeHomeInternetBrowser()}
console.log('ISP_TOTAL '+JSON.stringify({sources:results.length,healthy_sources:results.filter(x=>x.count).length,
companies:new Set(results.filter(x=>x.count).flatMap(x=>x.company_ids)).size,
brands:new Set(results.filter(x=>x.count).map(x=>x.provider)).size,
products:results.reduce((a,x)=>a+x.count,0),priced:results.reduce((a,x)=>a+x.priced,0)}));
