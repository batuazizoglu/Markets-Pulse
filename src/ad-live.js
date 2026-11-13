// Live visibility follows source observations, never the time of an AI reanalysis.
// The catalogue is verified every morning. Keep one short grace window for a
// delayed run, but never present a two-day-old observation as a current ad.
export const AD_ACTIVE_MAX_AGE_HOURS=30;
export function liveAdWindow(now=new Date()){
  return [new Date(+now-AD_ACTIVE_MAX_AGE_HOURS*3600000).toISOString(),new Date(+now+300000).toISOString()];
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
    ) INSERT INTO ad_live_status(page_id,ad_id,ad_status,checked_at)
    SELECT page_id,ad_id,'inactive',$3 FROM known WHERE page_id=$1 AND ad_id ~ '^\\d{5,30}$' AND NOT(ad_id=ANY($2::text[]))
    ON CONFLICT(page_id,ad_id) DO UPDATE SET ad_status='inactive',checked_at=EXCLUDED.checked_at
    WHERE ad_live_status.checked_at<EXCLUDED.checked_at`,[pageId,seenIds,checkedAt]);
}
