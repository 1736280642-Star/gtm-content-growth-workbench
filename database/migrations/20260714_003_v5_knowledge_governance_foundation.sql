-- V5 wave 2: knowledge governance truth source for G0-G6.
-- Existing knowledge_base remains the knowledge-base registry; V5 adds governed product, source, claim, rule and approval entities.

CREATE TABLE IF NOT EXISTS product_entity (
  id VARCHAR(64) PRIMARY KEY,
  canonical_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  brand_name VARCHAR(255) NULL,
  official_entity VARCHAR(255) NULL,
  official_url TEXT NULL,
  product_category VARCHAR(128) NULL,
  aliases JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  confirmed_by VARCHAR(128) NULL,
  confirmed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_entity_canonical_name (canonical_name),
  INDEX idx_product_entity_status (status)
);

CREATE TABLE IF NOT EXISTS product_entity_candidate (
  id VARCHAR(64) PRIMARY KEY,
  candidate_name VARCHAR(255) NOT NULL,
  aliases JSON NOT NULL,
  brand_candidate VARCHAR(255) NULL,
  official_url_candidate TEXT NULL,
  category_candidate VARCHAR(128) NULL,
  discovered_source_id VARCHAR(64) NOT NULL,
  similar_product_ids JSON NOT NULL,
  similarities JSON NOT NULL,
  conflicts JSON NOT NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  resolution_product_id VARCHAR(64) NULL,
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_product_candidate_status (status),
  INDEX idx_product_candidate_source (discovered_source_id)
);

CREATE TABLE IF NOT EXISTS knowledge_base_product_link (
  id VARCHAR(64) PRIMARY KEY,
  knowledge_base_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  relation_type VARCHAR(32) NOT NULL DEFAULT 'supporting',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  confirmed_by VARCHAR(128) NULL,
  confirmed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kb_product_relation (knowledge_base_id, product_id, relation_type),
  INDEX idx_kb_product_product (product_id, status)
);

CREATE TABLE IF NOT EXISTS ingestion_batch (
  id VARCHAR(64) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL,
  purpose VARCHAR(128) NULL,
  target_knowledge_base_id VARCHAR(64) NULL,
  target_product_id VARCHAR(64) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'draft',
  current_gate VARCHAR(8) NOT NULL DEFAULT 'G0',
  source_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  isolated_count INT NOT NULL DEFAULT 0,
  pending_review_count INT NOT NULL DEFAULT 0,
  parser_version VARCHAR(64) NULL,
  classifier_version VARCHAR(64) NULL,
  extractor_version VARCHAR(64) NULL,
  requested_by VARCHAR(128) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  UNIQUE KEY uq_ingestion_batch_idempotency (idempotency_key),
  INDEX idx_ingestion_batch_status (status, current_gate),
  INDEX idx_ingestion_batch_product (target_product_id)
);

CREATE TABLE IF NOT EXISTS source_asset (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  primary_knowledge_base_id VARCHAR(64) NOT NULL,
  import_method VARCHAR(32) NOT NULL,
  document_type VARCHAR(64) NOT NULL,
  authority_level VARCHAR(8) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  visibility VARCHAR(32) NOT NULL,
  title VARCHAR(500) NULL,
  canonical_url TEXT NULL,
  file_name VARCHAR(500) NULL,
  mime_type VARCHAR(128) NULL,
  language VARCHAR(32) NULL,
  content_hash CHAR(64) NULL,
  raw_asset_ref TEXT NULL,
  normalized_text_ref TEXT NULL,
  captured_at DATETIME NULL,
  source_updated_at DATETIME NULL,
  valid_from DATETIME NULL,
  valid_until DATETIME NULL,
  product_candidates JSON NOT NULL,
  classification_confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  classification_reasons JSON NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending_parse',
  quality_flags JSON NOT NULL,
  monthly_support JSON NOT NULL,
  safety_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  safety_risk_types JSON NOT NULL,
  isolated_reason TEXT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_source_asset_batch (batch_id),
  INDEX idx_source_asset_kb (primary_knowledge_base_id),
  INDEX idx_source_asset_status (status, safety_status),
  INDEX idx_source_asset_hash (content_hash)
);

