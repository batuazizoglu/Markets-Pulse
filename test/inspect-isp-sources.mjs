import {HOME_INTERNET_SOURCES,fetchSource,closeHomeInternetBrowser} from '../src/home-internet.js';
const slugs=['cypking-home','alemnet-home','fixnet-flex-super-internet','extend-business'];
try{for(const slug of slugs){const s=HOME_INTERNET_SOURCES.find(x=>x.slug===slug),r=await fetchSource(s);
console.log('ISP_FINAL '+JSON.stringify({slug,status:r.status,error:r.error,count:r.products.length,sample:r.products.slice(0,5),terms:[...new Set(r.products.map(x=>x.duration_months+'+'+x.bonus_months))]}));}}finally{await closeHomeInternetBrowser()}
const url='https://towernet.net/assets/index-DRqjO-CU.js';
const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),text=await r.text();
console.log('TOWER_DATA '+JSON.stringify([...text.matchAll(/.{0,300}(?:WDSL Ekonomik|850[,}]|1000[,}]|prices:|prices=|pricing:).{0,2500}/g)].map(x=>x[0]).slice(0,10)));
