// Offline only. Manifest paths are relative to the input file.
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {buildTariffIdentitySnapshot} from '../src/tariff-identity.js';
import {planLegacyBindings,previewScopedChanges} from '../src/tariff-identity-plan.js';

async function main(filename) {
  if (!filename) throw new Error('Usage: node scripts/tariff-identity-replay.js <manifest.json>');
  const manifest=JSON.parse(await readFile(filename,'utf8'));
  async function snapshot(paths) {
    const pages={};
    for (const [name,path] of Object.entries(paths)) pages[name]=await readFile(resolve(dirname(filename),path),'utf8');
    return buildTariffIdentitySnapshot(manifest.source,pages);
  }
  const result={source:manifest.source};
  if (manifest.products) {
    const archives=new Map();
    for (const [scanId,paths] of Object.entries(manifest.archives||{})) archives.set(scanId,await snapshot(paths));
    result.migration=planLegacyBindings(manifest.source,manifest.products,archives);
    if (!result.migration.ready) process.exitCode=2;
  }
  if (manifest.pages) {
    const current=await snapshot(manifest.pages);
    result.snapshot=current;
    if (manifest.previous) result.preview=previewScopedChanges(current,manifest.previous);
  }
  if (!result.snapshot && !result.migration) throw new Error('Missing pages or migration inventory');
  console.log(JSON.stringify(result,null,2));
}
main(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=2});
