import { getKktcellCatalog } from './kktcell-benchmark.js';

const TR='tr-TR';
const ENGINE_VERSION='2.4-review';
const LATEST_SQL=`SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,
  s.slug source_slug,s.name source_name,s.url source_url,
  v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json,v.raw_text
  FROM products p JOIN sources s ON s.id=p.source_id
  LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE
  WHERE p.active=TRUE ORDER BY s.id,v.price_try ASC NULLS LAST,p.current_name`;

function norm(v){return String(v||'').toLocaleLowerCase(TR).replace(/\s+/g,' ').trim()}
function num(v){if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function ratio(a,b){a=num(a);b=num(b);if(a==null&&b==null)return 1;if(a==null||b==null)return null;if(a===0&&b===0)return 1;if(a<=0||b<=0)return 0;return Math.min(a,b)/Math.max(a,b)}
function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,v))}
function jaccard(a,b){const A=new Set(a||[]),B=new Set(b||[]);if(!A.size||!B.size)return null;const U=new Set([...A,...B]);let n=0;for(const x of A)if(B.has(x))n++;return U.size?n/U.size:null}
function billingTelsim(p){return p.source_slug==='faturasiz'?'prepaid':'postpaid'}
function textTelsim(p){return norm(`${p.current_name||p.name||''} ${JSON.stringify(p.extras_json||[])} ${p.raw_text||''}`)}
function textKktcell(p){return norm(`${p.name||''} ${p.raw_text||''}`)}
function productKey(p){return p.product_url||`${p.source_slug}|${p.name}|${p.price_try??''}`}
function detectAddon(text){const t=norm(text);return /\bek\b|tek numara|aşım|asim|devir|favorim|sadece sms|dakika paketi|internet ek|platinum'a ek|gnç ek|gnc ek|tv\+ paketi|türkiye \d+\s*dk|dakika faturasız/i.test(t)}
function detectClosed(text){return /yeni abone alımına kapalı|abone alımına kapalı|sonlanmıştır|sona ermiştir|kullanıma kapalı/i.test(norm(text))}

function eligibility(name){
  const t=norm(name);
  if(/turist|tourist|ercan|havaalan|airport|e[- ]?sim/.test(t))return'tourist';
  if(/asker|askerfone|askere özel/.test(t))return'military';
  if(/red junior|junior|çocuk|cocuk|6\s*[-–]\s*17|6-17/.test(t))return'child';
  if(/kamu|sağlık çalışan|saglik calisan|basın çalışan|basin calisan|gümrük|gumruk|din işleri|din isleri|öğretmen|ogretmen|memur|belediye çalışan|belediye calisan/.test(t))return'public';
  if(/nigerian|nigeria|pakistan|bangladeş|banglades|nepal|sri lanka|hindistan|india/.test(t))return'international';
  if(/super\s*65|65\+|65 yaş|65 yas|kıdemli|kidemli/.test(t))return'senior';
  if(/gnç|gnc|genç|genc|öğrenci|ogrenci|student|young|super cool|\buni[- ]?pack\b/.test(t))return'youth';
  if(/platinum|premium|vip|super red/.test(t))return'premium';
  return'general';
}
function segment(e){return({tourist:'Turist',military:'Asker',child:'Çocuk',public:'Kamu / Meslek',international:'Uluslararası / Diaspora',senior:'Kıdemli / 65+',youth:'Öğrenci / Genç',premium:'Premium / Platinum',general:'Genel'})[e]||'Genel'}
function family(provider,name,e){
  const n=norm(name);
  if(e==='military')return'military';if(e==='tourist')return'tourist';if(e==='public')return'public';if(e==='premium')return'premium';if(e==='youth')return'youth';if(e==='child')return'child';if(e==='senior')return'senior';if(e==='international')return'international';
  if(provider==='Telsim'){
    if(/super\s*databol/.test(n))return'data_core';
    if(/super\s*world/.test(n))return'world';
    if(/super\s*simple/.test(n))return'simple';
  }else{
    if(/go[^a-z0-9çğıöşü]*world|world[^a-z0-9çğıöşü]*go/.test(n))return'world';
    if(/(?:^|\s)(?:yeni\s+)?go\s*[-+]?\s*(?:xs|s|m|l)\b/.test(n))return'data_core';
    if(/\bturbo\b/.test(n))return'simple';
  }
  return null;
}
function acquisition(text){const t=norm(text);if(/mnp|numara taşı|numara taşi|taşıma|taşima|port in/.test(t))return'MNP';if(/yeni hat|hoş geldin|hos geldin|new line|new customer|yeni faturasız hat/.test(t))return'Yeni Hat';if(/mevcut müşteri|mevcut musteri|tarifeye ek/.test(t))return'Mevcut Müşteri';return'Genel'}
function channel(text){const t=norm(text);if(/ercan|havaalan|airport/.test(t))return'Ercan';if(/dijital|digital|online|web|uygulama|app|e[- ]?sim/.test(t))return'Dijital';if(/mağaza|magaza|bayi|tim\b|store/.test(t))return'Mağaza';return'Genel'}
function benefits(text){const t=norm(text),out=[];const tests=[['social',/sosyal medya|instagram|facebook|whatsapp|tiktok|snapchat/],['video',/youtube|tv\+|video|izle/],['music',/fizy|spotify|müzik|muzik/],['gaming',/oyun|gaming|game/],['roaming',/red passport|roaming|yurt dışı|yurtdışı|23 ülke|23 ulke/],['unlimited_apps',/sınırsız uygulama|sinirsiz uygulama|non-stop|özgür pass|ozgur pass|pass/],['esim',/e[- ]?sim/]];for(const [k,re]of tests)if(re.test(t))out.push(k);return out}
function tier(d,e){if(['tourist','military','child','senior','premium'].includes(e))return e;d=num(d)||0;if(d<=15)return'entry';if(d<=40)return'core';if(d<=80)return'heavy';return'ultra'}
function tierSim(a,b){if(a===b)return 1;const x=['entry','core','heavy','ultra'],ia=x.indexOf(a),ib=x.indexOf(b);if(ia<0||ib<0)return 0;const d=Math.abs(ia-ib);return d===1?.65:d===2?.25:0}
function parseKktAllowances(raw,fallbackCore,fallbackBonus){
  const text=String(raw||''),items=[];for(const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/ig)){let v=Number(String(m[1]).replace(',','.'));if(String(m[2]).toUpperCase()==='MB')v/=1024;items.push({v,idx:m.index||0,end:(m.index||0)+m[0].length})}
  if(!items.length)return{core:num(fallbackCore)||0,bonus:num(fallbackBonus)||0};let core=null,bonus=0;
  for(let i=0;i<items.length;i++){const g=items[i],next=items[i+1],tail=norm(text.slice(g.end,next?next.idx:Math.min(text.length,g.end+90)));const isBonus=/sosyal medya|tv\+|uygulama|dijital bonus|hediye|özgür pass|ozgur pass/.test(tail),isCore=/internet|data|yurt içinde geçerli|yurt icinde gecerli/.test(tail);if(isBonus&&!isCore)bonus+=g.v;else if(core==null)core=g.v;else bonus+=g.v}
  if(core==null){core=num(fallbackCore)??items[0].v;bonus=Math.max(0,items.reduce((s,x)=>s+x.v,0)-core)}return{core,bonus};
}
function validityT(p,billing,name){const v=num(p.validity_days);if(v&&v>0)return v;const n=norm(name);if(billing==='postpaid')return 30;if(/super databol\s*3\b/.test(n))return 90;if(/super databol\s*5\b/.test(n))return 150;if(/super databol (?:xsmall|small|medium|large|digital)|super world (?:xsmall|small|medium|large|digital)|uni[- ]?pack/.test(n))return 30;return null}
function validityK(p,billing){const v=num(p.validity_days);if(v&&v>0)return v;return billing==='postpaid'?30:null}

