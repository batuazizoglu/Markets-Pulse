import * as cheerio from 'cheerio';
import {SOURCE_DEFS} from './config.js';
import {parseValidatedTariffPage} from './tariff-contract.js';
import {sha256} from './parser.js';

export const acquisitionMenus = {
  'numara-tasima-teklifleri': ['port-in', 'Numara Taşıma Teklifleri'],
  'yeni-musteri-alimi-teklifleri': ['new-customer', 'Yeni Müşteri Alımı Teklifleri'],
  'faturali-hatta-gecis-teklifleri': ['postpaid-conversion', 'Faturalı Hatta Geçiş Teklifleri']
};
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/gu,' ').trim();
function fail(reason) { throw new Error('TARIFF_IDENTITY_REVIEW: ' + reason); }

// Decode only data records. Text frames are byte-sized and may contain literal
// newlines. Never run supplier JavaScript or search arbitrary script text for IDs.
function flightRecords($) {
  const chunks = [];
  for (const node of $('script').toArray()) {
    const match = /^self\.__next_f\.push\(([\s\S]*)\);?$/.exec($(node).text().trim());
    if (!match) continue;
    const frame = JSON.parse(match[1]);
    if (frame[0] === 1 && typeof frame[1] === 'string') chunks.push(frame[1]);
  }
  const bytes = Buffer.from(chunks.join(''));
  const records = new Map();
  for (let offset=0; offset<bytes.length;) {
    const colon=bytes.indexOf(58,offset);
    if (colon<offset) fail('incomplete transport header');
    const id=bytes.toString('utf8',offset,colon);
    if (!/^[a-f0-9]*$/.test(id)) fail('unknown transport header');
    offset=colon+1;
    if (bytes[offset]===84) { // Flight T record
      const comma=bytes.indexOf(44,offset), size=bytes.toString('ascii',offset+1,comma);
      if (comma<offset || !/^[a-f0-9]+$/.test(size)) fail('unknown text frame');
      offset=comma+1+Number.parseInt(size,16);
      if (offset>bytes.length) fail('truncated text frame');
      continue;
    }
    const end=bytes.indexOf(10,offset);
    if (end<0) fail('incomplete transport frame');
    if (id && [91,123].includes(bytes[offset])) {
      if (records.has(id)) fail('duplicate transport record');
      records.set(id,JSON.parse(bytes.toString('utf8',offset,end)));
    }
    offset=end+1;
  }
  return records;
}

function renderGrid(records) {
  const grids=[];
  function visit(node) {
    if (!node || typeof node!=='object') return;
    if (Array.isArray(node) && node[0]==='$' && node[1]==='div' &&
        node[3]?.className?.split(/\s+/).includes('grid-cols-1') &&
        node[3].className.split(/\s+/).includes('max-w-4xl')) grids.push(node[3].children);
    else for (const child of Object.values(node)) visit(child);
  }
  for (const value of records.values()) visit(value);
  if (grids.length!==1 || !Array.isArray(grids[0])) fail('no unique package render grid');
  const resolve=node=>typeof node==='string' && /^\$L?[a-f0-9]+$/.test(node)
    ? records.get(node.replace(/^\$L?/,'')) : node;
  return grids[0].map((entry,index)=>{
    const wrapper=resolve(entry), component=resolve(wrapper?.[3]?.children);
    if (wrapper?.[0]!=='$' || wrapper[1]!=='div' || wrapper[2]!==String(index) ||
        component?.[0]!=='$' || !component[3]?.packageData) fail('unknown package render slot');
    return component[3];
  });
}

