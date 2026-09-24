import {PROVIDER_SCHEMA_SQL} from './ad-provider-schema.js';
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scans (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  http_status INTEGER,
  response_ms INTEGER,
  page_hash TEXT,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_source_time ON scans(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  identity_base TEXT NOT NULL,
  current_name TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  missing_count INTEGER NOT NULL DEFAULT 0,
  last_position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_source_active ON products(source_id, active);
CREATE INDEX IF NOT EXISTS idx_products_identity ON products(source_id, identity_base);

CREATE TABLE IF NOT EXISTS product_versions (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scan_id BIGINT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  card_position INTEGER,
  data_gb NUMERIC,
  bonus_data_gb NUMERIC,
  local_tr_minutes INTEGER,
  international_minutes INTEGER,
  sms INTEGER,
  validity_days INTEGER,
  red_passport_days INTEGER,
  price_try NUMERIC,
  extras_json JSONB,
  raw_text TEXT,
  product_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_product_time ON product_versions(product_id, captured_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS changes (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  change_type TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL,
  scan_id BIGINT NOT NULL REFERENCES scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_changes_time ON changes(detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_changes_scan_source ON changes(scan_id, source_id);
CREATE INDEX IF NOT EXISTS idx_changes_source_time ON changes(source_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  scan_id BIGINT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  page_hash TEXT,
  html_gzip BYTEA,
  extracted_json JSONB,
  screenshot_png BYTEA,
  focused_screenshot_png BYTEA,
  screenshot_error TEXT,
  focused_screenshot_error TEXT,
  screenshot_meta JSONB
);
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS screenshot_png BYTEA;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS focused_screenshot_png BYTEA;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS screenshot_error TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS focused_screenshot_error TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS screenshot_meta JSONB;
CREATE INDEX IF NOT EXISTS idx_snapshots_source_time ON snapshots(source_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(captured_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS competitive_position_history (
  id BIGSERIAL PRIMARY KEY,
  bucket_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  segment TEXT NOT NULL,
  score INTEGER,
  level TEXT,
  confidence TEXT,
  match_count INTEGER NOT NULL DEFAULT 0,
  kktcell_advantage_count INTEGER NOT NULL DEFAULT 0,
  telsim_advantage_count INTEGER NOT NULL DEFAULT 0,
  parity_count INTEGER NOT NULL DEFAULT 0,
  avg_value_gap_pct NUMERIC,
  avg_match_score NUMERIC,
  rationale TEXT,
  details_json JSONB,
  UNIQUE(segment,bucket_at)
);
CREATE INDEX IF NOT EXISTS idx_comp_position_segment_time ON competitive_position_history(segment,bucket_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_position_time ON competitive_position_history(bucket_at DESC);

CREATE TABLE IF NOT EXISTS report_runs (
  id BIGSERIAL PRIMARY KEY,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  delivery_status TEXT NOT NULL DEFAULT 'generated',
  recipients TEXT[],
  sent_at TIMESTAMPTZ,
  file_name TEXT,
  file_size_bytes BIGINT,
  error TEXT,
  meta_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_report_runs_type_time ON report_runs(report_type,generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_runs_delivery ON report_runs(delivery_status,generated_at DESC);
CREATE TABLE IF NOT EXISTS home_internet_scans (
  id BIGSERIAL PRIMARY KEY,
  source_slug TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  technology TEXT,
  ownership_group TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  http_status INTEGER,
  response_ms INTEGER,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB,
  source_meta_json JSONB,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_home_internet_scans_source_time ON home_internet_scans(source_slug,captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_internet_scans_time ON home_internet_scans(captured_at DESC);

CREATE TABLE IF NOT EXISTS home_internet_changes (
  id BIGSERIAL PRIMARY KEY,
  source_slug TEXT NOT NULL,
  provider TEXT NOT NULL,
  product_key TEXT,
  product_name TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  scan_id BIGINT REFERENCES home_internet_scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_home_internet_changes_time ON home_internet_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_internet_changes_source_time ON home_internet_changes(source_slug,detected_at DESC);

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('admin','standard')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  invite_sent_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users((lower(email)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users((lower(username)));
CREATE INDEX IF NOT EXISTS idx_app_users_active_role ON app_users(active,role);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS bootstrap_email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_bootstrap_email_lower ON app_users((lower(bootstrap_email))) WHERE bootstrap_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id,expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  identity TEXT,
  event TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  meta_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_time ON auth_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user_time ON auth_audit(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS social_watch_observations (
  id BIGSERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ad','post','page')),
  source_url TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_social_watch_brand_time ON social_watch_observations(brand,created_at DESC);
CREATE TABLE IF NOT EXISTS ad_visual_evidence (
  sha256 TEXT PRIMARY KEY,
  jpeg BYTEA NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ad_report_image_assets (
  sha256 TEXT PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  jpeg BYTEA NOT NULL CHECK(octet_length(jpeg) BETWEEN 1 AND 153600),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 960),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ad_visual_items (
  ad_key TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('home','gsm','mnp','review')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  meaning_hash TEXT NOT NULL,
  analysis_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_visual_categories (
  category_key TEXT PRIMARY KEY CHECK(length(category_key)<=80 AND category_key ~ '^auto-[a-z0-9]+(-[a-z0-9]+)*$'),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_ad_key TEXT NOT NULL
);
ALTER TABLE ad_visual_items DROP CONSTRAINT IF EXISTS ad_visual_items_category_check;
ALTER TABLE ad_visual_items ADD CONSTRAINT ad_visual_items_category_check CHECK(
  category IN ('home','gsm','mnp','review') OR (length(category)<=80 AND category ~ '^auto-[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE TABLE IF NOT EXISTS ad_visual_versions (
  id BIGSERIAL PRIMARY KEY,
  ad_key TEXT NOT NULL REFERENCES ad_visual_items(ad_key),
  observed_at TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('first_seen','changed')),
  analysis_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_visual_items_page ON ad_visual_items(observed_at DESC,ad_key);
CREATE INDEX IF NOT EXISTS idx_ad_visual_items_filter_page ON ad_visual_items(brand,category,observed_at DESC,ad_key);
CREATE INDEX IF NOT EXISTS idx_ad_visual_versions_time ON ad_visual_versions(observed_at DESC);
CREATE TABLE IF NOT EXISTS ad_visual_sync (
  id INTEGER PRIMARY KEY CHECK(id=1),
  run_id TEXT,
  checked_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  status TEXT,
  coverage_json JSONB,
  schedule_json JSONB,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ad_cloud_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  scheduled_day TEXT,
  manual_after TIMESTAMPTZ,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  vision_day TEXT,
  vision_calls INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ad_cloud_control(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ad_cloud_jobs (
  id BIGSERIAL PRIMARY KEY,
  batch_key TEXT NOT NULL,
  brand TEXT NOT NULL,
  source_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  captured INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE(batch_key,brand)
);
CREATE INDEX IF NOT EXISTS idx_ad_cloud_jobs_queue ON ad_cloud_jobs(status,available_at);
ALTER TABLE ad_cloud_jobs ADD COLUMN IF NOT EXISTS proxy_key TEXT;
ALTER TABLE ad_cloud_jobs ADD COLUMN IF NOT EXISTS proxy_attempts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ad_cloud_proxy_health (
  proxy_key TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_code TEXT
);
CREATE TABLE IF NOT EXISTS ad_cloud_candidates (
  ad_key TEXT PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES ad_cloud_jobs(id),
  fingerprint TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  analysis_json JSONB,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_at TIMESTAMPTZ NOT NULL,
  analyzed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ad_cloud_candidates_queue ON ad_cloud_candidates(status,available_at);
CREATE INDEX IF NOT EXISTS idx_ad_cloud_pending_archive ON ad_cloud_candidates(observed_at DESC,ad_key) WHERE status IN ('pending','retry','error');
CREATE TABLE IF NOT EXISTS ad_cloud_capture_links (
  job_id BIGINT NOT NULL REFERENCES ad_cloud_jobs(id),
  ad_key TEXT NOT NULL,
  PRIMARY KEY(job_id,ad_key)
);
INSERT INTO ad_cloud_capture_links(job_id,ad_key) SELECT job_id,ad_key FROM ad_cloud_candidates ON CONFLICT DO NOTHING;
ALTER TABLE ad_cloud_candidates ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_cloud_control ADD COLUMN IF NOT EXISTS analysis_manual_after TIMESTAMPTZ;
ALTER TABLE ad_cloud_control ADD COLUMN IF NOT EXISTS capture_after TIMESTAMPTZ;
ALTER TABLE ad_visual_versions DROP CONSTRAINT IF EXISTS ad_visual_versions_event_type_check;
ALTER TABLE ad_visual_versions ADD CONSTRAINT ad_visual_versions_event_type_check CHECK(event_type IN ('first_seen','changed','analysis_updated'));

${PROVIDER_SCHEMA_SQL}
`;
