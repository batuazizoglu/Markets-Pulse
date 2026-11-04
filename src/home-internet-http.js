import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(gzip);

// The browser derives these views from products. Keep the complete default API
// contract for other consumers, without sending duplicate catalogs to the UI.
export function homeInternetBrowserPayload(data){
  const {fixed_products,fwa_products,fwa_comparison,opportunities,...browser}=data;
  return browser;
}

export async function sendHomeInternetMarket(req,res,data,{log=console.log}={}){
  const payload=req.query.view==='browser'?homeInternetBrowserPayload(data):data;
  const raw=Buffer.from(JSON.stringify(payload));
  const useGzip=raw.length>=1024&&req.acceptsEncodings('gzip')==='gzip';
  const body=useGzip?await compress(raw):raw;
  res.set('Cache-Control','private, no-store');
  res.vary('Accept-Encoding');
  if(useGzip)res.set('Content-Encoding','gzip');
  // Counts and transfer sizes help distinguish delivery problems from missing
  // data. Never log account identities, cookies, payloads or request headers.
  log('[home-internet-response]',JSON.stringify({role:req.appUser?.role||'unknown',
    view:req.query.view==='browser'?'browser':'full',products:payload.products?.length||0,
    changes:payload.changes?.length||0,json_bytes:raw.length,transfer_bytes:body.length,encoding:useGzip?'gzip':'identity'}));
  res.type('application/json').send(body);
}