export function readTariffIdentityPage(html,sourceSlug,menu=null) {
  const source=SOURCE_DEFS.find(s=>s.slug===sourceSlug);
  if (!source || (menu!==null && !Object.hasOwn(acquisitionMenus,menu))) fail('unknown source or channel');
  const $=cheerio.load(html), entries=renderGrid(flightRecords($));
  const shells=$('div.shadow-full'), grid=shells.first().parent().parent();
  if (!grid.hasClass('grid') || !entries.length || grid.children().length!==entries.length ||
      shells.length!==entries.length) fail('render grid and physical inventory disagree');
  const nav=grid.prev(), selected=nav.find('a.active_filter'), path=new URL(source.url).pathname;
  const href=menu ? path+'?menu='+menu : path;
  if (selected.length!==1 || selected.attr('href')!==href ||
      clean(selected.text())!==(menu?acquisitionMenus[menu][1]:'Tümü')) fail('selected source/filter not proven');
  const menus=nav.find('a').toArray().map(node=>$(node).attr('href')).filter(link=>link?.endsWith('-teklifleri'));
  const expected=sourceSlug==='diger-faturali'?Object.keys(acquisitionMenus).map(m=>path+'?menu='+m):[];
  if (JSON.stringify(menus.sort())!==JSON.stringify(expected.sort())) fail('channel menu inventory changed');
  const slots=entries.map(({packageData,activeMenu},index)=>{
    const {id,attributes:a}=packageData, shell=grid.children().eq(index).children('div.shadow-full');
    if (!Number.isSafeInteger(id) || id<=0 || activeMenu!==path.split('/').at(-1) ||
        shell.length!==1 || shell[0]!==shells[index] || !a || !clean(a.title) ||
        clean(shell.children().first().text())!==clean(a.title) ||
        clean(shell.find('h1.text-2xl').text())!==clean(a.Internet_Quota) ||
        !Number.isFinite(a.Price) || !/^\d+(?:[.,]\d+)?$/.test(clean(shell.find('h1.text-4xl').text())) ||
        Number(clean(shell.find('h1.text-4xl').text()).replace(',','.'))!==a.Price)
      fail('CMS fields disagree with rendered slot '+(index+1));
    const body=shell.clone();
    body.find('div,p,h1,span,button,a').append(' ');
    const visible=clean(body.text());
    for (const field of ['StarFeature','CallMinutes','Sms','Add_Details','Add_Details2','Add_Details3']) {
      if (a[field]!=null && (typeof a[field]!=='string' || !visible.includes(clean(a[field]))))
        fail('CMS commercial field disagrees with rendered slot '+(index+1));
    }
    return {offerId:String(id),title:clean(a.title),evidenceHash:sha256($.html(shell))};
  });
  return {slots,htmlHash:sha256(html)};
}

// Complete, locally supplied capture bundle. No partial result can drive absence.
export function buildTariffIdentitySnapshot(sourceSlug,pages) {
  const source=SOURCE_DEFS.find(s=>s.slug===sourceSlug);
  const menus=sourceSlug==='diger-faturali'?Object.keys(acquisitionMenus):[];
  const inputs=['catalogue',...menus];
  if (!source || Object.keys(pages).length!==inputs.length || inputs.some(k=>typeof pages[k]!=='string'))
    fail('missing or unexpected capture in source bundle');
  const main=readTariffIdentityPage(pages.catalogue,sourceSlug);
  const parsed=parseValidatedTariffPage(pages.catalogue,source,{includeCardIndexes:true});
  const byId=new Map(), channels=new Map(), evidence={catalogue:main.htmlHash};
  for (const slot of main.slots) {
    if (byId.has(slot.offerId) && byId.get(slot.offerId).evidenceHash!==slot.evidenceHash)
      fail('conflicting observations for supplier package '+slot.offerId);
    byId.set(slot.offerId,slot);
  }
  for (const menu of menus) {
    const filtered=readTariffIdentityPage(pages[menu],sourceSlug,menu);
    evidence[menu]=filtered.htmlHash;
    for (const slot of filtered.slots) {
      if (byId.get(slot.offerId)?.evidenceHash!==slot.evidenceHash) fail('inconsistent catalogue/filter observation '+slot.offerId);
      if (channels.has(slot.offerId) && channels.get(slot.offerId)!==menu) fail('multiple acquisition channels for '+slot.offerId);
      channels.set(slot.offerId,menu);
    }
  }
  const offers=new Map();
  parsed.cards.forEach((card,i)=>{
    const slot=main.slots[parsed.cardIndexes[i]], menu=channels.get(slot.offerId);
    if (card.name==='12 Ay Tarifeye Ek') {
      const quota=/^Red Box\s+(\d+(?:[.,]\d+)?)\s*GB$/i.exec(slot.title);
      if (!quota || Number(quota[1].replace(',','.'))!==card.data_gb)
        fail('Red Box header and body allowance disagree: '+slot.offerId);
    }
    const channel=menu?acquisitionMenus[menu][0]:'catalogue-only';
    const key=JSON.stringify([sourceSlug,channel,slot.offerId]);
    // The physical header labels Red Box; legacy text solely proves the historical observation.
    offers.set(key,{key,source:sourceSlug,channel,offerId:slot.offerId,title:slot.title,card});
  });
  const supported=new Set(parsed.cardIndexes);
  const excludedSlots=main.slots.filter((_,index)=>!supported.has(index));
  const excluded=parsed.validation.excluded.map((item,index)=>({...item,offerId:excludedSlots[index].offerId}));
  return {source:sourceSlug,evidence,offers:[...offers.values()],excluded};
}
