import fs from 'node:fs';

const path=new URL('./comparable-v2.js',import.meta.url);
let c=fs.readFileSync(path,'utf8');

const familyFn=`\nfunction productFamily(provider,name,eligibility){\n  const n=norm(name);\n  if(eligibility==='military')return 'military';\n  if(eligibility==='tourist')return 'tourist';\n  if(eligibility==='public')return 'public';\n  if(eligibility==='premium')return 'premium';\n  if(eligibility==='youth')return 'youth';\n  if(eligibility==='child')return 'child';\n  if(eligibility==='senior')return 'senior';\n  if(eligibility==='international')return 'international';\n  if(provider==='Telsim'){\n    if(/super\\s*databol/.test(n))return 'data_core';\n    if(/super\\s*world/.test(n))return 'world';\n    if(/super\\s*simple/.test(n))return 'simple';\n    if(/super\\s*cool|uni[- ]?pack/.test(n))return 'youth';\n    if(/super\\s*red/.test(n))return 'premium';\n  }else{\n    if(/go[^a-z0-9çğıöşü]*world|world[^a-z0-9çğıöşü]*go/.test(n))return 'world';\n    if(/(?:^|\\s)(?:yeni\\s+)?go\\s*[-+]?\\s*(?:xs|s|m|l)\\b/.test(n))return 'data_core';\n    if(/\\bturbo\\b/.test(n))return 'simple';\n    if(/gnç|gnc/.test(n))return 'youth';\n    if(/platinum/.test(n))return 'premium';\n  }\n  return null;\n}\n`;

c=c.replace("function tierSimilarity(a,b){if(a===b)return 1;const order=['entry','core','heavy','ultra'];const ia=order.indexOf(a),ib=order.indexOf(b);if(ia>=0&&ib>=0){const d=Math.abs(ia-ib);return d===1?.65:d===2?.25:0}return 0}\n",m=>m+familyFn);

c=c.replace("segment:segmentLabel(eligibility),acquisition:acquisition(text)","segment:segmentLabel(eligibility),product_family:productFamily('Telsim',name,eligibility),acquisition:acquisition(text)");
c=c.replace("segment:segmentLabel(eligibility),acquisition:p.acquisition||acquisition(text)","segment:segmentLabel(eligibility),product_family:productFamily('KKTCELL',name,eligibility),acquisition:p.acquisition||acquisition(text)");

c=c.replace(
"function hardGate(t,k){const reasons=[];if(t.billing_type!==k.billing_type)reasons.push('billing_type');if(t.closed||k.closed)reasons.push('closed');if(t.addon||k.addon)reasons.push('non_core');if(t.eligibility!==k.eligibility)reasons.push(`eligibility:${t.eligibility}≠${k.eligibility}`);return {ok:reasons.length===0,reasons}}",
"function hardGate(t,k){const reasons=[];if(t.billing_type!==k.billing_type)reasons.push('billing_type');if(t.closed||k.closed)reasons.push('closed');if(t.addon||k.addon)reasons.push('non_core');if(t.eligibility!==k.eligibility)reasons.push(`eligibility:${t.eligibility}≠${k.eligibility}`);if(t.product_family&&k.product_family&&t.product_family!==k.product_family)reasons.push(`product_family:${t.product_family}≠${k.product_family}`);if(t.product_family&&!k.product_family)reasons.push(`product_family_missing:${t.product_family}`);return {ok:reasons.length===0,reasons}}"
);

c=c.replace("const reasons=[`aynı erişim: ${t.segment}`", "const reasons=[`aynı erişim: ${t.segment}`,`ürün ailesi: ${t.product_family||'belirsiz'} ↔ ${k.product_family||'belirsiz'}`");

c=c.replace(
"  {kind:'negative',t:/super databol 3/i,k:/yeni go.*l\\b/i,label:'Super Databol 3 (90 gün) ↔ Yeni GO L (30 gün)'},",
"  {kind:'negative',t:/super databol xsmall/i,k:/yeni go.*world/i,label:'Super Databol XSmall ↔ GO World (family mismatch)'},\n  {kind:'negative',t:/super world xsmall/i,k:/yeni go.*xs/i,label:'Super World XSmall ↔ GO XS (family mismatch)'},\n  {kind:'negative',t:/super world xsmall/i,k:/hos geldin s|hoş geldin s/i,label:'Super World XSmall ↔ Hoş Geldin S (family missing)'},\n  {kind:'negative',t:/super databol 3/i,k:/yeni go.*l\\b/i,label:'Super Databol 3 (90 gün) ↔ Yeni GO L (30 gün)'},"
);

c=c.replace("engine_version:'2.2-shadow'","engine_version:'2.4-shadow-family-precedence'");

if(!c.includes("productFamily('Telsim'"))throw new Error('Telsim family injection failed');
if(!c.includes("productFamily('KKTCELL'"))throw new Error('KKTCELL family injection failed');
if(!c.includes('product_family_missing:${t.product_family}'))throw new Error('family precedence gate injection failed');

fs.writeFileSync(path,c);
console.log('[shadow-family-patch] applied v2.4 family precedence gate');
