import {TRACKED_FIELDS} from './config.js';
import {rebaseCardBoundaries,rebaseCommercialTerms} from './parser.js';

const DAY_MS=86400000;
const FIELD_KEYS=new Map(TRACKED_FIELDS.map(([key,label])=>[label,key]));

function sameValue(a,b){
  if(a==null&&b==null)return true;
  if(typeof a==='object'||typeof b==='object')return JSON.stringify(a??null)===JSON.stringify(b??null);
  return String(a??'')===String(b??'');
}

function recordedValueMatches(value,stored){
  if(stored!=null&&typeof stored==='object'){
    try{return sameValue(JSON.parse(value),stored)}catch{return false}
  }
  return sameValue(value,stored);
}

// Retain every uncertain event. Only adjacent, original observations can prove
// that a legacy Red Junior card boundary created an otherwise unchanged field.
// Historical rows and evidence remain intact; this is a read-time classification.
function isBoundaryOnlyChange(row,event,previous){
  const field=FIELD_KEYS.get(row.field_name);
  if(row.change_type!=='field_changed'||!field||!event||!previous
    ||String(event.scan_id)!==String(row.scan_id)
    ||+new Date(event.captured_at)!==+new Date(row.detected_at)
    ||!recordedValueMatches(row.old_value,previous[field])
    ||!recordedValueMatches(row.new_value,event[field]))return false;
  try{
    const before=rebaseCardBoundaries(previous),after=rebaseCardBoundaries(event);
    if(before===previous&&after===event)return false;
    return sameValue(rebaseCommercialTerms(before,before)[field],rebaseCommercialTerms(after,after)[field]);
  }catch{return false}
}

export function competitiveWindow(days=30,now=new Date()){
  const window_days=Math.max(1,Math.min(180,Math.trunc(Number(days)||30)));
  const end=new Date(now);
  if(!Number.isFinite(+end))throw new RangeError('Invalid competitive window end');
  return {window_days,window_start:new Date(+end-window_days*DAY_MS).toISOString(),window_end:end.toISOString()};
}

// All mobile views use the same event-time product version and interval. Limits
// are only for the backwards-compatible latest-changes endpoint, never totals.
export async function loadCompetitiveChanges(pool,{start,end=new Date(),limit}={}){
  const baseParams=[new Date(end).toISOString()],baseWhere=['c.detected_at < $1::timestamptz'];
  if(start!=null){baseParams.push(new Date(start).toISOString());baseWhere.push('c.detected_at >= $2::timestamptz')}
  const resultLimit=limit==null?null:Math.max(1,Math.min(250,Math.trunc(Number(limit)||80)));
  const batchSize=resultLimit==null?null:Math.max(80,resultLimit),rows=[];
  let cursor=null;
  do{
    const params=[...baseParams],where=[...baseWhere];
    if(cursor){params.push(cursor.detected_at,cursor.id);where.push(`(c.detected_at,c.id) < ($${params.length-1}::timestamptz,$${params.length}::bigint)`)}
    let limitSql='';
    if(batchSize!=null){params.push(batchSize);limitSql=' LIMIT $'+params.length}
    const result=await pool.query(`SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,
    COALESCE(v.name,CASE WHEN c.change_type='added' THEN NULLIF(c.new_value,'')
      WHEN c.change_type='removed' THEN NULLIF(c.old_value,'')
      WHEN c.field_name='Paket Adı' THEN NULLIF(c.new_value,'') END,p.current_name,'Paket') product_name,
    p.identity_base,v.id event_version_id,v.extras_json,
    CASE WHEN c.change_type='field_changed' THEN to_jsonb(v) END _boundary_event_version,
    to_jsonb(previous) _boundary_previous_version
    FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id
    LEFT JOIN LATERAL (SELECT pv.* FROM product_versions pv
      WHERE pv.product_id=p.id AND pv.captured_at<=c.detected_at
      ORDER BY (pv.scan_id=c.scan_id) DESC NULLS LAST,pv.captured_at DESC,pv.id DESC LIMIT 1) v ON TRUE
    LEFT JOIN LATERAL (SELECT pv.* FROM product_versions pv
      WHERE c.change_type='field_changed' AND v.scan_id=c.scan_id AND pv.product_id=p.id
        AND (pv.captured_at,pv.id)<(v.captured_at,v.id)
      ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1) previous ON TRUE
    WHERE ${where.join(' AND ')} ORDER BY c.detected_at DESC,c.id DESC${limitSql}`,params);
    for(const row of result.rows){
      const {_boundary_event_version:event,_boundary_previous_version:previous,...publicRow}=row;
      if(!isBoundaryOnlyChange(publicRow,event,previous))rows.push(publicRow);
    }
    if(batchSize==null||result.rows.length<batchSize||rows.length>=resultLimit)break;
    cursor=result.rows.at(-1);
  }while(cursor);
  return resultLimit==null?rows:rows.slice(0,resultLimit);
}
