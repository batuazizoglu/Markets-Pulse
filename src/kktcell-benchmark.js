import * as cheerio from 'cheerio';

const KKTCELL_SOURCES = [
  { slug:'kktcell-faturasiz', type:'prepaid', name:'KKTCELL Faturasız', url:'https://www.kktcell.com/faturasiz' },
  { slug:'kktcell-faturali', type:'postpaid', name:'KKTCELL Faturalı', url:'https://www.kktcell.com/faturali' }
];

let cache = { at:0, rows:[], sources:[], error:null };
const CACHE_MS = 15 * 60 * 1000;

function cleanNumber(v){
  if(v==null) return null;
  const s=String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const m=s.match(/\d+(?:\.\d+)?/);
  return m?Number(m[0]):null;
}

function normalizeLines(html){
  const $=cheerio.load(html);
  $('script,style,noscript,svg').remove();
  $('br').replaceWith('\n');
  $('div,section,article,li,p,h1,h2,h3,h4,h5,h6,button,a,span,td,th,tr').each((_,el)=>$(el).append('\n'));
  return $('body').text().replace(/\u00a0/g,' ').split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}

function likelyProductName(line,type){
  if(!line || line.length<4 || line.length>180) return false;
  const suffix=type==='prepaid'?'Faturasız':'Faturalı';
  if(!new RegExp(`${suffix}$`,'i').test(line)) return false;
  if(new RegExp(`^${suffix}$`,'i').test(line)) return false;
  if(/^(Faturalı Paketler|Faturasız Paketler|Paketler|İnternet|Filtrele)/i.test(line)) return false;
  return /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(line);
}

function parseCatalog(html,source){
  const lines=normalizeLines(html);
  const starts=[];
  for(let i=0;i<lines.length;i++) if(likelyProductName(lines[i],source.type)) starts.push(i);
  const rows=[];

  for(let i=0;i<starts.length;i++){
    const start=starts[i];
    const end=i+1<starts.length?starts[i+1]:Math.min(lines.length,start+55);
    const chunk=lines.slice(start,end);
    const rawDisplay=chunk.join(' | ');
    // KKTCELL cards render numeric values and units in separate nested spans.
    // Joining with spaces reconstructs semantic phrases such as "40 GB" and
    // "489 TL/7 GÜN", while rawDisplay remains useful for diagnostics.
    const raw=chunk.join(' ').replace(/\s+/g,' ').trim();
    const name=chunk[0].replace(/\s+/g,' ').trim();

    const allowances=[];
    for(const m of raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/ig)){
      let v=cleanNumber(m[1]);
      if(String(m[2]).toUpperCase()==='MB') v=v==null?null:v/1024;
      allowances.push({v,idx:m.index||0,unit:String(m[2]).toUpperCase()});
    }

    let dataGb=null, bonusGb=0;
    for(const g of allowances){
      if(g.v==null) continue;
      const nearby=raw.slice(g.idx,Math.min(raw.length,g.idx+110)).toLocaleLowerCase('tr-TR');
      if(/sosyal medya|tv\+|uygulama|dijital bonus|hediye/.test(nearby)) bonusGb += g.v;
      else if(dataGb==null) dataGb=g.v;
      else bonusGb += g.v;
    }
    if(dataGb==null && allowances.length) dataGb=allowances[0].v;

    let price=null;
    const pm=raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\s*\/\s*(?:AY|HAFTA|GÜN|\d+\s*GÜN|\d+\s*AY)/i)
      || raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\b/i);
    if(pm) price=cleanNumber(pm[1]);

    const minm=raw.match(/(\d[\d.]*)\s*(?:DK|MIN)\b/i);
    const mins=minm?parseInt(minm[1].replace(/\./g,''),10):null;
    const sm=raw.match(/(\d[\d.]*)\s*SMS\b/i);
    const sms=sm?parseInt(sm[1].replace(/\./g,''),10):null;
    const daym=raw.match(/TL\s*\/\s*(\d+)\s*GÜN/i) || raw.match(/(\d+)\s*GÜN\b/i);
    const validityDays=daym?Number(daym[1]):(/TL\s*\/\s*AY|AYLIK ABONELİK/i.test(raw)?30:null);
    const intl=/YURT DIŞI|INT\.?\s*LINES|INTERNATIONAL/i.test(raw)?mins:null;
    const segment=classifySegment(name,raw,source.type);
    const isCore=price!=null && dataGb!=null && !/ek\s|100sms|1000 sms|10\.000 sms|tek numara|aşım|devir|favorim|türkiye \d+dk|tv\+/i.test(name.toLocaleLowerCase('tr-TR'));

    rows.push({
      provider:'KKTCELL', source_slug:source.slug, source_name:source.name, source_url:source.url,
      type:source.type, name, data_gb:dataGb, bonus_data_gb:bonusGb||0,
      effective_data_gb:(dataGb||0)+(bonusGb||0), local_tr_minutes:mins,
      international_minutes:intl, sms, validity_days:validityDays, price_try:price,
      segment, is_core:isCore, raw_text:rawDisplay
    });
  }

  const unique=new Map();
  for(const r of rows){
    const key=[r.type,r.name,r.data_gb,r.bonus_data_gb,r.price_try,r.validity_days].join('|');
    if(!unique.has(key)) unique.set(key,r);
  }
  return [...unique.values()];
}

