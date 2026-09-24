import {competitiveWindow,loadCompetitiveChanges} from './competitive-changes.js';

const INTENT_LABELS = { Acquire:'Acquire', Steal:'Steal', Defend:'Defend', Upsell:'Upsell', 'Lock-in':'Lock-in', Expand:'Expand' };

function n(v){if(v==null||v==='')return null;const m=String(v).replace(',','.').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
function textOf(move){return [move.product_name,move.event_version_id?null:move.identity_base,move.source_name,...(move.changes||[]).flatMap(c=>[c.field_name,c.old_value,c.new_value]),move.extras_json?JSON.stringify(move.extras_json):''].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR')}

function detectSegment(move){
  const t=textOf(move);
  if(/turist|tourist|ercan|airport|havaalan|e[- ]?sim/.test(t))return 'Turist';
  if(/asker|askerfone|askere özel/.test(t))return 'Asker';
  if(/freezone|genç|young|öğrenci|student|gnç/.test(t))return 'Öğrenci / Genç';
  if(/super red|\bred\b|premium|platinum|vip/.test(t))return 'Premium / Platinum';
  return 'Genel';
}

function detectIntent(move,segment){
  const t=textOf(move);const fields=new Set((move.changes||[]).map(c=>c.field_name));
  const added=move.changes?.some(c=>c.change_type==='added');const removed=move.changes?.some(c=>c.change_type==='removed');
  if(/mnp|numara taşı|taşıma|port/.test(t))return 'Steal';
  if(/taahhüt|commitment|12 ay|24 ay|kontrat/.test(t))return 'Lock-in';
  if(removed)return 'Defend';
  const price=move.changes?.find(c=>/fiyat|price/i.test(c.field_name||''));const priceOld=n(price?.old_value),priceNew=n(price?.new_value);
  const benefitUp=move.changes?.some(c=>{const a=n(c.old_value),b=n(c.new_value);return a!=null&&b!=null&&b>a&&/data|bonus|dakika|sms|geçerlilik|validity/i.test(c.field_name||'')});
  if(priceOld!=null&&priceNew!=null&&priceNew>priceOld&&!benefitUp)return 'Upsell';
  if(added&&['Turist','Öğrenci / Genç','Asker'].includes(segment))return 'Acquire';
  if(added)return 'Expand';
  if(benefitUp||(priceOld!=null&&priceNew!=null&&priceNew<priceOld))return 'Defend';
  if(fields.has('Paket Adı'))return 'Expand';
  return 'Defend';
}

function scoreMove(move,segment,intent){
  let threat=0,opportunity=0;const reasons=[];const sev={critical:34,high:25,medium:15,low:8};
  const maxSeverity=move.changes?.reduce((best,c)=>(sev[c.severity]||0)>(sev[best]||0)?c.severity:best,'low')||'low';
  threat+=sev[maxSeverity]||8;reasons.push(`${maxSeverity.toUpperCase()} önem seviyesi`);
  for(const c of move.changes||[]){
    const a=n(c.old_value),b=n(c.new_value),field=String(c.field_name||'').toLocaleLowerCase('tr-TR');
    if(c.change_type==='added'){threat+=18;reasons.push('Yeni paket/SKU')}
    if(c.change_type==='removed'){opportunity+=42;threat-=12;reasons.push('Rakip paket kaldırıldı')}
    if(a!=null&&b!=null){
      if(/fiyat|price/.test(field)){if(b<a){threat+=24;reasons.push(`Fiyat düşüşü %${Math.abs(((b-a)/a)*100).toFixed(1)}`)}if(b>a){opportunity+=28;threat-=6;reasons.push(`Rakip fiyat artışı %${(((b-a)/a)*100).toFixed(1)}`)}}
      if(/data|bonus/.test(field)){if(b>a){threat+=20;reasons.push(`Data/fayda artışı %${a?(((b-a)/a)*100).toFixed(1):'—'}`)}if(b<a){opportunity+=22;reasons.push('Data/fayda azaltıldı')}}
      if(/dakika|sms/.test(field)){if(b>a){threat+=10;reasons.push('İletişim faydası arttı')}if(b<a){opportunity+=12;reasons.push('İletişim faydası azaldı')}}
      if(/geçerlilik|validity/.test(field)){if(b>a){threat+=9;reasons.push('Geçerlilik süresi arttı')}if(b<a){opportunity+=10;reasons.push('Geçerlilik süresi azaldı')}}
    }
  }
  const segWeight={'Turist':12,'Asker':10,'Öğrenci / Genç':10,'Premium / Platinum':7,'Genel':6}[segment]||4;
  threat+=segWeight;reasons.push(`${segment} segmenti`);
  const intentWeight={Steal:14,Acquire:11,Defend:7,Expand:8,'Lock-in':6,Upsell:3}[intent]||4;threat+=intentWeight;
  if(intent==='Steal')reasons.push('Doğrudan müşteri çalma sinyali');if(intent==='Acquire')reasons.push('Yeni müşteri edinim sinyali');
  threat=Math.max(0,Math.min(100,Math.round(threat)));opportunity=Math.max(0,Math.min(100,Math.round(opportunity)));
  const decision=opportunity>=45&&opportunity>threat?'OPPORTUNITY':threat>=40?'THREAT':'NO_REACTION';
  const action=recommend(move,{threat,opportunity,decision,segment,intent});
  return {threat,opportunity,decision,reasons:[...new Set(reasons)].slice(0,5),action};
}

function recommend(move,x){
  const fields=(move.changes||[]).map(c=>String(c.field_name||'').toLocaleLowerCase('tr-TR'));const hasPrice=fields.some(f=>/fiyat|price/.test(f)),hasData=fields.some(f=>/data|bonus/.test(f));
  if(x.decision==='OPPORTUNITY')return 'Rakibin zayıflayan değer teklifini iletişim ve hedefli CRM ile avantaja çevir; genel fiyat indirimi yapma.';
  if(x.decision==='NO_REACTION')return 'Şimdilik reaksiyon verme; hareketi izlemeye devam et ve müşteri etkisi oluşursa yeniden değerlendir.';
  if(x.threat>=75&&x.intent==='Steal')return 'MNP savunma journey’sini ve yüksek riskli müşteri havuzunu hemen kontrol et; hedefli karşı teklif hazırla.';
  if(x.threat>=75&&x.segment==='Turist')return 'Turist/Ercan teklifini aynı gün benchmark et; fiyat yerine data, süre veya kanal bonusu ile hızlı karşılık senaryosu test et.';
  if(x.segment==='Asker'&&x.threat>=65)return 'Asker segmentindeki rakip faydayı ve aktivasyon kolaylığını karşılaştır; hedefli avantaj senaryosu hazırla.';
  if(x.segment==='Öğrenci / Genç'&&x.threat>=65)return 'Öğrenci/genç segmentinde sosyal medya, dijital bonus ve kampüs edinim teklifini benchmark et.';
  if(x.segment==='Premium / Platinum'&&x.threat>=65)return 'Premium/Platinum değerini roaming, ayrıcalık ve servis faydalarıyla birlikte karşılaştır; sadece GB/fiyatla reaksiyon verme.';
  if(hasPrice&&hasData)return 'Fiyat savaşı başlatmadan önce en yakın KKTCELL SKU’sunda fayda artışı veya dijital bonus A/B testi yap.';
  if(hasData)return 'En yakın KKTCELL paketinde aynı fiyatı koruyarak data/bonus cevabının marj etkisini test et.';
  if(hasPrice)return 'Fiyat elastikiyetini ve hedef segment büyüklüğünü ölç; yalnız riskli kitleye kişiselleştirilmiş teklif düşün.';
  if(move.changes?.some(c=>c.change_type==='added'))return 'Yeni SKU’yu en yakın KKTCELL ürünüyle eşleştir; hedef segment, kanal ve değer farkını 24 saat içinde raporla.';
  return 'Hareketi izle; en yakın KKTCELL ürünü ve etkilenen segment ile eşleştirerek hedefli aksiyon hazırla.';
}

function newestFirst(a,b){return new Date(b.detected_at)-new Date(a.detected_at)||String(b.key??b.id).localeCompare(String(a.key??a.id),'en',{numeric:true})}
function groupRows(rows){
  const m=new Map();
  for(const r of rows){const key=`${r.scan_id}:${r.product_id??'change:'+r.id}`;if(!m.has(key))m.set(key,{key,scan_id:r.scan_id,product_id:r.product_id,detected_at:r.detected_at,source_slug:r.source_slug,source_name:r.source_name,source_url:r.source_url,product_name:r.product_name||r.new_value||r.old_value||'Paket',identity_base:r.identity_base,event_version_id:r.event_version_id,extras_json:r.extras_json,changes:[]});m.get(key).changes.push({id:r.id,change_type:r.change_type,field_name:r.field_name,old_value:r.old_value,new_value:r.new_value,severity:r.severity})}
  return [...m.values()].sort(newestFirst);
}
function distribution(moves,field){const counts={};for(const m of moves)counts[m[field]]=(counts[m[field]]||0)+1;const total=moves.length||1;return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count,pct:Math.round(count/total*100)}))}