function fpT(p){const name=p.current_name||p.name||'',e=eligibility(name),billing=billingTelsim(p),core=num(p.data_gb)||0,bonus=num(p.bonus_data_gb)||0,eff=core+bonus,text=textTelsim(p);return{provider:'Telsim',id:Number(p.id),key:String(p.id),name,billing,eligibility:e,segment:segment(e),family:family('Telsim',name,e),core,bonus,eff,minutes:num(p.local_tr_minutes),intl:num(p.international_minutes),sms:num(p.sms),days:validityT(p,billing,name),price:num(p.price_try),benefits:benefits(text),acquisition:acquisition(text),channel:channel(text),intent:tier(eff,e),addon:detectAddon(text),closed:detectClosed(text)||p.active===false}}
function fpK(p){const name=p.name||'',e=eligibility(name),billing=p.type,parsed=parseKktAllowances(p.raw_text,p.data_gb,p.bonus_data_gb),core=parsed.core,bonus=parsed.bonus,eff=core+bonus,text=textKktcell(p);return{provider:'KKTCELL',id:productKey(p),key:productKey(p),name,billing,eligibility:e,segment:segment(e),family:family('KKTCELL',name,e),core,bonus,eff,minutes:num(p.local_tr_minutes),intl:num(p.international_minutes),sms:num(p.sms),days:validityK(p,billing),price:num(p.price_try),benefits:benefits(text),acquisition:p.acquisition||acquisition(text),channel:p.channel||channel(text),intent:tier(eff,e),addon:p.is_core===false||detectAddon(text),closed:!!p.is_closed||detectClosed(text)}}

