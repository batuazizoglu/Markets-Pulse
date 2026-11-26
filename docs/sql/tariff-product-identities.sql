-- Proposed additive staging migration. Applied explicitly, outside initDb().
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_source_product ON products(source_id,id);
-- Channel pages captured with the main response in the same scan. Empty on legacy databases.
CREATE TABLE IF NOT EXISTS tariff_identity_channel_evidence (
  scan_id bigint NOT NULL REFERENCES scans(id),
  menu text NOT NULL,
  html_gzip bytea NOT NULL,
  PRIMARY KEY(scan_id,menu)
);
CREATE TABLE IF NOT EXISTS tariff_product_identities (
  source_id bigint NOT NULL REFERENCES sources(id),
  acquisition_channel text NOT NULL CHECK (acquisition_channel IN
    ('port-in','new-customer','postpaid-conversion','catalogue-only')),
  supplier_offer_id text NOT NULL CHECK (supplier_offer_id ~ '^[1-9][0-9]*$'),
  product_id bigint NOT NULL UNIQUE,
  evidence_manifest jsonb NOT NULL CHECK (jsonb_typeof(evidence_manifest)='array' AND jsonb_array_length(evidence_manifest)>0),
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, acquisition_channel, supplier_offer_id),
  FOREIGN KEY (source_id,product_id) REFERENCES products(source_id,id)
);
COMMIT;
