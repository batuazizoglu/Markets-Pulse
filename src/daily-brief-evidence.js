import {TRACKED_FIELDS} from './config.js';

const MOBILE_FIELDS=['name','data_gb','bonus_data_gb','local_tr_minutes','international_minutes','sms','validity_days','red_passport_days','price_try'];
const HOME_FIELDS=['product_key','name','source_slug','source_url','product_url','provider','brand','product_family','market_segment','technology',
  'speed_down_mbps','speed_up_mbps','price_monthly_try','effective_monthly_try','total_price_try','price_status','install_fee_try',
  'data_limit_gb','unlimited','duration_months','duration_days','bonus_months','bonus_days','availability','expires_at','campaign_text',
  'contract_months','commitment_months','contract_required'];
const MOBILE_KEYS=new Map([...TRACKED_FIELDS.map(([key,label])=>[label,key]),['Paket Adı','name']]);
const HOME_KEYS=new Map([
  ['Download Hızı','speed_down_mbps'],['Upload Hızı','speed_up_mbps'],['Efektif Aylık Ücret','effective_monthly_try'],
  ['Aylık Ücret','price_monthly_try'],['Toplam Ücret','total_price_try'],['Taahhüt / Ödeme Süresi','duration_months'],
  ['Hediye Ay','bonus_months'],['Ödeme Süresi (gün)','duration_days'],['Hediye Gün','bonus_days'],['Fiyat Durumu','price_status'],
  ['Kurulum Ücreti','install_fee_try'],['Limitsiz','unlimited'],['Kota','data_limit_gb'],['Teknoloji','technology'],
  ['Kampanya durumu','availability'],['Kampanya bitişi','expires_at'],['Kampanya koşulları','campaign_text']
]);
const id=value=>/^[1-9]\d*$/.test(String(value??''))?String(value):null;
const timestamp=value=>value!=null&&Number.isFinite(+new Date(value))?new Date(value).toISOString():null;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
function safeSnapshot(value,fields,verifiedAt){
  if(!object(value))return null;
  const result={};
  for(const key of fields){
    const item=value[key];
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))result[key]=item;
  }
  // The tariff parser stores explicit benefit/condition lines, never page HTML.
  if(Array.isArray(value.extras_json))result.extras_json=value.extras_json.filter(x=>typeof x==='string');
  const verified=timestamp(verifiedAt);if(verified)result.verified_at=verified;
  return result;
}
function recordedMatches(value,stored){
  if(value==null&&stored==null)return true;
  if(stored!=null&&typeof stored==='object'){
    try{return JSON.stringify(typeof value==='string'?JSON.parse(value):value)===JSON.stringify(stored)}catch{return false}
  }
  return String(value??'')===String(stored??'');
}
function attach(row,before,after,field){
  // A missing baseline is unknown, not a zero-price/zero-benefit offer. Keep
  // the event intact; attach only the side(s) actually observed at that event.
  if(row.change_type==='field_changed'&&field){
    if(before&&!recordedMatches(row.old_value,before[field]))before=null;
    if(after&&!recordedMatches(row.new_value,after[field]))after=null;
  }
  return {...row,...(before?{product_before:before}:{}),...(after?{product_after:after}:{})};
}

async function mobileEvidence(pool,rows){
  const events=new Map(),keys=[];
  for(const row of rows){
    const entry={product_id:id(row.product_id),scan_id:id(row.scan_id),event_version_id:id(row.event_version_id),
      source_id:id(row.source_id),source_slug:typeof row.source_slug==='string'?row.source_slug:null,detected_at:timestamp(row.detected_at)};
    if(!entry.product_id||!entry.scan_id||!entry.detected_at||(!entry.source_id&&!entry.source_slug)||row.change_type==='removed'){
      keys.push(null);continue;
    }
    const key=JSON.stringify(entry);keys.push(key);events.set(key,{key,...entry});
  }
  if(!events.size)return rows;
  const versionColumns=['id','product_id','scan_id','captured_at',...MOBILE_FIELDS,'extras_json'].map(key=>'pv.'+key).join(',');
  const result=await pool.query(`WITH requested AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS input(key text,product_id bigint,scan_id bigint,event_version_id bigint,source_id bigint,source_slug text,detected_at timestamptz)
  ) SELECT r.key,p.first_seen_at,to_jsonb(event) event_product,to_jsonb(previous) previous_product
    FROM requested r JOIN products p ON p.id=r.product_id
    JOIN sources s ON s.id=p.source_id AND (r.source_id IS NULL OR s.id=r.source_id) AND (r.source_slug IS NULL OR s.slug=r.source_slug)
    JOIN scans sc ON sc.id=r.scan_id AND sc.source_id=p.source_id
    LEFT JOIN LATERAL (SELECT ${versionColumns} FROM product_versions pv
      WHERE pv.product_id=p.id AND pv.scan_id=r.scan_id AND pv.captured_at<=r.detected_at
        AND (r.event_version_id IS NULL OR pv.id=r.event_version_id)
      ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1) event ON TRUE
    LEFT JOIN LATERAL (SELECT ${versionColumns} FROM product_versions pv
      JOIN scans ps ON ps.id=pv.scan_id AND ps.source_id=p.source_id
      WHERE pv.product_id=p.id AND (pv.captured_at,pv.id)<(event.captured_at,event.id)
      ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1) previous ON TRUE`,[JSON.stringify([...events.values()])]);
  const evidence=new Map(result.rows.map(row=>[row.key,row]));
  return rows.map((row,index)=>{
    const found=evidence.get(keys[index]);
    if(!found?.event_product)return row;
    const before=row.change_type==='added'?null:safeSnapshot(found.previous_product,MOBILE_FIELDS,found.previous_product?.captured_at);
    const after=safeSnapshot(found.event_product,MOBILE_FIELDS,found.event_product.captured_at);
    const field=MOBILE_KEYS.get(row.field_name)||(MOBILE_FIELDS.includes(row.field_key)?row.field_key:null);
    const firstSeen=timestamp(found.first_seen_at);
    return attach({...row,...(firstSeen?{first_seen_at:firstSeen}:{})},before,after,field);
  });
}

