-- Product website GEO baseline, source-to-audit binding, and event-driven optimization snapshots.

ALTER TABLE geo_site_audit_run
  ADD COLUMN IF NOT EXISTS scope_mode VARCHAR(24) NOT NULL DEFAULT 'site' AFTER sitemap_url;

CREATE TABLE IF NOT EXISTS product_website_source_status (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_revision_id VARCHAR(96) NOT NULL,
  canonical_url VARCHAR(2048) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  ownership_status VARCHAR(24) NOT NULL,
  knowledge_readiness VARCHAR(24) NOT NULL,
  public_geo_readiness VARCHAR(24) NOT NULL DEFAULT 'pending_audit',
  site_audit_run_id VARCHAR(64) NULL,
  audit_ruleset_version VARCHAR(64) NULL,
  last_audited_at DATETIME NULL,
  last_error TEXT NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_product_website_source_revision (product_id, source_id, source_revision_id),
  INDEX idx_product_website_source_product (product_id, ownership_status, public_geo_readiness),
  INDEX idx_product_website_source_audit (site_audit_run_id)
);

CREATE TABLE IF NOT EXISTS product_website_coverage_profile (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  profile_version INT NOT NULL DEFAULT 1,
  source_snapshot_id VARCHAR(64) NULL,
  latest_site_audit_run_id VARCHAR(64) NULL,
  profile_hash VARCHAR(64) NOT NULL,
  profile_json JSON NOT NULL,
  generated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_product_website_coverage_product (product_id),
  INDEX idx_product_website_coverage_audit (latest_site_audit_run_id)
);

CREATE TABLE IF NOT EXISTS product_geo_optimization_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  matrix_version_id VARCHAR(64) NULL,
  strategy_pack_id VARCHAR(64) NULL,
  batch_key VARCHAR(160) NOT NULL,
  input_evidence_hash VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  priority VARCHAR(16) NOT NULL,
  optimization_json JSON NOT NULL,
  published_content_ids JSON NOT NULL,
  capture_task_ids JSON NOT NULL,
  source_site_audit_run_id VARCHAR(64) NULL,
  generated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_product_geo_optimization_evidence (product_id, batch_key, input_evidence_hash),
  INDEX idx_product_geo_optimization_product (product_id, generated_at),
  INDEX idx_product_geo_optimization_status (status, priority, generated_at)
);

ALTER TABLE geo_monitoring_question
  ADD COLUMN IF NOT EXISTS target_entity_name VARCHAR(255) NULL AFTER question_text_snapshot;

ALTER TABLE geo_monitoring_question
  ADD COLUMN IF NOT EXISTS expected_relationship TEXT NULL AFTER target_entity_name;

ALTER TABLE geo_monitoring_question
  ADD COLUMN IF NOT EXISTS target_solution_urls JSON NULL AFTER owned_domains;

ALTER TABLE capture_tasks
  ADD COLUMN IF NOT EXISTS target_entity_name VARCHAR(255) NULL AFTER product_id;