CREATE TABLE IF NOT EXISTS knowledge_base_source_asset (
  id VARCHAR(64) PRIMARY KEY,
  knowledge_base_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  relation_type VARCHAR(32) NOT NULL DEFAULT 'member',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kb_source_relation (knowledge_base_id, source_id, relation_type),
  INDEX idx_kb_source_source (source_id)
);

CREATE TABLE IF NOT EXISTS source_revision (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL,
  revision_number INT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  raw_asset_ref TEXT NULL,
  normalized_text_ref TEXT NOT NULL,
  title_snapshot VARCHAR(500) NULL,
  canonical_url_snapshot TEXT NULL,
  captured_at DATETIME NOT NULL,
  source_updated_at DATETIME NULL,
  parser_name VARCHAR(64) NOT NULL,
  parser_version VARCHAR(64) NOT NULL,
  parse_status VARCHAR(32) NOT NULL DEFAULT 'parsed',
  quality_flags JSON NOT NULL,
  content_length INT NOT NULL DEFAULT 0,
  supersedes_revision_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_revision_number (source_id, revision_number),
  UNIQUE KEY uq_source_revision_hash (source_id, content_hash),
  INDEX idx_source_revision_parse (parse_status)
);

CREATE TABLE IF NOT EXISTS product_claim (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  subject_type VARCHAR(32) NOT NULL DEFAULT 'product',
  claim_type VARCHAR(64) NOT NULL,
  normalized_claim TEXT NOT NULL,
  original_quote TEXT NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_revision_id VARCHAR(64) NOT NULL,
  source_locator JSON NOT NULL,
  authority_level VARCHAR(8) NOT NULL,
  support_mode VARCHAR(32) NOT NULL,
  capability_status VARCHAR(32) NOT NULL,
  claim_scope VARCHAR(64) NOT NULL,
  conditions JSON NOT NULL,
  limitations JSON NOT NULL,
  product_version VARCHAR(128) NULL,
  valid_from DATETIME NULL,
  valid_until DATETIME NULL,
  confidence DECIMAL(5,4) NOT NULL,
  extraction_model VARCHAR(128) NULL,
  extraction_prompt_version VARCHAR(64) NULL,
  extractor_version VARCHAR(64) NOT NULL,
  parent_claim_ids JSON NOT NULL,
  review_status VARCHAR(32) NOT NULL DEFAULT 'candidate',
  conflict_group_id VARCHAR(64) NULL,
  supersedes_claim_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  INDEX idx_product_claim_product (product_id, review_status),
  INDEX idx_product_claim_revision (source_revision_id, extractor_version),
  INDEX idx_product_claim_conflict (conflict_group_id)
);

CREATE TABLE IF NOT EXISTS claim_conflict (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  conflict_type VARCHAR(64) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  preferred_temporary_claim_id VARCHAR(64) NULL,
  temporary_policy VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  required_roles JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  resolution JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  INDEX idx_claim_conflict_product (product_id, status),
  INDEX idx_claim_conflict_severity (severity, status)
);

CREATE TABLE IF NOT EXISTS claim_conflict_item (
  id VARCHAR(64) PRIMARY KEY,
  conflict_id VARCHAR(64) NOT NULL,
  claim_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conflict_claim (conflict_id, claim_id),
  INDEX idx_conflict_item_claim (claim_id)
);

CREATE TABLE IF NOT EXISTS evidence_gap (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  gap_code VARCHAR(128) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  affected_rule_fields JSON NOT NULL,
  affected_claim_types JSON NOT NULL,
  trigger_source_ids JSON NOT NULL,
  severity VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  recommended_action TEXT NOT NULL,
  owner_role VARCHAR(64) NOT NULL,
  due_at DATETIME NULL,
  resolved_by_source_ids JSON NOT NULL,
  resolved_by VARCHAR(128) NULL,
  resolved_at DATETIME NULL,
  resolution_note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_evidence_gap_product (product_id, status),
  INDEX idx_evidence_gap_severity (severity, status)
);

CREATE TABLE IF NOT EXISTS ingestion_issue (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NULL,
  source_revision_id VARCHAR(64) NULL,
  product_id VARCHAR(64) NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  message TEXT NOT NULL,
  next_action TEXT NOT NULL,
  owner_role VARCHAR(64) NULL,
  details JSON NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_by VARCHAR(128) NULL,
  resolved_at DATETIME NULL,
  INDEX idx_ingestion_issue_batch (batch_id, status),
  INDEX idx_ingestion_issue_action (owner_role, status)
);

