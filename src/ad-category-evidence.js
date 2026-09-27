import {AD_CATEGORIES,AD_CAPTION_MAX_LENGTH,resolveCategoryProposal} from './ad-categories.js';

// These rules repair categorisation only. They never extract offers, manufacture
// model confidence, or treat previous prose summaries as observed evidence.
export const AD_STORED_CLASSIFICATION_VERSION=1;
const MAX_QUOTE=2000;
const sourceTexts=ad=>[
  ['visible_text',typeof ad?.visible_text==='string'?ad.visible_text.slice(0,12000):''],
  ['ad_text',typeof ad?.ad_text==='string'?ad.ad_text.slice(0,AD_CAPTION_MAX_LENGTH):'']
];

// Keep offsets into the original text while normalising typography. This lets
// callers persist a genuine source quotation instead of a repaired paraphrase.
function mappedText(raw,{ascii=false}={}){
  let text='';const starts=[],ends=[];
  for(const match of raw.matchAll(/\P{M}\p{M}*|\p{M}+/gu)){
    let part=match[0].normalize('NFKC').toLocaleLowerCase('tr');
    if(ascii)part=part.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
    for(const char of part){
      const normalized=/\s/u.test(char)?' ':char;
      if(normalized===' '&&(!text||text.endsWith(' '))){if(text)ends[ends.length-1]=match.index+match[0].length;continue}
      text+=normalized;
      for(let i=0;i<normalized.length;i++){starts.push(match.index);ends.push(match.index+match[0].length)}
    }
  }
  if(text.endsWith(' ')){text=text.slice(0,-1);starts.pop();ends.pop()}
  return {text,starts,ends};
}
export function recoverSourceQuote(quote,ad){
  if(typeof quote!=='string'||!quote.trim()||quote.length>MAX_QUOTE)return null;
  const needle=mappedText(quote).text;if(!needle)return null;
  for(const [source,raw] of sourceTexts(ad)){
    const mapped=mappedText(raw),index=mapped.text.indexOf(needle);
    if(index<0)continue;
    const original=raw.slice(mapped.starts[index],mapped.ends[index+needle.length-1]);
    if(original.length<=MAX_QUOTE)return {source,quote:original};
  }
  return null;
}

const money=/(?:\d[\d.,]*\s*(?:tl\b|₺)|₺\s*\d)/;
const duration=/(?:aylik|\/\s*ay(?=$|[^a-z])|\d+\s*(?:\+\s*\d+\s*)?ay(?=$|[^a-z])|yillik|abonelik|taahhut|\bmonthly\b|(?:\/|\bper\s+)\s*month\b|\d+\s*(?:\+\s*\d+\s*)?months?\b)/;
const speed=/\b\d+(?:[.,]\d+)?\s*mbps(?=$|[^a-z])/;
const mobileUnits=/\b\d+(?:[.,]\d+)?\s*(?:gb|dk|dakika)\b/;
const mnp=/numara.{0,60}(?:tasi(?:ma|yin|yarak|yabil|yan)|tasi\b|degismeden|degismeyecek)|operator.{0,40}gecis/;
const home=/(?:ev(?:de)?\s*internet|fiber(?:net)?\b|vdsl\b|wdsl\b|adsl\b|superbox\b|red\s*box\b|sabit\s*internet|apartman\s*internet|(?:home|fixed)\s*(?:internet|broadband))/;
const app=/my\s*vodafone|(?:mobil|dijital)\s+uygulama/;
const appAction=/uygulama|indir|yukle|bakiye|islem|hediye|kazan|hizmet|firsat|paket.{0,30}(?:al|satin)/;
const streaming=/(?:tv\s*\+|hbo\s*max)/;
const streamingPurpose=/film|dizi|izle|yayin|icerik|abonelik|hbo\s*max/;
const onlinePayment=/(?:online|dijital|internet|web).{0,45}(?:odeme|odey|ode\b|fatura)|(?:odeme|odey|ode\b|fatura).{0,45}(?:online|dijital|internet|web)/;
const device=/cep\s*telefonu|akilli\s*telefon|tablet\b|bilgisayar|laptop\b|televizyon|tv\s*&\s*ses\s*sistemleri|elektronik\s*urun/;
const retail=/magaza|satin|alisveris|e\s*[- ]?\s*ticaret|kampanya|taksit|indirim|modeller|fiyat/;
const address=/tasindik|tasiniyoruz|yeni.{0,25}(?:adres|ofis|sube)|(?:ofis|sube).{0,40}tasin/;
const physicalPlace=/adres|ofis|sube|magaza/;
const support=/teknik\s*destek|musteri\s*(?:hizmet|destek)|destek\s*(?:hatti|ekibi)|\bsupport\b/;
const supportAccess=/7\s*[/x]\s*24|24\s*[/x]\s*7|24\s*saat|7\s*gun|ulas|arayin/;
const safety=/guvenli\s*internet|internet.{0,25}guvenlig|cevrimici.{0,25}guvenlik|\binternet.{0,35}\bsafe(?:ty)?\b|\bsafe\s+internet\b/;
const safetyAdvice=/sifre|baglanti|link|paylas|dikkat|kontrol|kimlik|dolandir|cocuk|oner|ipuc|farkinda|koru|kutlu|\bfun\s+when\b|\bstay\s+safe\b|\bonline\s+safety\b/;

