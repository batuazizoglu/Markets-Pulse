import {createHash} from 'node:crypto';
import {reportChangeProduct,reportChangeValue} from './report-change-value.js';

const HOUR=3600000;
const APP='https://www.marketspulse.cloud/';
const LABELS={gsm:'GSM',mnp:'MNP / Numara Taşıma',fixed:'Ev İnterneti',fwa:'Superbox / Red Box',ads:'Reklam Radarı'};
const clean=(value,max=500)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):typeof value==='number'&&Number.isFinite(value)?String(value):'';
const norm=value=>clean(value).toLocaleLowerCase('tr-TR');
const normFull=value=>clean(value,Infinity).toLocaleLowerCase('tr-TR');
const list=value=>Array.isArray(value)?value:[];
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):null;
const number=value=>numeric(value)===null?'—':numeric(value).toLocaleString('tr-TR',{maximumFractionDigits:2});
const money=value=>number(value)+' TL';
const time=value=>value instanceof Date?value.getTime():typeof value==='string'&&value.trim()?Date.parse(value):NaN;
const iso=value=>Number.isFinite(time(value))?new Date(time(value)).toISOString():null;
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,20);
const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}};
const owned=value=>/^(?:kktcell|kuzey kıbrıs turkcell|turkcell(?: ev interneti)?|lifecell(?: digital)?|superbox|gnç kıbrıs)$/.test(norm(value));
const brandKey=value=>{const s=norm(value);return /^(?:kktcell|kuzey kıbrıs turkcell|turkcell)$/.test(s)?'turkcell':/^(?:telsim|kktc telsim)$/.test(s)?'telsim':s};
const fresh=(at,start,end)=>Number.isFinite(time(at))&&time(at)>=start&&time(at)<=end;
const latest=values=>values.map(iso).filter(Boolean).sort().at(-1)||null;
const labelFor=domain=>LABELS[domain]||'Reklam';
const linkFor=domain=>APP+(domain==='fixed'||domain==='fwa'?'#home':domain==='ads'?'#ads':'#competitor');

function fieldKind(change){
  const key=norm(change.field_key||change.field_name);
  if(/price|fiyat|ücret/.test(key)&&!/status|durum/.test(key))return 'price';
  if(/speed|hız/.test(key))return 'speed';
  if(/duration|validity|taahhüt|geçerlilik|ödeme süresi|commitment|contract/.test(key))return 'term';
  if(/data|bonus|kota|limitsiz|unlimited|hediye|dakika|minutes|sms/.test(key))return 'benefit';
  if(/campaign|kampanya|availability|expires/.test(key))return 'campaign';
  return 'terms';
}

function displayChange(row){
  const kind=fieldKind(row),unit=kind==='price'?' TL':kind==='speed'?' Mbps':/data|kota/.test(norm(row.field_key||row.field_name))?' GB':null;
  const format=value=>unit&&numeric(value)!==null?number(value)+unit:clean(reportChangeValue(value),600)||'—';
  return {label:clean(row.field_name)||({added:'Yeni paket',removed:'Kaldırılan paket'}[row.change_type]||'Koşullar'),before:format(row.old_value),after:format(row.new_value)};
}

function detectDomain(row,fallback='gsm'){
  if(row.product_family==='fwa')return 'fwa';
  if(row.product_family==='fixed')return 'fixed';
  if(fallback==='fixed'||fallback==='fwa')return fallback;
  const text=[row.segment,row.product_name,row.acquisition,JSON.stringify(row.product_after||{}),JSON.stringify(row.extras_json||{})]
    .join(' ').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
  return /\bmnp\b|\bnumara(?:ni|nizi|mi|mizi|sini|si)?\s+tasi/.test(text)?'mnp':fallback;
}

