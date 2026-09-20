import {captureTransportConfig,captureTransportStatus} from './ad-capture-proxy.js';

const terminalStatuses=new Set([401,403,407,429,451]);
const instant=value=>new Date(value).toISOString();
const atOrNull=value=>value==null?null:instant(value);

function terminalResponse(result){
  return result?.status==='rate_limited'||
    ['http_status','status_code','statusCode'].some(field=>terminalStatuses.has(Number(result?.[field])));
}

// Only a confirmed upstream network failure before any evidence was saved may
// select a second configured connection. An origin denial is never an outage.
export function canFailoverProxy(result,persistedCaptured=0){
  return Boolean(result&&result.reason==='PROXY_CONNECTION_FAILED'&&result.transport_only===true&&
    result.captured===0&&persistedCaptured===0&&!terminalResponse(result));
}

async function healthRows(db,proxies){
  if(!proxies.length)return new Map();
  const result=await db.query('SELECT * FROM ad_cloud_proxy_health WHERE proxy_key=ANY($1::text[])',[proxies.map(proxy=>proxy.key)]);
  return new Map(result.rows.map(row=>[row.proxy_key,row]));
}

function futureRetry(row,now){
  return row?.cooldown_until&&+new Date(row.cooldown_until)>+new Date(now)?instant(row.cooldown_until):null;
}

export async function getProxyPoolStatus(db,{env=process.env,now=Date.now()}={}){
  const config=captureTransportConfig(env),status=captureTransportStatus(env);
  if(config.mode!=='proxy'||!config.configured)return {...status,available_count:0,next_retry_at:null,proxies:[]};
  const rows=await healthRows(db,config.proxies);
  const proxies=config.proxies.map(proxy=>{
    const row=rows.get(proxy.key),retry_at=futureRetry(row,now);
    return {id:proxy.id,state:retry_at?'cooldown':row?.last_success_at&&row.consecutive_failures===0?'ready':'unverified',
      last_code:row?.last_code||null,last_success_at:atOrNull(row?.last_success_at),retry_at};
  });
  const retries=proxies.map(proxy=>proxy.retry_at).filter(Boolean).sort();
  return {...status,available_count:proxies.filter(proxy=>!proxy.retry_at).length,next_retry_at:retries[0]||null,proxies};
}

export async function selectCaptureProxy(db,{env=process.env,now=Date.now(),excludeKeys=[],pinnedKey=null}={}){
  const config=captureTransportConfig(env);
  const empty=(reason,retry_at=null)=>({proxy:null,reason,retry_at});
  if(config.mode!=='proxy')return empty(null);
  if(!config.configured)return empty(config.code);
  const candidates=pinnedKey==null?config.proxies:config.proxies.filter(proxy=>proxy.key===pinnedKey);
  if(pinnedKey!=null&&!candidates.length)return empty('PROXY_PIN_MISSING');
  const rows=await healthRows(db,candidates),excluded=new Set(excludeKeys),retries=[];
  for(const proxy of candidates){
    if(excluded.has(proxy.key))continue;
    const retry_at=futureRetry(rows.get(proxy.key),now);
    if(retry_at){retries.push(retry_at);continue}
    return {proxy:{mode:'proxy',configured:true,code:null,...proxy},reason:null,retry_at:null};
  }
  return empty('PROXY_POOL_COOLDOWN',retries.sort()[0]||null);
}

export async function recordProxyResult(db,proxy,result,{now=Date.now()}={}){
  if(!proxy?.key||proxy.mode!=='proxy'||!proxy.configured)return;
  const at=instant(now);
  if(canFailoverProxy(result)){
    await db.query(`INSERT INTO ad_cloud_proxy_health
      (proxy_key,consecutive_failures,cooldown_until,last_failure_at,last_code)
      VALUES($1,1,$2::timestamptz+INTERVAL '5 minutes',$2,'PROXY_CONNECTION_FAILED')
      ON CONFLICT(proxy_key) DO UPDATE SET
        consecutive_failures=LEAST(ad_cloud_proxy_health.consecutive_failures::bigint+1,2147483647)::integer,
        cooldown_until=$2::timestamptz+(LEAST(60,5*POWER(2,LEAST(ad_cloud_proxy_health.consecutive_failures,4)))*INTERVAL '1 minute'),
        last_failure_at=$2,last_code='PROXY_CONNECTION_FAILED'`,[proxy.key,at]);
  }else if(!terminalResponse(result)&&(result?.status==='no_ads'||result?.status==='partial'&&result.captured>0)){
    await db.query(`INSERT INTO ad_cloud_proxy_health
      (proxy_key,consecutive_failures,last_success_at)
      VALUES($1,0,$2)
      ON CONFLICT(proxy_key) DO UPDATE SET consecutive_failures=0,cooldown_until=NULL,
        last_success_at=$2,last_code=NULL`,[proxy.key,at]);
  }
}