CREATE TABLE IF NOT EXISTS product_expression_rule_package (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  active_version_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule_package_product (product_id)
);

CREATE TABLE IF NOT EXISTS rule_package_version (
  id VARCHAR(64) PRIMARY KEY,
  rule_package_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  version VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'draft_pending_confirmation',
  pending_roles JSON NOT NULL,
  based_on_version_id VARCHAR(64) NULL,
  source_batch_ids JSON NOT NULL,
  linked_knowledge_base_ids JSON NOT NULL,
  linked_source_ids JSON NOT NULL,
  linked_claim_ids JSON NOT NULL,
  product_identity JSON NOT NULL,
  capabilities JSON NOT NULL,
  allowed_expressions JSON NOT NULL,
  conditional_expressions JSON NOT NULL,
  blocked_expressions JSON NOT NULL,
  evidence_requirements JSON NOT NULL,
  channel_boundaries JSON NOT NULL,
  official_citation_rules JSON NOT NULL,
  evidence_gap_ids JSON NOT NULL,
  conflict_refs JSON NOT NULL,
  distilled_term_suggestions JSON NOT NULL,
  question_suggestions JSON NOT NULL,
  monthly_matrix_scope JSON NOT NULL,
  change_set JSON NOT NULL,
  claim_set_hash CHAR(64) NOT NULL,
  source_snapshot_hash CHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  approved_by VARCHAR(128) NULL,
  activated_at DATETIME NULL,
  superseded_at DATETIME NULL,
  immutable_at DATETIME NULL,
  UNIQUE KEY uq_rule_package_version (rule_package_id, version),
  UNIQUE KEY uq_rule_package_claim_set (rule_package_id, based_on_version_id, claim_set_hash),
  INDEX idx_rule_version_product (product_id, status),
  INDEX idx_rule_version_snapshot (source_snapshot_hash)
);

CREATE TABLE IF NOT EXISTS rule_package_claim (
  id VARCHAR(64) PRIMARY KEY,
  rule_package_version_id VARCHAR(64) NOT NULL,
  claim_id VARCHAR(64) NOT NULL,
  usage_type VARCHAR(32) NOT NULL DEFAULT 'evidence',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule_version_claim (rule_package_version_id, claim_id, usage_type),
  INDEX idx_rule_claim_claim (claim_id)
);

CREATE TABLE IF NOT EXISTS rule_package_source_revision (
  id VARCHAR(64) PRIMARY KEY,
  rule_package_version_id VARCHAR(64) NOT NULL,
  source_revision_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule_version_revision (rule_package_version_id, source_revision_id),
  INDEX idx_rule_revision_source (source_id)
);

CREATE TABLE IF NOT EXISTS rule_package_change (
  id VARCHAR(64) PRIMARY KEY,
  rule_package_version_id VARCHAR(64) NOT NULL,
  section VARCHAR(128) NOT NULL,
  field_path VARCHAR(500) NOT NULL,
  change_type VARCHAR(64) NOT NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  reason TEXT NOT NULL,
  claim_ids JSON NOT NULL,
  source_ids JSON NOT NULL,
  risk_level VARCHAR(32) NOT NULL,
  required_roles JSON NOT NULL,
  review_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rule_change_version (rule_package_version_id, review_status),
  INDEX idx_rule_change_risk (risk_level, review_status)
);

CREATE TABLE IF NOT EXISTS approval_record (
  id VARCHAR(64) PRIMARY KEY,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(64) NOT NULL,
  confirmation_unit VARCHAR(32) NOT NULL,
  role VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  before_summary JSON NULL,
  after_summary JSON NULL,
  reason TEXT NOT NULL,
  evidence_source_ids JSON NOT NULL,
  impact_summary JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_approval_object (object_type, object_id),
  INDEX idx_approval_role_status (role, status)
);

