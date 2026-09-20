import {Server,RequestError} from 'proxy-chain';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const domains=['facebook.com','fbcdn.net','fbsbx.com','facebook.net'];
function allowedHost(host){return domains.some(d=>host===d||host.endsWith('.'+d))}
export function allowedAdRequest(raw){
  try{const u=new URL(raw);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&allowedHost(u.hostname)}catch{return false}
}
export function captureTransportConfig(env=process.env){
  const raw=String(env.AD_CAPTURE_PROXY_URL||'').trim();
  const pool=String(env.AD_CAPTURE_PROXIES||'').trim();
  const mode=String(env.AD_CAPTURE_TRANSPORT||((raw||pool)?'proxy':'direct')).trim().toLowerCase();
  if(mode==='direct')return {mode,configured:true,code:null};
  const invalid={mode:'proxy',configured:false,code:'PROXY_CONFIG_INVALID'};
  if(mode!=='proxy')return invalid;
  if(!raw&&!pool)return {mode,configured:false,code:'PROXY_CONFIG_MISSING'};
  try{
    if(pool&&(raw||env.AD_CAPTURE_PROXY_USERNAME||env.AD_CAPTURE_PROXY_PASSWORD))return invalid;
    const entries=pool?JSON.parse(pool):[{id:'primary',url:raw,username:env.AD_CAPTURE_PROXY_USERNAME||'',password:env.AD_CAPTURE_PROXY_PASSWORD||''}];
    if(!Array.isArray(entries)||entries.length<1||entries.length>5)return invalid;
    const ids=new Set(),endpoints=new Set(),proxies=[];
    for(const entry of entries){
      if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(k=>!['id','url','username','password'].includes(k)))return invalid;
      if(typeof entry.id!=='string'||!/^[a-zA-Z0-9_-]{1,32}$/.test(entry.id)||ids.has(entry.id)||typeof entry.url!=='string')return invalid;
      if((entry.username!==undefined&&typeof entry.username!=='string')||(entry.password!==undefined&&typeof entry.password!=='string'))return invalid;
      const url=new URL(entry.url),username=entry.username||'',password=entry.password||'';
      if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.search||url.hash||url.pathname!=='/')return invalid;
      if(Boolean(username)!==Boolean(password)||Boolean(url.username)!==Boolean(url.password))return invalid;
      if((username||password)&&(url.username||url.password))return invalid;
      if(username){url.username=encodeURIComponent(username);url.password=encodeURIComponent(password)}
      // Canonical credentials avoid treating alternate percent encodings as distinct.
      url.username=encodeURIComponent(decodeURIComponent(url.username));
      url.password=encodeURIComponent(decodeURIComponent(url.password));
      if(endpoints.has(url.origin))return invalid;
      ids.add(entry.id);endpoints.add(url.origin);
      proxies.push({id:entry.id,upstreamUrl:url.href,key:createHash('sha256').update(url.href).digest('hex')});
    }
    return {mode,configured:true,code:null,upstreamUrl:proxies[0].upstreamUrl,proxies};
  }catch{return invalid}
}
export function captureTransportStatus(env=process.env){
  const {mode,configured,code,proxies}=captureTransportConfig(env);
  return {mode,configured,code,proxy_count:proxies?.length||0,message:mode==='direct'?'Reklam sayfaları doğrudan sunucudan taranır.':
    !configured?(code==='PROXY_CONFIG_MISSING'?'Reklam taraması için proxy bağlantısı bekleniyor.':'Proxy bağlantı ayarları kontrol edilmeli.'):
    'Reklam taramasının birincil bağlantısı proxy olarak ayarlandı. Kaynak erişimi tarama sırasında doğrulanır.'};
}
function proxyRetryDelay(value,now=Date.now()){
  const seconds=Number(value),delay=value&&Number.isFinite(seconds)?seconds*1000:Date.parse(value||'')-now;
  return Math.max(15*60000,Math.min(8640000000000000-now,Number.isNaN(delay)?15*60000:delay));
}
const networkCodes=new Set(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT']);
function networkFailure(error){return networkCodes.has(error?.code)?{reason:'PROXY_CONNECTION_FAILED',transport_only:true}:{reason:'PROXY_FAILED',transport_only:false}}
function responseFailure(response){
  const status=Number(response?.statusCode);
  if(status===407)return {reason:'PROXY_AUTH_FAILED',transport_only:false};
  if([401,403,451].includes(status))return {reason:'PROXY_ACCESS_DENIED',transport_only:false};
  if(status===429)return {reason:'PROXY_RATE_LIMITED',transport_only:false,retry_after_ms:proxyRetryDelay(response?.headers?.['retry-after'])};
  if([502,503,504].includes(status))return {reason:'PROXY_CONNECTION_FAILED',transport_only:true};
  return {reason:'PROXY_FAILED',transport_only:false};
}
export async function openCaptureProxy(config){
  if(config.mode!=='proxy'||!config.configured||!config.upstreamUrl)throw new Error(config.code||'PROXY_CONFIG_INVALID');
  let failure=null;
  const priority=value=>!value?0:value.transport_only?1:['PROXY_AUTH_FAILED','PROXY_ACCESS_DENIED'].includes(value.reason)?4:value.reason==='PROXY_RATE_LIMITED'?3:2;
  const remember=value=>{
    if(priority(value)>priority(failure))failure=value;
    else if(value.reason==='PROXY_RATE_LIMITED'&&failure?.reason===value.reason)failure.retry_after_ms=Math.max(failure.retry_after_ms,value.retry_after_ms);
  };
  const agentFor=(Agent,readyEvent)=>{
    const agent=new Agent({keepAlive:false,maxSockets:8});
    const createConnection=agent.createConnection;
    agent.createConnection=function(options,callback){
      const socket=createConnection.call(this,options,callback);
      let connecting=true;
      const timer=setTimeout(()=>{
        if(!connecting)return;
        const error=Object.assign(new Error('Proxy connection timeout'),{code:'ETIMEDOUT'});
        remember(networkFailure(error));socket.destroy(error);
      },15000);
      const clear=()=>{connecting=false;clearTimeout(timer)};
      socket.once(readyEvent,clear);
      socket.once('error',error=>{if(connecting)remember(networkFailure(error));clear()});
      socket.once('close',clear);
      return socket;
    };
    return agent;
  };
  // proxy-chain intentionally does not emit CONNECT socket errors. Observe only
  // upstream connection establishment, never infer it from a browser/DOM failure.
  const httpAgent=agentFor(http.Agent,'connect'),httpsAgent=agentFor(https.Agent,'secureConnect');
  const server=new Server({host:'127.0.0.1',port:0,verbose:false,
    prepareRequestFunction:({hostname,port,isHttp})=>{
      if(failure)throw new RequestError('Proxy access stopped',403);
      // This local adapter only tunnels TLS to Meta hosts. Credentials stay upstream,
      // never in Chromium arguments or origin-server HTTP authentication challenges.
      if(isHttp||port!==443||!allowedHost(hostname.toLowerCase()))throw new RequestError('Target not allowed',403);
      return {upstreamProxyUrl:config.upstreamUrl,httpAgent,httpsAgent};
    }});
  server.on('tunnelConnectFailed',({response,error})=>{remember(response?responseFailure(response):networkFailure(error))});
  server.on('requestFailed',({error})=>{if(!(error instanceof RequestError))remember(networkFailure(error))});
  server.on('error',()=>{remember({reason:'PROXY_FAILED',transport_only:false})});
  const close=async()=>{httpAgent.destroy();httpsAgent.destroy();await server.close(true)};
  try{await server.listen()}catch{await close().catch(()=>{});throw new Error('PROXY_FAILED')}
  return {server:'http://127.0.0.1:'+server.port,close,getFailure:()=>failure?.reason||null,getFailureDetails:()=>failure?{...failure}:null};
}
