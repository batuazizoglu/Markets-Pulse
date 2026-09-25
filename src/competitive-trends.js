import {competitiveWindow,loadCompetitiveChanges} from './competitive-changes.js';
import {marketPulseFromRows} from './intelligence.js';

const DAY_MS=86400000;
const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit'});
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const finite=value=>value==null||typeof value==='boolean'||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
const time=value=>value==null?NaN:+new Date(value);
const dateKey=value=>dayFormat.format(new Date(value));
const directionDefinitions=[
  ['added','Yeni paket'],['removed','Kaldırılan paket'],
  ['price_increase','Fiyat artışı'],['price_decrease','Fiyat indirimi'],
  ['data_increase','İnternet / bonus artışı'],['data_decrease','İnternet / bonus azalışı'],
  ['benefit_change','Fayda / koşul değişikliği'],['other_change','Diğer değişiklikler']
];

function periods(days,now){
  const current=competitiveWindow(days,now),previous=competitiveWindow(current.window_days,current.window_start);
  return {...current,previous_start:previous.window_start,previous_end:previous.window_end};
}

// These are calendar-date buckets intersecting a rolling interval, not an
// assumption that every local day is 24 hours or that every day was observed.
function periodCoverage(sources,scans,start,end,moves){
  const first=dateKey(start),last=dateKey(time(end)-1),days=[];
  for(let cursor=Date.parse(first+'T12:00:00Z');cursor<=Date.parse(last+'T12:00:00Z');cursor+=DAY_MS)days.push(new Date(cursor).toISOString().slice(0,10));
  const expected=new Set(sources.filter(source=>source.enabled!==false).map(source=>String(source.id)));
  const seen=new Map(days.map(day=>[day,new Set()]));
  for(const scan of scans){
    const at=time(scan.started_at),source=String(scan.source_id);
    if(scan.status!=='ok'||!expected.has(source)||!Number.isFinite(at)||at<time(start)||at>=time(end))continue;
    seen.get(dateKey(at))?.add(source);
  }
  const counts=new Map();
  for(const move of moves){const day=dateKey(move.detected_at);counts.set(day,(counts.get(day)||0)+1);}
  const activity=days.map(date=>{
    const count=seen.get(date).size,knownMoves=counts.get(date)||0,observed=count>0||knownMoves>0;
    return {date,move_count:observed?knownMoves:null,observed,partial:observed&&!(count>0&&count===expected.size),scan_observed:count>0,observed_change:knownMoves>0};
  });
  const observed_days=activity.filter(day=>day.scan_observed).length;
  const fully_observed_days=activity.filter(day=>day.scan_observed&&!day.partial).length;
  return {activity,coverage:{observed_days,expected_days:days.length,fully_observed_days,source_count:expected.size,complete:expected.size>0&&fully_observed_days===days.length}};
}

function pricePair(change){
  if(change.change_type!=='field_changed'||!/fiyat|price/i.test(change.field_name||''))return null;
  const before=finite(change.old_value),after=finite(change.new_value);
  return before>0&&after>0&&before!==after?{before,after,pct:(after-before)/before*100}:null;
}

function directionKeys(move){
  const keys=new Set();
  for(const change of move.changes){
    if(change.change_type==='added'||change.change_type==='removed'){keys.add(change.change_type);continue;}
    if(change.change_type!=='field_changed')continue;
    const field=String(change.field_name||'');
    const price=pricePair(change);
    if(price){keys.add(price.after>price.before?'price_increase':'price_decrease');continue;}
    if(/data|internet|gb/i.test(field)){
      const before=finite(change.old_value),after=finite(change.new_value);
      if(before!=null&&after!=null&&before>=0&&after>=0&&before!==after){keys.add(after>before?'data_increase':'data_decrease');continue;}
    }
    keys.add(/extras|fayda|koşul|data|internet|gb|dakika|minutes|sms|geçerlilik|validity|pasaport/i.test(field)?'benefit_change':'other_change');
  }
  return keys;
}