function classifySegment(name,raw,type){
  const t=`${name} ${raw}`.toLocaleLowerCase('tr-TR');
  if(/turist|tourist|ercan|havaalan|airport|e\s*sim/.test(t)) return 'Tourist / Airport';
  if(/mnp|numara taşı|taşıma/.test(t)) return 'MNP';
  if(/gnç|genç|öğrenci|student|freezone/.test(t)) return 'Youth / Student';
  if(/asker/.test(t)) return 'Military';
  if(/kamu/.test(t)) return 'Public Sector';
  if(/platinum|premium|vip/.test(t)) return 'Premium';
  if(/çocuk|kids/.test(t)) return 'Kids';
  if(/60\+|senior|yaş/.test(t)) return 'Senior';
  return type==='prepaid'?'Prepaid':'Postpaid';
}

export async function getKktcellCatalog(force=false){
  if(!force && cache.rows.length && Date.now()-cache.at<CACHE_MS) return cache;
  const all=[]; const sourceStatus=[];
  for(const source of KKTCELL_SOURCES){
    const t0=Date.now();
    try{
      const res=await fetch(source.url,{headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'tr-TR,tr;q=0.9'},signal:AbortSignal.timeout(30000)});
      const html=await res.text();
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows=parseCatalog(html,source);
      all.push(...rows);
      sourceStatus.push({...source,ok:true,http_status:res.status,response_ms:Date.now()-t0,parsed_count:rows.length,core_count:rows.filter(x=>x.is_core).length});
    }catch(e){
      sourceStatus.push({...source,ok:false,response_ms:Date.now()-t0,error:e?.message||String(e),parsed_count:0,core_count:0});
    }
  }
  cache={at:Date.now(),rows:all,sources:sourceStatus,error:sourceStatus.some(x=>!x.ok)?'One or more KKTCELL sources failed':null};
  return cache;
}

function competitorType(p){
  return p.source_slug==='faturasiz'?'prepaid':'postpaid';
}
function competitorSegment(p){
  const t=`${p.current_name||p.name||''} ${JSON.stringify(p.extras_json||[])}`.toLocaleLowerCase('tr-TR');
  if(/turist|tourist|ercan|havaalan|airport|e[- ]?sim/.test(t)) return 'Tourist / Airport';
  if(/mnp|numara taşı|taşıma/.test(t)) return 'MNP';
  if(/freezone|genç|young|öğrenci|student/.test(t)) return 'Youth / Student';
  if(/asker/.test(t)) return 'Military';
  if(/kamu/.test(t)) return 'Public Sector';
  if(/red|premium|platinum|vip/.test(t)) return 'Premium';
  if(/çocuk|kids/.test(t)) return 'Kids';
  if(/60\+|senior|yaş/.test(t)) return 'Senior';
  return competitorType(p)==='prepaid'?'Prepaid':'Postpaid';
}

function pctGap(ours,theirs){
  if(ours==null||theirs==null||Number(theirs)===0) return null;
  return ((Number(ours)-Number(theirs))/Number(theirs))*100;
}
function valueScore(p){
  const data=Number(p.effective_data_gb ?? ((Number(p.data_gb)||0)+(Number(p.bonus_data_gb)||0)));
  const price=Number(p.price_try);
  return data>0&&price>0?data/price*100:null;
}
function similarity(t,k){
  let s=0;
  const tt=competitorType(t), ts=competitorSegment(t);
  if(k.type===tt) s+=45; else return -999;
  if(k.segment===ts) s+=30;
  else if(['Prepaid','Postpaid'].includes(k.segment)&&['Prepaid','Postpaid'].includes(ts)) s+=12;
  const td=(Number(t.data_gb)||0)+(Number(t.bonus_data_gb)||0), kd=Number(k.effective_data_gb)||0;
  if(td>0&&kd>0){const ratio=Math.min(td,kd)/Math.max(td,kd);s+=ratio*18;}
  if(t.validity_days&&k.validity_days){const d=Math.abs(Number(t.validity_days)-Number(k.validity_days));s+=Math.max(0,10-d/3);}
  if(t.price_try&&k.price_try){const ratio=Math.min(Number(t.price_try),Number(k.price_try))/Math.max(Number(t.price_try),Number(k.price_try));s+=ratio*7;}
  return s;
}

