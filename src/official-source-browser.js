// Chromium builds valid certificate chains using its normal verifier. Never
// ignore certificate errors or turn a failed verification into a successful read.
export async function readOfficialHtml(browser,source,{userAgent}={}){
  const url=new URL(source.fetch_url||source.url),host=url.hostname.replace(/^www\./,'');
  const allowed=raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&u.hostname.replace(/^www\./,'')===host;}catch{return false;}};
  if(!allowed(url.href))throw new Error('Güvenli resmî kaynak adresi gerekli');
  const page=await browser.newPage();
  try{
    if(userAgent)await page.setUserAgent(userAgent);
    await page.setJavaScriptEnabled(false);
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const main=request.isNavigationRequest()&&request.frame()===page.mainFrame();
      (main&&allowed(request.url())?request.continue():request.abort()).catch(()=>{});
    });
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response?.ok())throw new Error('HTTP '+response?.status());
    if(!allowed(response.url()))throw new Error('Beklenmeyen alan adına yönlendirme; kaynak doğrulaması gerekli');
    const html=await response.text();
    if(html.length>8_000_000)throw new Error('Kaynak beklenen boyutu aşıyor');
    return {html,http_status:response.status()};
  }finally{await page.close().catch(()=>{});}
}
