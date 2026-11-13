// Defaults only bootstrap the singleton database policy. Runtime visibility and
// scheduling always read ad_lifecycle_policy so deployments do not own ad state.
export const AD_ACTIVE_MAX_AGE_HOURS=30;
export const AD_LIFECYCLE_DEFAULTS=Object.freeze({active_max_age_hours:AD_ACTIVE_MAX_AGE_HOURS,daily_scan_hour:6,timezone:'Asia/Famagusta'});
export async function getAdLifecyclePolicy(db){
  const row=(await db.query('SELECT active_max_age_hours,daily_scan_hour,timezone,updated_at FROM ad_lifecycle_policy WHERE id=1')).rows[0]||{};
  const active=Number(row.active_max_age_hours),hour=Number(row.daily_scan_hour);
  let timezone=typeof row.timezone==='string'?row.timezone:AD_LIFECYCLE_DEFAULTS.timezone;
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{timezone=AD_LIFECYCLE_DEFAULTS.timezone}
  return {active_max_age_hours:Number.isInteger(active)&&active>=1&&active<=168?active:AD_LIFECYCLE_DEFAULTS.active_max_age_hours,
    daily_scan_hour:Number.isInteger(hour)&&hour>=0&&hour<=23?hour:AD_LIFECYCLE_DEFAULTS.daily_scan_hour,timezone,updated_at:row.updated_at||null};
}
export function liveAdWindow(now=new Date(),policy=AD_LIFECYCLE_DEFAULTS){
  const hours=Number(policy.active_max_age_hours)||AD_ACTIVE_MAX_AGE_HOURS;
  return [new Date(+now-hours*3600000).toISOString(),new Date(+now+300000).toISOString()];
}
export function liveAdSql(alias,json='analysis_json'){
  const payload=`${alias}.${json}`;
  const checked=`COALESCE(l.checked_at,${alias}.observed_at)`;
  const status=`COALESCE(l.ad_status,${payload}->>'ad_status')`;
  return {join:`LEFT JOIN ad_live_status l ON l.page_id=${payload}->>'page_id' AND l.ad_id=${payload}->>'ad_id'`,checked,status,
    where:`${status}='active' AND ${checked}>=$1::timestamptz AND ${checked}<=$2::timestamptz`};
}
export async function recordAdStatus(db,ad){
  const at=ad.status_observed_at||ad.observed_at;
  if(!/^\d{5,30}$/.test(ad.page_id||'')||!/^\d{5,30}$/.test(ad.ad_id||'')||!at||!Number.isFinite(+new Date(at)))return;
  const status=['active','inactive'].includes(ad.ad_status)?ad.ad_status:'unknown';
  await db.query(`INSERT INTO ad_live_status_history(page_id,ad_id,ad_status,checked_at,source)
    VALUES($1,$2,$3,$4,'observation') ON CONFLICT(page_id,ad_id,ad_status,checked_at) DO NOTHING`,[ad.page_id,ad.ad_id,status,at]);
  await db.query(`INSERT INTO ad_live_status(page_id,ad_id,ad_status,checked_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(page_id,ad_id) DO UPDATE SET ad_status=EXCLUDED.ad_status,checked_at=EXCLUDED.checked_at
    WHERE ad_live_status.checked_at<EXCLUDED.checked_at OR
      (ad_live_status.checked_at=EXCLUDED.checked_at AND EXCLUDED.ad_status<>'active')`,[ad.page_id,ad.ad_id,status,at]);
}
// Only call after a complete, successful active-ad scan; partial/blocked scans prove no absence.
export async function retireMissingAds(db,pageId,seenIds,checkedAt){
  if(!/^\d{5,30}$/.test(pageId||''))return;
  await db.query(`WITH known AS (
      SELECT page_id,ad_id FROM ad_live_status
      UNION SELECT analysis_json->>'page_id',analysis_json->>'ad_id' FROM ad_visual_items
      UNION SELECT payload->>'page_id',payload->>'ad_id' FROM ad_cloud_candidates
    ) INSERT INTO ad_live_status_history(page_id,ad_id,ad_status,checked_at,source)
    SELECT page_id,ad_id,'inactive',$3,'complete_scan' FROM known
    WHERE page_id=$1 AND ad_id ~ '^\\d{5,30}$' AND NOT(ad_id=ANY($2::text[]))
    ON CONFLICT(page_id,ad_id,ad_status,checked_at) DO NOTHING`,[pageId,seenIds,checkedAt]);
  await db.query(`WITH known AS (
      SELECT page_id,ad_id FROM ad_live_status
      UNION SELECT analysis_json->>'page_id',analysis_json->>'ad_id' FROM ad_visual_items
      UNION SELECT payload->>'page_id',payload->>'ad_id' FROM ad_cloud_candidates
    ) INSERT INTO ad_live_status(page_id,ad_id,ad_status,checked_at)
    SELECT page_id,ad_id,'inactive',$3 FROM known WHERE page_id=$1 AND ad_id ~ '^\\d{5,30}$' AND NOT(ad_id=ANY($2::text[]))
    ON CONFLICT(page_id,ad_id) DO UPDATE SET ad_status='inactive',checked_at=EXCLUDED.checked_at
    WHERE ad_live_status.checked_at<EXCLUDED.checked_at`,[pageId,seenIds,checkedAt]);
}