function gate(t,k){const reasons=[];if(t.billing!==k.billing)reasons.push('billing');if(t.eligibility!==k.eligibility)reasons.push('eligibility');if(t.family&&(!k.family||t.family!==k.family))reasons.push('product_family');return{ok:!reasons.length,reasons}}
function pair(t,k){
  const g=gate(t,k);if(!g.ok)return{eligible:false,score:0,gate:g.reasons,penalties:[]};
  const weights={core:25,bonus:8,minutes:15,intl:6,days:10,price:8,sms:3,benefits:8,acquisition:7,channel:3,intent:7};let earned=0,available=0,parts={};
  const metric=(key,a,b,sim=null)=>{if(sim==null){if(a==null||b==null){parts[key]=null;return}sim=ratio(a,b)}if(sim==null){parts[key]=null;return}available+=weights[key];earned+=weights[key]*sim;parts[key]=Math.round(weights[key]*sim*10)/10};
  metric('core',t.core,k.core);metric('bonus',t.bonus,k.bonus);metric('minutes',t.minutes,k.minutes);metric('intl',t.intl,k.intl);metric('days',t.days,k.days);metric('price',t.price,k.price);metric('sms',t.sms,k.sms);const b=jaccard(t.benefits,k.benefits);if(b!=null)metric('benefits',1,1,b);metric('acquisition',1,1,t.acquisition===k.acquisition?1:(t.acquisition==='Genel'||k.acquisition==='Genel'?.55:0));metric('channel',1,1,t.channel===k.channel?1:(t.channel==='Genel'||k.channel==='Genel'?.55:0));metric('intent',1,1,tierSim(t.intent,k.intent));
  let score=available?earned/available*100:0;const penalties=[];const mr=ratio(t.minutes,k.minutes),dr=ratio(t.core,k.core),vr=ratio(t.days,k.days);
  if(mr!=null&&t.minutes!=null&&k.minutes!=null&&Math.max(t.minutes,k.minutes)>=300){if(mr<.35){score-=20;penalties.push('Ciddi dakika farkı')}else if(mr<.5){score-=12;penalties.push('Yüksek dakika farkı')}else if(mr<.7){score-=5;penalties.push('Orta dakika farkı')}}
  if(dr!=null&&t.core>0&&k.core>0){if(dr<.4){score-=18;penalties.push('Ciddi ana data farkı')}else if(dr<.6){score-=9;penalties.push('Yüksek ana data farkı')}}
  if(vr!=null&&t.days&&k.days&&vr<.5){score-=12;penalties.push('Geçerlilik süresi farklı')}
  if(t.intent!==k.intent&&tierSim(t.intent,k.intent)===0){score-=8;penalties.push('Ürün intent farklı')}
  score=Math.round(clamp(score));
  return{eligible:true,score,parts,penalties,reasons:[`Aynı segment: ${t.segment}`,`Ürün ailesi: ${t.family||'belirsiz'} ↔ ${k.family||'belirsiz'}`,`Ana data benzerliği %${Math.round((dr??0)*100)}`,`Dakika benzerliği ${mr==null?'bilinmiyor':'%'+Math.round(mr*100)}`,`Geçerlilik ${vr==null?'bilinmiyor':'%'+Math.round(vr*100)}`,`Fiyat benzerliği %${Math.round((ratio(t.price,k.price)??0)*100)}`]};
}
function compact(p){return p?{key:p.key,name:p.name,segment:p.segment,family:p.family,core_data_gb:p.core,bonus_data_gb:p.bonus,minutes:p.minutes,international_minutes:p.intl,sms:p.sms,validity_days:p.days,price_try:p.price,intent:p.intent}:null}

export async function ensureMatchReviewSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS product_match_overrides (
    telsim_product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('primary','secondary','reject')),
    kktcell_product_key TEXT,
    kktcell_product_name TEXT,
    note TEXT,
    engine_version TEXT,
    engine_score INTEGER,
    created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (decision='reject' OR kktcell_product_key IS NOT NULL)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_product_match_overrides_decision ON product_match_overrides(decision,updated_at DESC)');
}