function unchangedPrice(rows){
  const snapshot=rows.find(row=>row.product_before&&row.product_after);
  if(!snapshot)return false;
  const before=snapshot.product_before,after=snapshot.product_after;
  const keys=['price_try','price_monthly_try','effective_monthly_try','total_price_try','price_total_try'];
  const known=keys.filter(key=>numeric(before[key])!==null&&numeric(after[key])!==null);
  return known.length>0&&known.every(key=>numeric(before[key])===numeric(after[key]))&&
    !rows.some(row=>fieldKind(row)==='price'&&numeric(row.old_value)!==numeric(row.new_value));
}

function groupChanges(rows,fallback,start,end){
  const groups=new Map(),seen=new Set();
  for(const row of rows){
    if(!fresh(row.detected_at,start,end-1))continue;
    const title=reportChangeProduct(row),domain=detectDomain(row,fallback);
    const identity=row.product_id??row.product_key??[row.source_slug,title].join('|');
    const scan=row.scan_id??iso(row.detected_at);
    const key=[domain,scan,identity].join(':');
    const eventKey=JSON.stringify([key,row.id??null,row.change_type,row.field_key||row.field_name,row.old_value,row.new_value]);
    if(seen.has(eventKey))continue;seen.add(eventKey);
    if(!groups.has(key))groups.set(key,{key,domain,title,rows:[]});
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group=>{
    const rows=group.rows,row=rows[0],kinds=new Set(rows.map(fieldKind)),isOwned=owned(row.brand||row.provider||row.source_name);
    const kind=rows.some(x=>x.change_type==='removed')?'removed':rows.some(x=>x.change_type==='added')?'added':'changed';
    const flags=[];
    if(kind==='changed'&&(kinds.has('benefit')||kinds.has('speed'))&&unchangedPrice(rows))flags.push('Fiyat aynı, teklif değişti');
    if(kind==='changed'&&kinds.has('term')&&unchangedPrice(rows))flags.push('Fiyat aynı, süre / taahhüt değişti');
    if(kind==='removed')flags.push('Kaldırılan paket');
    if(kind==='added')flags.push('Yeni paket');
    const priority=Math.max(...rows.map(x=>({critical:90,high:70,medium:45,low:20}[x.severity]||30)))+(group.domain==='mnp'?8:0)+(flags.some(x=>x.startsWith('Fiyat aynı'))?8:0)+(kind==='added'?5:0);
    if(kind==='changed'&&priority>=70&&rows.some(x=>fresh(x.first_seen_at,0,start-1)||fresh(x.product_before?.verified_at,0,start-1)))flags.push('Devam eden konuda yeni gelişme');
    let why=kind==='added'?'Yeni teklif, müşterinin seçebileceği paketleri değiştiriyor.':kind==='removed'?'Bu teklif güncel katalogdan kaldırılmış; satış iletişimindeki geçerliliği kontrol edilmeli.':kinds.has('price')?'Paketin fiyatı değişti; aynı fayda ve süreyle ödenen tutarı yeniden değerlendirmek gerekiyor.':kinds.has('benefit')||kinds.has('speed')?'Müşteriye sunulan fayda değişti; mevcut karşılaştırma ve iletişim yeniden değerlendirilmeli.':'Paketin kullanım veya satın alma koşulları değişti.';
    let action=group.domain==='mnp'?'Numara taşıma sayfası ve ilgili dijital iletişimde mevcut avantajlarımızı bu teklifin koşullarıyla karşılaştırın.':group.domain==='fixed'||group.domain==='fwa'?'Aynı hız, kota ve taahhüt koşullarını karşılaştırın; ev interneti teklif ve iletişimini gözden geçirin.':'İlgili paket sayfasını ve hedef kitle iletişimini güncel teklifle karşılaştırın.';
    if(kind==='removed')action='Paketin kaynak sayfasını doğrulayın; geçersizleşen teklif bağlantılarını ve karşılaştırmaları güncelleyin.';
    if(isOwned){why='Kendi teklifimizdeki değişiklik müşteri iletişimine doğru yansıtılmalı.';action='Web, uygulama ve dijital iletişimde paket bilgilerinin aynı olduğundan emin olun.';flags.push('Kendi markamız')}
    return {id:'move-'+hash(group.key),domain:group.domain,label:labelFor(group.domain),title:clean(group.title,180),brand:clean(row.brand||row.provider||(group.domain==='gsm'||group.domain==='mnp'?'Telsim':row.source_name),120),at:latest(rows.map(x=>x.detected_at)),priority,kind,changes:rows.slice(0,6).map(displayChange),omitted_change_count:Math.max(0,rows.length-6),why,action,flags,owned:isOwned,source_url:safeUrl(row.product_url||row.source_url),detail_url:linkFor(group.domain),_rows:rows};
  });
}

