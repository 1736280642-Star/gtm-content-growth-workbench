-- Phase 1: MCP contract & capture devices foundation
-- Migration: 20260809_017_v5_phase1_mcp_capture.sql

CREATE TABLE IF NOT EXISTS product_strategy_packs (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  geo_blueprint_id VARCHAR(64) NULL,
  source_snapshot_id VARCHAR(64) NULL,
  rule_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  content_plan_json JSON NULL,
  compiled_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_strategy_pack_product (product_id),
  INDEX idx_strategy_pack_status (status)
);

CREATE TABLE IF NOT EXISTS capture_devices (
  device_id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  platforms JSON NOT NULL,
  last_heartbeat_at DATETIME NULL,
  adapter_version VARCHAR(32) NULL,
  lease_expires_at DATETIME NULL,
  paired_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_capture_device_user (workspace_id, user_id),
  INDEX idx_capture_device_status (status),
  INDEX idx_capture_device_heartbeat (last_heartbeat_at)
);

CREATE TABLE IF NOT EXISTS capture_tasks (
  task_id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  question TEXT NOT NULL,
  platform VARCHAR(32) NOT NULL,
  device_id VARCHAR(64) NULL,
  lease_expires_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(128) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  created_at_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_capture_task_idempotency (idempotency_key),
  INDEX idx_capture_task_status (status),
  INDEX idx_capture_task_device (device_id),
  INDEX idx_capture_task_product (product_id)
);

CREATE TABLE IF NOT EXISTS capture_evidence (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  artifact_hash VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  collected_by VARCHAR(64) NULL,
  device_id VARCHAR(64) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_capture_evidence_task (task_id),
  INDEX idx_capture_evidence_hash (artifact_hash),
  UNIQUE INDEX uq_capture_evidence_task_hash (task_id, artifact_hash)
);

CREATE TABLE IF NOT EXISTS attribution_chain (
  id VARCHAR(64) PRIMARY KEY,
  source_event_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  change_type VARCHAR(64) NOT NULL,
  evidence_ids JSON NULL,
  strategy_adjustment_id VARCHAR(64) NULL,
  article_ids JSON NULL,
  outcome VARCHAR(32) NULL,
  recorded_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attribution_chain_event (source_event_id),
  INDEX idx_attribution_chain_platform (platform),
  INDEX idx_attribution_chain_outcome (outcome)
);

-- Existing table extensions
-- V5 formal truth sources are product_entity and content_matrix_item. The old
-- products/production_tasks/publish_schedules names do not exist in a clean V5 schema.
ALTER TABLE product_entity ADD COLUMN IF NOT EXISTS is_promoting BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE product_entity ADD COLUMN IF NOT EXISTS promotion_status VARCHAR(32) NULL;
ALTER TABLE product_entity ADD COLUMN IF NOT EXISTS strategy_pack_id VARCHAR(64) NULL;

ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS responsibility VARCHAR(16) NULL;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS recovery_status VARCHAR(16) NULL;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS next_automatic_action VARCHAR(500) NULL;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS next_attempt_at DATETIME NULL;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS impact_count INT NOT NULL DEFAULT 0;
ALTER TABLE content_matrix_item ADD COLUMN IF NOT EXISTS user_action_required BOOLEAN NOT NULL DEFAULT FALSE;
