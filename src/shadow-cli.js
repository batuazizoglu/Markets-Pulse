import * as cheerio from 'cheerio';
import { pool } from './db.js';
import { buildComparableV2 } from './comparable-v2.js';

const SOURCES=[
  {slug:'kktcell-faturasiz',type:'prepaid',name:'KKTCELL Faturasız',url:'https://www.kktcell.com/faturasiz'},
  {slug:'kktcell-faturali',type:'postpaid',name:'KKTCELL Faturalı',url:'https://www.kktcell.com/faturali'},
  {slug:'kktcell-gnc',type:'postpaid',name:'KKTCELL GNÇ',url:'https://www.kktcell.com/gnc'},
  {slug:'kktcell-platinum',type:'postpaid',name:'KKTCELL Platinum',url:'https://www.kktcell.com/platinum'}
];
function cleanNumber(v){if(v==null)return null;const s=String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');const m=s.match(/\d+(?:\.\d+)?/);return m?Number(m[0]):null}
function text(v){return String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function segment(raw){const t=String(raw||'').toLocaleLowerCase('tr-TR');if(/turist|tourist|ercan|havaalan|airport|e[- ]?sim/.test(t))return'Turist';if(/asker|askerfone|askere özel/.test(t))return'Asker';if(/freezone|gnç|genç|öğrenci|student|young/.test(t))return'Öğrenci / Genç';if(/platinum|premium|vip|super red|\bred\b/.test(t))return'Premium / Platinum';return'Genel'}
function acquisition(raw){const t=String(raw||'').toLocaleLowerCase('tr-TR');if(/mnp|numara taşı|numara taşi|taşıma|taşima|port in/.test(t))return'MNP';if(/yeni hat|hoş geldin|hos geldin|new line|new customer/.test(t))return'Yeni Hat';return'Genel'}
function channel(raw){const t=String(raw||'').toLocaleLowerCase('tr-TR');if(/ercan|havaalan|airport/.test(t))return'Ercan';if(/dijital|digital|online|web|uygulama|app|e[- ]?sim/.test(t))return'Dijital';if(/mağaza|magaza|bayi|tim\b|store/.test(t))return'Mağaza';return'Genel'}
function parse(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const suffix=source.type==='prepaid'?'Faturasız':'Faturalı',suffixRe=new RegExp(`${suffix}(?=\\s|$)`,'i'),cards=[];
  $('a').each((_,el)=>{const raw=text($(el).text());if(!raw||raw.length<8||raw.length>1200)return;const m=raw.match(suffixRe);if(!m||m.index==null||m.index<2)return;const after=raw.slice(m.index+m[0].length);if(!/(?:\d+(?:[.,]\d+)?\s*(?:GB|MB|DK|SMS)|\d[\d.]*(?:,\d+)?\s*TL|ÜCRETSİZ)/i.test(after))return;const name=text(raw.slice(0,m.index+m[0].length));if(!name||/^(?:Faturalı|Faturasız)(?:\s+4\.5G)?$/i.test(name)||/^(?:Paketler|Tüm Paketler|Faturalı Hatta Geçiş|Yeni Faturasız Hat Al)/i.test(name))return;cards.push({name,raw,href:$(el).attr('href')||null})});
  const rows=[],seen=new Set();
  for(const card of cards){
    const key=source.type+'|'+card.name+'|'+card.raw;if(seen.has(key))continue;seen.add(key);const raw=card.raw,name=card.name,allow=[];
    for(const m of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/ig)){let v=cleanNumber(m[1]);if(String(m[2]).toUpperCase()==='MB')v=v==null?null:v/1024;allow.push({v,idx:m.index||0})}
    let data=null,bonus=0;for(const g of allow){if(g.v==null)continue;const around=raw.slice(Math.max(0,g.idx-20),Math.min(raw.length,g.idx+100)).toLocaleLowerCase('tr-TR');if(/sosyal medya|tv\+|uygulama|dijital bonus|hediye/.test(around))bonus+=g.v;else if(data==null)data=g.v;else bonus+=g.v}if(data==null&&allow.length)data=allow[0].v;
    let price=null;const pm=raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\s*\/\s*(?:AY|HAFTA|GÜN|\d+\s*GÜN|\d+\s*AY)/i)||raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\b/i);if(pm)price=cleanNumber(pm[1]);
    const mm=[...raw.matchAll(/(\d[\d.]*)\s*(?:DK|MIN)\b/ig)].map(m=>parseInt(m[1].replace(/\./g,''),10)),mins=mm.length?mm[0]:null;const sm=raw.match(/(\d[\d.]*)\s*SMS\b/i),sms=sm?parseInt(sm[1].replace(/\./g,''),10):null;const dm=raw.match(/TL\s*\/\s*(\d+)\s*GÜN/i)||raw.match(/(\d+)\s*GÜN\b/i),days=dm?Number(dm[1]):(/TL\s*\/\s*AY|AYLIK ABONELİK|KONTRATLI ABONELİK/i.test(raw)?30:null);
    const low=name.toLocaleLowerCase('tr-TR'),addon=/\bek\b|\b100\s*sms\b|\b1\.000\s*sms\b|\b10\.000\s*sms\b|tek numara|aşım|devir|favorim|türkiye \d+\s*dk|tv\+|dakika faturasız|platinum'a ek|gnç ek|gnc ek/i.test(low),closed=/yeni abone alımına kapalı|abone alımına kapalı|sonlanmıştır|sona ermiştir/i.test(raw),core=price!=null&&data!=null&&!addon&&!closed;
    rows.push({provider:'KKTCELL',source_slug:source.slug,source_name:source.name,source_url:source.url,type:source.type,name,data_gb:data,bonus_data_gb:bonus||0,effective_data_gb:(data||0)+(bonus||0),local_tr_minutes:mins,international_minutes:null,sms,validity_days:days,price_try:price,segment:segment(name+' '+raw),acquisition:acquisition(name+' '+raw),channel:channel(name+' '+raw),is_core:core,is_closed:closed,raw_text:raw,product_url:card.href});
  }
  const uniq=new Map();for(const r of rows){const k=[r.type,r.name,r.data_gb,r.bonus_data_gb,r.price_try,r.validity_days].join('|');if(!uniq.has(k))uniq.set(k,r)}return[...uniq.values()];
}
async function fetchSource(source){const t0=Date.now();try{const r=await fetch(source.url,{headers:{'user-agent':'Mozilla/5.0 Chrome/152 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'tr-TR,tr;q=0.9'},signal:AbortSignal.timeout(20000)});const html=await r.text();if(!r.ok)throw new Error('HTTP '+r.status);const rows=parse(html,source);return{source,ok:true,rows,response_ms:Date.now()-t0}}catch(e){return{source,ok:false,rows:[],response_ms:Date.now()-t0,error:e.message}}}
const latest=`SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,s.slug source_slug,s.name source_name,s.url source_url,v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json FROM products p JOIN sources s ON s.id=p.source_id LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE WHERE p.active=TRUE ORDER BY s.id,v.price_try ASC NULLS LAST,p.current_name`;
function compact(r){const p=x=>x?{name:x.name,data:x.core_data_gb,bonus:x.bonus_data_gb,minutes:x.minutes,intl:x.international_minutes,sms:x.sms,days:x.validity_days,price:x.price_try,intent:x.intent,eligibility:x.eligibility}:null;return{status:r.status,score:r.score,mutual:r.mutual_best,segment:r.telsim?.segment,telsim:p(r.telsim),kktcell:p(r.kktcell),penalties:r.penalties||[],runner_up:r.runner_up||null,margin:r.score_margin??null}}
try{
  const [telsim,sourceResults]=await Promise.all([pool.query(latest),Promise.all(SOURCES.map(fetchSource))]);const catalog=sourceResults.flatMap(x=>x.rows);const out=buildComparableV2(telsim.rows,catalog);
  const result={sources:sourceResults.map(x=>({slug:x.source.slug,ok:x.ok,count:x.rows.length,response_ms:x.response_ms,error:x.error||null})),catalog:out.catalog,counts:out.counts,by_segment:out.by_segment,diagnostics:out.diagnostics,golden:out.golden,primary:out.primary.map(compact),review_queue:out.review_queue.map(compact),reject_top:out.rejected.slice(0,15).map(compact)};
  console.log(JSON.stringify(result));
}catch(e){console.error(JSON.stringify({error:e.message,stack:e.stack}));process.exitCode=1}finally{await pool.end().catch(()=>{})}
