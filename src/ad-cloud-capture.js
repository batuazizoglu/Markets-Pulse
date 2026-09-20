import puppeteer from 'puppeteer';
import {createHash} from 'node:crypto';
import {allowedAdRequest,captureTransportConfig,openCaptureProxy} from './ad-capture-proxy.js';

export function adLibrarySource(source){
  if(!/^\d{5,30}$/.test(source.page_id||''))return null;
  const q=new URLSearchParams({active_status:'active',ad_type:'all',country:'CY',media_type:'all',search_type:'page',view_all_page_id:source.page_id});
  return 'https://www.facebook.com/ads/library/?'+q;
}
export function pageState(text,httpStatus=200){
  if(httpStatus===429)return 'rate_limited';
  if(httpStatus>=400)return 'error';
  if(/captcha|confirm you.re human|unusual traffic|temporarily blocked|access denied|giriş yapman gerekiyor|log in to continue|you must log in|reklam kütüphanesi şu anda kullanılamıyor|ad library is currently unavailable/i.test(text))return 'blocked';
  if(/(?:Library ID|Kütüphane Kodu)\s*:\s*\d{5,30}/i.test(text))return 'cards';
  if(/(?:^|\n)\s*(?:0 results|0 sonuç|no ads found|sonuç bulunamadı|no ads match your search criteria|hiçbir reklam arama kriterinizle eşleşmiyor)\s*(?:\n|$)/im.test(text))return 'no_ads';
  return 'unknown';
}
export function captureRetryDelay(value,now=Date.now()){
  const seconds=Number(value);
  const delay=value&&Number.isFinite(seconds)?seconds*1000:Date.parse(value||'')-now;
  return Math.max(15*60000,Math.min(86400000,Number.isFinite(delay)?delay:15*60000));
}