function scanProducts(scan,source){
  const products=new Map();
  const rows=[...(Array.isArray(scan?.payload_json)?scan.payload_json:[]),
    ...(Array.isArray(scan?.source_meta_json?.campaigns)?scan.source_meta_json.campaigns:[])];
  for(const row of rows){
    if(!object(row)||typeof row.product_key!=='string'||row.source_slug&&row.source_slug!==source)continue;
    // This is the same last-key-wins identity map used when the scan writes its diff.
    products.set(row.product_key,row);
  }
  return products;
}
async function homeEvidence(pool,rows){
  const scans=new Map(),keys=[];
  for(const row of rows){
    const entry={scan_id:id(row.scan_id),source_slug:typeof row.source_slug==='string'?row.source_slug:null};
    if(!entry.scan_id||!entry.source_slug||!timestamp(row.detected_at)||!row.product_key){keys.push(null);continue}
    const key=JSON.stringify(entry);keys.push(key);scans.set(key,{key,...entry});
  }
  if(!scans.size)return rows;
  const result=await pool.query(`WITH requested AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS input(key text,scan_id bigint,source_slug text)
  ) SELECT r.key,s.captured_at,s.payload_json,s.source_meta_json,
      previous.captured_at previous_captured_at,previous.payload_json previous_payload_json,previous.source_meta_json previous_source_meta_json
    FROM requested r JOIN home_internet_scans s ON s.id=r.scan_id AND s.source_slug=r.source_slug AND s.status='ok'
    LEFT JOIN LATERAL (SELECT p.captured_at,p.payload_json,p.source_meta_json FROM home_internet_scans p
      WHERE p.source_slug=s.source_slug AND p.status='ok' AND (p.captured_at,p.id)<(s.captured_at,s.id)
      ORDER BY p.captured_at DESC,p.id DESC LIMIT 1) previous ON TRUE`,[JSON.stringify([...scans.values()])]);
  const evidence=new Map(result.rows.map(scan=>{
    const source=scans.get(scan.key).source_slug;
    return [scan.key,{at:scan.captured_at,beforeAt:scan.previous_captured_at,after:scanProducts(scan,source),before:scanProducts({payload_json:scan.previous_payload_json,source_meta_json:scan.previous_source_meta_json},source)}];
  }));
  return rows.map((row,index)=>{
    const found=evidence.get(keys[index]);
    if(!found||+new Date(found.at)>+new Date(row.detected_at))return row;
    const before=row.change_type==='added'?null:safeSnapshot(found.before.get(row.product_key),HOME_FIELDS,found.beforeAt);
    const after=row.change_type==='removed'?null:safeSnapshot(found.after.get(row.product_key),HOME_FIELDS,found.at);
    const field=HOME_KEYS.get(row.field_name)||(HOME_FIELDS.includes(row.field_key)?row.field_key:null);
    return attach(row,before,after,field);
  });
}

// Read-time report evidence: bounded by the original event, never today's
// catalogue. One batched query per domain, even when a scan changed many fields.
export async function enrichDailyChanges(pool,{changes=[],homeChanges=[]}={}){
  const [mobile,home]=await Promise.all([mobileEvidence(pool,changes),homeEvidence(pool,homeChanges)]);
  return {changes:mobile,homeChanges:home};
}

// A tariff version is written only when its terms change. last_seen_at is the
// successful re-observation time, so an unchanged offer can still be fresh.
// However, a newer failed source check must not be disguised as fresh success.
export async function loadDailyMobileCatalog(pool,{start,end}={}){
  const from=timestamp(start),to=timestamp(end);
  if(!from||!to||from>to)throw new RangeError('A valid daily catalogue interval is required');
  const columns=['id','product_id','scan_id','captured_at',...MOBILE_FIELDS,'extras_json'].map(key=>'pv.'+key).join(',');
  const result=await pool.query(`SELECT p.id,p.first_seen_at,p.last_seen_at,s.slug source_slug,s.name source_name,s.url source_url,to_jsonb(version) product
    FROM products p JOIN sources s ON s.id=p.source_id
    JOIN LATERAL (SELECT sc.status,sc.finished_at FROM scans sc
      WHERE sc.source_id=p.source_id AND sc.started_at<=$2::timestamptz
      ORDER BY sc.started_at DESC,sc.id DESC LIMIT 1) latest ON TRUE
    JOIN LATERAL (SELECT ${columns} FROM product_versions pv JOIN scans vs ON vs.id=pv.scan_id AND vs.source_id=p.source_id
      WHERE pv.product_id=p.id AND pv.captured_at<=$2::timestamptz
      ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1) version ON TRUE
    WHERE p.active=TRUE AND p.last_seen_at>=$1::timestamptz AND p.last_seen_at<=$2::timestamptz
      AND latest.status='ok' AND (latest.finished_at IS NULL OR latest.finished_at<=$2::timestamptz)
    ORDER BY s.id,p.id`,[from,to]);
  return result.rows.map(row=>({...safeSnapshot(row.product,MOBILE_FIELDS,row.last_seen_at),id:row.id,product_id:row.id,
    brand:'Telsim',provider:'Telsim',source_slug:row.source_slug,source_name:row.source_name,source_url:row.source_url,
    first_seen_at:timestamp(row.first_seen_at)}));
}
