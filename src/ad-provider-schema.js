export const PROVIDER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ad_provider_budget (
  day TEXT PRIMARY KEY,
  reserved_usd NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK(reserved_usd>=0),
  starts INTEGER NOT NULL DEFAULT 0 CHECK(starts>=0)
);
CREATE TABLE IF NOT EXISTS ad_provider_runs (
  job_id BIGINT PRIMARY KEY REFERENCES ad_cloud_jobs(id),
  state TEXT NOT NULL CHECK(state IN ('creating','running','importing','downloading','complete','partial','error','start_unknown')),
  run_id TEXT,
  dataset_id TEXT,
  dataset_offset INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER,
  expected_ads INTEGER,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  source_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_complete BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_denied BOOLEAN NOT NULL DEFAULT FALSE,
  limit_reached BOOLEAN NOT NULL DEFAULT FALSE,
  max_run_usd NUMERIC(12,4) NOT NULL,
  usage_usd NUMERIC(12,4),
  last_error TEXT,
  poll_attempts INTEGER NOT NULL DEFAULT 0,
  read_failed_at TIMESTAMPTZ,
  next_poll_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE ad_provider_runs ADD COLUMN IF NOT EXISTS coverage_denied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ad_provider_runs ADD COLUMN IF NOT EXISTS read_failed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ad_provider_runs_pending ON ad_provider_runs(state,next_poll_at);
CREATE TABLE IF NOT EXISTS ad_provider_assets (
  job_id BIGINT NOT NULL REFERENCES ad_provider_runs(job_id),
  asset_key TEXT NOT NULL,
  page_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_url TEXT,
  media_kind TEXT NOT NULL CHECK(media_kind IN ('image','video_preview')),
  status TEXT NOT NULL CHECK(status IN ('pending','retry','captured','missing','error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence_sha256 TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(job_id,asset_key)
);
CREATE INDEX IF NOT EXISTS idx_ad_provider_assets_pending ON ad_provider_assets(job_id,status,available_at);
`;
