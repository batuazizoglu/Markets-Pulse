// One frozen rolling 30-day window; never add totals from overlapping daily/weekly PDFs.
export async function collectMonthlyData(pool,start,end){
  const range=[new Date(start).toISOString(),new Date(end).toISOString()];
  const [mobile,home,baseline,proof,trend,coverage]=await Promise.all([
    pool.query(`SELECT c.*,s.slug source_slug,s.name source_name,s.url source_url,p.current_name product_name,p.identity_base,v.extras_json
      FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id
      LEFT JOIN LATERAL (SELECT extras_json FROM product_versions WHERE product_id=p.id AND captured_at<=c.detected_at ORDER BY captured_at DESC,id DESC LIMIT 1) v ON TRUE
      WHERE c.detected_at >= $1 AND c.detected_at < $2 ORDER BY c.detected_at DESC,c.id DESC`,range),
    pool.query('SELECT * FROM home_internet_changes WHERE detected_at >= $1 AND detected_at < $2 ORDER BY detected_at DESC,id DESC',range),
    pool.query('SELECT DISTINCT ON (segment) segment,score,bucket_at FROM competitive_position_history WHERE bucket_at <= $1 ORDER BY segment,bucket_at DESC',[range[0]]),
    pool.query(`SELECT sn.id,sn.source_id,sn.captured_at,sn.kind,s.name source_name,
      COALESCE(octet_length(sn.focused_screenshot_png),0)>0 has_focus,COALESCE(octet_length(sn.screenshot_png),0)>0 has_screenshot,
      COALESCE(octet_length(sn.html_gzip),0)>0 has_html,(sn.extracted_json IS NOT NULL AND sn.extracted_json<>'null'::jsonb) has_json
      FROM snapshots sn JOIN sources s ON s.id=sn.source_id WHERE sn.captured_at >= $1 AND sn.captured_at < $2
      ORDER BY (sn.kind='change') DESC,sn.captured_at DESC,sn.id DESC`,range),
    pool.query(`SELECT date_trunc('week',bucket_at AT TIME ZONE 'Asia/Famagusta')::date::text week,segment,
      round(avg(score)::numeric,1) average_score,count(score)::int samples,min(bucket_at) first_sample,max(bucket_at) last_sample
      FROM competitive_position_history WHERE bucket_at >= $1 AND bucket_at < $2 AND score IS NOT NULL
      GROUP BY 1,segment ORDER BY 1,segment`,range),
    pool.query(`SELECT 'Mobil' domain,s.name source,min(sc.started_at) first_recorded,
      count(sc.id) FILTER (WHERE sc.started_at >= $1 AND sc.started_at < $2)::int scans,
      count(sc.id) FILTER (WHERE sc.started_at >= $1 AND sc.started_at < $2 AND sc.status='ok')::int successful
      FROM sources s LEFT JOIN scans sc ON sc.source_id=s.id GROUP BY s.id,s.name
      UNION ALL SELECT 'Ev İnterneti / FWA',source_slug,min(captured_at),
      count(*) FILTER (WHERE captured_at >= $1 AND captured_at < $2)::int,
      count(*) FILTER (WHERE captured_at >= $1 AND captured_at < $2 AND status='ok')::int
      FROM home_internet_scans GROUP BY source_slug ORDER BY 1,2`,range)
  ]);
  // Spread the first image selections across sources, then fill remaining slots.
  const visual=proof.rows.filter(x=>x.has_focus||x.has_screenshot),chosen=[],seen=new Set();
  for(const row of visual)if(!seen.has(row.source_id)&&chosen.length<4){chosen.push(row);seen.add(row.source_id);}
  for(const row of visual)if(chosen.length<4&&!chosen.includes(row))chosen.push(row);
  const images=chosen.length?(await pool.query(`SELECT sn.id,sn.captured_at,sn.kind,s.name source_name,
    CASE WHEN COALESCE(octet_length(sn.focused_screenshot_png),0)>0 THEN sn.focused_screenshot_png ELSE sn.screenshot_png END focused_screenshot_png
    FROM snapshots sn JOIN sources s ON s.id=sn.source_id WHERE sn.id=ANY($1::bigint[]) ORDER BY sn.captured_at DESC,sn.id DESC`,[chosen.map(x=>x.id)])).rows:[];
  const complete=proof.rows.filter(x=>x.has_focus&&x.has_screenshot&&x.has_html&&x.has_json).length;
  return {changes:mobile.rows,homeChanges:home.rows,baseline:Object.fromEntries(baseline.rows.map(x=>[x.segment,x])),evidence:images,trend:trend.rows,coverage:coverage.rows,
    summary:{evidence_total:proof.rows.length,evidence_complete:complete,evidence_missing:proof.rows.length-complete,evidence_visual:visual.length,selected_evidence_ids:images.map(x=>String(x.id))}};
}
