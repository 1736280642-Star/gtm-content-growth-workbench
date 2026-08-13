-- Phase 2D: immutable production contracts and human-owned sample calibration.

CREATE TABLE IF NOT EXISTS expression_calibration_version (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  product_strategy_pack_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  directives_json JSON NOT NULL,
  source_sample_draft_id VARCHAR(64) NOT NULL,
  source_feedback_id VARCHAR(64) NOT NULL,
  calibration_hash CHAR(64) NOT NULL,
  approved_by VARCHAR(128) NOT NULL,
  approved_at DATETIME NOT NULL,
  immutable_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expression_calibration_version (product_id, version_number),
  UNIQUE KEY uq_expression_calibration_hash (product_id, calibration_hash),
  INDEX idx_expression_calibration_active (product_id, status)
);

CREATE TABLE IF NOT EXISTS production_contract_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  contract_version VARCHAR(64) NOT NULL,
  contract_hash CHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  task_version INT NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  product_strategy_pack_id VARCHAR(64) NOT NULL,
  article_type_version_id VARCHAR(64) NOT NULL,
  expression_calibration_version_id VARCHAR(64) NULL,
  final_evidence_pack_id VARCHAR(64) NOT NULL,
  production_mode VARCHAR(32) NOT NULL,
  contract_json JSON NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  immutable_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_production_contract_hash (contract_hash),
  INDEX idx_production_contract_task (task_id, task_version),
  INDEX idx_production_contract_strategy (product_strategy_pack_id, production_mode)
);

CREATE TABLE IF NOT EXISTS sample_article_feedback (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  product_strategy_pack_id VARCHAR(64) NOT NULL,
  draft_version_id VARCHAR(64) NOT NULL,
  production_contract_id VARCHAR(64) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  feedback_json JSON NOT NULL,
  feedback_hash CHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  decided_by VARCHAR(128) NOT NULL,
  decided_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sample_feedback_idempotency (draft_version_id, idempotency_key),
  INDEX idx_sample_feedback_strategy (product_strategy_pack_id, decided_at)
);

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS production_contract_id VARCHAR(64) NULL AFTER final_evidence_pack_id;

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS production_contract_hash CHAR(64) NULL AFTER production_contract_id;

ALTER TABLE draft_version
  ADD COLUMN IF NOT EXISTS production_contract_id VARCHAR(64) NULL AFTER final_evidence_pack_id;

ALTER TABLE draft_version
  ADD COLUMN IF NOT EXISTS production_contract_hash CHAR(64) NULL AFTER production_contract_id;