function comparisonResult(ours,theirs,terms,period_label){
  const price=numeric(ours.price_try??ours.effective_monthly_try),competitorPrice=numeric(theirs.price_try??theirs.effective_monthly_try);
  if(price===null||competitorPrice===null||price<0||competitorPrice<0)return null;
  return {title:clean(ours.name,180),brand:'Kuzey Kıbrıs Turkcell',price,competitor_price:competitorPrice,difference:Math.round((price-competitorPrice)*100)/100,terms,period_label,source_url:safeUrl(ours.product_url||ours.source_url)};
}

function comparisonFor(move,ctx,start,end){
  if(move.owned||move.kind==='removed')return null;
  if(move.domain==='gsm'||move.domain==='mnp'){
    const benchmark=ctx.benchmark||{};
    if(benchmark.kktcell_error||list(benchmark.kktcell_sources).some(x=>x.ok===false)||!fresh(benchmark.generated_at,start,end+5*60000))return null;
    const id=move._rows[0].product_id;
    if(id==null)return null;
    const matches=list(benchmark.matches).filter(match=>match.match_status==='Primary'&&String(match.telsim?.id)===String(id)&&(match.match_origin==='admin'||numeric(match.match_score)>=85));
    if(matches.length!==1)return null;
    const {kktcell:ours,telsim:theirs}=matches[0];
    const a=numeric(ours.validity_days),b=numeric(theirs.validity_days),oursData=numeric(ours.data_gb??ours.core_data_gb),theirsData=numeric(theirs.data_gb??theirs.core_data_gb);
    if(a===null||b===null||a!==b||oursData===null||theirsData===null)return null;
    return comparisonResult(ours,theirs,`${number(a)} gün; Turkcell ${number(oursData)} GB / rakip ${number(theirsData)} GB. Ana internet kotasıdır; ek fayda ve müşteri koşulları ayrıca değerlendirilmelidir.`,`${number(a)} günlük paket bedeli`);
  }
  const family=ctx.daily_home?.[move.domain]||{};
  const id=move._rows[0].product_key;
  let pairs=list(family.opportunities).filter(x=>id&&x.competitor?.product_key===id);
  if(move.domain==='fwa'){
    const theirs=list(family.products).find(x=>id&&x.product_key===id);
    if(theirs)pairs=list(family.comparison?.superbox).map(kktcell=>({kktcell,competitor:theirs}));
  }
  const comparable=pairs.filter(({kktcell:a,competitor:b})=>a&&b&&!a.stale&&!b.stale&&fresh(a.verified_at,start,end)&&fresh(b.verified_at,start,end)&&a.technology&&a.technology===b.technology&&typeof a.unlimited==='boolean'&&a.unlimited===b.unlimited&&(a.unlimited||numeric(a.data_limit_gb)!==null&&numeric(a.data_limit_gb)===numeric(b.data_limit_gb))&&((numeric(a.duration_months)!==null&&numeric(a.duration_months)===numeric(b.duration_months))||(numeric(a.duration_days)!==null&&numeric(a.duration_days)===numeric(b.duration_days))));
  if(comparable.length!==1)return null;
  const {kktcell:a,competitor:b}=comparable[0];
  const quota=a.unlimited?'sınırsız':number(a.data_limit_gb)+' GB';
  const speed=numeric(a.speed_down_mbps)!==null&&numeric(b.speed_down_mbps)!==null?`; Turkcell ${number(a.speed_down_mbps)} / rakip ${number(b.speed_down_mbps)} Mbps`:'';
  return comparisonResult(a,b,`${clean(a.technology)}, ${quota}, ${numeric(a.duration_months)!==null?number(a.duration_months)+' ay':number(a.duration_days)+' gün'}${speed}. Efektif aylık bedel; kurulum ve ek koşullar kaynakta.`,'Efektif aylık bedel');
}

