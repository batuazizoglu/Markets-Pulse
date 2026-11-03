import {ProxyAgent} from 'undici';
import {captureTransportConfig} from './ad-capture-proxy.js';

const transient=new Set(['UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT','ECONNRESET','EAI_AGAIN']);
// This is only a transport retry for a configured official HTTPS source. HTTP
// denials, certificate failures, DNS absence and parser failures are not retried.
export async function withOfficialSourceTransport(source,allowedHosts,read,{env=process.env,createAgent=uri=>new ProxyAgent(uri)}={}){
  try{return await read(undefined)}catch(error){
    const code=error?.cause?.code||error?.code;
    if(!transient.has(code))throw error;
    const url=new URL(source.fetch_url||source.url);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!allowedHosts.has(url.hostname))throw error;
    const config=captureTransportConfig(env);
    if(!config.configured||!config.proxies?.length)throw error;
    // One configured connection only. No IP rotation or retry after a denial.
    const agent=createAgent(config.proxies[0].upstreamUrl);
    try{
      const result=await read(agent);
      return {...result,meta:{...result.meta,transport:'proxy',direct_error:code}};
    }catch(error){
      // Preserve only known transport diagnostics, never upstream text/URLs.
      const rawCode=error?.cause?.code||error?.code;
      const known=new Set([...transient,'ENOTFOUND','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','UND_ERR_HEADERS_TIMEOUT']);
      const http=String(error?.message||'').match(/^HTTP (\d{3})$/)?.[1];
      const reason=http?'HTTP '+http:known.has(rawCode)?rawCode:error?.name==='TimeoutError'?'TIMEOUT':null;
      throw new Error('Resmi kaynak bağlantısı doğrudan ve proxy üzerinden tamamlanamadı'+(reason?' ('+reason+')':''));
    }finally{await agent.destroy().catch(()=>{})}
  }
}
