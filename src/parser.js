import * as cheerio from 'cheerio';
import crypto from 'crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function extractRelevantText(html, pageName) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();

  // Cheerio's body.text() concatenates adjacent block elements on the
  // current Telsim/Next.js markup. Add explicit separators before reading
  // text so product name, allowance, benefit and price remain distinct.
  $('br').replaceWith('\n');
  $('div,section,article,li,p,h1,h2,h3,h4,h5,h6,button,a,td,th,tr').each((_, el) => {
    $(el).append('\n');
  });

  let text = $('body').text()
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map(x => x.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, ''))
    .filter(Boolean)
    .join('\n');

  // On Telsim pages the main tariff payload currently appears in the HTML
  // after an early footer/copyright block. Keep that portion when present.
  const copyrightIdx = text.lastIndexOf('© 2026 KKTC Telsim');
  if (copyrightIdx >= 0) text = text.slice(copyrightIdx);

  // Prefer an exact logical line match, but don't fail the scan if the page
  // wrapper changes — parseCards can still identify the tariff cards below.
  const lines = text.split('\n');
  const pageLine = lines.findIndex(x => x.toLocaleLowerCase('tr-TR') === pageName.toLocaleLowerCase('tr-TR'));
  if (pageLine >= 0) text = lines.slice(pageLine + 1).join('\n');

  return text;
}

export function parseCards(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const starts = [];

  for (let i = 1; i < lines.length; i++) {
    if (/^\d+(?:[.,]\d+)?\s*(?:GB|MB)(?:\s*\([^)]*\))?$/i.test(lines[i])) {
      // Normally the product name is immediately above the main allowance.
      // Walk back a few logical rows to survive harmless wrapper text.
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        if (isLikelyName(lines[j])) {
          starts.push(j);
          break;
        }
      }
    }
  }

  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  const cards = [];
  for (let x = 0; x < uniqueStarts.length; x++) {
    const start = uniqueStarts[x];
    const end = x + 1 < uniqueStarts.length ? uniqueStarts[x + 1] : Math.min(lines.length, start + 60);
    const chunk = lines.slice(start, end);
    const card = parseCard(chunk, cards.length);
    if (card && card.price_try != null && card.data_gb != null) cards.push(card);
  }
  return cards;
}