function coverageFor(ctx,start,end){
  const groups=[['gsm',list(ctx.sources).filter(x=>x.enabled!==false)],['fixed',list(ctx.daily_home?.fixed?.sources).filter(x=>x.enabled!==false)],['fwa',list(ctx.daily_home?.fwa?.sources).filter(x=>x.enabled!==false)]];
  const ad=ctx.ad_report_data||{};
  groups.push(['ads',list(ad.coverage).length?ad.coverage:[{status:ad.status,checked_at:ad.checked_at,last_error:ad.last_error}]]);
  const domains=groups.map(([domain,rows])=>{
    let checked=0,failed=0;
    const stamps=[];
    for(const row of rows){
      const status=domain==='gsm'?row.last_status||row.status:row.status||row.last_status;
      const at=row.last_checked_at||row.checked_at||row.captured_at;
      const recent=fresh(at,start,end);
      if(recent&&['ok','success','no_ads'].includes(status)&&!row.last_error&&!row.error&&!row.stale)checked++;
      else failed++;
      if(recent)stamps.push(at);
    }
    let state=!rows.length?'unknown':failed?'partial':'complete';
    const adPartial=domain==='ads'&&(ad.last_error||!['ok','no_ads'].includes(ad.status));
    if(adPartial)state='partial';
    const label=labelFor(domain),message=state==='complete'?`${label}: ${checked} kaynak dönem içinde kontrol edildi.`:adPartial?`${label}: güncel kontrol yalnız kısmen tamamlandı; reklam yok sonucuna varılamaz.`:rows.length?`${label}: ${rows.length-checked} kaynakta güncel kontrol tamamlanamadı; değişiklik yok sonucuna varılamaz.`:`${label}: güncel kaynak kontrolü doğrulanamadı.`;
    return {domain,label,state,checked,total:rows.length,failed,checked_at:latest(stamps),message};
  });
  const total=domains.reduce((n,x)=>n+x.total,0),checked=domains.reduce((n,x)=>n+x.checked,0),failed=domains.reduce((n,x)=>n+x.failed,0);
  const state=domains.every(x=>x.state==='complete')?'complete':checked?'partial':'unknown';
  return {state,total,checked,failed,domains,message:state==='complete'?'İzlenen kaynakların güncel kontrolleri tamamlandı.':'Bazı kaynakların güncel kontrolü tamamlanamadı. Bulgular yalnız doğrulanan kapsamı gösterir.'};
}

function catalogFor(ctx){
  const home=['fixed','fwa'].flatMap(domain=>list(ctx.daily_home?.[domain]?.products).map(x=>({...x,domain})));
  // Only explicit catalogue rows with their own verification timestamp can
  // establish an ad/catalog discrepancy; benchmark generation isn't a scrape.
  const snapshots=new Map();
  const dailyRows=Array.isArray(ctx.daily_changes)?ctx.daily_changes:list(ctx.changes);
  for(const row of [...dailyRows].sort((a,b)=>time(b.detected_at)-time(a.detected_at))){
    if(!row.product_after||row.change_type==='removed'||row.product_id==null||snapshots.has(String(row.product_id)))continue;
    snapshots.set(String(row.product_id),{...row.product_after,id:row.product_id,product_id:row.product_id,brand:row.brand||'Telsim',source_url:row.source_url,verified_at:row.detected_at,domain:detectDomain(row)});
  }
  for(const product of list(ctx.catalog_products)){
    const id=product.product_id??product.id??[product.brand||product.provider,product.name||product.current_name].join('|');
    snapshots.set(String(id),{...product,domain:detectDomain(product)});
  }
  const mobile=[...snapshots.values()];
  return [...home,...mobile];
}

