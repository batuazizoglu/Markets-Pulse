import {TRACKED_FIELDS} from './config.js';
import {rebaseCardBoundaries,rebaseCommercialTerms} from './parser.js';

function review(reason) { throw new Error('TARIFF_IDENTITY_REVIEW: '+reason); }
const same=(a,b)=>Array.isArray(a)||Array.isArray(b)
  ? JSON.stringify(a)===JSON.stringify(b) : String(a??'')===String(b??'');

// Archive snapshots must be built from the captured HTML of the version's own
// successful scan. A matching modern catalogue is never historical evidence.
export function planLegacyBindings(source,products,archives) {
  const bindings=[], holds=[], owners=new Map(), ids=new Set();
  if (!Array.isArray(products)) review('missing legacy product inventory');
  for (const product of products) {
    const id=String(product.id);
    if (!/^\d+$/.test(id) || ids.has(id) || product.source!==source) review('invalid legacy product inventory');
    ids.add(id);
    let identity=null;
    const evidence=[];
    try {
      if (!product.versions?.length) review('no version evidence');
      for (const version of product.versions) {
        const archive=archives.get(String(version.scan_id));
        if (!archive || archive.source!==source) review('missing same-scan source bundle');
        // Do not break ties with price, quota, hash, position or today's title.
        const candidates=archive.offers.filter(o=>o.card.name===version.name);
        if (candidates.length!==1) review('legacy name has no unique origin');
        const offer=candidates[0];
        if (!version.raw_text || version.raw_text!==offer.card.raw_text ||
            version.product_hash!==offer.card.product_hash ||
            TRACKED_FIELDS.some(([field])=>!Object.hasOwn(version,field) || !same(version[field],offer.card[field])))
          review('legacy observation disagrees with archive');
        if (identity && identity.key!==offer.key) review('legacy ID spans distinct offer identities');
        identity=offer;
        evidence.push({versionId:String(version.id),scanId:String(version.scan_id),pages:archive.evidence});
      }
      if (owners.has(identity.key)) review('multiple legacy products claim the same identity');
      owners.set(identity.key,id);
      bindings.push({productId:id,key:identity.key,source,channel:identity.channel,offerId:identity.offerId,evidence});
    } catch (error) {
      if (!error.message.startsWith('TARIFF_IDENTITY_REVIEW:')) throw error;
      holds.push({productId:id,reason:error.message});
    }
  }
  // The unit of cutover is a source. A partial mapping cannot safely establish absences.
  return {source,ready:holds.length===0,bindings:holds.length?[]:bindings,holds};
}

// Pure publication preview. Call once with the entire locked source inventory.
// previous contains the last accepted baseline for both live and inactive keys.
export function previewScopedChanges(snapshot,previous) {
  const known=new Map(), seen=new Set(), productIds=new Set(), events=[], observations=[];
  for (const item of snapshot.excluded) {
    const tracked=previous.filter(p=>p.active && (p.offerId===item.offerId || p.title===item.name ||
      (item.protected_identity_bases||[]).includes(p.card.identity_base)));
    if (!tracked.length) continue;
    const prior=tracked[0],live=snapshot.offers.find(o=>o.key===prior.key);
    const split=card=>card?.raw_text?.startsWith(item.name+' | ') &&
      /^\d+\s*GB$/i.test(card.raw_text.split(' | ')[1]) &&
      card.raw_text.split(' | ').some(row=>/^\+\s*\d+\s*GB Özgür Pass$/i.test(row)) &&
      !card.raw_text.includes('Bu tarife sonlanmıştır');
    if (item.reason==='retired-super-red-combined-allowance' && tracked.length===1 &&
        live && item.offerId!==live.offerId && live.card.product_hash===item.live_counterpart_hash &&
        split(prior.card) && split(live.card)) continue;
    review('tracked offer overlaps an excluded card: '+item.name);
  }
  for (const row of previous) {
    if (!row.productId || productIds.has(String(row.productId)) || typeof row.active!=='boolean' ||
        !Number.isSafeInteger(row.missingCount) || row.missingCount<0 ||
        row.source!==snapshot.source || known.has(row.key) ||
        row.key!==JSON.stringify([row.source,row.channel,row.offerId])) review('inconsistent existing binding');
    known.set(row.key,row);
    productIds.add(String(row.productId));
  }
  for (const offer of snapshot.offers) {
    if (offer.source!==snapshot.source || seen.has(offer.key) ||
        offer.key!==JSON.stringify([offer.source,offer.channel,offer.offerId])) review('inconsistent incoming binding');
    seen.add(offer.key);
  }
  for (const offer of snapshot.offers) {
    const prior=known.get(offer.key);
    if (!prior) {
      if (previous.some(p=>!seen.has(p.key) && (p.offerId===offer.offerId || p.title===offer.title)))
        review('possible channel transfer or supplier ID replacement: '+offer.offerId);
      observations.push({key:offer.key,state:'new'});
      if (previous.length) events.push({key:offer.key,type:'added'});
      continue;
    }
    observations.push({key:offer.key,productId:prior.productId,state:prior.active?'present':'returned',missingCount:0});
    if (!prior.active) events.push({key:offer.key,productId:prior.productId,type:'returned'});
    const before=rebaseCommercialTerms(rebaseCardBoundaries({...prior.card,current_name:prior.card.name}),offer.card);
    for (const [field,label,severity] of TRACKED_FIELDS) {
      if (!same(before[field],offer.card[field])) events.push({key:offer.key,productId:prior.productId,type:'field_changed',
        field:label,severity,before:before[field],after:offer.card[field]});
    }
    if (prior.title!==offer.title) events.push({key:offer.key,productId:prior.productId,type:'field_changed',field:'Paket Adı',before:prior.title,after:offer.title});
  }
  for (const prior of previous) {
    if (seen.has(prior.key) || !prior.active) continue;
    const missingCount=prior.missingCount+1;
    if (!Number.isSafeInteger(missingCount) || missingCount<1) review('invalid absence counter');
    observations.push({key:prior.key,productId:prior.productId,state:missingCount>=2?'removed':'missing',missingCount});
    if (missingCount>=2) events.push({key:prior.key,productId:prior.productId,type:'removed'});
  }
  return {observations,events};
}
