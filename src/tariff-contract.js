import * as cheerio from 'cheerio';
import {SOURCE_DEFS} from './config.js';
import {extractRelevantText, normalizeIdentity, parseCards} from './parser.js';

// This contract covers the existing GSM parser's supported card shapes. Known
// untracked shapes are inventoried explicitly, never silently treated as a
// disappearing tracked product. New layouts require a reviewed contract update.
export const TARIFF_CONTRACT_VERSION = 'telsim-dom-v2';
const shellSelector = 'div.shadow-full';
const quotaSelector = 'h1.text-2xl';
const priceSelector = 'h1.text-4xl';
const normalize = value => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function reject(reason, cardIndex) {
  const location = cardIndex == null ? '' : ` (kart ${cardIndex + 1})`;
  const error = new Error(`TARIFF_CONTRACT_ERROR: ${reason}${location}. Son doğrulanmış veriler korundu.`);
  error.code = 'TARIFF_CONTRACT_ERROR';
  throw error;
}

function amount(text) {
  let value = normalize(text).replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) value = value.replace(/\./g, '');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourceContract(source) {
  const expected = SOURCE_DEFS.find(item => item.slug === source.slug);
  if (!expected) reject('Kaynak için onaylı kart yapısı bulunamadı');
  try {
    const actual = new URL(source.url), configured = new URL(expected.url);
    if (actual.protocol !== 'https:' || actual.hostname !== configured.hostname ||
        actual.pathname.replace(/\/$/, '') !== configured.pathname || actual.username || actual.password) {
      reject('Kaynak adresi onaylı tarife sayfasıyla eşleşmiyor');
    }
  } catch (error) {
    if (error.code === 'TARIFF_CONTRACT_ERROR') throw error;
    reject('Kaynak adresi geçersiz');
  }
  return expected;
}

function supportedShape(name, quota, text, sourceSlug, hasPurchaseControl) {
  // The archive repeats the same display names as current offers, but the
  // archive combines standard data and Özgür Pass in the heading. Recognize
  // only the proven retired Super Red layout; never import it as a new offer.
  const red = /^Super Red (8|10|15|20|25|30)$/.exec(name);
  const combined = /^(\d+)\s*GB\s*\+\s*(\d+)\s*GB Özgür Pass$/i.exec(quota);
  if (sourceSlug === 'diger-faturali' && red && combined &&
      Number(red[1]) === Number(combined[1]) && Number(combined[2]) > 0 &&
      !hasPurchaseControl && text.split('\n').includes('Bu tarife sonlanmıştır')) {
    return {excluded: 'retired-super-red-combined-allowance'};
  }
  const standard = quota.match(/^(\d+(?:[.,]\d+)?)\s*GB(?:\s*\([^)]*\))?$/i);
  if (standard) return {data: Number(standard[1].replace(',', '.'))};
  // Red Box is already present under this legacy body-derived identity. Keep
  // that identity stable here; a channel/name migration needs historical proof.
  if (/^Red Box /i.test(name) && quota === '4.5G') {
    const rows = text.split('\n');
    const quotas = rows.filter(row => /^\d+(?:[.,]\d+)?\s*GB$/i.test(row));
    if (quotas.length === 1) return {data: Number(quotas[0].replace(/\s*GB$/i, '').replace(',', '.')), legacyName: '12 Ay Tarifeye Ek'};
    if (quotas.length === 0 && name === 'Red Box Sınırsız' && rows.includes('Sınırsız')) return {excluded: 'legacy-unlimited-redbox'};
    return null;
  }
  // Explicit exclusions preserve the existing monitoring scope. A source with
  // one of these shapes is not proof that every offer on the website is tracked.
  if (/^Askerfone (250|500)$/.test(name) && quota === 'İnternetsiz Paket') return {excluded: 'legacy-no-data'};
  if (/^\d+(?:[.,]\d+)?\s*MB$/i.test(quota)) return {excluded: 'legacy-mb-allowance'};
  if (/^\d+\s*GB(?:\s*\/\s*\d+\s*GB)+$/i.test(quota)) return {excluded: 'legacy-multiple-allowances'};
  if (/^\d+\s*GB\s*\+\s*\d+\s*GB\b/i.test(quota)) return {excluded: 'legacy-combined-allowance'};
  return null;
}