export async function buildMatchReviewSnapshot(pool,{refresh=false}={}){
  await ensureMatchReviewSchema(pool);
  const [tr,catalog,ov]=await Promise.all([pool.query(LATEST_SQL),getKktcellCatalog(refresh),pool.query(`SELECT o.*,u.first_name,u.last_name,u.email FROM product_match_overrides o LEFT JOIN app_users u ON u.id=o.updated_by ORDER BY o.updated_at DESC`)]);
  const T=tr.rows.map(fpT).filter(x=>!x.closed&&!x.addon&&x.price!=null&&x.core>0),K=catalog.rows.map(fpK).filter(x=>!x.closed&&!x.addon&&x.price!=null&&x.core>0),pairs=[];
  for(const t of T)for(const k of K){const p=pair(t,k);pairs.push({t,k,...p})}
  const bestT=new Map(),bestK=new Map();for(const p of pairs){if(!p.eligible)continue;const a=bestT.get(p.t.id),b=bestK.get(p.k.key);if(!a||p.score>a.score)bestT.set(p.t.id,p);if(!b||p.score>b.score)bestK.set(p.k.key,p)}
  const overrides=new Map(ov.rows.map(x=>[Number(x.telsim_product_id),x]));const rows=[];
  for(const t of T){const best=bestT.get(t.id),all=pairs.filter(x=>x.t.id===t.id&&x.eligible).sort((a,b)=>b.score-a.score);let engineStatus='Reject',mutual=false;
    if(best){mutual=bestK.get(best.k.key)?.t.id===t.id;if(best.score>=85&&mutual)engineStatus='Primary';else if(best.score>=75)engineStatus='Secondary';else if(best.score>=65)engineStatus='Review'}
    const o=overrides.get(t.id);let effectiveStatus=engineStatus,effectiveK=best?.k||null,override=null;
    if(o){effectiveStatus=o.decision==='primary'?'Primary':o.decision==='secondary'?'Secondary':'Reject';effectiveK=o.decision==='reject'?null:(K.find(x=>x.key===o.kktcell_product_key)||null);override={decision:o.decision,kktcell_product_key:o.kktcell_product_key,kktcell_product_name:o.kktcell_product_name,note:o.note,updated_at:o.updated_at,updated_by:[o.first_name,o.last_name].filter(Boolean).join(' ')||o.email||null,stale:o.decision!=='reject'&&!effectiveK}}
    rows.push({telsim:compact(t),telsim_product_id:t.id,engine_status:engineStatus,engine_score:best?.score||0,mutual_best:mutual,engine_match:compact(best?.k),effective_status:effectiveStatus,effective_match:compact(effectiveK),override,reasons:best?.reasons||[],penalties:best?.penalties||[],score_margin:best&&all[1]?best.score-all[1].score:null,candidates:all.map(x=>({score:x.score,product:compact(x.k),penalties:x.penalties}))});
  }
  const count=(field)=>rows.reduce((a,x)=>(a[x[field]]=(a[x[field]]||0)+1,a),{});
  return{generated_at:new Date().toISOString(),engine_version:ENGINE_VERSION,mode:'admin-review-shadow',thresholds:{Primary:'≥85 + Mutual Best',Secondary:'≥75',Review:'65–74',Reject:'<65 / uygun peer yok'},catalog:{telsim_core:T.length,kktcell_core:K.length,eligible_pairs:pairs.filter(x=>x.eligible).length,total_pairs:pairs.length},engine_counts:count('engine_status'),effective_counts:count('effective_status'),override_count:ov.rows.length,rows};
}

export async function saveMatchOverride(pool,{telsimProductId,decision,kktcellProductKey,note,userId,refresh=false}){
  await ensureMatchReviewSchema(pool);const id=Number(telsimProductId);if(!Number.isFinite(id))throw new Error('Geçersiz Telsim ürün ID');if(!['primary','secondary','reject'].includes(decision))throw new Error('Geçersiz karar');
  const snap=await buildMatchReviewSnapshot(pool,{refresh}),row=snap.rows.find(x=>x.telsim_product_id===id);if(!row)throw new Error('Telsim ürünü bulunamadı');let key=null,name=null,score=row.engine_score;
  if(decision!=='reject'){key=String(kktcellProductKey||'');const c=row.candidates.find(x=>x.product?.key===key);if(!c)throw new Error('Seçilen KKTCELL ürünü bu ürün için karşılaştırılabilir aday değil');name=c.product.name;score=c.score}
  const q=await pool.query(`INSERT INTO product_match_overrides(telsim_product_id,decision,kktcell_product_key,kktcell_product_name,note,engine_version,engine_score,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
    ON CONFLICT(telsim_product_id) DO UPDATE SET decision=EXCLUDED.decision,kktcell_product_key=EXCLUDED.kktcell_product_key,kktcell_product_name=EXCLUDED.kktcell_product_name,note=EXCLUDED.note,engine_version=EXCLUDED.engine_version,engine_score=EXCLUDED.engine_score,updated_by=EXCLUDED.updated_by,updated_at=NOW()
    RETURNING *`,[id,decision,key,name,String(note||'').trim().slice(0,1000)||null,ENGINE_VERSION,score,userId]);return q.rows[0];
}
export async function deleteMatchOverride(pool,telsimProductId){await ensureMatchReviewSchema(pool);const r=await pool.query('DELETE FROM product_match_overrides WHERE telsim_product_id=$1 RETURNING *',[Number(telsimProductId)]);return r.rows[0]||null}
