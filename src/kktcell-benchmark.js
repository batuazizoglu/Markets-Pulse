import { ENGINE_VERSION, evaluateComparableProducts } from './comparable-engine.js';
import * as cheerio from 'cheerio';

const KKTCELL_SOURCES = [
  { slug:'kktcell-faturasiz', type:'prepaid', name:'KKTCELL Faturasız', url:'https://www.kktcell.com/faturasiz' },
  { slug:'kktcell-faturali', type:'postpaid', name:'KKTCELL Faturalı', url:'https://www.kktcell.com/faturali' },
  { slug:'kktcell-gnc', type:'postpaid', name:'KKTCELL GNÇ', url:'https://www.kktcell.com/gnc' },
  { slug:'kktcell-platinum', type:'postpaid', name:'KKTCELL Platinum', url:'https://www.kktcell.com/platinum' }
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
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

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
    const isAddon=/\bek\b|\b100\s*sms\b|\b1\.000\s*sms\b|\b10\.000\s*sms\b|tek numara|aşım|devir|favorim|türkiye \d+\s*dk|tv\+|dakika faturasız|platinum'a ek|gnç ek|gnc ek/i.test(lowName);
    const isClosed=/yeni abone alımına kapalı|abone alımına kapalı|sonlanmıştır|sona ermiştir/i.test(raw);
    const isCore=price!=null&&dataGb!=null&&!isAddon&&!isClosed;
    rows.push({provider:'KKTCELL',source_slug:source.slug,source_name:source.name,source_url:source.url,type:source.type,name,
      data_gb:dataGb,bonus_data_gb:bonusGb||0,effective_data_gb:(dataGb||0)+(bonusGb||0),local_tr_minutes:mins,
      international_minutes:null,sms,validity_days:validityDays,price_try:price,segment,acquisition,channel,is_core:isCore,is_closed:isClosed,raw_text:raw,product_url:card.href});
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
  const globalUnique=new Map();
  for(const r of all){const key=[r.type,r.name,r.data_gb,r.bonus_data_gb,r.price_try,r.validity_days].join('|');if(!globalUnique.has(key))globalUnique.set(key,r)}
  const rows=[...globalUnique.values()];
  cache={at:Date.now(),rows,sources:sourceStatus,error:sourceStatus.some(x=>!x.ok)?'One or more KKTCELL sources failed':null};
  return cache;
}

function pctGap(ours,theirs){if(ours==null||theirs==null||Number(theirs)===0)return null;return((Number(ours)-Number(theirs))/Number(theirs))*100}
function competitivePositionScore(rows,segment){
  if(!rows.length){
    return {segment,score:null,level:'VERİ YETERSİZ',confidence:'DÜŞÜK',match_count:0,positions:{},avg_value_gap_pct:null,avg_match_score:null,rationale:'Bu segmentte karşılaştırılabilir Telsim ↔ KKTCELL SKU eşleşmesi yok.'};
  }
  const positions=rows.reduce((a,m)=>(a[m.position]=(a[m.position]||0)+1,a),{});
  const ours=positions.KKTCELL_ADVANTAGE||0,theirs=positions.TELSIM_ADVANTAGE||0;
  const netPosition=(ours-theirs)/rows.length;
  const relativeValue=[];
  for(const m of rows){
    const tv=Number(m.telsim?.gb_per_100tl),kv=Number(m.kktcell?.gb_per_100tl);
    if(tv>0&&Number.isFinite(kv)) relativeValue.push(clamp(((kv-tv)/tv)*100,-60,60));
  }
  const avgValuePct=relativeValue.length?relativeValue.reduce((s,v)=>s+v,0)/relativeValue.length:0;
  const avgMatch=rows.reduce((s,m)=>s+(Number(m.match_score)||0),0)/rows.length;
  const positionComponent=netPosition*22;
  const valueComponent=(avgValuePct/60)*28;
  const score=Math.round(clamp(50+positionComponent+valueComponent,0,100));
  const level=score>=75?'GÜÇLÜ':score>=60?'AVANTAJLI':score>=45?'DENGELİ':score>=30?'BASKI ALTINDA':'KRİTİK';
  const confidence=rows.length>=5&&avgMatch>=85?'YÜKSEK':rows.length>=3&&avgMatch>=80?'ORTA':'DÜŞÜK';
  const parity=positions.PARITY||0;
  const gapText=`${avgValuePct>=0?'+':''}${avgValuePct.toFixed(1)}%`;
  const rationale=`${rows.length} eşleşme: ${ours} KKTCELL avantajı, ${theirs} Telsim avantajı, ${parity} parite. Ortalama relatif GB/100 TL farkı ${gapText}.`;
  return {segment,score,level,confidence,match_count:rows.length,positions,avg_value_gap_pct:Number(avgValuePct.toFixed(1)),avg_match_score:Number(avgMatch.toFixed(1)),rationale};
}