function isLikelyName(s) {
  if (!s || s.length < 3 || s.length > 140) return false;
  if (/^(Faturalı|Faturasız|Tümü|Dijitale Özel Paketler|Super Databol|Super World|Askerfone|Diğer Faturasız Paketler|Super Red|Super Simple|Super Cool|Red Junior|Super65|Asker'e Özel|PGM Çalışanlarına Özel|Kamu Çalışanlarına Özel|Sağlık Çalışanlarına Özel|Engelleri Aşan Tarifesi)$/i.test(s)) return false;
  if (/^\+/.test(s) || /^\d+(?:[.,]\d+)?\s*(GB|MB|DK|SMS)(?:\s*\([^)]*\))?$/i.test(s)) return false;
  if (/^(Detayları Göster|Hemen Başvur|Satın Al|₺|\/ ay)$/i.test(s)) return false;
  if (/^(Aşım Yok|Fatura Aşımı Yok|Sınırsız|Happy Avantajlar)$/i.test(s)) return false;
  return /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(s);
}

function parseCard(lines, position) {
  const name = lines[0];
  const raw = lines.join(' | ');
  const data = firstNumber(raw, /(?:^|\|)\s*(\d+(?:[.,]\d+)?)\s*GB\b/i);
  const bonus = firstNumber(raw, /\+\s*(\d+(?:[.,]\d+)?)\s*GB\b/i);
  const price = findPrice(lines);
  const sms = firstInt(raw, /(\d[\d.]*)\s*SMS\b/i);
  const redPassport = firstInt(raw, /(\d+)\s*Gün\s*Ücretsiz\s*Red\s*Pasaport/i);
  const validity = redPassport != null ? firstInt(raw.replace(/\d+\s*Gün\s*Ücretsiz\s*Red\s*Pasaport/ig, ''), /(\d+)\s*Gün(?:lük)?\b/i)
                                    : firstInt(raw, /(\d+)\s*Gün(?:lük)?\b/i);

  let local = firstInt(raw, /(\d[\d.]*)\s*DK\s*(?:Ada\s*İçi\s*(?:&|\+|ve)?\s*(?:TR|Türkiye)|Her\s*Yöne|TR\b)/i);
  if (local == null && /Ada içi Sınırsız/i.test(raw)) {
    local = firstInt(raw, /(\d[\d.]*)\s*DK\s*TR\b/i);
  }
  if (local == null) local = firstInt(raw, /(\d[\d.]*)\s*DK\b/i);

  const intl = firstInt(raw, /(\d[\d.]*)\s*DK\s*(?:Uluslararası|23\s*VF\s*Ülke)/i);
  const extras = withCommercialTerms(lines.filter(x => /Özgür Pass|Sınırsız|Aşım|Happy|Red Pasaport|yeni faturasız|Taahhüt|yaş|Grup İçi|FreeZone|sonlanmıştır|Havaliman|e-SİM|e-SIM/i.test(x)), lines);

  const canonical = {
    name,
    data_gb: data,
    bonus_data_gb: bonus,
    local_tr_minutes: local,
    international_minutes: intl,
    sms,
    validity_days: validity,
    red_passport_days: redPassport,
    price_try: price,
    extras
  };

  return {
    identity_base: normalizeIdentity(name),
    position,
    name,
    data_gb: data,
    bonus_data_gb: bonus,
    local_tr_minutes: local,
    international_minutes: intl,
    sms,
    validity_days: validity,
    red_passport_days: redPassport,
    price_try: price,
    extras_json: extras,
    raw_text: raw,
    product_hash: sha256(JSON.stringify(canonical))
  };
}

function commercialTerms(lines) {
  const prices = lines.filter(line => {
    const lower = line.toLocaleLowerCase('tr-TR');
    return /(?:ilk|ikinci|sonraki|son)\s+\d+\s*ay\b/.test(lower)
      && /(?:₺\s*\d|\d[\d.,]*\s*tl\b)/.test(lower);
  });
  // The allowance itself is tracked as Data; retain the Non-Stop promise
  // separately so changing GB does not duplicate the same numeric change.
  const nonStop = lines.some(line => /\bnon[\s-]*stop\b/i.test(line)) ? ['Non-Stop internet'] : [];
  return [...prices, ...nonStop];
}

function withCommercialTerms(extras, lines) {
  const additions = [...new Set(commercialTerms(lines))].filter(term => !extras.includes(term));
  return [...extras, ...additions];
}

// Compare the old observation using the newly tracked commercial terms. This
// never edits historical versions, and preserves stored fields/identity/hash.
// The scanner can save an enriched current version without calling that parser
// enrichment a market change. Null legacy raw text cannot prove a new term.
export function rebaseCommercialTerms(previous, current) {
  const extras = Array.isArray(previous.extras_json) ? previous.extras_json : [];
  const raw = typeof previous.raw_text === 'string' ? previous.raw_text.trim() : '';
  if (raw) return {...previous, extras_json: withCommercialTerms(extras, raw.split(/\s*\|\s*|\r?\n/).filter(Boolean))};
  const normalizedExtras = withCommercialTerms(extras, extras);
  const known = commercialTerms(normalizedExtras);
  const currentTerms = [...new Set(commercialTerms(Array.isArray(current.extras_json) ? current.extras_json : []))];
  const isNonStop = term => term === 'Non-Stop internet';
  const unknown = currentTerms.filter(term => !known.some(old => isNonStop(old) === isNonStop(term)));
  return {...previous, extras_json: [...normalizedExtras, ...unknown.filter(term => !normalizedExtras.includes(term))]};
}

function findPrice(lines) {
  const raw = lines.join(' ');

  // Handles both separate nodes (₺ / 3359) and compact renderings
  // such as "₺3359 / ay" or "₺ 449".
  let m = raw.match(/₺\s*(\d+(?:[.,]\d+)?)/);
  if (m) return Number(m[1].replace(',', '.'));

  // Fallback for text-only campaign cards that spell the currency out.
  m = raw.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*TL\b/i);
  if (m) return Number(m[1].replace(',', '.'));
  return null;
}

function firstNumber(text, re) {
  const m = text.match(re);
  return m ? Number(m[1].replace(',', '.').replace(/\.(?=\d{3}\b)/g, '')) : null;
}
function firstInt(text, re) {
  const m = text.match(re);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}

export function normalizeIdentity(name) {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|mb)\b/gi, '')
    .replace(/[’']/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}