export function parseValidatedTariffPage(html, source, {includeCardIndexes = false} = {}) {
  const expected = sourceContract(source);
  if (typeof html !== 'string' || !/<\/body\s*>/i.test(html) || !/<\/html\s*>/i.test(html)) {
    reject('Kaynak HTML yanıtı tamamlanmamış');
  }
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const shells = $(shellSelector).toArray();
  if (!shells.length) reject('Tarife kartları bulunamadı veya sayfa yapısı değişti');
  const inventory = new Set(shells);
  const details = $('button,a').filter((_, node) => normalize($(node).text()) === 'Detayları Göster');
  // Independent markers detect a shell selector disappearing on just one card.
  for (const marker of [...$(priceSelector).toArray(), ...$(quotaSelector).toArray(), ...details.toArray()]) {
    if (!inventory.has($(marker).closest(shellSelector)[0])) reject('Kart sınırı dışında tarife alanı bulundu');
  }
  if ($(priceSelector).length !== shells.length || $(quotaSelector).length !== shells.length || details.length !== shells.length) {
    reject('Kart sayısı ile fiyat, kota veya detay alanı sayısı uyuşmuyor');
  }

  const cards = [], cardIndexes = [], excluded = [], purchasableRedCards = new Map();
  for (const [index, node] of shells.entries()) {
    const shell = $(node), sections = shell.children();
    if (shell.find(shellSelector).length || sections.length !== 2 || !sections.first().hasClass('rounded-t')) {
      reject('Kartın başlık ve içerik sınırları doğrulanamadı', index);
    }
    const name = normalize(sections.first().text());
    const body = sections.eq(1), quotas = body.find(quotaSelector), prices = body.find(priceSelector);
    const buttons = body.find('button,a').filter((_, item) => normalize($(item).text()) === 'Detayları Göster');
    if (!name || quotas.length !== 1 || prices.length !== 1 || buttons.length !== 1) reject('Kartta zorunlu veya tekil alan eksik', index);
    const price = amount(prices.text());
    const currency = normalize(prices.parent().text());
    if (price == null || !/^₺\s*\d/.test(currency)) reject('Ana fiyat alanı veya TL para birimi doğrulanamadı', index);
    const text = extractRelevantText(`<body>${$.html(node)}</body>`, '');
    const hasPurchaseControl = body.find('button,a').toArray().some(item =>
      /^(Hemen Başvur|Satın Al)$/i.test(normalize($(item).text())));
    const shape = supportedShape(name, normalize(quotas.text()), text, expected.slug, hasPurchaseControl);
    if (!shape) reject('Kota alanında tanınmayan veya belirsiz kart biçimi', index);
    const parsed = parseCards(text);
    if (shape.excluded) {
      if (parsed.length) reject('Kapsam dışı kart komşu alanlardan paket üretiyor', index);
      excluded.push({name, identity_base: normalizeIdentity(name), reason: shape.excluded,
        ...(/^Red Box /i.test(name) && name !== 'Red Box Sınırsız'
          ? {protected_identity_bases: [normalizeIdentity('12 Ay Tarifeye Ek')]} : {})});
      continue;
    }
    if (parsed.length !== 1) reject('Fiziksel kart tek bir eksiksiz pakete dönüştürülemedi', index);
    const card = parsed[0];
    if (card.name !== (shape.legacyName || name) || card.price_try !== price || card.data_gb !== shape.data) {
      reject('Okunan paket adı, fiyat veya kota kendi kart alanıyla eşleşmiyor', index);
    }
    // Competing SMS values cannot be resolved by simply taking the first one.
    const sms = [...text.matchAll(/(\d[\d.]*)\s*SMS\b/gi)].map(match => Number(match[1].replace(/\./g, '')));
    if (new Set(sms).size > 1) reject('Kartta çelişen SMS değerleri var', index);
    if (expected.slug === 'diger-faturali' && hasPurchaseControl && /^Super Red (8|10|15|20|25|30)$/.test(name) &&
        !text.split('\n').includes('Bu tarife sonlanmıştır')) {
      const hashes = purchasableRedCards.get(name) || new Set();
      hashes.add(card.product_hash);
      purchasableRedCards.set(name, hashes);
    }
    if (includeCardIndexes) cardIndexes.push(index);
    cards.push({...card, position: cards.length});
  }
  if (!cards.length) reject('Desteklenen ve doğrulanan tarife kartı bulunamadı');
  const relevantText = extractRelevantText(html, expected.name);
  // Also audit the text view. Losing all styling selectors on one otherwise
  // readable card must not hide it from both the inventory and removal guard.
  const pageHashes = parseCards(relevantText).map(card => card.product_hash).sort();
  const isolatedHashes = cards.map(card => card.product_hash).sort();
  if (JSON.stringify(pageHashes) !== JSON.stringify(isolatedHashes)) {
    reject('Sayfa içeriği ile doğrulanan kartların kapsamı veya alanları uyuşmuyor');
  }
  return {
    cards,
    relevantText,
    ...(includeCardIndexes ? {cardIndexes} : {}),
    validation: {contract_version: TARIFF_CONTRACT_VERSION, scope: 'supported-gsm-card-shapes',
      candidate_count: shells.length, validated_count: cards.length,
      excluded: excluded.map(item => {
        const hashes = purchasableRedCards.get(item.name);
        return item.reason === 'retired-super-red-combined-allowance' && hashes?.size === 1
          ? {...item, live_counterpart_hash: [...hashes][0]} : item;
      })}
  };
}
