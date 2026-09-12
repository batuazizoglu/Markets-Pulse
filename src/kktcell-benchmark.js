import * as cheerio from 'cheerio';

const KKTCELL_SOURCES = [
  { slug:'kktcell-faturasiz', type:'prepaid', name:'KKTCELL Faturasız', url:'https://www.kktcell.com/faturasiz' },
  { slug:'kktcell-faturali', type:'postpaid', name:'KKTCELL Faturalı', url:'https://www.kktcell.com/faturali' }
];

export const BENCHMARK_SEGMENTS = ['Genel','Asker','Öğrenci / Genç','Turist','Premium / Platinum'];

let cache = { at:0, rows:[], sources:[], error:null };
const CACHE_MS = 15 * 60 * 1000;

function cleanNumber(v){
  if(v==null) return null;
  const s=String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const m=s.match(/\d+(?:\.\d+)?/);
  return m?Number(m[0]):null;
}
function normalizeText(v){return String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}

function classifySegment(text){
  const t=String(text||'').toLocaleLowerCase('tr-TR');
  if(/turist|tourist|ercan|havaalan|airport|e[- ]?sim/.test(t)) return 'Turist';
  if(/asker|askerfone|askere özel/.test(t)) return 'Asker';
  if(/freezone|gnç|genç|öğrenci|student|young/.test(t)) return 'Öğrenci / Genç';
  if(/platinum|premium|vip|super red|\bred\b/.test(t)) return 'Premium / Platinum';
  return 'Genel';
}
function detectAcquisition(text){
  const t=String(text||'').toLocaleLowerCase('tr-TR');
  if(/mnp|numara taşı|numara taşi|taşıma|taşima|port in/.test(t)) return 'MNP';
  if(/yeni hat|hoş geldin|hos geldin|new line|new customer/.test(t)) return 'Yeni Hat';
  return 'Genel';
}
function detectChannel(text){
  const t=String(text||'').toLocaleLowerCase('tr-TR');
  if(/ercan|havaalan|airport/.test(t)) return 'Ercan';
  if(/dijital|digital|online|web|uygulama|app|e[- ]?sim/.test(t)) return 'Dijital';
  if(/mağaza|magaza|bayi|tim\b|store/.test(t)) return 'Mağaza';
  return 'Genel';
}

function extractProductCards(html,source){
  const $=cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const suffix=source.type==='prepaid'?'Faturasız':'Faturalı';
  const suffixRe=new RegExp(`${suffix}(?=\\s|$)`,'i');
  const candidates=[];
  $('a').each((_,el)=>{
    const raw=normalizeText($(el).text());
    if(!raw || raw.length<8 || raw.length>1200) return;
    const m=raw.match(suffixRe);
    if(!m || m.index==null || m.index<2) return;
    const after=raw.slice(m.index+m[0].length);
    if(!/(?:\d+(?:[.,]\d+)?\s*(?:GB|MB|DK|SMS)|\d[\d.]*(?:,\d+)?\s*TL|ÜCRETSİZ)/i.test(after)) return;
    const name=normalizeText(raw.slice(0,m.index+m[0].length));
    if(!name || /^(?:Faturalı|Faturasız)(?:\s+4\.5G)?$/i.test(name)) return;
    if(/^(?:Paketler|Tüm Paketler|Faturalı Hatta Geçiş|Yeni Faturasız Hat Al)/i.test(name)) return;
    candidates.push({name,raw,href:$(el).attr('href')||null});
  });
  const unique=new Map();
  for(const c of candidates){const key=`${source.type}|${c.name}|${c.raw}`;if(!unique.has(key))unique.set(key,c)}
  return [...unique.values()];
}

