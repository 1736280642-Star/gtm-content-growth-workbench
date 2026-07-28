-- V5 expression-driven free content production.
CREATE TABLE IF NOT EXISTS free_content_expression_type (
  id VARCHAR(64) PRIMARY KEY,
  preset_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_version_id VARCHAR(64) NOT NULL,
  active_version_id VARCHAR(64) NULL,
  version INT NOT NULL DEFAULT 1,
  usage_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_by VARCHAR(128) NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_free_expression_status (status, updated_at),
  INDEX idx_free_expression_preset (preset_key, status)
);

CREATE TABLE IF NOT EXISTS free_content_expression_type_version (
  id VARCHAR(64) PRIMARY KEY,
  expression_type_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  preset_key VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  config_snapshot JSON NOT NULL,
  source_rule_version VARCHAR(64) NOT NULL,
  source_rule_digest CHAR(64) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  system_managed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  activated_at DATETIME NULL,
  UNIQUE KEY uq_free_expression_version (expression_type_id, version),
  UNIQUE KEY uq_free_expression_snapshot (expression_type_id, snapshot_hash),
  INDEX idx_free_expression_version_status (status, activated_at)
);

CREATE TABLE IF NOT EXISTS free_production_batch (
  id VARCHAR(64) PRIMARY KEY,
  monthly_plan_id VARCHAR(64) NOT NULL,
  month_start DATE NOT NULL,
  month_end DATE NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  product_expression_rule_version_id VARCHAR(64) NOT NULL,
  expression_type_version_id VARCHAR(64) NOT NULL,
  channel_config JSON NOT NULL,
  publish_policy VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  repair_count TINYINT NOT NULL DEFAULT 0,
  current_expression_plan_id VARCHAR(64) NULL,
  current_draft_artifact_id VARCHAR(64) NULL,
  confirmed_content_digest CHAR(64) NULL,
  published_at DATETIME NULL,
  published_url TEXT NULL,
  external_record_id VARCHAR(255) NULL,
  failure_code VARCHAR(128) NULL,
  failure_message TEXT NULL,
  next_action TEXT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_production_idempotency (idempotency_key),
  INDEX idx_free_production_month (monthly_plan_id, month_start),
  INDEX idx_free_production_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS free_production_expression_plan (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  plan_version INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  plan_snapshot JSON NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_expression_plan_version (batch_id, plan_version),
  INDEX idx_free_expression_plan_current (batch_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS free_production_input_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  expression_plan_id VARCHAR(64) NOT NULL,
  input_snapshot JSON NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_input_snapshot_hash (batch_id, snapshot_hash)
);

CREATE TABLE IF NOT EXISTS free_production_draft_artifact (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  expression_plan_id VARCHAR(64) NOT NULL,
  generation_input_snapshot_id VARCHAR(64) NOT NULL,
  artifact_version INT NOT NULL,
  artifact_snapshot JSON NOT NULL,
  article_body MEDIUMTEXT NOT NULL,
  content_digest CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_draft_version (batch_id, artifact_version),
  UNIQUE KEY uq_free_draft_digest (batch_id, content_digest)
);

CREATE TABLE IF NOT EXISTS free_production_risk_gap (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  risk_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  input_schema JSON NULL,
  affected_section_keys JSON NOT NULL,
  value_text TEXT NULL,
  asset_ref TEXT NULL,
  resolved_at DATETIME NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_risk_key (batch_id, risk_key),
  INDEX idx_free_risk_status (batch_id, status)
);

CREATE TABLE IF NOT EXISTS free_production_supplemental_fact (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  risk_gap_id VARCHAR(64) NOT NULL,
  fact_key VARCHAR(128) NOT NULL,
  value_text TEXT NULL,
  asset_ref TEXT NULL,
  value_digest CHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_supplement_digest (batch_id, risk_gap_id, value_digest)
);

CREATE TABLE IF NOT EXISTS free_production_task (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  monthly_plan_id VARCHAR(64) NOT NULL,
  planning_source VARCHAR(32) NOT NULL DEFAULT 'free_production',
  expression_type_version_id VARCHAR(64) NOT NULL,
  channel VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  title VARCHAR(500) NULL,
  content_digest CHAR(64) NULL,
  published_at DATETIME NULL,
  published_url TEXT NULL,
  failure_code VARCHAR(128) NULL,
  failure_message TEXT NULL,
  next_action TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_free_task_batch_channel (batch_id, channel),
  INDEX idx_free_task_month_status (monthly_plan_id, status, updated_at)
);
