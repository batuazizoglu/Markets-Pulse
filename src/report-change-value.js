// Product snapshots contain parser evidence and internal metadata. Reports show
// commercial terms only; the unchanged snapshot remains in the source record.
const present=value=>value!==null&&value!==undefined&&value!=='';
const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():typeof value==='number'||typeof value==='boolean'?String(value):'';
const number=value=>present(value)&&Number.isFinite(Number(value))?Number(value).toLocaleString('tr-TR',{maximumFractionDigits:2}):null;
const money=value=>number(value)===null?null:number(value)+' TL';
const short=(value,limit)=>{const text=clean(value);return text.length<=limit?text:text.slice(0,limit-1).trimEnd()+'…'};
function decoded(value){
  if(typeof value!=='string')return value;
  const text=value.trim();
  if(!/^[\[{\"]/.test(text))return value;
  try{return JSON.parse(text)}catch{return value}
}
function terms(snapshot){
  const values=[snapshot.contract,snapshot.commitment,snapshot.campaign_text,snapshot.conditions,snapshot.features,snapshot.extras_json,snapshot.extras];
  const parts=[...new Set(values.flatMap(value=>Array.isArray(value)?value:[value]).map(clean).filter(Boolean))];
  const text=parts.join(' • ');
  if(text.length<=320)return text;
  // Keep the start and representative commercial conditions from later in the
  // source. Explicitly identify an abridged condition block instead of silently
  // presenting it as the full legal/campaign wording.
  const later=parts.join(' ').slice(180).split(/(?<=[.!?;])\s+/).filter(part=>/taahhüt|kurulum|ücretsiz|ücret|yalnız|sadece|abone|indirim|hediye|son tarih|geçerl/i.test(part));
  return short(text,180)+(later.length?' • '+short(later.join(' • '),140):'')+' (koşul özeti; ayrıntılar kaynak kaydında)';
}
function snapshotValue(snapshot){
  const parts=[],push=value=>{if(value&&!parts.includes(value))parts.push(value)};
  push(short(snapshot.name??snapshot.product_name??snapshot.current_name,180));
  push(short(snapshot.technology,40));
  const down=number(snapshot.speed_down_mbps),up=number(snapshot.speed_up_mbps);
  if(down!==null)push(down+' Mbps'+(up!==null?' / '+up+' Mbps yükleme':''));
  else if(up!==null)push(up+' Mbps yükleme');
  const quota=number(snapshot.data_limit_gb??snapshot.data_gb);
  if(snapshot.unlimited===true)push('Sınırsız internet');
  else if(quota!==null)push(quota+' GB');
  if(Number(snapshot.bonus_data_gb)>0)push('+'+number(snapshot.bonus_data_gb)+' GB hediye');
  const days=number(snapshot.duration_days??snapshot.validity_days),months=number(snapshot.duration_months??snapshot.paid_months);
  if(days!==null)push(days+' gün');else if(months!==null)push(months+' ay');
  if(Number(snapshot.bonus_months)>0)push('+'+number(snapshot.bonus_months)+' ay hediye');
  if(Number(snapshot.bonus_days)>0)push('+'+number(snapshot.bonus_days)+' gün hediye');
  const contract=number(snapshot.contract_months??snapshot.commitment_months);
  if(contract!==null)push(contract+' ay taahhüt');
  if(snapshot.contract_required===false)push('Taahhütsüz');else if(snapshot.contract_required===true&&contract===null)push('Taahhüt gerekli');
  const monthly=money(snapshot.price_monthly_try),effective=money(snapshot.effective_monthly_try),total=money(snapshot.total_price_try),price=money(snapshot.price_try);
  if(monthly!==null)push(monthly+' / ay');else if(price!==null)push('Paket fiyatı: '+price);
  if(effective!==null&&(monthly===null||Number(snapshot.effective_monthly_try)!==Number(snapshot.price_monthly_try)))push('Efektif: '+effective+' / ay');
  if(total!==null)push('Toplam: '+total);
  if(money(snapshot.install_fee_try)!==null)push('Kurulum: '+money(snapshot.install_fee_try));
  if(!monthly&&!effective&&!total&&!price&&snapshot.price_status==='not_published')push('Fiyat yayımlanmamış');
  if(number(snapshot.local_tr_minutes)!==null)push(number(snapshot.local_tr_minutes)+' dk ada içi / TR');
  if(number(snapshot.international_minutes)!==null)push(number(snapshot.international_minutes)+' dk uluslararası');
  if(number(snapshot.sms)!==null)push(number(snapshot.sms)+' SMS');
  const status={expired:'Kampanya sona ermiş',active:'Kampanya aktif',unconfirmed:'Kampanya durumu doğrulanmamış'}[snapshot.availability];
  push(status);
  if(/^\d{4}-\d{2}-\d{2}/.test(snapshot.expires_at||''))push('Bitiş: '+snapshot.expires_at.slice(0,10));
  push(terms(snapshot));
  return parts.join(' • ')||'Ürün ayrıntısı kaynak kaydında';
}

export function reportChangeValue(value){
  if(!present(value))return '—';
  const parsed=decoded(value);
  if(Array.isArray(parsed))return parsed.map(item=>item&&typeof item==='object'?snapshotValue(item):clean(item)).filter(Boolean).join(' • ')||'—';
  if(parsed&&typeof parsed==='object')return snapshotValue(parsed);
  return present(parsed)?String(parsed):'—';
}

export function reportChangeProduct(change){
  if(present(change.product_name))return String(change.product_name);
  for(const value of [change.new_value,change.old_value]){
    const parsed=decoded(value);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
      const name=parsed.name??parsed.product_name??parsed.current_name;if(present(name))return short(name,180);
    }else if(['added','removed'].includes(change.change_type)&&typeof parsed==='string'&&parsed.trim())return short(parsed,180);
  }
  return 'Paket';
}