function parseCatalog(html,source){
  const cards=extractProductCards(html,source);
  const rows=[];
  for(const card of cards){
    const {name,raw}=card;
    const allowances=[];
    for(const m of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/ig)){
      let v=cleanNumber(m[1]);
      if(String(m[2]).toUpperCase()==='MB') v=v==null?null:v/1024;
      allowances.push({v,idx:m.index||0});
    }
    let dataGb=null,bonusGb=0;
    for(const g of allowances){
      if(g.v==null)continue;
      const around=raw.slice(Math.max(0,g.idx-20),Math.min(raw.length,g.idx+100)).toLocaleLowerCase('tr-TR');
      if(/sosyal medya|tv\+|uygulama|dijital bonus|hediye/.test(around)) bonusGb+=g.v;
      else if(dataGb==null)dataGb=g.v; else bonusGb+=g.v;
    }
    if(dataGb==null&&allowances.length)dataGb=allowances[0].v;
    let price=null;
    const pm=raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\s*\/\s*(?:AY|HAFTA|GÜN|\d+\s*GÜN|\d+\s*AY)/i)||raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\b/i);
    if(pm)price=cleanNumber(pm[1]);
    const minuteMatches=[...raw.matchAll(/(\d[\d.]*)\s*(?:DK|MIN)\b/ig)].map(m=>parseInt(m[1].replace(/\./g,''),10));
    const mins=minuteMatches.length?minuteMatches[0]:null;
    const sm=raw.match(/(\d[\d.]*)\s*SMS\b/i);const sms=sm?parseInt(sm[1].replace(/\./g,''),10):null;
    const daym=raw.match(/TL\s*\/\s*(\d+)\s*GÜN/i)||raw.match(/(\d+)\s*GÜN\b/i);
    const validityDays=daym?Number(daym[1]):(/TL\s*\/\s*AY|AYLIK ABONELİK|KONTRATLI ABONELİK/i.test(raw)?30:null);
    const segment=classifySegment(`${name} ${raw}`);
    const acquisition=detectAcquisition(`${name} ${raw}`);
    const channel=detectChannel(`${name} ${raw}`);
    const lowName=name.toLocaleLowerCase('tr-TR');
    const isAddon=/\bek\b|\b100\s*sms\b|\b1\.000\s*sms\b|\b10\.000\s*sms\b|tek numara|aşım|devir|favorim|türkiye \d+\s*dk|tv\+|dakika faturasız|platinum'a ek/i.test(lowName);
    const isCore=price!=null&&dataGb!=null&&!isAddon;
    rows.push({provider:'KKTCELL',source_slug:source.slug,source_name:source.name,source_url:source.url,type:source.type,name,
      data_gb:dataGb,bonus_data_gb:bonusGb||0,effective_data_gb:(dataGb||0)+(bonusGb||0),local_tr_minutes:mins,
      international_minutes:null,sms,validity_days:validityDays,price_try:price,segment,acquisition,channel,is_core:isCore,raw_text:raw,product_url:card.href});
  }
  const unique=new Map();
  for(const r of rows){const key=[r.type,r.name,r.data_gb,r.bonus_data_gb,r.price_try,r.validity_days].join('|');if(!unique.has(key))unique.set(key,r)}
  return [...unique.values()];
}

export async function getKktcellCatalog(force=false){
  if(!force&&cache.rows.length&&Date.now()-cache.at<CACHE_MS)return cache;
  const all=[];const sourceStatus=[];
  for(const source of KKTCELL_SOURCES){
    const t0=Date.now();
    try{
      const res=await fetch(source.url,{headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'tr-TR,tr;q=0.9'},signal:AbortSignal.timeout(30000)});
      const html=await res.text();if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const rows=parseCatalog(html,source);all.push(...rows);
      sourceStatus.push({...source,ok:true,http_status:res.status,response_ms:Date.now()-t0,parsed_count:rows.length,core_count:rows.filter(x=>x.is_core).length});
    }catch(e){sourceStatus.push({...source,ok:false,response_ms:Date.now()-t0,error:e?.message||String(e),parsed_count:0,core_count:0})}
  }
  cache={at:Date.now(),rows:all,sources:sourceStatus,error:sourceStatus.some(x=>!x.ok)?'One or more KKTCELL sources failed':null};
  return cache;
}

function competitorType(p){return p.source_slug==='faturasiz'?'prepaid':'postpaid'}
function competitorText(p){return `${p.current_name||p.name||''} ${JSON.stringify(p.extras_json||[])}`}
function competitorSegment(p){return classifySegment(competitorText(p))}
function competitorAcquisition(p){return detectAcquisition(competitorText(p))}
function competitorChannel(p){return detectChannel(competitorText(p))}
function pctGap(ours,theirs){if(ours==null||theirs==null||Number(theirs)===0)return null;return((Number(ours)-Number(theirs))/Number(theirs))*100}
function valueScore(p){const data=Number(p.effective_data_gb??((Number(p.data_gb)||0)+(Number(p.bonus_data_gb)||0)));const price=Number(p.price_try);return data>0&&price>0?data/price*100:null}

function similarity(t,k){
  const tt=competitorType(t),ts=competitorSegment(t);
  if(k.type!==tt)return -999;
  if(k.segment!==ts)return -999;
  let s=70;
  const td=(Number(t.data_gb)||0)+(Number(t.bonus_data_gb)||0),kd=Number(k.effective_data_gb)||0;
  if(td>0&&kd>0)s+=Math.min(td,kd)/Math.max(td,kd)*15;
  if(t.validity_days&&k.validity_days){const d=Math.abs(Number(t.validity_days)-Number(k.validity_days));s+=Math.max(0,8-d/4)}
  if(t.price_try&&k.price_try)s+=Math.min(Number(t.price_try),Number(k.price_try))/Math.max(Number(t.price_try),Number(k.price_try))*7;
  if(competitorAcquisition(t)===k.acquisition)s+=3;
  if(competitorChannel(t)===k.channel)s+=2;
  return s;
}

