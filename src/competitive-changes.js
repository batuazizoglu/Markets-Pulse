const DAY_MS=86400000;

export function competitiveWindow(days=30,now=new Date()){
  const window_days=Math.max(1,Math.min(180,Math.trunc(Number(days)||30)));
  const end=new Date(now);
  if(!Number.isFinite(+end))throw new RangeError('Invalid competitive window end');
  return {window_days,window_start:new Date(+end-window_days*DAY_MS).toISOString(),window_end:end.toISOString()};
}

// All mobile views use the same event-time product version and interval. Limits
// are only for the backwards-compatible latest-changes endpoint, never totals.
export async function loadCompetitiveChanges(pool,{start,end=new Date(),limit}={}){
  const params=[new Date(end).toISOString()],where=['c.detected_at < $1::timestamptz'];
  if(start!=null){params.push(new Date(start).toISOString());where.push('c.detected_at >= $2::timestamptz')}
  let limitSql='';
  if(limit!=null){params.push(Math.max(1,Math.min(250,Math.trunc(Number(limit)||80))));limitSql=' LIMIT $'+params.length}
  const result=await pool.query(`SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,
    COALESCE(v.name,CASE WHEN c.change_type='added' THEN NULLIF(c.new_value,'')
      WHEN c.change_type='removed' THEN NULLIF(c.old_value,'')
      WHEN c.field_name='Paket Adı' THEN NULLIF(c.new_value,'') END,p.current_name,'Paket') product_name,
    p.identity_base,v.id event_version_id,v.extras_json
    FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id
    LEFT JOIN LATERAL (SELECT pv.id,pv.name,pv.extras_json FROM product_versions pv
      WHERE pv.product_id=p.id AND pv.captured_at<=c.detected_at ORDER BY pv.captured_at DESC,pv.id DESC LIMIT 1) v ON TRUE
    WHERE ${where.join(' AND ')} ORDER BY c.detected_at DESC,c.id DESC${limitSql}`,params);
  return result.rows;
}