export function buildBenchmark(telsimRows,kktcellRows){
  const ours=kktcellRows.filter(x=>x.is_core);
  const comp=telsimRows.filter(x=>x.active && x.price_try!=null && x.data_gb!=null);
  const matches=[];
  for(const t of comp){
    const ranked=ours.map(k=>({k,score:similarity(t,k)})).filter(x=>x.score>=45).sort((a,b)=>b.score-a.score);
    const best=ranked[0];
    if(!best) continue;
    const k=best.k;
    const tEff=(Number(t.data_gb)||0)+(Number(t.bonus_data_gb)||0);
    const kEff=Number(k.effective_data_gb)||0;
    const tValue=valueScore({...t,effective_data_gb:tEff});
    const kValue=valueScore(k);
    const priceGap=Number(k.price_try)-Number(t.price_try);
    const dataGap=kEff-tEff;
    const valueGap=(kValue!=null&&tValue!=null)?kValue-tValue:null;
    const position=valueGap==null?'UNKNOWN':valueGap>0.25?'KKTCELL_ADVANTAGE':valueGap<-0.25?'TELSIM_ADVANTAGE':'PARITY';
    matches.push({
      match_score:Math.round(best.score), segment:competitorSegment(t), type:competitorType(t), position,
      telsim:{id:t.id,name:t.name||t.current_name,data_gb:Number(t.data_gb)||0,bonus_data_gb:Number(t.bonus_data_gb)||0,effective_data_gb:tEff,minutes:t.local_tr_minutes,validity_days:t.validity_days,price_try:Number(t.price_try),gb_per_100tl:tValue},
      kktcell:{name:k.name,data_gb:k.data_gb,bonus_data_gb:k.bonus_data_gb,effective_data_gb:kEff,minutes:k.local_tr_minutes,validity_days:k.validity_days,price_try:k.price_try,gb_per_100tl:kValue,source_url:k.source_url},
      gaps:{price_try:priceGap,data_gb:dataGap,value_gb_per_100tl:valueGap,price_pct:pctGap(k.price_try,t.price_try),data_pct:pctGap(kEff,tEff)},
      recommendation:recommend(position,{priceGap,dataGap,valueGap,segment:competitorSegment(t),t,k})
    });
  }
  matches.sort((a,b)=>{
    const rank={TELSIM_ADVANTAGE:0,PARITY:1,KKTCELL_ADVANTAGE:2,UNKNOWN:3};
    return rank[a.position]-rank[b.position] || b.match_score-a.match_score;
  });
  const counts=matches.reduce((a,m)=>(a[m.position]=(a[m.position]||0)+1,a),{});
  return {generated_at:new Date().toISOString(),methodology:'Nearest commercial equivalent v1',counts,total_matches:matches.length,matches};
}

function recommend(position,x){
  if(position==='KKTCELL_ADVANTAGE') return 'Avantajı koru; fiyat indiriminden kaçın, değer üstünlüğünü dijital iletişim ve CRM ile görünür kıl.';
  if(position==='PARITY') return 'Fiyat savaşı yerine kanal bonusu, ek data veya servis faydası ile fark yarat.';
  if(position==='TELSIM_ADVANTAGE'){
    if(x.segment==='Tourist / Airport') return 'Turist/Ercan teklifinde fiyat yerine data, süre veya airport-only dijital bonus senaryosunu test et.';
    if(x.dataGap<0 && x.priceGap>=0) return 'Aynı/yüksek fiyata daha düşük data riski var; hedefli ek GB veya dijital bonusla cevap değerlendir.';
    if(x.priceGap>0) return 'KKTCELL fiyat primi var; premium gerekçeyi güçlendir veya yalnız riskli segmente kişiselleştirilmiş teklif test et.';
    return 'En yakın SKU için fayda/marj simülasyonu yap; genel fiyat indirimi yerine hedefli cevap tasarla.';
  }
  return 'Manuel ürün eşleştirmesi kontrolü gerekli.';
}