function explicitCommitment(product){
  const values=[product.contract_months,product.commitment_months].map(numeric).filter(x=>x!==null&&Number.isInteger(x)&&x>=0&&x<=120);
  if(product.contract_required===false)values.push(0);
  const text=[product.campaign_text,product.contract,...list(product.features),...list(product.extras_json),...list(product.conditions)]
    .map(x=>clean(x,Infinity)).filter(Boolean).join(' ').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
  if(/\btaahhutsuz\b/.test(text))values.push(0);
  for(const match of text.matchAll(/\b(\d{1,2})\s*ay(?:lik)?\s*taahhut(?:lu)?\b/g)){
    const after=text.slice(match.index+match[0].length,match.index+match[0].length+45).split(/[.;]/)[0];
    // A negated duration is not proof of either that term or no commitment.
    if(/yok|degil|gerekm|bulunm|olmadan|istenm|istemiyor/.test(after))continue;
    values.push(Number(match[1]));
  }
  const unique=[...new Set(values)];
  return unique.length===1?unique[0]:null;
}

function mismatchFor(ad,catalog,start,end){
  if(list(ad.uncertainties).length)return null;
  const offer=ad.offer||{},adAt=ad.observed_at;
  const candidates=catalog.filter(p=>!p.stale&&p.active!==false&&p.availability!=='expired'&&normFull(p.name||p.current_name)===normFull(ad.title)&&brandKey(p.brand||p.provider)===brandKey(ad.brand)&&fresh(p.verified_at,start,end)&&Math.abs(time(p.verified_at)-time(adAt))<=26*HOUR);
  if(candidates.length!==1)return null;
  const p=candidates[0],commitment=numeric(offer.commitment_months),catalogCommitment=explicitCommitment(p);
  if(commitment===null||catalogCommitment===null||commitment!==catalogCommitment)return null;
  if(offer.billing_period!=='monthly'||!(numeric(p.price_monthly_try)!==null||numeric(p.validity_days)===30))return null;
  const fields=[];
  const values=[['Fiyat',offer.price_try,p.price_monthly_try??p.price_try,' TL / ay'],['İnternet',offer.data_gb,p.data_limit_gb??p.data_gb,' GB'],['Hız',offer.speed_mbps,p.speed_down_mbps,' Mbps']];
  for(const [label,a,b,unit]of values)if(numeric(a)!==null&&numeric(b)!==null&&numeric(a)!==numeric(b))fields.push({label,ad_value:number(a)+unit,catalog_value:number(b)+unit});
  const adUrl=safeUrl(ad.source_url),catalogUrl=safeUrl(p.product_url||p.source_url);
  return fields.length&&adUrl&&catalogUrl?{title:'Reklam ile paket sayfasında teklif farkı',fields,ad_url:adUrl,catalog_url:catalogUrl,ad_at:iso(adAt),catalog_at:iso(p.verified_at),note:'Aynı marka, paket adı, fiyat dönemi ve taahhüt süresi eşleşti. Diğer müşteri koşullarını kaynaklardan teyit edin.'}:null;
}

function offerDisplay(offer={}){
  const parts=[];
  if(numeric(offer.price_try)!==null)parts.push(money(offer.price_try)+(offer.billing_period==='monthly'?' / ay':offer.billing_period==='one_time'?' tek seferlik':' (fiyat dönemi belirsiz)'));
  if(numeric(offer.data_gb)!==null)parts.push(number(offer.data_gb)+' GB');
  if(numeric(offer.bonus_data_gb)!==null&&numeric(offer.bonus_data_gb)>0)parts.push('+'+number(offer.bonus_data_gb)+' GB hediye');
  if(numeric(offer.speed_mbps)!==null)parts.push(number(offer.speed_mbps)+' Mbps');
  if(numeric(offer.commitment_months)!==null)parts.push(number(offer.commitment_months)+' ay taahhüt');
  return parts.join(' · ');
}

