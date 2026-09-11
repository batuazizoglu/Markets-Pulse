import puppeteer from 'puppeteer';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote'
      ]
    }).catch(err => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

async function dismissCookieUi(page) {
  return page.evaluate(async () => {
    const normalize = s => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const acceptTerms = [
      'tümünü kabul et','hepsini kabul et','kabul et','kabul ediyorum','çerezleri kabul et',
      'accept all','accept cookies','allow all','i accept','agree','tamam','onayla'
    ];
    let clicked = 0;
    const clickables = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')];
    for (const el of clickables) {
      const text = normalize(el.innerText || el.value || el.getAttribute('aria-label') || el.title);
      if (!text) continue;
      if (acceptTerms.some(t => text === t || text.startsWith(t + ' ') || text.includes(t))) {
        try { el.click(); clicked++; } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 650));

    let removed = 0;
    const candidates = [...document.querySelectorAll('body *')];
    for (const el of candidates) {
      const text = normalize(el.innerText);
      if (!text || text.length > 1800) continue;
      const cookieLike = /(çerez|cookie|consent|gizlilik|privacy)/i.test(text);
      if (!cookieLike) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const fixedish = cs.position === 'fixed' || cs.position === 'sticky' || Number(cs.zIndex || 0) >= 100;
      const overlayish = fixedish && rect.width > 250 && rect.height > 50;
      const selectorLike = /cookie|consent|privacy|kvkk/i.test(`${el.id} ${el.className}`);
      if (overlayish || selectorLike) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-tw-cookie-hidden', '1');
        removed++;
      }
    }
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    return { clicked, removed };
  });
}

async function warmPage(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const step = 850;
      const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= max) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(resolve, 700);
        }
      }, 100);
    });
  });
}

async function markAndLocateTariffArea(page) {
  return page.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 150 && r.height >= 60 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    };
    const looksLikeTariff = el => {
      if (!visible(el)) return false;
      const text = String(el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 15 || text.length > 1800) return false;
      const hasData = /\b\d+(?:[.,]\d+)?\s*(?:GB|MB)\b/i.test(text);
      const hasPrice = /(?:₺\s*\d+|\b\d+(?:[.,]\d+)?\s*(?:TL|₺)(?:\s*\/\s*ay)?\b)/i.test(text);
      const hasActionOrBenefit = /(dk|sms|paket|tarife|başvur|satın|ay|gün|sınırsız|e-sim|esim)/i.test(text);
      return hasData && hasPrice && hasActionOrBenefit;
    };

    const all = [...document.querySelectorAll('main *,section *,article *,div *,li *')].filter(looksLikeTariff);
    const leaves = all.filter(el => ![...el.children].some(ch => looksLikeTariff(ch)));
    const cards = (leaves.length ? leaves : all)
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 160 && x.r.height > 75)
      .sort((a,b) => (a.r.top + window.scrollY) - (b.r.top + window.scrollY));

    if (!cards.length) return { found:false, count:0 };

    const groups = [];
    for (const item of cards) {
      const top = item.r.top + window.scrollY;
      let group = groups.find(g => Math.abs(g.center - top) < 1100);
      if (!group) { group = { center:top, items:[] }; groups.push(group); }
      group.items.push(item);
      group.center = group.items.reduce((s,x)=>s+x.r.top+window.scrollY,0)/group.items.length;
    }
    groups.sort((a,b) => b.items.length - a.items.length);
    const chosen = groups[0].items.slice(0, 24);

    for (const {el} of chosen) {
      el.setAttribute('data-tw-evidence-card','1');
      el.style.setProperty('outline','3px solid #e60000','important');
      el.style.setProperty('outline-offset','3px','important');
      el.style.setProperty('position', getComputedStyle(el).position === 'static' ? 'relative' : getComputedStyle(el).position, 'important');
    }

    const rects = chosen.map(({r}) => ({
      left:r.left + window.scrollX,
      top:r.top + window.scrollY,
      right:r.right + window.scrollX,
      bottom:r.bottom + window.scrollY
    }));
    let left=Math.min(...rects.map(r=>r.left));
    let top=Math.min(...rects.map(r=>r.top));
    let right=Math.max(...rects.map(r=>r.right));
    let bottom=Math.max(...rects.map(r=>r.bottom));
    const padX=45, padTop=130, padBottom=70;
    left=Math.max(0,left-padX);
    top=Math.max(0,top-padTop);
    right=Math.min(document.documentElement.scrollWidth,right+padX);
    bottom=Math.min(document.documentElement.scrollHeight,bottom+padBottom);
    const width=Math.max(320,right-left);
    const height=Math.min(3600,Math.max(240,bottom-top));
    return { found:true,count:chosen.length,clip:{x:left,y:top,width,height} };
  });
}

export async function captureEvidenceScreenshots(url) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const cookie = await dismissCookieUi(page);
    await warmPage(page);
    await new Promise(r => setTimeout(r, 700));

    const fullPage = await page.screenshot({ type:'png', fullPage:true, captureBeyondViewport:true });
    const focusInfo = await markAndLocateTariffArea(page);
    let focused = null;
    if (focusInfo?.found && focusInfo.clip) {
      await page.evaluate(y => window.scrollTo(0, Math.max(0, y - 80)), focusInfo.clip.y);
      await new Promise(r => setTimeout(r, 250));
      focused = await page.screenshot({ type:'png', clip:focusInfo.clip, captureBeyondViewport:true });
    }
    return {
      fullPage,
      focused,
      meta: {
        cookie_clicked: cookie?.clicked || 0,
        cookie_removed: cookie?.removed || 0,
        focus_found: Boolean(focusInfo?.found),
        focus_card_count: focusInfo?.count || 0,
        focus_clip: focusInfo?.clip || null
      }
    };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function captureFullPageScreenshot(url) {
  const result = await captureEvidenceScreenshots(url);
  return result.fullPage;
}

export async function closeScreenshotBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {}
  browserPromise = null;
}