export function buildBenchmark(telsimRows,kktcellRows,overrides=[],{sources=[]}={}){
  const review=evaluateComparableProducts(telsimRows,kktcellRows,overrides);
  const matches=[],secondary_matches=[];
  const product=p=>({...p,data_gb:p.core_data_gb,effective_data_gb:p.core_data_gb+p.bonus_data_gb,
    gb_per_100tl:p.price_try>0?(p.core_data_gb+p.bonus_data_gb)/p.price_try*100:null});
  for(const row of review.rows){
    if(!['Primary','Secondary'].includes(row.effective_status)||!row.effective_match||row.override?.stale)continue;
    const t=product(row.telsim),k=product(row.effective_match),segment=t.segment;
    const priceGap=k.price_try-t.price_try,dataGap=k.effective_data_gb-t.effective_data_gb;
    const valueGap=k.gb_per_100tl!=null&&t.gb_per_100tl!=null?k.gb_per_100tl-t.gb_per_100tl:null;
    const position=valueGap==null?'UNKNOWN':valueGap>0.25?'KKTCELL_ADVANTAGE':valueGap<-.25?'TELSIM_ADVANTAGE':'PARITY';
    const match={match_score:row.effective_score,match_status:row.effective_status,match_origin:row.override?'admin':'engine',
      mutual_best:!row.override&&row.mutual_best,reasons:row.reasons,penalties:row.penalties,
      segment,type:t.type,acquisition:t.acquisition,channel:t.channel,position,telsim:t,kktcell:k,
      gaps:{price_try:priceGap,data_gb:dataGap,value_gb_per_100tl:valueGap,price_pct:pctGap(k.price_try,t.price_try),data_pct:pctGap(k.effective_data_gb,t.effective_data_gb)},
      recommendation:recommend(position,{priceGap,dataGap,segment})};
    (row.effective_status==='Primary'?matches:secondary_matches).push(match);
  }
  const rank={TELSIM_ADVANTAGE:0,PARITY:1,KKTCELL_ADVANTAGE:2,UNKNOWN:3};
  for(const rows of [matches,secondary_matches])rows.sort((a,b)=>rank[a.position]-rank[b.position]||b.match_score-a.match_score);
  const segments=[...new Set([...BENCHMARK_SEGMENTS,...review.rows.map(x=>x.telsim.segment)])];
  const scored=(rows,segment)=>{
    const result={...competitivePositionScore(rows,segment),engine_version:ENGINE_VERSION};
    if(rows.length)return result;
    const coverage=segment==='Toplam'?{
      telsim_core:review.catalog.telsim_core,kktcell_core:review.catalog.kktcell_core,
      statuses:review.effective_counts,stale_overrides:review.rows.filter(x=>x.override?.stale).length,
      rejected_overrides:review.rows.filter(x=>x.override?.decision==='reject').length,billing_types:['prepaid','postpaid']
    }:(review.segment_coverage[segment]||{telsim_core:0,kktcell_core:0,statuses:{},billing_types:[]});
    const prefix=`${coverage.telsim_core} Telsim / ${coverage.kktcell_core} KKTCELL ana tarifesi. `;
    const relevantSources=sources.filter(s=>
      segment==='Premium / Platinum'?['kktcell-platinum','kktcell-faturali'].includes(s.slug):
      segment==='Öğrenci / Genç'?['kktcell-gnc','kktcell-faturali'].includes(s.slug):
      !coverage.billing_types.length||coverage.billing_types.includes(s.type));
    const failed=relevantSources.filter(s=>!s.ok);
    let level,reason,code;
    if(failed.length){level='KAYNAK ERİŞİM SORUNU';code='source_error';reason='İlgili katalog kaynağına erişilemedi: '+failed.map(s=>s.name||s.slug).join(', ')+'.';}
    else if(!coverage.telsim_core){level='RAKİP TARİFESİ YOK';code='no_competitor';reason='İzlenen Telsim kataloğunda karşılaştırma koşullarını sağlayan ana tarife bulunamadı.';}
    else if(!coverage.kktcell_core){level='KARŞILIK BULUNAMADI';code='no_peer';reason='İzlenen KKTCELL kataloğunda aynı segmente uygun ana tarife bulunamadı; bu paketler rakip takibinde izlenmeye devam ediyor.';}
    else if(coverage.stale_overrides){level='KARAR GÜNCELLENMELİ';code='stale_override';reason=coverage.stale_overrides+' yönetici eşleşmesinin seçili ürünü artık uygun değil; yeniden inceleme gerekiyor.';}
    else if(coverage.statuses.Secondary){level='PRIMARY EŞLEŞME YOK';code='secondary_only';reason=coverage.statuses.Secondary+' Secondary alternatif var; skora katılan Primary eşleşme yok.';}
    else if(coverage.statuses.Review){level='EŞLEŞME İNCELENMELİ';code='review_required';reason=coverage.statuses.Review+' aday inceleme bekliyor; skora katılan Primary eşleşme yok.';}
    else {level='UYGUN EŞLEŞME YOK';code='no_approved_match';reason='Ürünler mevcut, fakat karşılaştırma kuralları veya kayıtlı yönetici kararları sonucunda Primary eşleşme oluşmadı.'+(coverage.rejected_overrides?' '+coverage.rejected_overrides+' eşleşme yönetici tarafından reddedilmiş.':'');}
    return {...result,level,availability:code,coverage,rationale:prefix+reason};
  };
  const counts=matches.reduce((a,m)=>(a[m.position]=(a[m.position]||0)+1,a),{});
  const segment_scores=segments.map(segment=>scored(matches.filter(m=>m.segment===segment),segment));
  const overall_score=scored(matches,'Toplam');
  const segment_summary=segment_scores.map(s=>({segment:s.segment,total:s.match_count,positions:s.positions,score:s.score,level:s.level,confidence:s.confidence}));
  return {generated_at:review.generated_at,engine_version:ENGINE_VERSION,mode:'live',
    methodology:'Comparable Product Engine v2.4 • ürün ailesi + uygunluk + karşılıklı en iyi eşleşme',
    score_methodology:'Skor ve avantaj adetleri yalnız Primary eşleşmelerden hesaplanır. Secondary alternatifleri skor dışındadır; Review, Reject ve geçersiz yönetici kararları karşılaştırmaya alınmaz. 50 nötr baz + net avantaj oranı (±22) + relatif GB/100 TL farkı (±28, ±60% sınır).',
    history_note:'Motor geçişinden önceki skorlar saklanır; yeni motorla birleştirilmez. Dönem değişimi için aynı motorun tarihçesi birikir.',
    segments,counts,total_matches:matches.length,overall_score,segment_scores,segment_summary,matches,secondary_matches,
    matching:{engine_counts:review.engine_counts,effective_counts:review.effective_counts,override_count:review.override_count,
      stale_override_count:review.rows.filter(x=>x.override?.stale).length,catalog:review.catalog,segment_coverage:review.segment_coverage}};
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

export function warmKktcellCatalog(){
  getKktcellCatalog(true).then(c=>console.log('[kktcell-catalog]',JSON.stringify({total:c.rows.length,core:c.rows.filter(x=>x.is_core).length,segments:BENCHMARK_SEGMENTS.map(segment=>({segment,count:c.rows.filter(x=>x.is_core&&x.segment===segment).length})),sources:c.sources.map(s=>({slug:s.slug,ok:s.ok,http_status:s.http_status,parsed_count:s.parsed_count,core_count:s.core_count,response_ms:s.response_ms,error:s.error||null}))}))).catch(e=>console.error('[kktcell-catalog]',e?.message||String(e)));
}