export async function buildMarketPulse(pool,days=30,now=new Date()){
  const window=competitiveWindow(days,now);
  const rows=await loadCompetitiveChanges(pool,{start:window.window_start,end:window.window_end});
  return marketPulseFromRows(rows,window.window_days,window.window_end);
}

export function marketPulseFromRows(rows,days=30,now=new Date()){
  const window=competitiveWindow(days,now),start=+new Date(window.window_start),end=+new Date(window.window_end);
  const changes=rows.filter(row=>{const time=+new Date(row.detected_at);return time>=start&&time<end}).sort(newestFirst);
  const moves=groupRows(changes).map(move=>{const segment=detectSegment(move),intent=detectIntent(move,segment),score=scoreMove(move,segment,intent);return {...move,segment,intent:INTENT_LABELS[intent]||intent,...score}});
  const topThreats=[...moves].sort((a,b)=>b.threat-a.threat||newestFirst(a,b)).slice(0,8),opportunities=moves.filter(m=>m.decision==='OPPORTUNITY').sort((a,b)=>b.opportunity-a.opportunity||newestFirst(a,b)).slice(0,5),actionable=moves.filter(m=>m.decision==='THREAT');
  const top5=topThreats.slice(0,5),avgTop=top5.length?top5.reduce((s,m)=>s+m.threat,0)/top5.length:0,recent48=moves.filter(m=>new Date(now)-new Date(m.detected_at)>=0&&new Date(now)-new Date(m.detected_at)<=48*3600*1000).length;
  const pressure_index=Math.min(100,Math.round(avgTop*.78+Math.min(recent48,7)*3.1)),pressure_level=pressure_index>=75?'CRITICAL':pressure_index>=55?'HIGH':pressure_index>=30?'MEDIUM':'LOW';
  return {generated_at:window.window_end,...window,competitor:'KKTC Telsim',methodology:'Rule-based explainable scoring v2 • 5 segment',pressure_index,pressure_level,change_count:changes.length,changes,move_count:moves.length,threat_count:actionable.length,opportunity_count:moves.filter(m=>m.decision==='OPPORTUNITY').length,no_reaction_count:moves.filter(m=>m.decision==='NO_REACTION').length,intent_mix:distribution(moves,'intent'),segment_mix:distribution(moves,'segment'),top_threats:topThreats,opportunities,moves,executive_summary:buildExecutiveSummary(pressure_index,pressure_level,topThreats,opportunities,moves)};
}

function buildExecutiveSummary(index,level,threats,opportunities,moves){if(!moves.length)return 'İzleme penceresinde anlamlı rakip hareketi yok. Baseline veri birikmeye devam ediyor.';const top=threats[0],topIntent=distribution(moves,'intent')[0],topSegment=distribution(moves,'segment')[0],opp=opportunities[0];let s=`Rekabet baskısı ${index}/100 (${level}). Son hareketlerin ana niyeti ${topIntent?.name||'—'} ve en yoğun segment ${topSegment?.name||'—'}.`;if(top)s+=` En yüksek risk: ${top.product_name} (${top.threat}/100).`;if(opp)s+=` Aynı dönemde değerlendirilebilecek fırsat: ${opp.product_name}.`;return s}
