export const MOBILE_FIELDS=['name','data_gb','bonus_data_gb','local_tr_minutes','international_minutes','sms','validity_days','red_passport_days','price_try'];

// Both daily readers bind $1 to the same report cutoff. Versions are written
// only when terms change, so an unchanged product carries forward until a
// successful scan records its removal. Never use mutable products.active,
// last_seen_at or current_name to reconstruct a historical catalogue.
export const MOBILE_CATALOG_HISTORY_CTES=`
  completed_scans AS (
    SELECT * FROM scans WHERE status<>'running'
      AND started_at<=$1::timestamptz AND finished_at<=$1::timestamptz
  ), latest_checks AS (
    SELECT DISTINCT ON (source_id) * FROM completed_scans
    ORDER BY source_id,started_at DESC,id DESC
  ), successful_checks AS (
    SELECT DISTINCT ON (source_id) * FROM completed_scans WHERE status='ok'
    ORDER BY source_id,started_at DESC,id DESC
  ), historical_products AS (
    SELECT p.id,p.source_id,version.first_seen_at,successful.started_at verified_at,
      to_jsonb(version) product
    FROM successful_checks successful JOIN products p ON p.source_id=successful.source_id
      AND p.created_at<=$1::timestamptz
    JOIN LATERAL (
      SELECT pv.id,pv.product_id,pv.scan_id,pv.captured_at,
        ${MOBILE_FIELDS.map(key=>'pv.'+key).join(',')},pv.extras_json,
        vs.started_at version_scan_started_at,MIN(pv.captured_at) OVER () first_seen_at
      FROM product_versions pv JOIN completed_scans vs ON vs.id=pv.scan_id
        AND vs.source_id=p.source_id AND vs.status='ok'
      WHERE pv.product_id=p.id AND pv.captured_at<=vs.finished_at
      ORDER BY vs.started_at DESC,vs.id DESC,pv.captured_at DESC,pv.id DESC LIMIT 1
    ) version ON TRUE
    -- Recovery may insert a new product today with a version backdated to an
    -- old scan. Its immutable creation time above prevents retroactive entry.
    WHERE NOT EXISTS (
      SELECT 1 FROM changes c JOIN completed_scans removed ON removed.id=c.scan_id
        AND removed.source_id=p.source_id AND removed.status='ok'
      WHERE c.product_id=p.id AND c.source_id=p.source_id AND c.change_type='removed'
        AND c.detected_at<=removed.finished_at
        AND (removed.started_at,removed.id)>=(version.version_scan_started_at,version.scan_id)
    )
  )`;
