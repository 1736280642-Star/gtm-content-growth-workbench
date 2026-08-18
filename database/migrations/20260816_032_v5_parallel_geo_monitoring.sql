-- P0-P4: parallel website audit and question monitoring foundations.

CREATE TABLE IF NOT EXISTS geo_site_audit_run (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NULL,
  scope_url VARCHAR(2048) NOT NULL,
  sitemap_url VARCHAR(2048) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  source VARCHAR(32) NOT NULL DEFAULT 'site_audit_runner',
  audited_url_count INT NOT NULL DEFAULT 0,
  failed_url_count INT NOT NULL DEFAULT 0,
  core_readiness_score DECIMAL(5,2) NULL,
  ruleset_version VARCHAR(32) NOT NULL,
  executor_version VARCHAR(32) NULL,
  failure_reason TEXT NULL,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at DATETIME NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_geo_site_audit_idempotency (idempotency_key),
  INDEX idx_geo_site_audit_status (status, created_at),
  INDEX idx_geo_site_audit_scope (scope_url(255), created_at)
);

CREATE TABLE IF NOT EXISTS geo_site_audit_page (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  requested_url VARCHAR(2048) NOT NULL,
  final_url VARCHAR(2048) NOT NULL,
  http_status INT NOT NULL,
  render_mode VARCHAR(32) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  evidence JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  INDEX idx_geo_site_page_run (run_id),
  INDEX idx_geo_site_page_hash (content_hash)
);

CREATE TABLE IF NOT EXISTS geo_site_audit_finding (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  category VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  detection_evidence TEXT NOT NULL,
  evidence_source VARCHAR(32) NOT NULL DEFAULT 'page_audit_deterministic',
  user_impact TEXT NOT NULL,
  recommended_remediation TEXT NOT NULL,
  claim_ids JSON NOT NULL,
  published_content_ids JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  version INT NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  INDEX idx_geo_site_finding_run (run_id),
  INDEX idx_geo_site_finding_code (code, status)
);

CREATE TABLE IF NOT EXISTS geo_site_remediation_task (
  id VARCHAR(64) PRIMARY KEY,
  finding_id VARCHAR(64) NOT NULL,
  assignee VARCHAR(128) NULL,
  due_date DATE NULL,
  note TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_geo_remediation_finding (finding_id)
);

CREATE TABLE IF NOT EXISTS geo_site_audit_diff (
  id VARCHAR(64) PRIMARY KEY,
  baseline_run_id VARCHAR(64) NOT NULL,
  comparison_run_id VARCHAR(64) NOT NULL,
  new_finding_ids JSON NOT NULL,
  persistent_finding_ids JSON NOT NULL,
  resolved_finding_ids JSON NOT NULL,
  recurring_finding_ids JSON NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE INDEX uq_geo_site_diff_comparison (comparison_run_id)
);

CREATE TABLE IF NOT EXISTS geo_monitoring_question (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  question_version_id VARCHAR(64) NULL,
  question_text_snapshot TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  selection_source VARCHAR(32) NOT NULL,
  strategy_pack_id VARCHAR(64) NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  platforms JSON NOT NULL,
  locale VARCHAR(32) NOT NULL DEFAULT 'zh-CN',
  region VARCHAR(32) NULL,
  owned_domains JSON NOT NULL,
  samples_per_month INT NOT NULL DEFAULT 3,
  active_from DATE NOT NULL,
  active_to DATE NULL,
  approved_by VARCHAR(128) NOT NULL,
  approved_at DATETIME NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_geo_monitoring_question_idempotency (idempotency_key),
  INDEX idx_geo_monitoring_question_active (status, active_from, active_to),
  INDEX idx_geo_monitoring_question_product (product_id)
);

ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS monitoring_question_id VARCHAR(64) NULL AFTER question_version_id;
ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS scheduled_for DATETIME NULL AFTER priority;
CREATE INDEX IF NOT EXISTS idx_capture_task_monitoring_question ON capture_tasks (monitoring_question_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capture_task_scheduled ON capture_tasks (status, scheduled_for, priority);
