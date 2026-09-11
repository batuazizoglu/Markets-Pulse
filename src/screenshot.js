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

export async function captureFullPageScreenshot(url) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let total = 0;
        const step = 800;
        const timer = setInterval(() => {
          const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          window.scrollBy(0, step);
          total += step;
          if (total >= h) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 600);
          }
        }, 120);
      });
    });
    await new Promise(r => setTimeout(r, 800));
    return await page.screenshot({ type: 'png', fullPage: true, captureBeyondViewport: true });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function closeScreenshotBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {}
  browserPromise = null;
}
