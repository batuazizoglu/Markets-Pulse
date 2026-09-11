import * as cheerio from 'cheerio';
import crypto from 'crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function extractRelevantText(html, pageName) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  let text = $('body').text();
  text = text
    .split(/\r?\n/)
    .map(x => x.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, ''))
    .filter(Boolean)
    .join('\n');

  const copyrightIdx = text.lastIndexOf('© 2026 KKTC Telsim');
  if (copyrightIdx >= 0) text = text.slice(copyrightIdx);
  const pageIdx = text.indexOf(`\n${pageName}\n`);
  if (pageIdx >= 0) text = text.slice(pageIdx + pageName.length + 2);
  return text;
}

export function parseCards(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const starts = [];

  for (let i = 1; i < lines.length; i++) {
    if (/^\d+(?:[.,]\d+)?\s*(?:GB|MB)$/i.test(lines[i])) {
      const prev = lines[i - 1];
      if (isLikelyName(prev)) starts.push(i - 1);
    }
  }

  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  const cards = [];
  for (let x = 0; x < uniqueStarts.length; x++) {
    const start = uniqueStarts[x];
    const end = x + 1 < uniqueStarts.length ? uniqueStarts[x + 1] : Math.min(lines.length, start + 50);
    const chunk = lines.slice(start, end);
    const card = parseCard(chunk, cards.length);
    if (card && card.price_try != null) cards.push(card);
  }
  return cards;
}

function isLikelyName(s) {
  if (!s || s.length < 3 || s.length > 140) return false;
  if (/^(Faturalı|Faturasız|Tümü|Dijitale Özel Paketler|Super Databol|Super World|Askerfone|Diğer Faturasız Paketler)$/i.test(s)) return false;
  if (/^\+/.test(s) || /^\d+(?:[.,]\d+)?\s*(GB|MB|DK|SMS)$/i.test(s)) return false;
  if (/^(Detayları Göster|Hemen Başvur|Satın Al|₺|\/ ay)$/i.test(s)) return false;
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
  const extras = lines.filter(x => /Özgür Pass|Sınırsız|Aşım|Happy|Red Pasaport|yeni faturasız|Taahhüt|yaş|Grup İçi|FreeZone|sonlanmıştır|Havaliman|e-SİM|e-SIM/i.test(x));

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

function findPrice(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === '₺') {
      const m = lines[i + 1].match(/^(\d+(?:[.,]\d+)?)$/);
      if (m) return Number(m[1].replace(',', '.'));
    }
  }
  for (const line of lines) {
    const m = line.match(/^₺\s*(\d+(?:[.,]\d+)?)$/);
    if (m) return Number(m[1].replace(',', '.'));
  }
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