function priceSummary(moves){
  const pairs=moves.map(move=>move.changes.map(pricePair).find(Boolean)).filter(Boolean);
  const sorted=pairs.map(pair=>pair.pct).sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return {increases:pairs.filter(pair=>pair.after>pair.before).length,reductions:pairs.filter(pair=>pair.after<pair.before).length,
    median_change_pct:sorted.length?round(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null,sample_size:pairs.length};
}

function valueComparisons(products,start,end){
  const candidates=products.filter(product=>time(product.first_seen_at)<time(end)&&time(product.last_seen_at)>=time(start));
  const rows=[];let eligible_count=0,unchanged_count=0;
  for(const product of candidates){
    const fromPrice=finite(product.from_price_try),toPrice=finite(product.to_price_try),fromData=finite(product.from_data_gb),toData=finite(product.to_data_gb);
    const fromDuration=finite(product.from_validity_days),toDuration=finite(product.to_validity_days);
    if(product.id==null||product.active!==true||time(product.first_seen_at)>=time(start)||product.from_id==null||product.to_id==null||
      !(time(product.from_at)<time(start))||!(time(product.to_at)<time(end))||time(product.to_at)<time(product.from_at)||
      !(fromPrice>0&&toPrice>0&&fromDuration>0&&fromDuration===toDuration)||fromData==null||toData==null||fromData<0||toData<0)continue;
    const before=fromData/fromPrice*100,after=toData/toPrice*100;
    if(!Number.isFinite(before)||!Number.isFinite(after))continue;
    eligible_count++;
    const from_value=round(before),to_value=round(after);
    if(from_value===to_value){unchanged_count++;continue;}
    rows.push({product_id:product.id,name:product.to_name||product.current_name||'Paket',source_url:product.source_url,
      from_at:new Date(product.from_at).toISOString(),to_at:new Date(product.to_at).toISOString(),from_value,to_value,
      change_pct:before>0?round((after-before)/before*100):null,from_price:fromPrice,to_price:toPrice,validity_days:fromDuration});
  }
  rows.sort((a,b)=>Math.abs(b.to_value-b.from_value)-Math.abs(a.to_value-a.from_value)||String(a.product_id).localeCompare(String(b.product_id),'en',{numeric:true}));
  return {rows,eligible_count,excluded_count:candidates.length-eligible_count,unchanged_count,changed_count:rows.length};
}

function buildInsights(summary,coverage,price,values,segments){
  const insights=[];
  if(summary.move_count==null)insights.push({title:'Bu dönemde gözlem yok',body:'Yeni bir hareket olmadığı sonucuna varmak için yeterli gözlem bulunmuyor.',tone:'info'});
  else if(summary.change_pct!=null)insights.push({title:summary.change_pct===0?'Hareket sayısı aynı':summary.change_pct>0?'Rakip hareketleri arttı':'Rakip hareketleri azaldı',body:`Önceki eşit dönemde ${summary.previous_move_count}, bu dönemde ${summary.move_count} hamle gözlendi.`,tone:'info'});
  else insights.push({title:'Gözlenen rakip hareketleri',body:`Bu dönemde ${summary.move_count} hamle, ${summary.affected_packages} farklı paketi etkiledi.`,tone:'info'});
  if(price.sample_size)insights.push({title:'Fiyat hareketlerinin yönü',body:`${price.sample_size} fiyat hareketinde ${price.reductions} indirim ve ${price.increases} artış gözlendi.`,tone:'info'});
  if(values.changed_count)insights.push({title:'Paketlerin internet değeri değişti',body:`${values.eligible_count} karşılaştırılabilir paketten ${values.changed_count} tanesinde temel GB / 100 TL değişti. Bonus internet bu ölçüme dahil değildir.`,tone:'info'});
  else if(values.eligible_count)insights.push({title:'Karşılaştırılabilir paketlerde değer aynı',body:`${values.eligible_count} paketin temel GB / 100 TL değeri aynı kaldı. Eksik veya farklı süreli kayıtlar karşılaştırmaya dahil edilmedi.`,tone:'info'});
  if(summary.move_count!=null)insights.push({title:'Paket listesindeki hareket',body:`Dönem kayıtlarında paket listesine ${summary.added_count} ekleme ve ${summary.removed_count} kaldırma gözlendi.`,tone:'info'});
  const busiest=segments.find(segment=>segment.current>0);
  if(busiest&&summary.move_count>0)insights.push({title:'Hareketlerin yoğunlaştığı grup',body:`${busiest.name}: gözlenen ${summary.move_count} hamlenin ${busiest.current} tanesi (%${round(busiest.current/summary.move_count*100)}). Bu oran pazar payını göstermez.`,tone:'info'});
  return insights;
}

export function competitiveTrendsFromRows({changes=[],scans=[],sources=[],products=[],first_observed_at=null,last_observed_at=null}={}, {days=30,now=new Date()}={}){
  const window=periods(days,now);
  const current=marketPulseFromRows(changes,window.window_days,window.window_end),previous=marketPulseFromRows(changes,window.window_days,window.previous_end);
  const currentCoverage=periodCoverage(sources,scans,window.window_start,window.window_end,current.moves);
  const previousCoverage=periodCoverage(sources,scans,window.previous_start,window.previous_end,previous.moves);
  const currentKnown=currentCoverage.coverage.observed_days>0||current.moves.length>0,previousKnown=previousCoverage.coverage.observed_days>0||previous.moves.length>0;
  const coverage={current:currentCoverage.coverage,previous:previousCoverage.coverage,comparable:currentCoverage.coverage.complete&&previousCoverage.coverage.complete,
    first_observed_at:first_observed_at?new Date(first_observed_at).toISOString():null,last_observed_at:last_observed_at?new Date(last_observed_at).toISOString():null};
  const directionSets=current.moves.map(directionKeys);
  const directions=directionDefinitions.map(([key,label])=>({key,label,count:currentKnown?directionSets.filter(keys=>keys.has(key)).length:null}));
  const summary={move_count:currentKnown?current.moves.length:null,previous_move_count:previousKnown?previous.moves.length:null,
    affected_packages:currentKnown?new Set(current.moves.filter(move=>move.product_id!=null).map(move=>String(move.product_id))).size:null,
    added_count:currentKnown?directionSets.filter(keys=>keys.has('added')).length:null,removed_count:currentKnown?directionSets.filter(keys=>keys.has('removed')).length:null,
    priority_count:currentKnown?current.moves.filter(move=>move.decision==='THREAT').length:null,
    change_pct:coverage.comparable&&previous.moves.length>0?round((current.moves.length-previous.moves.length)/previous.moves.length*100):null};
  const segmentNames=[...new Set([...current.moves,...previous.moves].map(move=>move.segment))];
  const segments=segmentNames.map(name=>({name,current:currentKnown?current.moves.filter(move=>move.segment===name).length:null,
    previous:previousKnown?previous.moves.filter(move=>move.segment===name).length:null,
    priority_count:currentKnown?current.moves.filter(move=>move.segment===name&&move.decision==='THREAT').length:null}))
    .sort((a,b)=>(b.current||0)-(a.current||0)||(b.previous||0)-(a.previous||0)||a.name.localeCompare(b.name,'tr'));
  const price=priceSummary(current.moves),values=valueComparisons(products,window.window_start,window.window_end);
  return {generated_at:window.window_end,...window,coverage,summary,activity:currentCoverage.activity,directions,price,segments,values,
    insights:buildInsights(summary,coverage,price,values,segments)};
}

export async function buildCompetitiveTrends(pool,{days=30,now=new Date()}={}){
  const window=periods(days,now);
  const [changes,sources,scans,observations,products]=await Promise.all([
    loadCompetitiveChanges(pool,{start:window.previous_start,end:window.window_end}),
    pool.query('SELECT id,enabled FROM sources WHERE enabled=TRUE ORDER BY id'),
    pool.query(`SELECT source_id,MIN(started_at) started_at,'ok' status FROM scans
      WHERE status='ok' AND started_at >= $1::timestamptz AND started_at < $2::timestamptz
      GROUP BY source_id,(started_at AT TIME ZONE 'Asia/Famagusta')::date,started_at >= $3::timestamptz`,[window.previous_start,window.window_end,window.window_start]),
    pool.query("SELECT MIN(started_at) first_observed_at,MAX(started_at) last_observed_at FROM scans WHERE status='ok' AND started_at < $1::timestamptz",[window.window_end]),
    pool.query(`SELECT p.id,p.source_id,p.current_name,p.first_seen_at,p.last_seen_at,s.url source_url,
      (lifecycle.last_removed_at IS NULL OR GREATEST(p.first_seen_at,after.captured_at,lifecycle.last_present_at,
        CASE WHEN p.last_seen_at < $2::timestamptz THEN p.last_seen_at END)>lifecycle.last_removed_at) active,
      before.id from_id,before.captured_at from_at,before.name from_name,before.data_gb from_data_gb,before.price_try from_price_try,before.validity_days from_validity_days,
      after.id to_id,after.captured_at to_at,after.name to_name,after.data_gb to_data_gb,after.price_try to_price_try,after.validity_days to_validity_days
      FROM products p JOIN sources s ON s.id=p.source_id
      LEFT JOIN LATERAL (SELECT id,captured_at,name,data_gb,price_try,validity_days FROM product_versions WHERE product_id=p.id AND captured_at < $1::timestamptz ORDER BY captured_at DESC,id DESC LIMIT 1) before ON TRUE
      LEFT JOIN LATERAL (SELECT id,captured_at,name,data_gb,price_try,validity_days FROM product_versions WHERE product_id=p.id AND captured_at < $2::timestamptz ORDER BY captured_at DESC,id DESC LIMIT 1) after ON TRUE
      LEFT JOIN (SELECT product_id,
        MAX(detected_at) FILTER(WHERE change_type='removed') last_removed_at,
        MAX(detected_at) FILTER(WHERE change_type IN ('added','field_changed')) last_present_at
        FROM changes WHERE detected_at < $2::timestamptz GROUP BY product_id) lifecycle ON lifecycle.product_id=p.id
      WHERE p.first_seen_at < $2::timestamptz AND p.last_seen_at >= $1::timestamptz ORDER BY p.id`,[window.window_start,window.window_end])
  ]);
  return competitiveTrendsFromRows({changes,sources:sources.rows,scans:scans.rows,products:products.rows,...observations.rows[0]}, {days:window.window_days,now:window.window_end});
}