function periodAdRows(ctx,start,end){
  const seen=new Set(),rows=[];
  for(const row of [...list(ctx.ad_report_data?.rows)].sort((a,b)=>time(b.observed_at)-time(a.observed_at))){
    if(!['first_seen','changed'].includes(row.event_type)||!fresh(row.observed_at,start,end-1))continue;
    const ad=row.analysis_json||{},identity=[ad.page_id,ad.ad_id,ad.variant_id||'1'].join(':');
    if(!ad.ad_id||seen.has(identity))continue;
    seen.add(identity);rows.push(row);
  }
  return rows;
}

function adItems(ctx,start,end){
  const catalog=catalogFor(ctx),byCampaign=new Map();
  for(const row of periodAdRows(ctx,start,end)){
    const ad=row.analysis_json||{};
    if(ad.category==='review'||ad.review_required===true)continue;
    if(ad.ad_status==='inactive')continue;
    const title=clean(ad.title,180),brand=clean(ad.brand,120);
    if(!title||!brand)continue;
    const isOwned=owned(brand),domain=ad.category==='home'?/superbox|red\s*box/i.test(title+' '+brand)?'fwa':'fixed':['gsm','mnp'].includes(ad.category)?ad.category:'ads';
    const offer=ad.offer||{},conditions=list(ad.conditions).map(x=>clean(x,Infinity)).filter(Boolean),uncertainties=list(ad.uncertainties).map(x=>clean(x,Infinity)).filter(Boolean);
    const key=JSON.stringify([brandKey(brand),normFull(ad.title),ad.category,['price_try','billing_period','data_gb','bonus_data_gb','minutes','speed_mbps','commitment_months'].map(k=>offer[k]??null),conditions.map(normFull).sort(),uncertainties.map(normFull).sort()]);
    const image=row.report_image||{},sha=image.sha256;
    const imageUrl=['creative','browser_creative'].includes(image.selection)&&/^[a-f0-9]{64}$/.test(sha||'')?APP+'report-media/'+sha+'.jpg':null;
    if(byCampaign.has(key)){
      const old=byCampaign.get(key);old.variant_count++;if(!old.image_url&&imageUrl)old.image_url=imageUrl;
      continue;
    }
    const flags=[row.event_type==='changed'?'Reklam teklifi / durumu güncellendi':'İlk kez görülen reklam'];
    if(isOwned)flags.push('Kendi markamız');
    if(uncertainties.length)flags.push('Bazı koşullar teyit bekliyor');
    const mismatch=mismatchFor({...ad,observed_at:row.observed_at},catalog,start,end);
    if(mismatch)flags.push('Reklam–paket farkı');
    byCampaign.set(key,{id:'ad-'+hash(key),title,brand,domain,label:ad.category_label||labelFor(domain),at:iso(row.observed_at),image_url:imageUrl,source_url:safeUrl(ad.source_url),detail_url:APP+'#ads',why:isOwned?'Kendi markamızın güncel iletişimi.':row.event_type==='changed'?'Reklam teklifi veya yayın durumu önceki kayda göre güncellendi.':'Bu kampanya rapor döneminde ilk kez kaydedildi.',action:mismatch?'Reklam ve paket sayfasındaki farkı müşteri koşullarıyla birlikte doğrulayın.':isOwned?'Reklam mesajının güncel paket koşullarıyla uyumunu kontrol edin.':uncertainties.length?'Belirsiz koşulları kaynak üzerinden teyit ettikten sonra iletişim etkisini değerlendirin.':'Ana vaadi ve hedef kitleyi kendi güncel iletişimimizle karşılaştırın.',flags,offer:offerDisplay(offer),conditions,summary:clean(ad.visual_summary,500),uncertainties,owned:isOwned,variant_count:1,kind:row.event_type,mismatch,priority:(mismatch?85:domain==='mnp'?65:45)+(row.event_type==='changed'?5:0)-(uncertainties.length?20:0)});
  }
  return [...byCampaign.values()].sort(rank);
}

