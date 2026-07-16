-- V5 wave 1: greenfield monthly planning truth source.
-- V4 weekly data is intentionally not migrated or referenced.

CREATE TABLE IF NOT EXISTS monthly_plan (
  id VARCHAR(64) PRIMARY KEY,
  plan_month CHAR(7) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  goals JSON NOT NULL,
  product_quotas JSON NOT NULL,
  channel_mix JSON NOT NULL,
  content_type_mix JSON NOT NULL,
  publish_frequency JSON NOT NULL,
  strategy_package_version_id VARCHAR(64) NULL,
  matrix_version_id VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_plan_month (plan_month),
  INDEX idx_monthly_plan_status (status)
);

CREATE TABLE IF NOT EXISTS monthly_strategy_package_version (
  id VARCHAR(64) PRIMARY KEY,
  monthly_plan_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  product_allocation JSON NOT NULL,
  channel_allocation JSON NOT NULL,
  content_type_allocation JSON NOT NULL,
  distilled_term_coverage JSON NOT NULL,
  evidence_readiness_summary JSON NOT NULL,
  risks JSON NOT NULL,
  gaps JSON NOT NULL,
  generated_by_run_id VARCHAR(64) NULL,
  rule_validation_result JSON NULL,
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_strategy_plan_version (monthly_plan_id, version_number),
  INDEX idx_strategy_plan_status (monthly_plan_id, status)
);

CREATE TABLE IF NOT EXISTS content_matrix_version (
  id VARCHAR(64) PRIMARY KEY,
  monthly_plan_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  based_on_strategy_package_version_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  item_ids JSON NOT NULL,
  generated_by_run_id VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrix_plan_version (monthly_plan_id, version_number),
  INDEX idx_matrix_plan_status (monthly_plan_id, status)
);

CREATE TABLE IF NOT EXISTS content_matrix_item (
  id VARCHAR(64) PRIMARY KEY,
  monthly_plan_id VARCHAR(64) NOT NULL,
  matrix_version_id VARCHAR(64) NOT NULL,
  publish_date DATE NOT NULL,
  publish_time TIME NULL,
  week_index INT NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  channel VARCHAR(64) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  platform_content_type VARCHAR(64) NULL,
  title VARCHAR(500) NOT NULL,
  target_audience VARCHAR(255) NULL,
  primary_distilled_term_id VARCHAR(64) NULL,
  secondary_distilled_term_ids JSON NOT NULL,
  knowledge_base_ids JSON NOT NULL,
  rule_package_version_id VARCHAR(64) NULL,
  evidence_preview_id VARCHAR(64) NULL,
  evidence_preview_status VARCHAR(32) NULL,
  final_evidence_pack_id VARCHAR(64) NULL,
  evidence_gate_status VARCHAR(32) NULL,
  platform_expression_profile_id VARCHAR(64) NULL,
  platform_expression_snapshot JSON NULL,
  source_problem TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_matrix_item_plan (monthly_plan_id),
  INDEX idx_matrix_item_version (matrix_version_id),
  INDEX idx_matrix_item_publish_date (publish_date),
  INDEX idx_matrix_item_status (status)
);

CREATE TABLE IF NOT EXISTS monthly_production_readiness (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  rule_package_version_id VARCHAR(64) NOT NULL,
  monthly_production_ready BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_content_types JSON NOT NULL,
  conditional_content_types JSON NOT NULL,
  blocked_content_types JSON NOT NULL,
  allowed_channels JSON NOT NULL,
  required_evidence_roles JSON NOT NULL,
  evidence_gap_ids JSON NOT NULL,
  max_monthly_quota INT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_readiness_product_rule (product_id, rule_package_version_id),
  INDEX idx_readiness_ready (monthly_production_ready, status)
);

CREATE TABLE IF NOT EXISTS production_pool_entry (
  id VARCHAR(64) PRIMARY KEY,
  monthly_plan_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  readiness_id VARCHAR(64) NOT NULL,
  monthly_quota INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pool_plan_product (monthly_plan_id, product_id),
  INDEX idx_pool_status (status)
);

CREATE TABLE IF NOT EXISTS artifact_reference (
  id VARCHAR(64) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_version VARCHAR(64) NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  target_version VARCHAR(64) NULL,
  relation_type VARCHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_artifact_relation (source_type, source_id, target_type, target_id, relation_type),
  INDEX idx_artifact_source (source_type, source_id),
  INDEX idx_artifact_target (target_type, target_id)
);
