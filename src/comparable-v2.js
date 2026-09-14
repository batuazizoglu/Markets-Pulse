const TR='tr-TR';

function norm(v){return String(v||'').toLocaleLowerCase(TR).replace(/\s+/g,' ').trim()}
function clamp(v,min=0,max=1){return Math.max(min,Math.min(max,v))}
function num(v){if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function ratio(a,b){a=num(a);b=num(b);if(a==null&&b==null)return 1;if(a==null||b==null)return null;if(a===0&&b===0)return 1;if(a<=0||b<=0)return 0;return Math.min(a,b)/Math.max(a,b)}
function pctGap(a,b){a=num(a);b=num(b);if(a==null||b==null||b===0)return null;return (a-b)/b*100}
function round(v,d=1){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**d;return Math.round(Number(v)*p)/p}

function textOfTelsim(p){return norm(`${p.current_name||p.name||''} ${JSON.stringify(p.extras_json||[])} ${p.raw_text||''}`)}
function textOfKktcell(p){return norm(`${p.name||''} ${p.raw_text||''}`)}
function billingTypeTelsim(p){return p.source_slug==='faturasiz'?'prepaid':'postpaid'}

function classifyEligibility(text){
  const t=norm(text);
  if(/turist|tourist|ercan|havaalan|airport|e[- ]?sim/.test(t))return 'tourist';
  if(/asker|askerfone|askere özel/.test(t))return 'military';
  if(/red junior|junior|çocuk|cocuk|6\s*[-–]\s*17|6-17/.test(t))return 'child';
  if(/kamu|sağlık çalışan|saglik calisan|basın çalışan|basin calisan|gümrük|gumruk|din işleri|din isleri|öğretmen|ogretmen|memur|belediye çalışan|belediye calisan/.test(t))return 'public';
  if(/nigerian|nigeria|pakistan|bangladeş|banglades|nepal|sri lanka|hindistan|india/.test(t))return 'international';
  if(/super\s*65|65\+|65 yaş|65 yas|kıdemli|kidemli/.test(t))return 'senior';
  if(/freezone|gnç|gnc|genç|genc|öğrenci|ogrenci|student|young|super cool/.test(t))return 'youth';
  if(/platinum|premium|vip|super red/.test(t))return 'premium';
  return 'general';
}
function segmentLabel(elig){
  return ({tourist:'Turist',military:'Asker',child:'Çocuk',public:'Kamu / Meslek',international:'Uluslararası / Diaspora',senior:'Kıdemli / 65+',youth:'Öğrenci / Genç',premium:'Premium / Platinum',general:'Genel'})[elig]||'Genel';
}
function acquisition(text){
  const t=norm(text);
  if(/mnp|numara taşı|numara taşi|taşıma|taşima|port in/.test(t))return 'MNP';
  if(/yeni hat|hoş geldin|hos geldin|new line|new customer/.test(t))return 'Yeni Hat';
  if(/mevcut müşteri|mevcut musteri|tarifeye ek/.test(t))return 'Mevcut Müşteri';
  return 'Genel';
}
function channel(text){
  const t=norm(text);
  if(/ercan|havaalan|airport/.test(t))return 'Ercan';
  if(/dijital|digital|online|web|uygulama|app|e[- ]?sim/.test(t))return 'Dijital';
  if(/mağaza|magaza|bayi|tim\b|store/.test(t))return 'Mağaza';
  return 'Genel';
}
function detectAddon(text){
  const t=norm(text);
  return /\bek\b|tek numara|aşım|asim|devir|favorim|sadece sms|dakika paketi|internet ek|platinum'a ek|gnç ek|gnc ek|tv\+ paketi/.test(t);
}
function detectClosed(text){return /yeni abone alımına kapalı|abone alımına kapalı|sonlanmıştır|sona ermiştir|kullanıma kapalı/.test(norm(text))}
function benefits(text){
  const t=norm(text),out=new Set();
  const tests=[
    ['social',/sosyal medya|instagram|facebook|whatsapp|tiktok|snapchat/],
    ['video',/youtube|tv\+|video|izle/],
    ['music',/fizy|spotify|müzik|muzik/],
    ['gaming',/oyun|gaming|game/],
    ['roaming',/red passport|roaming|yurt dışı|yurtdışı|vf countr|23 ülke|23 ulke/],
    ['unlimited_apps',/sınırsız uygulama|sinirsiz uygulama|non-stop|özgür pass|ozgur pass|pass/],
    ['cloud',/bulut|cloud/],
    ['esim',/e[- ]?sim/]
  ];
  for(const [k,re] of tests)if(re.test(t))out.add(k);
  return [...out];
}
function jaccard(a,b){const A=new Set(a||[]),B=new Set(b||[]);if(!A.size&&!B.size)return null;const union=new Set([...A,...B]);let inter=0;for(const x of A)if(B.has(x))inter++;return union.size?inter/union.size:null}
function tier(effectiveData,elig){
  if(['tourist','military','child','senior','premium'].includes(elig))return elig;
  const d=num(effectiveData)||0;
  if(d<=15)return 'entry';
  if(d<=40)return 'core';
  if(d<=80)return 'heavy';
  return 'ultra';
}
function tierSimilarity(a,b){if(a===b)return 1;const order=['entry','core','heavy','ultra'];const ia=order.indexOf(a),ib=order.indexOf(b);if(ia>=0&&ib>=0){const d=Math.abs(ia-ib);return d===1?.65:d===2?.25:0}return 0}
function inferredValidity(p,billing){const v=num(p.validity_days);if(v!=null&&v>0)return v;return billing==='postpaid'?30:null}

function fingerprintTelsim(p){
  const text=textOfTelsim(p),eligibility=classifyEligibility(text),billing=billingTypeTelsim(p);
  const core=num(p.data_gb)||0,bonus=num(p.bonus_data_gb)||0,eff=core+bonus;
  return {provider:'Telsim',id:p.id,name:p.current_name||p.name||'',billing_type:billing,eligibility,segment:segmentLabel(eligibility),acquisition:acquisition(text),channel:channel(text),core_data_gb:core,bonus_data_gb:bonus,effective_data_gb:eff,minutes:num(p.local_tr_minutes),international_minutes:num(p.international_minutes),sms:num(p.sms),validity_days:inferredValidity(p,billing),price_try:num(p.price_try),benefits:benefits(text),intent:tier(eff,eligibility),addon:detectAddon(text),closed:detectClosed(text)||p.active===false,raw:p};
}
function fingerprintKktcell(p){
  const text=textOfKktcell(p),eligibility=classifyEligibility(text),billing=p.type;
  const core=num(p.data_gb)||0,bonus=num(p.bonus_data_gb)||0,eff=num(p.effective_data_gb)??(core+bonus);
  return {provider:'KKTCELL',id:p.product_url||`${p.source_slug}|${p.name}|${p.price_try}`,name:p.name||'',billing_type:billing,eligibility,segment:segmentLabel(eligibility),acquisition:p.acquisition||acquisition(text),channel:p.channel||channel(text),core_data_gb:core,bonus_data_gb:bonus,effective_data_gb:eff,minutes:num(p.local_tr_minutes),international_minutes:num(p.international_minutes),sms:num(p.sms),validity_days:inferredValidity(p,billing),price_try:num(p.price_try),benefits:benefits(text),intent:tier(eff,eligibility),addon:p.is_core===false||detectAddon(text),closed:!!p.is_closed||detectClosed(text),raw:p};
}

function hardGate(t,k){
  const reasons=[];
  if(t.billing_type!==k.billing_type)reasons.push('billing_type');
  if(t.closed||k.closed)reasons.push('closed');
  if(t.addon||k.addon)reasons.push('non_core');
  if(t.eligibility!==k.eligibility)reasons.push(`eligibility:${t.eligibility}≠${k.eligibility}`);
  return {ok:reasons.length===0,reasons};
}

function pairScore(t,k){
  const gate=hardGate(t,k);if(!gate.ok)return {eligible:false,score:0,gate_reasons:gate.reasons,reasons:[],penalties:[]};
  const parts={},weights={core_data:25,bonus_data:8,minutes:15,international:6,validity:10,price:8,sms:3,benefits:8,acquisition:7,channel:3,intent:7};
  let earned=0,available=0;
  const metric=(key,a,b,similarity=null)=>{
    let sim=similarity;
    if(sim==null){if(a==null||b==null){parts[key]=null;return}sim=ratio(a,b)}
    if(sim==null){parts[key]=null;return}
    const w=weights[key];available+=w;earned+=w*sim;parts[key]=round(w*sim,1);
  };
  metric('core_data',t.core_data_gb,k.core_data_gb);
  metric('bonus_data',t.bonus_data_gb,k.bonus_data_gb);
  metric('minutes',t.minutes,k.minutes);
  metric('international',t.international_minutes,k.international_minutes);
  metric('validity',t.validity_days,k.validity_days);
  metric('price',t.price_try,k.price_try);
  metric('sms',t.sms,k.sms);
  const benefitSim=jaccard(t.benefits,k.benefits);if(benefitSim!=null)metric('benefits',1,1,benefitSim);else parts.benefits=null;
  metric('acquisition',1,1,t.acquisition===k.acquisition?1:(t.acquisition==='Genel'||k.acquisition==='Genel'?.55:0));
  metric('channel',1,1,t.channel===k.channel?1:(t.channel==='Genel'||k.channel==='Genel'?.55:0));
  metric('intent',1,1,tierSimilarity(t.intent,k.intent));

  let score=available?earned/available*100:0;
  const penalties=[];
  const minuteRatio=ratio(t.minutes,k.minutes);
  if(minuteRatio!=null&&t.minutes!=null&&k.minutes!=null&&Math.max(t.minutes,k.minutes)>=300){
    if(minuteRatio<.35){score-=20;penalties.push('ciddi dakika farkı (<%35 oran)')}
    else if(minuteRatio<.5){score-=12;penalties.push('yüksek dakika farkı (<%50 oran)')}
    else if(minuteRatio<.7){score-=5;penalties.push('orta dakika farkı')}
  }
  const coreRatio=ratio(t.core_data_gb,k.core_data_gb);
  if(coreRatio!=null&&t.core_data_gb>0&&k.core_data_gb>0){
    if(coreRatio<.4){score-=18;penalties.push('ciddi ana data farkı')}
    else if(coreRatio<.6){score-=9;penalties.push('yüksek ana data farkı')}
  }
  const validityRatio=ratio(t.validity_days,k.validity_days);
  if(validityRatio!=null&&t.validity_days&&k.validity_days&&validityRatio<.5){score-=12;penalties.push('geçerlilik süresi farklı ürün ritmi')}
  if(t.intent!==k.intent&&tierSimilarity(t.intent,k.intent)===0){score-=8;penalties.push(`ürün intent farklı (${t.intent}/${k.intent})`)}
  score=Math.round(clamp(score/100,0,1)*100);
  const reasons=[
    `aynı erişim: ${t.segment}`,
    `ana data benzerliği %${Math.round((coreRatio??0)*100)}`,
    `dakika benzerliği ${minuteRatio==null?'bilinmiyor':'%'+Math.round(minuteRatio*100)}`,
    `geçerlilik benzerliği ${validityRatio==null?'bilinmiyor':'%'+Math.round(validityRatio*100)}`,
    `fiyat benzerliği %${Math.round((ratio(t.price_try,k.price_try)??0)*100)}`,
    `intent ${t.intent===k.intent?'aynı':'farklı'} (${t.intent}/${k.intent})`,
    `ölçülen ağırlık ${available}/100`
  ];
  return {eligible:true,score,parts,reasons,penalties,measured_weight:available};
}

const GOLDEN=[
  {kind:'positive',t:/asker.*2 gb/i,k:/asker kıdemli 2gb/i,label:'Asker 2 GB ↔ Asker Kıdemli 2 GB'},
  {kind:'positive',t:/asker.*4 gb/i,k:/asker kıdemli 4gb/i,label:'Asker 4 GB ↔ Asker Kıdemli 4 GB'},
  {kind:'positive',t:/asker.*6 gb/i,k:/asker kıdemli 6gb/i,label:'Asker 6 GB ↔ Asker Kıdemli 6 GB'},
  {kind:'positive',t:/asker.*8 gb/i,k:/asker kıdemli 8gb/i,label:'Asker 8 GB ↔ Asker Kıdemli 8 GB'},
  {kind:'positive',t:/asker.*10 gb/i,k:/asker mini/i,label:'ASKER MİNİ ↔ Asker 10 GB'},
  {kind:'positive',t:/asker.*20 gb/i,k:/asker maxi/i,label:'ASKER MAXİ ↔ Asker 20 GB'},
  {kind:'positive',t:/super cool uni.*midi/i,k:/gnç giga m|gnc giga m/i,label:'GNÇ Giga M ↔ Super Cool Uni Midi'},
  {kind:'negative',t:/nigerian/i,k:/yeni go.*xs/i,label:'Nigerian ↔ Yeni GO XS'},
  {kind:'negative',t:/pakistan/i,k:/yeni go.*xs/i,label:'Pakistan ↔ Yeni GO XS'},
  {kind:'negative',t:/sağlık çalışanlarına özel 10 gb|saglik calisanlarina ozel 10 gb/i,k:/turbo star 60\+/i,label:'Sağlık 10 GB ↔ Turbo Star 60+'},
  {kind:'negative',t:/super simple 10/i,k:/turbo go\+? xs/i,label:'Turbo GO+ XS ↔ Super Simple 10'},
  {kind:'negative',t:/super\s*65/i,k:/turbo extra mega/i,label:'Turbo Extra Mega ↔ Super65'},
  {kind:'negative',t:/super red\s*200/i,k:/platinum black\s*90/i,label:'Platinum BLACK 90 ↔ Super Red 200'},
  {kind:'negative',t:/red junior/i,k:/gnç lite|gnc lite/i,label:'GNÇ Lite ↔ Red Junior'}
];

function goldenValidation(telsim,kktcell,pairLookup){
  const tests=[];
  for(const g of GOLDEN){
    const t=telsim.find(x=>g.t.test(x.name)),k=kktcell.find(x=>g.k.test(x.name));
    if(!t||!k){tests.push({label:g.label,kind:g.kind,status:'SKIPPED',reason:'ürünlerden biri mevcut katalogda bulunamadı'});continue}
    const p=pairLookup.get(`${t.id}|||${k.id}`),score=p?.score??0;
    const pass=g.kind==='positive'?score>=85:(score<65||!p?.eligible);
    tests.push({label:g.label,kind:g.kind,status:pass?'PASS':'FAIL',score,eligible:!!p?.eligible,telsim:t.name,kktcell:k.name,penalties:p?.penalties||[]});
  }
  const evaluated=tests.filter(x=>x.status!=='SKIPPED');
  return {total:tests.length,evaluated:evaluated.length,passed:evaluated.filter(x=>x.status==='PASS').length,failed:evaluated.filter(x=>x.status==='FAIL').length,skipped:tests.filter(x=>x.status==='SKIPPED').length,tests};
}

export function buildComparableV2(telsimRows,kktcellRows){
  const telsim=telsimRows.map(fingerprintTelsim).filter(x=>!x.closed&&!x.addon&&x.price_try!=null&&x.core_data_gb>0);
  const kktcell=kktcellRows.map(fingerprintKktcell).filter(x=>!x.closed&&!x.addon&&x.price_try!=null&&x.core_data_gb>0);
  const pairs=[],pairLookup=new Map();
  for(const t of telsim)for(const k of kktcell){
    const p=pairScore(t,k),row={telsim_id:t.id,kktcell_id:k.id,telsim:t,kktcell:k,...p};pairs.push(row);pairLookup.set(`${t.id}|||${k.id}`,row);
  }
  const bestForT=new Map(),bestForK=new Map();
  for(const p of pairs){if(!p.eligible)continue;const bt=bestForT.get(p.telsim_id);if(!bt||p.score>bt.score)bestForT.set(p.telsim_id,p);const bk=bestForK.get(p.kktcell_id);if(!bk||p.score>bk.score)bestForK.set(p.kktcell_id,p)}
  const results=[];
  for(const t of telsim){
    const best=bestForT.get(t.id);
    if(!best){results.push({status:'Reject',score:0,mutual_best:false,telsim:t,kktcell:null,reasons:['hard gate sonrası karşılaştırılabilir ürün yok'],penalties:[]});continue}
    const reverse=bestForK.get(best.kktcell_id),mutual=reverse?.telsim_id===t.id;
    let status='Reject';
    if(best.score>=85&&mutual)status='Primary';
    else if(best.score>=75)status='Secondary';
    else if(best.score>=65)status='Review';
    const runner=pairs.filter(x=>x.eligible&&x.telsim_id===t.id&&x.kktcell_id!==best.kktcell_id).sort((a,b)=>b.score-a.score)[0]||null;
    results.push({status,score:best.score,mutual_best:mutual,telsim:t,kktcell:best.kktcell,reasons:best.reasons,penalties:best.penalties,parts:best.parts,measured_weight:best.measured_weight,runner_up:runner?{score:runner.score,name:runner.kktcell.name,id:runner.kktcell.id}:null,score_margin:runner?best.score-runner.score:null});
  }
  const counts={Primary:0,Secondary:0,Review:0,Reject:0};for(const r of results)counts[r.status]++;
  const bySegment={};for(const r of results){const s=r.telsim.segment;if(!bySegment[s])bySegment[s]={Primary:0,Secondary:0,Review:0,Reject:0,total:0};bySegment[s][r.status]++;bySegment[s].total++}
  const golden=goldenValidation(telsim,kktcell,pairLookup);
  const reviewQueue=results.filter(x=>x.status==='Review'||x.status==='Secondary').sort((a,b)=>a.score-b.score||Number(a.score_margin||0)-Number(b.score_margin||0));
  const primary=results.filter(x=>x.status==='Primary').sort((a,b)=>b.score-a.score);
  const rejected=results.filter(x=>x.status==='Reject').sort((a,b)=>b.score-a.score);
  return {
    generated_at:new Date().toISOString(),mode:'shadow',engine_version:'2.1-shadow',
    thresholds:{primary:'>=85 + mutual best',secondary:'>=75, or >=85 without mutual best',review:'65-74',reject:'<65 or no eligible peer'},
    catalog:{telsim_core:telsim.length,kktcell_core:kktcell.length},counts,by_segment:bySegment,golden,
    results,primary,review_queue:reviewQueue,rejected,
    diagnostics:{eligible_pair_count:pairs.filter(x=>x.eligible).length,total_pair_count:pairs.length,mutual_best_count:results.filter(x=>x.mutual_best).length}
  };
}