function localDateEnd(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return time(value);
  const noon=Date.parse(value+'T12:00:00Z');
  if(!Number.isFinite(noon)||new Date(noon).toISOString().slice(0,10)!==value)return NaN;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Famagusta',hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(noon));
  const hour=Number(parts.find(x=>x.type==='hour')?.value),minute=Number(parts.find(x=>x.type==='minute')?.value);
  return Date.parse(value+'T23:59:59.999Z')-((hour-12)*60+minute)*60000;
}

function expiringItems(ctx,start,end){
  const seen=new Set(),out=[];
  for(const domain of ['fixed','fwa'])for(const p of [...list(ctx.daily_home?.[domain]?.products),...list(ctx.daily_home?.[domain]?.campaigns)]){
    const expires=localDateEnd(p.expires_at),id=p.product_key||[p.provider,p.name,p.expires_at].join('|'),source=safeUrl(p.product_url||p.source_url);
    if(seen.has(id)||p.stale||!fresh(p.verified_at,start,end)||p.availability==='expired'||p.availability==='unconfirmed'||!source||!Number.isFinite(expires)||expires<=end||expires>end+72*HOUR)continue;
    seen.add(id);out.push({id:'expiry-'+hash(id),title:clean(p.name,180),brand:clean(p.brand||p.provider,120),domain,expires_at:new Date(expires).toISOString(),date_only:/^\d{4}-\d{2}-\d{2}$/.test(p.expires_at),hours_remaining:Math.ceil((expires-end)/HOUR),source_url:source});
  }
  return out.sort((a,b)=>time(a.expires_at)-time(b.expires_at)||a.id.localeCompare(b.id)).slice(0,5);
}

function rank(a,b){return Number(a.owned)-Number(b.owned)||b.priority-a.priority||time(b.at)-time(a.at)||a.id.localeCompare(b.id)}

