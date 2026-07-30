-- V5 GEO research foundation: dynamic product onboarding and auditable pre-MonthlyPlan research.

INSERT INTO product_entity
  (id, canonical_name, display_name, brand_name, official_entity, product_category, aliases, status, row_version, confirmed_by, confirmed_at)
VALUES
  ('joto-workbuddy', 'WorkBuddy x JOTO', 'WorkBuddy x JOTO', 'JOTO', 'WorkBuddy', 'enterprise_ai_service', JSON_ARRAY('WorkBuddy', 'JOTO WorkBuddy'), 'active', 1, 'v5-geo-seed-migration', NOW()),
  ('tencent-adp-joto', 'Tencent Cloud ADP x JOTO', 'Tencent Cloud ADP x JOTO', 'JOTO', 'Tencent Cloud ADP', 'enterprise_ai_service', JSON_ARRAY('腾讯云 ADP', 'JOTO ADP'), 'active', 1, 'v5-geo-seed-migration', NOW()),
  ('pharaoh-command', 'Pharaoh Command', 'Pharaoh Command', NULL, NULL, 'ai_product', JSON_ARRAY('Pharaoh Command'), 'active', 1, 'v5-geo-seed-migration', NOW()),
  ('noteflow', 'Noteflow', 'Noteflow', NULL, NULL, 'ai_product', JSON_ARRAY('Noteflow'), 'active', 1, 'v5-geo-seed-migration', NOW()),
  ('weike-ai-guardrail', 'Weike AI Guardrail', 'Weike AI Guardrail', 'Weike', NULL, 'ai_product', JSON_ARRAY('唯客 AI 护栏', 'Weike AI Guardrail'), 'active', 1, 'v5-geo-seed-migration', NOW())
ON DUPLICATE KEY UPDATE
  confirmed_by = COALESCE(confirmed_by, VALUES(confirmed_by)),
  confirmed_at = COALESCE(confirmed_at, VALUES(confirmed_at));

CREATE TABLE IF NOT EXISTS geo_research_project (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  research_markets JSON NOT NULL,
  languages JSON NOT NULL,
  target_channels JSON NOT NULL,
  expression_focus TEXT NOT NULL,
  forbidden_focus JSON NOT NULL,
  current_approved_blueprint_version_id VARCHAR(64) NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_research_project_product (product_id),
  INDEX idx_geo_research_project_status (status)
);

CREATE TABLE IF NOT EXISTS geo_research_run (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  run_version INT NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  input_source_snapshot_hash CHAR(64) NOT NULL,
  plan_json JSON NOT NULL,
  plan_schema_version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  live_search_required BOOLEAN NOT NULL DEFAULT TRUE,
  live_search_verified BOOLEAN NOT NULL DEFAULT FALSE,
  row_version INT NOT NULL DEFAULT 1,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  failure_code VARCHAR(64) NULL,
  failure_message TEXT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_research_run_version (project_id, run_version),
  INDEX idx_geo_research_run_product (product_id, status),
  INDEX idx_geo_research_run_project (project_id, created_at)
);

CREATE TABLE IF NOT EXISTS geo_research_task (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  dependency_ids JSON NOT NULL,
  provider VARCHAR(64) NULL,
  provider_model VARCHAR(128) NULL,
  tool_name VARCHAR(128) NULL,
  request_json JSON NOT NULL,
  output_summary JSON NOT NULL,
  response_artifact_id VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'blocked',
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  available_at DATETIME NOT NULL,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at DATETIME NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  failure_code VARCHAR(64) NULL,
  failure_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_research_task_idempotency (idempotency_key),
  INDEX idx_geo_research_task_queue (status, available_at),
  INDEX idx_geo_research_task_run (run_id, task_type)
);

CREATE TABLE IF NOT EXISTS geo_research_artifact (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  provider_model VARCHAR(128) NOT NULL,
  payload_json JSON NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_research_artifact_task_hash (task_id, payload_hash),
  INDEX idx_geo_research_artifact_run (run_id, task_id)
);

CREATE TABLE IF NOT EXISTS geo_research_evidence (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  source_url TEXT NULL,
  source_title VARCHAR(500) NULL,
  publisher VARCHAR(255) NULL,
  query_text TEXT NULL,
  snapshot_hash CHAR(64) NULL,
  content_locator JSON NOT NULL,
  captured_at DATETIME NOT NULL,
  verification_status VARCHAR(32) NOT NULL,
  visibility VARCHAR(32) NOT NULL,
  artifact_id VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_geo_research_evidence_run (run_id, evidence_type),
  INDEX idx_geo_research_evidence_snapshot (snapshot_hash)
);

CREATE TABLE IF NOT EXISTS geo_research_finding (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  finding_type VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  evidence_ids JSON NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  review_status VARCHAR(32) NOT NULL DEFAULT 'candidate',
  analyzer_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_geo_research_finding_run (run_id, finding_type),
  INDEX idx_geo_research_finding_review (review_status)
);

CREATE TABLE IF NOT EXISTS geo_blueprint_version (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  question_strategy JSON NOT NULL,
  competitor_landscape JSON NOT NULL,
  citation_strategy JSON NOT NULL,
  content_type_strategy JSON NOT NULL,
  evidence_requirements JSON NOT NULL,
  rule_package_draft_ref VARCHAR(64) NULL,
  monthly_strategy_input JSON NOT NULL,
  retest_baseline JSON NOT NULL,
  research_snapshot_hash CHAR(64) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  approved_by VARCHAR(128) NULL,
  approved_at DATETIME NULL,
  immutable_at DATETIME NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_blueprint_version (project_id, version_number),
  UNIQUE KEY uq_geo_blueprint_run (run_id),
  INDEX idx_geo_blueprint_status (project_id, status)
);

ALTER TABLE question_candidate
  ADD COLUMN research_run_id VARCHAR(64) NULL AFTER product_id,
  ADD COLUMN source_evidence_ids JSON NULL AFTER source_ids,
  ADD INDEX idx_question_candidate_research_run (research_run_id);