function rules(verifiedFixedPage){return [
  {id:'mnp_number_portability',category:'mnp',anchor:mnp,test:text=>mnp.test(text)},
  {id:'home_explicit',category:'home',anchor:home,test:text=>home.test(text)},
  {id:'home_fixed_plan',category:'home',anchor:speed,test:text=>verifiedFixedPage&&speed.test(text)&&money.test(text)&&duration.test(text)},
  {id:'gsm_tariff',category:'gsm',anchor:/tarife|faturali|faturasiz|gsm\b/,test:text=>/tarife|faturali|faturasiz|gsm\b/.test(text)&&mobileUnits.test(text)&&money.test(text)},
  {id:'digital_app',label:'Dijital Hizmetler',anchor:app,test:text=>app.test(text)&&appAction.test(text)},
  {id:'digital_streaming',label:'Dijital Hizmetler',anchor:streaming,test:text=>streaming.test(text)&&streamingPurpose.test(text)},
  {id:'digital_payment',label:'Dijital Hizmetler',anchor:onlinePayment,test:text=>onlinePayment.test(text)},
  {id:'devices_retail',label:'Cihazlar',anchor:device,test:text=>device.test(text)&&(retail.test(text)||money.test(text))},
  {id:'corporate_address',label:'Kurumsal İletişim',anchor:address,test:text=>address.test(text)&&physicalPlace.test(text)},
  {id:'corporate_support',label:'Kurumsal İletişim',anchor:support,test:text=>support.test(text)&&supportAccess.test(text)},
  {id:'corporate_safety',label:'Kurumsal İletişim',anchor:safety,test:text=>safety.test(text)&&safetyAdvice.test(text)}
]}
function ruleQuote(rule,{source,raw,mapped}){
  if(raw.length<=MAX_QUOTE&&rule.test(mapped.text))return {source,quote:raw.trim()};
  // On unusually long captions, require all supporting expressions to coexist
  // in a bounded neighbourhood instead of combining distant unrelated copy.
  for(const match of mapped.text.matchAll(new RegExp(rule.anchor.source,'g'))){
    const start=Math.max(0,match.index-300),end=Math.min(mapped.text.length,match.index+1100);
    if(!rule.test(mapped.text.slice(start,end)))continue;
    const quote=raw.slice(mapped.starts[start],mapped.ends[end-1]).trim();
    if(quote&&quote.length<=MAX_QUOTE)return {source,quote};
  }
  return null;
}
export function proposeStoredCategory(ad,{categories=AD_CATEGORIES,verifiedFixedIspPageId=null}={}){
  if(ad?.category!=='review')return null;
  const verifiedFixedPage=typeof verifiedFixedIspPageId==='string'&&/^\d{5,30}$/.test(verifiedFixedIspPageId)&&ad.page_id===verifiedFixedIspPageId;
  const sources=sourceTexts(ad).map(([source,raw])=>({source,raw,mapped:mappedText(raw,{ascii:true})}));
  for(const rule of rules(verifiedFixedPage)){
    for(const source of sources){
      const evidence=ruleQuote(rule,source);if(!evidence)continue;
      const resolved=resolveCategoryProposal(rule.category||'new',rule.label,categories);if(!resolved)continue;
      return {...resolved,category_evidence:evidence.quote,classification_method:'stored_evidence',
        classification_rule:rule.id,classification_version:AD_STORED_CLASSIFICATION_VERSION,evidence_source:evidence.source};
    }
  }
  return null;
}