/** A pure, evidence-gated editorial model. No scans, AI calls or email sends. */
export function buildDailyBrief(ctx={}){
  const end=time(ctx.period_end),start=time(ctx.period_start);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new TypeError('Daily brief requires a valid report period');
  const mobile=Array.isArray(ctx.daily_changes)?ctx.daily_changes:Array.isArray(ctx.changes)?ctx.changes:list(ctx.market?.moves).flatMap(move=>list(move.changes).map(change=>({...move,...change})));
  const moves=[...groupChanges(mobile,'gsm',start,end),...groupChanges(list(ctx.daily_home?.fixed?.changes),'fixed',start,end),...groupChanges(list(ctx.daily_home?.fwa?.changes),'fwa',start,end)];
  for(const move of moves){
    const comparison=comparisonFor(move,ctx,start,end);
    if(comparison)move.comparison=comparison;
    else if(!move.owned&&move.kind!=='removed')move.comparison_note='Aynı koşullarda doğrulanmış Turkcell karşılığı bulunamadı; fiyat farkı hesaplanmadı.';
  }
  const adsAll=adItems(ctx,start,end),ads=adsAll.slice(0,3),coverage=coverageFor(ctx,start,end),expiring=expiringItems(ctx,start,end);
  const adHighlights=adsAll.map(ad=>({...ad,domain:ad.domain,label:labelFor(ad.domain)+' · Reklam',changes:[{label:'Reklam teklifi',before:'—',after:ad.offer||ad.summary}],kind:'ad'}));
  const highlights=[...moves,...adHighlights].sort(rank).slice(0,3).map(({_rows,...item})=>item);
  const observations=periodAdRows(ctx,start,end),statusUpdates=observations.filter(x=>x.analysis_json?.ad_status==='inactive').length;
  const unverified=observations.filter(x=>x.analysis_json?.ad_status!=='inactive'&&(x.analysis_json?.category==='review'||x.analysis_json?.review_required===true||!clean(x.analysis_json?.title)||!clean(x.analysis_json?.brand))).length;
  const quiet=!moves.length&&!observations.length&&!expiring.length&&coverage.state==='complete';
  const counts={moves:moves.length,fields:moves.reduce((sum,item)=>sum+item._rows.length,0),ads:adsAll.length,observed_ads:observations.length,unverified_ads:unverified,status_updates:statusUpdates,expiring:expiring.length};
  const headline=highlights.length?`${highlights[0].brand}: ${highlights[0].title}`:expiring.length?`${expiring.length} kampanyanın bitişi yaklaşıyor`:unverified?'Yeni reklam kaydı var; teklif koşulları henüz doğrulanamadı':statusUpdates?'Reklam yayın durumunda güncelleme var':quiet?'Bugün yeni paket veya reklam değişikliği yok':'Güncel kontrol kapsamı tamamlanamadı';
  let summary=highlights.length?`${counts.moves} paket hamlesi (${counts.fields} alan değişikliği) ve ${counts.ads} yeni veya güncellenen reklam kampanyası kaydedildi.`:expiring.length?`Önümüzdeki 72 saatte ${expiring.length} doğrulanmış kampanya bitişi var. Yeni doğrulanmış paket veya reklam teklifi kaydedilmedi.`:unverified?`${unverified} reklam kaydının teklif koşulları henüz doğrulanamadı; bu kayıtlar doğrulanmış teklif olarak özetlenmedi.`:statusUpdates?`${statusUpdates} reklam artık aktif görünmüyor. Yeni doğrulanmış teklif kaydedilmedi.`:quiet?'İzlenen kaynaklarda bu döneme ait yeni paket değişikliği veya reklam teklifi kaydedilmedi.':'Güncel kayıtlarda yeni gelişme yok; eksik kaynak kontrolleri nedeniyle piyasanın değişmediği sonucuna varılamaz.';
  if((highlights.length||expiring.length)&&unverified)summary+=` Ayrıca ${unverified} reklam kaydının teklif koşulları henüz doğrulanamadı.`;
  if((highlights.length||expiring.length||unverified)&&statusUpdates)summary+=` ${statusUpdates} reklam artık aktif görünmüyor.`;
  // Never carry yesterday's important finding forward without a fresh event.
  const featured=new Set(highlights.map(x=>x.id));
  const watchlist=moves.filter(m=>!featured.has(m.id)&&m.flags.includes('Devam eden konuda yeni gelişme')).sort(rank).slice(0,3).map(({_rows,...item})=>item);
  const position_changes=list(ctx.score_deltas).filter(x=>numeric(x.delta)!==null&&Math.abs(numeric(x.delta))>=3&&numeric(x.current)!==null&&numeric(x.baseline)!==null).map(x=>({segment:clean(x.segment),delta:numeric(x.delta),current:numeric(x.current),baseline:numeric(x.baseline)}));
  return {period_start:iso(ctx.period_start),period_end:iso(ctx.period_end),headline,summary,quiet,counts,coverage,highlights,ads,expiring,watchlist,position_changes};
}

export function dailyBriefSubject(ctx,brief=buildDailyBrief(ctx)){
  const date=new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',day:'2-digit',month:'2-digit'}).format(new Date(brief.period_end));
  const top=brief.highlights[0];
  const topic=top?`${top.brand}: ${top.flags.includes('Fiyat aynı, teklif değişti')?'fiyat aynı, teklif değişti':top.kind==='added'?'yeni paket':top.kind==='removed'?'paket kaldırıldı':top.kind==='ad'?'reklam teklifi':top.changes[0]?.label||'paket değişikliği'} · ${top.title}`:brief.expiring.length?`${brief.expiring.length} kampanyanın bitişi yaklaşıyor`:brief.counts.unverified_ads?'Yeni reklamların teklif koşulları teyit bekliyor':brief.counts.status_updates?'Reklam yayın durumu güncellendi':brief.quiet?'Yeni değişiklik yok':'Kaynak kontrolleri eksik';
  return `Markets Pulse | ${date} | ${clean(topic,125)}`;
}
