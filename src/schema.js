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

`;
