// Categories are shared by the cloud model, persisted catalog and public filters.
// New labels are data, never HTML, provider instructions or an external URL.
export const AD_CATEGORIES=Object.freeze({home:'Ev İnterneti',gsm:'GSM Paketleri',mnp:'MNP / Numara Taşıma',review:'Diğer / Belirsiz'});
export const AD_TAXONOMY_VERSION=2;
export const AD_CAPTION_MAX_LENGTH=8000;
const fold=value=>String(value||'').toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/\s+/g,' ').trim();
const aliasKey=value=>fold(value).replace(/[^a-z0-9]+/g,' ').trim();
const aliases=new Map([
  ...['home','ev interneti','ev internet paketleri','ev interneti paketleri','ev interneti reklamlari','evde internet','home internet','home broadband','sabit internet','fixed internet','broadband'].map(label=>[label,'home']),
  ...['gsm','gsm paketleri','gsm tarifeleri','gsm reklamlari','mobil','mobil paketler','mobil tarifeler','mobil internet','mobil internet paketleri','mobile','mobile tariffs'].map(label=>[label,'gsm']),
  ...['mnp','numara tasima','numara tasima paketleri','numara tasima kampanyalari','mnp kampanyalari','mnp numara tasima','number portability'].map(label=>[label,'mnp']),
  ...['review','diger','belirsiz','diger belirsiz','other','unknown','uncategorized','inceleme','inceleme bekliyor','belirsiz reklamlar','siniflandirilmamis'].map(label=>[label,'review'])
]);
const reservedLabels=new Set(['new','all','all categories','tumu','tum kategoriler','categories','kategori','category','default','null','undefined']);
const deviceAliases=new Set(['cihaz','cihazlar','cihaz reklamlari','cihaz kampanyalari','cihaz satisi','cihaz satislari','telefon','telefonlar','cep telefonu','cep telefonlari','akilli telefon','akilli telefonlar','tablet','tabletler','telefon ve tablet','telefon tablet','telefonlar ve tabletler','telefon tablet cihaz','device','devices','device offers','smartphone','smartphones','mobile phones','electronics','elektronik cihazlar']);

export function isDynamicCategory(key){return typeof key==='string'&&key.length<=80&&/^auto-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)}
export function normalizeCategoryLabel(value){
  if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value))return null;
  const label=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(label.length<2||label.length>60||!/[\p{L}]/u.test(label)||!/^[\p{L}\p{N}][\p{L}\p{N}\s&/+()'’-]*[\p{L}\p{N})]$/u.test(label))return null;
  if(/https?|javascript|data\s*:|script|ignore.{0,30}instructions|system\s*prompt|talimatlari.{0,20}(yok|unut)|onceki.{0,20}talimat/i.test(fold(label)))return null;
  return label;
}
function canonicalLabel(label){return deviceAliases.has(aliasKey(label))?'Cihazlar':label}
export function categoryKeyForLabel(value){
  const cleaned=normalizeCategoryLabel(value);if(!cleaned)return null;
  const label=canonicalLabel(cleaned),identity=aliasKey(label);if(reservedLabels.has(identity))return null;
  const core=aliases.get(identity);if(core)return core;
  const slug=fold(label).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const key='auto-'+slug;return isDynamicCategory(key)?key:null;
}
export function resolveCategoryProposal(category,label,catalog=AD_CATEGORIES){
  if(Object.hasOwn(AD_CATEGORIES,category))return {category,category_label:AD_CATEGORIES[category]};
  if(category!=='new'&&!isDynamicCategory(category))return null;
  const cleaned=normalizeCategoryLabel(label);if(!cleaned)return null;
  const canonical=canonicalLabel(cleaned),derivedKey=categoryKeyForLabel(canonical);if(!derivedKey)return null;
  // Core aliases cannot create parallel categories that avoid core evidence checks.
  if(Object.hasOwn(AD_CATEGORIES,derivedKey))return {category:derivedKey,category_label:AD_CATEGORIES[derivedKey]};
  const entries=Object.entries(catalog||{}).filter(([key,value])=>(Object.hasOwn(AD_CATEGORIES,key)||isDynamicCategory(key))&&normalizeCategoryLabel(value));
  if(isDynamicCategory(category)&&Object.hasOwn(catalog||{},category)){
    const existing=normalizeCategoryLabel(catalog[category]);
    return existing&&aliasKey(canonicalLabel(existing))===aliasKey(canonical)?{category,category_label:existing}:null;
  }
  const matched=entries.find(([,value])=>aliasKey(canonicalLabel(value))===aliasKey(canonical));
  if(matched)return {category:matched[0],category_label:matched[1]};
  // A supplied unknown key must agree with its label, so imports cannot rename a
  // category merely by placing an arbitrary key next to a plausible label.
  if(category!=='new'&&category!==derivedKey)return null;
  if(Object.hasOwn(catalog||{},derivedKey)&&aliasKey(canonicalLabel(catalog[derivedKey]))!==aliasKey(canonical))return null;
  return {category:derivedKey,category_label:canonical};
}