// Public rendered DOM only. No private GraphQL calls, saved account sessions or stealth plugins.
// Exported to exercise the same DOM extraction against representative fixtures.
export function markAdCards(){
  const idPattern=/(?:Library ID|Kütüphane Kodu)\s*:\s*(\d{5,30})/gi;
  const found=new Map();
  for(const el of document.querySelectorAll('span,div')){
    const text=el.innerText||el.textContent||'';
    if(text.length>100||!/(?:Library ID|Kütüphane Kodu)\s*:\s*\d{5,30}/i.test(text))continue;
    const id=text.match(/(?:Library ID|Kütüphane Kodu)\s*:\s*(\d{5,30})/i)[1];
    if(found.has(id))continue;
    let card=el;
    for(let depth=0;card&&depth<14;depth++,card=card.parentElement){
      const body=card.innerText||card.textContent||'';
      const ids=new Set([...body.matchAll(idPattern)].map(m=>m[1]));
      if(ids.size>1)break;
      const hasDetails=[...card.querySelectorAll('button,[role="button"]')].some(b=>/See ad details|Reklam Detaylarını Gör/i.test(b.innerText||b.textContent||''));
      const images=[...card.querySelectorAll('img,video')].filter(i=>{const r=i.getBoundingClientRect();return (i.tagName==='VIDEO'?i.readyState>=2&&i.videoWidth>=200&&i.videoHeight>=150:i.naturalWidth>=200&&i.naturalHeight>=150)&&r.width>=150&&r.height>=150});
      if(hasDetails&&images.length){
        card.setAttribute('data-mp-ad-card',id);
        found.set(id,{ad_id:id,ad_text:body.slice(0,8000),has_video:Boolean(card.querySelector('video'))});break;
      }
    }
  }
  return [...found.values()];
}
function restrictedDestination(raw){
  try{return /^\/(?:login(?:\.php)?|checkpoint|challenge)(?:\/|$)/i.test(new URL(raw).pathname)}catch{return true}
}
export async function captureCloudAds(source,onCapture,{maxAds=12,timeoutMs=110000,env=process.env,launch=options=>puppeteer.launch(options),openProxy=openCaptureProxy}={}){
  const url=adLibrarySource(source);
  if(!url)return {status:'unverified',captured:0,note:'Resmî Facebook sayfa kimliği doğrulanmadı; isim aramasından otomatik marka eşleştirilmedi.'};
  const transport=captureTransportConfig(env);
  if(!transport.configured)return {status:'blocked',captured:0,reason:transport.code,note:'Proxy bağlantısı hazır değil; reklam taraması başlamadı.'};
  let browser,proxy,timedOut=false,captured=0;
  const checkProxy=()=>{const failure=proxy?.getFailure();if(failure)throw new Error(failure)};
  const timeout=setTimeout(()=>{timedOut=true;browser?.close().catch(()=>{});proxy?.close().catch(()=>{})},timeoutMs);
  try{
    if(transport.mode==='proxy')proxy=await openProxy(transport);
    if(timedOut)throw new Error('Capture timeout');
    browser=await launch({headless:true,timeout:30000,
      ...(env.PUPPETEER_EXECUTABLE_PATH?{executablePath:env.PUPPETEER_EXECUTABLE_PATH}:{}),
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        ...(proxy?['--proxy-server='+proxy.server,'--proxy-bypass-list=<-loopback>','--disable-quic']:[])]});
    if(timedOut)throw new Error('Capture timeout');
    const page=await browser.newPage();await page.setViewport({width:1440,height:1100,deviceScaleFactor:1.5});
    await page.setRequestInterception(true);
    page.on('request',r=>{(allowedAdRequest(r.url())?r.continue():r.abort()).catch(()=>{})});
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    checkProxy();
    const httpStatus=response?.status()||0;
    if(httpStatus>=400)return {status:httpStatus===429?'rate_limited':[401,403,407].includes(httpStatus)?'blocked':'error',http_status:httpStatus,reason:'HTTP_'+httpStatus,retry_after_ms:httpStatus===429?captureRetryDelay(response.headers()['retry-after']):undefined,captured,note:'Ad Library erişimi HTTP '+httpStatus+' ile sonuçlandı. '+(httpStatus===429?'Kaynağın hız sınırı için beklenip sınırlı yeniden deneme yapılacak.':'Reklam yok olarak yorumlanmadı.')};
    if(restrictedDestination(page.url()))return {status:'blocked',http_status:httpStatus,reason:'ACCESS_RESTRICTED',captured,note:'Kaynak giriş veya doğrulama sayfasına yönlendirdi; tarama durduruldu.'};
    // Click an actual consent choice only; never remove login/challenge overlays.
    await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button,[role="button"]')];const b=buttons.find(x=>/^(Decline optional cookies|Only allow essential cookies|İsteğe bağlı çerezleri reddet|Yalnızca gerekli çerezlere izin ver)$/i.test((x.innerText||'').trim()));b?.click()});
    await page.waitForFunction(()=>/(Library ID|Kütüphane Kodu)\s*:|0 results|0 sonuç|no ads found|sonuç bulunamadı|no ads match your search criteria|hiçbir reklam arama kriterinizle eşleşmiyor|captcha|log in to continue|temporarily blocked|currently unavailable/i.test(document.body.innerText),{timeout:25000}).catch(()=>{});
    let text=await page.evaluate(()=>document.body.innerText.slice(0,60000));
    checkProxy();
    const state=pageState(text,httpStatus);
    if(state!=='cards')return {status:state==='no_ads'?'no_ads':state==='blocked'?'blocked':'error',http_status:httpStatus,reason:state==='blocked'?'ACCESS_RESTRICTED':state==='no_ads'?'NO_MATCHING_ADS':'CARDS_NOT_FOUND',captured,note:state==='no_ads'?'CY filtresinde açıkça sıfır sonuç gösterildi.':'Reklam kartları doğrulanamadı; erişim, oturum veya sayfa yapısı kontrolü gerekli.'};
    const seen=new Set();
    for(let scroll=0;scroll<4&&captured<maxAds;scroll++){
      const cards=await page.evaluate(markAdCards);
      for(const data of cards){
        if(seen.has(data.ad_id)||captured>=maxAds)continue;seen.add(data.ad_id);
        const card=await page.$('[data-mp-ad-card="'+data.ad_id+'"]');if(!card)continue;
        await card.scrollIntoView();
        const unobscured=await card.evaluate(el=>{const r=el.getBoundingClientRect(),x=Math.min(innerWidth-1,Math.max(1,r.x+r.width/2)),y=Math.min(innerHeight-1,Math.max(1,r.y+Math.min(r.height/2,400)));return el.contains(document.elementFromPoint(x,y))});
        if(!unobscured)continue;
        const box=await card.boundingBox();if(!box||box.height>2600||box.width>1500)continue;
        let creative;
        const images=await card.$$('img,video');
        for(const img of images){
          const usable=await img.evaluate(i=>{const r=i.getBoundingClientRect();return (i.tagName==='VIDEO'?i.readyState>=2&&i.videoWidth>=200&&i.videoHeight>=150:i.complete&&i.naturalWidth>=200&&i.naturalHeight>=150)&&r.width>=150&&r.height>=150});
          if(usable){creative=img;break}
        }
        if(!creative)continue;
        const shots=[Buffer.from(await card.screenshot({type:'jpeg',quality:85})),Buffer.from(await creative.screenshot({type:'jpeg',quality:90}))];
        if(shots.some(b=>b.length>1500000))continue;
        const at=new Date().toISOString();
        const evidence=shots.map(bytes=>({sha256:createHash('sha256').update(bytes).digest('hex'),bytes,captured_at:at}));
        checkProxy();
        await onCapture({brand:source.brand,page_id:source.page_id,ad_id:data.ad_id,variant_id:'1',source_url:url,
          observed_at:at,started_on:null,ad_status:/\bInactive\b|Aktif değil/i.test(data.ad_text)?'inactive':/\bActive\b|\bAktif\b/i.test(data.ad_text)?'active':'unknown',
          ad_text:data.ad_text,has_video:data.has_video,evidence});
        captured++;
      }
      if(captured>=maxAds)break;
      await page.evaluate(()=>window.scrollBy(0,1000));
      await new Promise(r=>setTimeout(r,900));
      text=await page.evaluate(()=>document.body.innerText.slice(0,60000));
      checkProxy();
      if(pageState(text)==='blocked'||restrictedDestination(page.url()))return {status:'blocked',reason:'ACCESS_RESTRICTED',captured,note:'Tarama sırasında erişim kısıtı görüldü; kaydedilmiş görseller korundu.'};
    }
    return {status:captured?'partial':'error',captured,note:captured+' reklam görseli bulut sunucusunda kaydedildi. CY filtresi; en fazla '+maxAds+' kart. Video varsa yalnız görünen kare kaydedildi. Görsel analizi ayrı kuyrukta işlenir.'};
  }catch(error){
    if(transport.mode==='proxy'&&!timedOut){
      const message=String(error?.message||'');
      const code=proxy?.getFailure()||(['PROXY_CONFIG_MISSING','PROXY_CONFIG_INVALID','PROXY_AUTH_FAILED','PROXY_ACCESS_DENIED','PROXY_CONNECTION_FAILED'].includes(message)?message:null);
      if(code||/ERR_(?:PROXY|TUNNEL)_/.test(message))return {status:'blocked',reason:code||'PROXY_CONNECTION_FAILED',captured,note:'Proxy bağlantısı kurulamadı veya erişim reddedildi. Bağlantı ayarları kontrol edilmeli; kaydedilmiş görseller korundu.'};
    }
    return {status:captured?'partial':'error',captured,note:timedOut?'Bulut taraması zaman aşımına uğradı; kaydedilmiş görseller korundu.':'Bulut tarayıcısı reklam kartlarını tamamlayamadı; kaydedilmiş görseller korundu.'};
  }finally{clearTimeout(timeout);await browser?.close().catch(()=>{});await proxy?.close().catch(()=>{})}
}