export function buildBenchmark(telsimRows,kktcellRows){
  const ours=kktcellRows.filter(x=>x.is_core);
  const comp=telsimRows.filter(x=>x.active&&x.price_try!=null&&x.data_gb!=null);
  const matches=[];
  for(const t of comp){
    const segment=competitorSegment(t),acquisition=competitorAcquisition(t),channel=competitorChannel(t);
    const ranked=ours.map(k=>({k,score:similarity(t,k)})).filter(x=>x.score>=70).sort((a,b)=>b.score-a.score);
    const best=ranked[0];if(!best)continue;
    const k=best.k,tEff=(Number(t.data_gb)||0)+(Number(t.bonus_data_gb)||0),kEff=Number(k.effective_data_gb)||0;
    const tValue=valueScore({...t,effective_data_gb:tEff}),kValue=valueScore(k);
    const priceGap=Number(k.price_try)-Number(t.price_try),dataGap=kEff-tEff,valueGap=(kValue!=null&&tValue!=null)?kValue-tValue:null;
    const position=valueGap==null?'UNKNOWN':valueGap>0.25?'KKTCELL_ADVANTAGE':valueGap<-0.25?'TELSIM_ADVANTAGE':'PARITY';
    matches.push({match_score:Math.round(best.score),segment,type:competitorType(t),acquisition,channel,position,
      telsim:{id:t.id,name:t.name||t.current_name,data_gb:Number(t.data_gb)||0,bonus_data_gb:Number(t.bonus_data_gb)||0,effective_data_gb:tEff,minutes:t.local_tr_minutes,validity_days:t.validity_days,price_try:Number(t.price_try),gb_per_100tl:tValue,acquisition,channel},
      kktcell:{name:k.name,data_gb:k.data_gb,bonus_data_gb:k.bonus_data_gb,effective_data_gb:kEff,minutes:k.local_tr_minutes,validity_days:k.validity_days,price_try:k.price_try,gb_per_100tl:kValue,source_url:k.source_url,product_url:k.product_url,acquisition:k.acquisition,channel:k.channel},
      gaps:{price_try:priceGap,data_gb:dataGap,value_gb_per_100tl:valueGap,price_pct:pctGap(k.price_try,t.price_try),data_pct:pctGap(kEff,tEff)},
      recommendation:recommend(position,{priceGap,dataGap,segment})});
  }
  matches.sort((a,b)=>{const rank={TELSIM_ADVANTAGE:0,PARITY:1,KKTCELL_ADVANTAGE:2,UNKNOWN:3};return rank[a.position]-rank[b.position]||b.match_score-a.match_score});
  const counts=matches.reduce((a,m)=>(a[m.position]=(a[m.position]||0)+1,a),{});
  const segment_summary=BENCHMARK_SEGMENTS.map(segment=>{
    const rows=matches.filter(m=>m.segment===segment);
    const positions=rows.reduce((a,m)=>(a[m.position]=(a[m.position]||0)+1,a),{});
    return {segment,total:rows.length,positions};
  });
  return {generated_at:new Date().toISOString(),methodology:'Segment-first nearest commercial equivalent v2',segments:BENCHMARK_SEGMENTS,counts,total_matches:matches.length,segment_summary,matches};
}

function recommend(position,x){
  if(position==='KKTCELL_ADVANTAGE')return 'Avantajı koru; fiyat indiriminden kaçın, değer üstünlüğünü dijital iletişim ve CRM ile görünür kıl.';
  if(position==='PARITY')return 'Fiyat savaşı yerine kanal bonusu, ek data veya servis faydası ile fark yarat.';
  if(position==='TELSIM_ADVANTAGE'){
    if(x.segment==='Turist')return 'Turist teklifinde fiyat yerine data, süre veya Ercan/dijital bonus senaryosunu test et.';
    if(x.segment==='Asker')return 'Asker segmentinde aktivasyon kolaylığı ve hedefli fayda farkını güçlendir; genel fiyat indirimi yapma.';
    if(x.segment==='Öğrenci / Genç')return 'Öğrenci/genç segmentinde sosyal medya, dijital bonus ve kampüs edinim teklifini test et.';
    if(x.segment==='Premium / Platinum')return 'Premium farkını yalnız GB ile değil roaming, servis ve ayrıcalık değeriyle güçlendir.';
    if(x.dataGap<0&&x.priceGap>=0)return 'Aynı/yüksek fiyata daha düşük data riski var; hedefli ek GB veya dijital bonus değerlendir.';
    if(x.priceGap>0)return 'KKTCELL fiyat primi var; premium gerekçeyi güçlendir veya yalnız riskli kitleye kişiselleştirilmiş teklif test et.';
    return 'En yakın SKU için fayda/marj simülasyonu yap; genel fiyat indirimi yerine hedefli cevap tasarla.';
  }
  return 'Manuel ürün eşleştirmesi kontrolü gerekli.';
}

setTimeout(()=>{
  getKktcellCatalog(true).then(c=>console.log('[kktcell-catalog]',JSON.stringify({total:c.rows.length,core:c.rows.filter(x=>x.is_core).length,segments:BENCHMARK_SEGMENTS.map(segment=>({segment,count:c.rows.filter(x=>x.is_core&&x.segment===segment).length})),sources:c.sources.map(s=>({slug:s.slug,ok:s.ok,http_status:s.http_status,parsed_count:s.parsed_count,core_count:s.core_count,response_ms:s.response_ms,error:s.error||null}))}))).catch(e=>console.error('[kktcell-catalog]',e?.message||String(e)));
},1500);