CREATE TABLE IF NOT EXISTS term_candidate (
  id VARCHAR(64) PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  level VARCHAR(64) NOT NULL,
  source_claim_ids JSON NOT NULL,
  source_ids JSON NOT NULL,
  generation_reason TEXT NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  risk_flags JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  monthly_plan_id VARCHAR(64) NULL,
  matrix_coverage_status VARCHAR(32) NULL,
  content_types JSON NOT NULL,
  channels JSON NOT NULL,
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_term_candidate_product (product_id, status),
  INDEX idx_term_candidate_monthly (monthly_plan_id, matrix_coverage_status)
);

CREATE TABLE IF NOT EXISTS question_candidate (
  id VARCHAR(64) PRIMARY KEY,
  question TEXT NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  intent_type VARCHAR(64) NOT NULL,
  source_claim_ids JSON NOT NULL,
  source_ids JSON NOT NULL,
  generation_reason TEXT NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  risk_flags JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_question_candidate_product (product_id, status)
);

CREATE TABLE IF NOT EXISTS source_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  source_ids JSON NOT NULL,
  source_revision_ids JSON NOT NULL,
  approved_claim_ids JSON NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_snapshot_product_hash (product_id, snapshot_hash)
);

CREATE TABLE IF NOT EXISTS source_snapshot_item (
  id VARCHAR(64) PRIMARY KEY,
  source_snapshot_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_revision_id VARCHAR(64) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot_revision (source_snapshot_id, source_revision_id),
  INDEX idx_snapshot_item_source (source_id)
);

CREATE TABLE IF NOT EXISTS knowledge_governance_run (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  current_gate VARCHAR(8) NOT NULL DEFAULT 'G0',
  rule_package_version_id VARCHAR(64) NULL,
  source_snapshot_id VARCHAR(64) NULL,
  readiness_id VARCHAR(64) NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  expected_version INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governance_run_idempotency (idempotency_key),
  INDEX idx_governance_run_batch (batch_id, status),
  INDEX idx_governance_run_product (product_id, status)
);

CREATE TABLE IF NOT EXISTS knowledge_governance_gate_result (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  gate_code VARCHAR(8) NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  input_fingerprint CHAR(64) NOT NULL,
  reason_codes JSON NOT NULL,
  blockers JSON NOT NULL,
  next_actions JSON NOT NULL,
  payload_summary JSON NOT NULL,
  evaluator_version VARCHAR(64) NOT NULL,
  evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governance_gate_attempt (run_id, gate_code, attempt),
  INDEX idx_governance_gate_status (gate_code, status)
);

CREATE TABLE IF NOT EXISTS governance_idempotency_record (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  operation_type VARCHAR(64) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  resource_type VARCHAR(64) NULL,
  resource_id VARCHAR(64) NULL,
  response_status VARCHAR(32) NOT NULL,
  response_summary JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  INDEX idx_governance_idempotency_operation (operation_type, created_at)
);

CREATE TABLE IF NOT EXISTS governance_audit_event (
  id VARCHAR(64) PRIMARY KEY,
  event_type VARCHAR(128) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  actor_role VARCHAR(64) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(64) NOT NULL,
  related_source_ids JSON NOT NULL,
  before_summary JSON NULL,
  after_summary JSON NULL,
  reason TEXT NOT NULL,
  correlation_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_governance_audit_object (object_type, object_id, created_at),
  INDEX idx_governance_audit_event (event_type, created_at),
  INDEX idx_governance_audit_correlation (correlation_id)
);

ALTER TABLE monthly_production_readiness
  ADD COLUMN source_snapshot_id VARCHAR(64) NULL AFTER rule_package_version_id,
  ADD COLUMN source_snapshot_hash CHAR(64) NULL AFTER source_snapshot_id,
  ADD COLUMN reason_codes JSON NULL AFTER max_monthly_quota,
  ADD COLUMN evaluated_at DATETIME NULL AFTER status,
  ADD COLUMN evaluator_version VARCHAR(64) NULL AFTER evaluated_at,
  ADD COLUMN governance_run_id VARCHAR(64) NULL AFTER evaluator_version,
  ADD INDEX idx_readiness_snapshot (source_snapshot_hash),
  ADD INDEX idx_readiness_evaluated (evaluated_at);

ALTER TABLE production_pool_entry
  ADD COLUMN version INT NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN activated_at DATETIME NULL AFTER approved_by,
  ADD COLUMN suspended_at DATETIME NULL AFTER activated_at;
