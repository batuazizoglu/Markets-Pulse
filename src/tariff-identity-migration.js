import {gunzipSync} from 'node:zlib';
import {buildTariffIdentitySnapshot} from './tariff-identity.js';
import {planLegacyBindings} from './tariff-identity-plan.js';

// Caller supplies one transaction on a quiescent staging copy. No database URL
// or service entry point is used. Only opt-in binding inserts are permitted.
export async function stageTariffBindings(tx,source,{writeBindings=false}={}) {
  const sourceRow=(await tx.query('SELECT id FROM sources WHERE slug=$1 FOR UPDATE',[source])).rows[0];
  if (!sourceRow) throw new Error('Unknown tariff source');
  const sourceId=sourceRow.id;
  const rows=(await tx.query(`SELECT p.id AS legacy_id,v.*
    FROM products p LEFT JOIN product_versions v ON v.product_id=p.id
    WHERE p.source_id=$1 ORDER BY p.id,v.id`,[sourceId])).rows;
  const products=new Map(), scans=new Set();
  for (const row of rows) {
    const id=String(row.legacy_id);
    if (!products.has(id)) products.set(id,{source,id,versions:[]});
    if (row.id!=null) { products.get(id).versions.push(row); scans.add(String(row.scan_id)); }
  }
  const archives=new Map(), rejected=[];
  for (const scanId of scans) {
    const originals=(await tx.query(`SELECT t.html_gzip FROM snapshots t JOIN scans s ON s.id=t.scan_id
      WHERE s.id=$1 AND s.source_id=$2 AND t.source_id=s.source_id AND s.status='ok'`,[scanId,sourceId])).rows;
    if (originals.length!==1 || !originals[0].html_gzip) {rejected.push({scanId,reason:'missing or ambiguous original HTML'});continue;}
    const companions=(await tx.query('SELECT menu,html_gzip FROM tariff_identity_channel_evidence WHERE scan_id=$1',[scanId])).rows;
    try {
      const unpack=bytes=>gunzipSync(bytes,{maxOutputLength:16*1024*1024}).toString('utf8');
      const pages={catalogue:unpack(originals[0].html_gzip)};
      for (const page of companions) {
        if (Object.hasOwn(pages,page.menu)) throw new Error('duplicate archive page');
        pages[page.menu]=unpack(page.html_gzip);
      }
      archives.set(scanId,buildTariffIdentitySnapshot(source,pages));
    } catch (error) { rejected.push({scanId,reason:error.message}); }
  }
  const plan=planLegacyBindings(source,[...products.values()],archives);
  if (writeBindings && plan.ready) {
    for (const bind of plan.bindings) {
      const args=[sourceId,bind.channel,bind.offerId,bind.productId,JSON.stringify(bind.evidence)];
      const existing=(await tx.query(`SELECT acquisition_channel,supplier_offer_id FROM tariff_product_identities
        WHERE source_id=$1 AND product_id=$2`,[sourceId,bind.productId])).rows[0];
      if (existing) {
        if (existing.acquisition_channel!==bind.channel || existing.supplier_offer_id!==bind.offerId)
          throw new Error('TARIFF_IDENTITY_REVIEW: existing binding disagrees');
        continue;
      }
      await tx.query(`INSERT INTO tariff_product_identities
        (source_id,acquisition_channel,supplier_offer_id,product_id,evidence_manifest)
        VALUES($1,$2,$3,$4,$5::jsonb)`,args);
    }
  }
  return {...plan,rejected};
}
