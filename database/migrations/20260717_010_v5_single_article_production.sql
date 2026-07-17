-- V5 single-article production: approved prompt/channel rules, orchestration idempotency and formal drafts.
-- This migration is additive and intentionally preserves every V4 table.

CREATE TABLE IF NOT EXISTS prompt_group (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  channel VARCHAR(64) NOT NULL,
  platform_content_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  active_version_id VARCHAR(64) NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prompt_group_scope (product_id, channel, platform_content_type)
);

CREATE TABLE IF NOT EXISTS prompt_group_version (
  id VARCHAR(64) PRIMARY KEY,
  prompt_group_id VARCHAR(64) NOT NULL,
  version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  system_prompt MEDIUMTEXT NOT NULL,
  user_prompt_template MEDIUMTEXT NOT NULL,
  hard_rules JSON NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  approved_by VARCHAR(128) NULL,
  approved_at DATETIME NULL,
  immutable_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prompt_group_version (prompt_group_id, version),
  INDEX idx_prompt_group_version_status (prompt_group_id, status)
);

CREATE TABLE IF NOT EXISTS channel_rule_version (
  id VARCHAR(64) PRIMARY KEY,
  channel VARCHAR(64) NOT NULL,
  version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  required_format JSON NOT NULL,
  prohibited_patterns JSON NOT NULL,
  cta_boundary TEXT NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  approved_by VARCHAR(128) NULL,
  approved_at DATETIME NULL,
  immutable_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel_rule_version (channel, version),
  INDEX idx_channel_rule_status (channel, status)
);

ALTER TABLE content_matrix_item
  ADD COLUMN prompt_group_id VARCHAR(64) NULL AFTER rule_package_version_id,
  ADD COLUMN prompt_group_version_id VARCHAR(64) NULL AFTER prompt_group_id,
  ADD COLUMN channel_rule_version_id VARCHAR(64) NULL AFTER prompt_group_version_id,
  ADD COLUMN production_scope VARCHAR(64) NULL AFTER channel_rule_version_id,
  ADD INDEX idx_matrix_item_production_scope (production_scope, publish_date);

CREATE TABLE IF NOT EXISTS single_article_operation (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  retrieval_run_id VARCHAR(64) NULL,
  evidence_preview_id VARCHAR(64) NULL,
  final_evidence_pack_id VARCHAR(64) NULL,
  generation_run_id VARCHAR(64) NULL,
  draft_version_id VARCHAR(64) NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  next_action TEXT NULL,
  actor_id VARCHAR(128) NOT NULL,
  actor_role VARCHAR(64) NOT NULL,
  audit_reason TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_single_article_idempotency (task_id, idempotency_key),
  INDEX idx_single_article_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS generation_run (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  task_version INT NOT NULL,
  matrix_item_id VARCHAR(64) NOT NULL,
  final_evidence_pack_id VARCHAR(64) NOT NULL,
  prompt_group_version_id VARCHAR(64) NOT NULL,
  rule_package_version_id VARCHAR(64) NOT NULL,
  channel_rule_version_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  model VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  hard_rule_result JSON NOT NULL,
  failure_code VARCHAR(64) NULL,
  failure_message TEXT NULL,
  next_action TEXT NULL,
  actor_id VARCHAR(128) NOT NULL,
  audit_reason TEXT NOT NULL,
  test_only BOOLEAN NOT NULL DEFAULT FALSE,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generation_task_idempotency (task_id, idempotency_key),
  INDEX idx_generation_matrix (matrix_item_id, started_at),
  INDEX idx_generation_status (status, started_at)
);

CREATE TABLE IF NOT EXISTS draft_version (
  id VARCHAR(64) PRIMARY KEY,
  generation_run_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  task_version INT NOT NULL,
  matrix_item_id VARCHAR(64) NOT NULL,
  final_evidence_pack_id VARCHAR(64) NOT NULL,
  rule_package_version_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  markdown MEDIUMTEXT NOT NULL,
  fact_traces JSON NOT NULL,
  hard_rule_result JSON NOT NULL,
  copy_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  test_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_draft_generation (generation_run_id),
  UNIQUE KEY uq_draft_task_version (task_id, task_version, version_number),
  INDEX idx_draft_matrix (matrix_item_id, created_at)
);
