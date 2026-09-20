import {Server,RequestError} from 'proxy-chain';

const domains=['facebook.com','fbcdn.net','fbsbx.com','facebook.net'];
function allowedHost(host){return domains.some(d=>host===d||host.endsWith('.'+d))}
export function allowedAdRequest(raw){
  try{const u=new URL(raw);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&allowedHost(u.hostname)}catch{return false}
}
export function captureTransportConfig(env=process.env){
  const raw=String(env.AD_CAPTURE_PROXY_URL||'').trim();
  const mode=String(env.AD_CAPTURE_TRANSPORT||(raw?'proxy':'direct')).trim().toLowerCase();
  if(mode==='direct')return {mode,configured:true,code:null};
  const invalid={mode:'proxy',configured:false,code:'PROXY_CONFIG_INVALID'};
  if(mode!=='proxy')return invalid;
  if(!raw)return {mode,configured:false,code:'PROXY_CONFIG_MISSING'};
  try{
    const url=new URL(raw);
    if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.search||url.hash||url.pathname!=='/')return invalid;
    const username=String(env.AD_CAPTURE_PROXY_USERNAME||''),password=String(env.AD_CAPTURE_PROXY_PASSWORD||'');
    if(Boolean(username)!==Boolean(password)||Boolean(url.username)!==Boolean(url.password))return invalid;
    if((username||password)&&(url.username||url.password))return invalid;
    if(username){url.username=encodeURIComponent(username);url.password=encodeURIComponent(password)}
    // Reject malformed URL escapes before the transport library parses credentials.
    decodeURIComponent(url.username);decodeURIComponent(url.password);
    return {mode,configured:true,code:null,upstreamUrl:url.href};
  }catch{return invalid}
}
export function captureTransportStatus(env=process.env){
  const {mode,configured,code}=captureTransportConfig(env);
  return {mode,configured,code,message:mode==='direct'?'Reklam sayfaları doğrudan sunucudan taranır.':
    !configured?(code==='PROXY_CONFIG_MISSING'?'Reklam taraması için proxy bağlantısı bekleniyor.':'Proxy bağlantı ayarları kontrol edilmeli.'):
    'Reklam taramasının birincil bağlantısı proxy olarak ayarlandı. Kaynak erişimi tarama sırasında doğrulanır.'};
}
export async function openCaptureProxy(config){
  if(config.mode!=='proxy'||!config.configured||!config.upstreamUrl)throw new Error(config.code||'PROXY_CONFIG_INVALID');
  let failure=null;
  const server=new Server({host:'127.0.0.1',port:0,verbose:false,
    prepareRequestFunction:({hostname,port,isHttp})=>{
      if(failure==='PROXY_AUTH_FAILED'||failure==='PROXY_ACCESS_DENIED')throw new RequestError('Proxy access stopped',403);
      // This local adapter only tunnels TLS to Meta hosts. Credentials stay upstream,
      // never in Chromium arguments or origin-server HTTP authentication challenges.
      if(isHttp||port!==443||!allowedHost(hostname.toLowerCase()))throw new RequestError('Target not allowed',403);
      return {upstreamProxyUrl:config.upstreamUrl};
    }});
  server.on('tunnelConnectFailed',({response})=>{
    const code=response?.statusCode;
    failure=code===407?'PROXY_AUTH_FAILED':code===403?'PROXY_ACCESS_DENIED':'PROXY_CONNECTION_FAILED';
  });
  server.on('requestFailed',({error})=>{if(!(error instanceof RequestError))failure||='PROXY_CONNECTION_FAILED'});
  server.on('error',()=>{failure||='PROXY_CONNECTION_FAILED'});
  try{await server.listen()}catch{await server.close(true).catch(()=>{});throw new Error('PROXY_CONNECTION_FAILED')}
  return {server:'http://127.0.0.1:'+server.port,close:()=>server.close(true),getFailure:()=>failure};
}
