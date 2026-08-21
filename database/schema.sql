CREATE TABLE IF NOT EXISTS workspace_setting (
  id VARCHAR(64) PRIMARY KEY,
  default_weekly_days INT NOT NULL DEFAULT 5,
  default_daily_count INT NOT NULL DEFAULT 3,
  enabled_channels JSON NOT NULL,
  enabled_products JSON NOT NULL,
  final_review_mode VARCHAR(32) NOT NULL DEFAULT 'default_final',
  geo_platforms JSON NOT NULL,
  log_mode VARCHAR(32) NOT NULL DEFAULT 'demo_csv',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  update_mode VARCHAR(32) NOT NULL DEFAULT 'manual',
  usage_scope TEXT,
  last_synced_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_article (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  url TEXT NOT NULL,
  published_at DATETIME NULL,
  updated_at DATETIME NULL,
  content_hash VARCHAR(128),
  indexed_status VARCHAR(32) DEFAULT 'unknown',
  seo_issue_count INT NOT NULL DEFAULT 0,
  geo_result VARCHAR(32) NOT NULL DEFAULT 'partial',
  candidate_status VARCHAR(32) NOT NULL DEFAULT 'none',
  candidate_reason TEXT,
  candidate_added_at DATETIME NULL,
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'pending',
  source VARCHAR(64) NOT NULL DEFAULT 'xcrawl',
  last_crawled_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  row_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_blog_article_indexed_status (indexed_status),
  INDEX idx_blog_article_geo_result (geo_result),
  INDEX idx_blog_article_candidate_status (candidate_status)
);

CREATE TABLE IF NOT EXISTS blog_diagnosis (
  id VARCHAR(64) PRIMARY KEY,
  blog_article_id VARCHAR(64) NOT NULL,
  seo_issues JSON,
  geo_issues JSON,
  content_gap JSON,
  suggestion_type VARCHAR(64) NOT NULL,
  candidate_status VARCHAR(32) NOT NULL DEFAULT 'none',
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'real',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_blog_diagnosis_blog_article_id (blog_article_id)
);

CREATE TABLE IF NOT EXISTS log_import_batch (
  id VARCHAR(64) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(255),
  imported_at DATETIME NOT NULL,
  imported_by VARCHAR(128),
  row_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_import_batch_source_type (source_type),
  INDEX idx_log_import_batch_status (status)
);

CREATE TABLE IF NOT EXISTS bot_visit_summary (
  id VARCHAR(64) PRIMARY KEY,
  log_import_batch_id VARCHAR(64) NULL,
  blog_article_id VARCHAR(64) NULL,
  path TEXT NOT NULL,
  bot_name VARCHAR(128),
  pv INT NOT NULL DEFAULT 0,
  summary_date DATE NOT NULL,
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'demo',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bot_visit_summary_bot_name (bot_name),
  INDEX idx_bot_visit_summary_summary_date (summary_date)
);

CREATE TABLE IF NOT EXISTS workbench_audit_event (
  id VARCHAR(64) PRIMARY KEY,
  event VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_workbench_audit_event_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS workbench_state_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  storage VARCHAR(32) NOT NULL DEFAULT 'mysql',
  state_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Phase 1: MCP contract & capture devices foundation

CREATE TABLE IF NOT EXISTS product_strategy_packs (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  strategy_version INT NOT NULL DEFAULT 1,
  geo_blueprint_id VARCHAR(64) NULL,
  source_snapshot_id VARCHAR(64) NULL,
  contract_version VARCHAR(64) NOT NULL DEFAULT 'product-geo-strategy.v2',
  rule_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  status VARCHAR(32) NOT NULL DEFAULT 'pending_strategy_review',
  content_plan_json JSON NULL,
  content_plan_hash CHAR(64) NULL,
  row_version INT NOT NULL DEFAULT 1,
  strategy_approved_at DATETIME NULL,
  strategy_approved_by VARCHAR(128) NULL,
  rejected_at DATETIME NULL,
  rejected_by VARCHAR(128) NULL,
  decision_reason VARCHAR(500) NULL,
  decision_idempotency_key VARCHAR(128) NULL,
  decision_payload_hash CHAR(64) NULL,
  compiled_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_strategy_pack_product (product_id),
  INDEX idx_strategy_pack_status (status)
);

CREATE TABLE IF NOT EXISTS product_strategy_article_type_versions (
  id VARCHAR(64) PRIMARY KEY,
  strategy_pack_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  portfolio_item_id VARCHAR(64) NOT NULL,
  origin VARCHAR(32) NOT NULL,
  article_type_id VARCHAR(64) NULL,
  article_type_version_id VARCHAR(64) NOT NULL,
  base_article_type_id VARCHAR(64) NULL,
  base_article_type_version_id VARCHAR(64) NULL,
  name VARCHAR(120) NOT NULL,
  definition_json JSON NOT NULL,
  definition_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  activated_at DATETIME NULL,
  activated_by VARCHAR(128) NULL,
  rejected_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_strategy_article_type_item (strategy_pack_id, portfolio_item_id),
  INDEX idx_strategy_article_type_product (product_id, status),
  INDEX idx_strategy_article_type_pack (strategy_pack_id, status),
  INDEX idx_strategy_article_type_origin (origin)
);

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

CREATE TABLE IF NOT EXISTS capture_pairing_codes (
  code_hash CHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_capture_pairing_expiry (expires_at, used_at)
);

CREATE TABLE IF NOT EXISTS ai_frontend_connections (
  connection_id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  account_alias VARCHAR(120) NOT NULL,
  browser_profile_slot VARCHAR(120) NOT NULL DEFAULT 'default',
  status VARCHAR(32) NOT NULL DEFAULT 'isolation_unverified',
  isolation_policy JSON NOT NULL,
  last_verified_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_frontend_connection_slot (device_id, platform, browser_profile_slot),
  INDEX idx_ai_frontend_connection_user (workspace_id, user_id, status),
  INDEX idx_ai_frontend_connection_device (device_id, status),
  INDEX idx_ai_frontend_connection_platform (platform, status)
);

CREATE TABLE IF NOT EXISTS capture_tasks (
  task_id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  question TEXT NOT NULL,
  question_version_id VARCHAR(64) NULL,
  published_content_id VARCHAR(64) NULL,
  source_publish_result_id VARCHAR(64) NULL,
  connection_id VARCHAR(64) NULL,
  trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual_once',
  capture_condition JSON NULL,
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
  INDEX idx_capture_task_connection (connection_id, status, created_at),
  INDEX idx_capture_task_product (product_id),
  INDEX idx_capture_task_question (question_version_id),
  INDEX idx_capture_task_published_content (published_content_id),
  INDEX idx_capture_task_trigger (trigger_type, created_at),
  INDEX idx_capture_task_connection (connection_id, status, created_at)
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

CREATE TABLE IF NOT EXISTS capture_gap_reviews (
  id VARCHAR(64) PRIMARY KEY,
  evidence_id VARCHAR(64) NOT NULL,
  answer_id VARCHAR(96) NOT NULL,
  version INT NOT NULL,
  selected_gap_ids JSON NOT NULL,
  decision VARCHAR(16) NOT NULL,
  destinations JSON NOT NULL,
  note TEXT NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_capture_gap_review_version (answer_id, version),
  INDEX idx_capture_gap_review_evidence (evidence_id)
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

CREATE TABLE IF NOT EXISTS hosted_promotion_order (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  contact_email VARCHAR(320) NOT NULL,
  contact_email_verified_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'preparing',
  channel_preferences_json JSON NOT NULL,
  daily_caps_json JSON NOT NULL,
  notification_preferences_json JSON NOT NULL,
  material_summary_json JSON NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  current_monthly_plan_id VARCHAR(64) NULL,
  current_action_type VARCHAR(32) NULL,
  pause_reason VARCHAR(500) NULL,
  last_error_code VARCHAR(96) NULL,
  last_error_message VARCHAR(500) NULL,
  row_version INT NOT NULL DEFAULT 1,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_order_idempotency (idempotency_key),
  INDEX idx_hosted_order_product (product_id, status),
  INDEX idx_hosted_order_status (status, updated_at),
  INDEX idx_hosted_order_monthly_plan (current_monthly_plan_id)
);

CREATE TABLE IF NOT EXISTS hosted_review_request (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  gate_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  acted_at DATETIME NULL,
  acted_by VARCHAR(128) NULL,
  decision VARCHAR(32) NULL,
  comment TEXT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_review_token (token_hash),
  UNIQUE KEY uq_hosted_review_idempotency (idempotency_key),
  INDEX idx_hosted_review_order (order_id, status),
  INDEX idx_hosted_review_target (gate_type, target_id),
  INDEX idx_hosted_review_expiry (status, expires_at)
);

CREATE TABLE IF NOT EXISTS hosted_daily_publish_batch (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  monthly_plan_id VARCHAR(64) NOT NULL,
  business_date DATE NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  effective_caps_json JSON NOT NULL,
  result_snapshot_json JSON NOT NULL,
  planned_count INT NOT NULL DEFAULT 0,
  published_count INT NOT NULL DEFAULT 0,
  pending_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'collecting',
  closed_at DATETIME NULL,
  digest_outbox_id VARCHAR(64) NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_daily_batch (order_id, business_date, version),
  INDEX idx_hosted_daily_batch_plan (monthly_plan_id, business_date),
  INDEX idx_hosted_daily_batch_status (status, business_date)
);

CREATE TABLE IF NOT EXISTS hosted_notification_outbox (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  review_request_id VARCHAR(64) NULL,
  event_type VARCHAR(64) NOT NULL,
  recipient_email VARCHAR(320) NOT NULL,
  template_version VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  provider_message_id VARCHAR(191) NULL,
  last_error_code VARCHAR(96) NULL,
  last_error_message VARCHAR(500) NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_notification_dedupe (dedupe_key),
  INDEX idx_hosted_notification_delivery (status, available_at),
  INDEX idx_hosted_notification_order (order_id, created_at)
);
