-- V5 real RAG: governed manifests, immutable indexes, explainable retrieval and evidence lifecycle.
-- Provider secrets are intentionally excluded from persistence.

CREATE TABLE IF NOT EXISTS rag_ingestion_manifest (
  id VARCHAR(64) PRIMARY KEY, product_id VARCHAR(64) NOT NULL, knowledge_base_ids JSON NOT NULL,
  active_rule_package_version_id VARCHAR(64) NOT NULL, approved_source_revision_ids JSON NOT NULL,
  approved_claim_ids JSON NOT NULL, blocked_claim_ids JSON NOT NULL, unresolved_conflict_ids JSON NOT NULL,
  authority_policy_version VARCHAR(64) NOT NULL, monthly_production_readiness_id VARCHAR(64) NOT NULL,
  matrix_scope_version VARCHAR(64) NOT NULL, manifest_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL,
  generated_by VARCHAR(128) NOT NULL, generated_at DATETIME NOT NULL, approved_by VARCHAR(128) NULL, approved_at DATETIME NULL,
  supersedes_manifest_id VARCHAR(64) NULL, row_version INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_rag_manifest_hash (manifest_hash), INDEX idx_rag_manifest_product_status (product_id, status, generated_at)
);

CREATE TABLE IF NOT EXISTS rag_index_snapshot (
  id VARCHAR(64) PRIMARY KEY, manifest_id VARCHAR(64) NOT NULL, namespace VARCHAR(32) NOT NULL, product_id VARCHAR(64) NOT NULL,
  language VARCHAR(16) NOT NULL, index_version VARCHAR(64) NOT NULL, index_name VARCHAR(255) NOT NULL, index_alias VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL, chunk_schema_version VARCHAR(64) NOT NULL, chunker_version VARCHAR(64) NOT NULL,
  retrieval_policy_version VARCHAR(64) NOT NULL, embedding_provider VARCHAR(64) NULL, embedding_model VARCHAR(128) NULL,
  embedding_dimensions INT NULL, document_count INT NOT NULL DEFAULT 0, manifest_hash CHAR(64) NOT NULL,
  validation_summary JSON NULL, immutable_at DATETIME NULL, activated_at DATETIME NULL, supersedes_snapshot_id VARCHAR(64) NULL,
  created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, row_version INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_rag_index_partition (namespace, product_id, language, index_version),
  UNIQUE KEY uq_rag_index_name (index_name), INDEX idx_rag_index_active (namespace, product_id, language, status)
);

CREATE TABLE IF NOT EXISTS rag_knowledge_chunk (
  id VARCHAR(64) PRIMARY KEY, index_snapshot_id VARCHAR(64) NOT NULL, namespace VARCHAR(32) NOT NULL,
  product_id VARCHAR(64) NOT NULL, product_name VARCHAR(255) NOT NULL, knowledge_base_ids JSON NOT NULL,
  source_id VARCHAR(64) NOT NULL, source_revision_id VARCHAR(64) NOT NULL, parent_chunk_id VARCHAR(64) NULL,
  primary_claim_id VARCHAR(64) NULL, claim_ids JSON NOT NULL, source_locator JSON NOT NULL, semantic_type VARCHAR(64) NOT NULL,
  chunk_title TEXT NOT NULL, summary TEXT NOT NULL, content MEDIUMTEXT NOT NULL, original_quote MEDIUMTEXT NOT NULL, canonical_url TEXT NULL,
  document_type VARCHAR(64) NOT NULL, authority_level VARCHAR(8) NOT NULL, lifecycle_status VARCHAR(32) NOT NULL,
  visibility VARCHAR(32) NOT NULL, support_mode VARCHAR(32) NOT NULL, claim_scope VARCHAR(64) NOT NULL, capability_status VARCHAR(32) NOT NULL,
  conditions JSON NOT NULL, limitations JSON NOT NULL, scenario_tags JSON NOT NULL, capability_tags JSON NOT NULL,
  audience_tags JSON NOT NULL, problem_tags JSON NOT NULL, channel_tags JSON NOT NULL, distilled_term_ids JSON NOT NULL,
  question_candidate_ids JSON NOT NULL, conflict_group_ids JSON NOT NULL, rule_package_version_id VARCHAR(64) NOT NULL,
  valid_from DATETIME NULL, valid_until DATETIME NULL, content_hash CHAR(64) NOT NULL, semantic_hash CHAR(64) NOT NULL,
  duplicate_cluster_id VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, chunker_version VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rag_chunk_snapshot_hash (index_snapshot_id, content_hash, primary_claim_id),
  INDEX idx_rag_chunk_hard_filter (index_snapshot_id, product_id, namespace, status, visibility, lifecycle_status),
  INDEX idx_rag_chunk_claim (primary_claim_id), INDEX idx_rag_chunk_source (source_revision_id), INDEX idx_rag_chunk_duplicate (duplicate_cluster_id)
);

CREATE TABLE IF NOT EXISTS rag_chunk_relation (
  id VARCHAR(64) PRIMARY KEY, index_snapshot_id VARCHAR(64) NOT NULL, from_chunk_id VARCHAR(64) NOT NULL,
  to_chunk_id VARCHAR(64) NOT NULL, relation_type VARCHAR(64) NOT NULL, metadata JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_rag_chunk_relation (index_snapshot_id, from_chunk_id, to_chunk_id, relation_type)
);

CREATE TABLE IF NOT EXISTS rag_chunk_embedding (
  id VARCHAR(64) PRIMARY KEY, index_snapshot_id VARCHAR(64) NOT NULL, chunk_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL, model VARCHAR(128) NOT NULL, dimensions INT NOT NULL, normalization_version VARCHAR(64) NOT NULL,
  vector_hash CHAR(64) NOT NULL, embedded_at DATETIME NOT NULL, status VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_rag_chunk_embedding (index_snapshot_id, chunk_id, provider, model), INDEX idx_rag_embedding_status (index_snapshot_id, status)
);

CREATE TABLE IF NOT EXISTS rag_index_job (
  id VARCHAR(64) PRIMARY KEY, job_type VARCHAR(64) NOT NULL, index_snapshot_id VARCHAR(64) NULL, product_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL, idempotency_key VARCHAR(191) NOT NULL, payload JSON NOT NULL, attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3, lease_owner VARCHAR(128) NULL, lease_expires_at DATETIME NULL, available_at DATETIME NOT NULL,
  failure_code VARCHAR(64) NULL, failure_message TEXT NULL, created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, started_at DATETIME NULL, completed_at DATETIME NULL, row_version INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_rag_job_idempotency (idempotency_key), INDEX idx_rag_job_lease (status, available_at, lease_expires_at)
);

CREATE TABLE IF NOT EXISTS rag_index_activation (
  id VARCHAR(64) PRIMARY KEY, product_id VARCHAR(64) NOT NULL, namespace VARCHAR(32) NOT NULL, language VARCHAR(16) NOT NULL,
  activated_snapshot_id VARCHAR(64) NOT NULL, previous_snapshot_id VARCHAR(64) NULL, action VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rag_activation_partition (product_id, namespace, language, created_at)
);

CREATE TABLE IF NOT EXISTS retrieval_route (
  id VARCHAR(64) PRIMARY KEY, route_version VARCHAR(64) NOT NULL, platform_content_type VARCHAR(64) NOT NULL,
  route_config JSON NOT NULL, status VARCHAR(32) NOT NULL, activated_at DATETIME NULL, created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_retrieval_route_version (platform_content_type, route_version)
);

CREATE TABLE IF NOT EXISTS retrieval_request (
  id VARCHAR(64) PRIMARY KEY, matrix_item_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NULL, task_version INT NULL,
  product_id VARCHAR(64) NOT NULL, namespace VARCHAR(32) NOT NULL, request_snapshot JSON NOT NULL,
  request_hash CHAR(64) NOT NULL, requested_by VARCHAR(128) NOT NULL, requested_at DATETIME NOT NULL,
  UNIQUE KEY uq_retrieval_request_hash (request_hash), INDEX idx_retrieval_request_matrix (matrix_item_id, requested_at)
);

CREATE TABLE IF NOT EXISTS retrieval_run (
  id VARCHAR(64) PRIMARY KEY, retrieval_request_id VARCHAR(64) NOT NULL, index_snapshot_ids JSON NOT NULL,
  route_id VARCHAR(64) NOT NULL, route_version VARCHAR(64) NOT NULL, retrieval_policy_version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL, selected_chunk_ids JSON NOT NULL, missing_evidence_roles JSON NOT NULL,
  started_at DATETIME NOT NULL, completed_at DATETIME NULL, failure_code VARCHAR(64) NULL, failure_message TEXT NULL,
  INDEX idx_retrieval_run_request (retrieval_request_id, started_at)
);

CREATE TABLE IF NOT EXISTS retrieval_candidate (
  id VARCHAR(64) PRIMARY KEY, retrieval_run_id VARCHAR(64) NOT NULL, chunk_id VARCHAR(64) NOT NULL,
  recall_channels JSON NOT NULL, raw_scores JSON NOT NULL, rrf_score DECIMAL(18,8) NOT NULL, rerank_score DECIMAL(18,8) NOT NULL,
  selected BOOLEAN NOT NULL DEFAULT FALSE, exclusion_reasons JSON NOT NULL, selection_reasons JSON NOT NULL, evidence_roles JSON NOT NULL,
  chunk_snapshot JSON NOT NULL,
  rank_position INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_retrieval_candidate (retrieval_run_id, chunk_id), INDEX idx_retrieval_candidate_selected (retrieval_run_id, selected, rank_position)
);

CREATE TABLE IF NOT EXISTS evidence_preview (
  id VARCHAR(64) PRIMARY KEY, matrix_item_id VARCHAR(64) NOT NULL, matrix_version_id VARCHAR(64) NOT NULL,
  retrieval_run_id VARCHAR(64) NULL, status VARCHAR(32) NOT NULL, summary_snapshot JSON NOT NULL,
  source_snapshot_hash CHAR(64) NOT NULL, expires_at DATETIME NULL, invalidated_at DATETIME NULL, invalidation_reason TEXT NULL,
  created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, row_version INT NOT NULL DEFAULT 1,
  INDEX idx_evidence_preview_matrix (matrix_item_id, matrix_version_id, created_at)
);

CREATE TABLE IF NOT EXISTS evidence_preview_item (
  id VARCHAR(64) PRIMARY KEY, evidence_preview_id VARCHAR(64) NOT NULL, chunk_id VARCHAR(64) NOT NULL,
  claim_ids JSON NOT NULL, item_snapshot JSON NOT NULL, evidence_role VARCHAR(64) NOT NULL, display_order INT NOT NULL,
  UNIQUE KEY uq_evidence_preview_item (evidence_preview_id, chunk_id, evidence_role)
);

CREATE TABLE IF NOT EXISTS evidence_gate_run (
  id VARCHAR(64) PRIMARY KEY, matrix_item_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NULL, final_evidence_pack_id VARCHAR(64) NULL,
  decision VARCHAR(64) NOT NULL, reason_codes JSON NOT NULL, blockers JSON NOT NULL, evaluated_by VARCHAR(128) NOT NULL,
  evaluated_at DATETIME NOT NULL, INDEX idx_evidence_gate_matrix (matrix_item_id, evaluated_at)
);

-- Keep this RAG migration self-contained when the optional prompt-generation
-- migration has not been installed yet. If it has, this is a no-op.
CREATE TABLE IF NOT EXISTS final_evidence_pack (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  task_version INT NOT NULL,
  rule_package_version_id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  required_claims JSON NOT NULL,
  forbidden_claims JSON NOT NULL,
  evidence_items JSON NOT NULL,
  gaps JSON NOT NULL,
  downgrade_instructions JSON NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  test_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_final_evidence_task_snapshot (task_id, task_version, snapshot_hash),
  INDEX idx_final_evidence_rule_package (rule_package_version_id, status)
);

ALTER TABLE final_evidence_pack
  ADD COLUMN pack_version INT NOT NULL DEFAULT 1 AFTER id,
  ADD COLUMN monthly_plan_id VARCHAR(64) NULL AFTER pack_version,
  ADD COLUMN matrix_version_id VARCHAR(64) NULL AFTER monthly_plan_id,
  ADD COLUMN matrix_item_id VARCHAR(64) NULL AFTER matrix_version_id,
  ADD COLUMN retrieval_run_id VARCHAR(64) NULL AFTER task_version,
  ADD COLUMN index_snapshot_ids JSON NULL AFTER retrieval_run_id,
  ADD COLUMN route_id VARCHAR(64) NULL AFTER index_snapshot_ids,
  ADD COLUMN route_version VARCHAR(64) NULL AFTER route_id,
  ADD COLUMN retrieval_policy_version VARCHAR(64) NULL AFTER route_version,
  ADD COLUMN embedding_provider VARCHAR(64) NULL AFTER retrieval_policy_version,
  ADD COLUMN embedding_model VARCHAR(128) NULL AFTER embedding_provider,
  ADD COLUMN reranker_model VARCHAR(128) NULL AFTER embedding_model,
  ADD COLUMN task_snapshot JSON NULL AFTER reranker_model,
  ADD COLUMN governance_snapshot JSON NULL AFTER task_snapshot,
  ADD COLUMN retrieval_snapshot JSON NULL AFTER governance_snapshot,
  ADD COLUMN claim_plan JSON NULL AFTER retrieval_snapshot,
  ADD COLUMN evidence_groups JSON NULL AFTER claim_plan,
  ADD COLUMN conflicts JSON NULL AFTER gaps,
  ADD COLUMN outdated_evidence JSON NULL AFTER conflicts,
  ADD COLUMN unverified_claims JSON NULL AFTER outdated_evidence,
  ADD COLUMN decision VARCHAR(64) NULL AFTER unverified_claims,
  ADD COLUMN source_snapshot_hash CHAR(64) NULL AFTER snapshot_hash,
  ADD COLUMN supersedes_pack_id VARCHAR(64) NULL AFTER source_snapshot_hash,
  ADD COLUMN immutable_at DATETIME NULL AFTER supersedes_pack_id,
  ADD COLUMN invalidated_at DATETIME NULL AFTER immutable_at,
  ADD COLUMN invalidation_reason TEXT NULL AFTER invalidated_at,
  ADD INDEX idx_final_pack_matrix (matrix_item_id, task_version, created_at),
  ADD INDEX idx_final_pack_validity (status, invalidated_at);

CREATE TABLE IF NOT EXISTS final_evidence_pack_version (
  id VARCHAR(64) PRIMARY KEY, final_evidence_pack_id VARCHAR(64) NOT NULL, pack_version INT NOT NULL,
  immutable_snapshot JSON NOT NULL, snapshot_hash CHAR(64) NOT NULL, immutable_at DATETIME NOT NULL,
  created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_final_pack_version (final_evidence_pack_id, pack_version), UNIQUE KEY uq_final_pack_snapshot_hash (snapshot_hash)
);

CREATE TABLE IF NOT EXISTS final_evidence_pack_item (
  id VARCHAR(64) PRIMARY KEY, final_evidence_pack_id VARCHAR(64) NOT NULL, pack_version INT NOT NULL,
  chunk_id VARCHAR(64) NOT NULL, primary_claim_id VARCHAR(64) NULL, claim_ids JSON NOT NULL,
  source_id VARCHAR(64) NOT NULL, source_revision_id VARCHAR(64) NOT NULL, source_locator JSON NOT NULL,
  item_snapshot JSON NOT NULL, evidence_group VARCHAR(64) NOT NULL, display_order INT NOT NULL,
  UNIQUE KEY uq_final_pack_item (final_evidence_pack_id, pack_version, chunk_id, evidence_group)
);

CREATE TABLE IF NOT EXISTS rag_evaluation_case (
  id VARCHAR(64) PRIMARY KEY, product_id VARCHAR(64) NOT NULL, case_type VARCHAR(64) NOT NULL, request_fixture JSON NOT NULL,
  expected_result JSON NOT NULL, blocking_metric BOOLEAN NOT NULL DEFAULT FALSE, status VARCHAR(32) NOT NULL,
  created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_rag_eval_case_product (product_id, status)
);

CREATE TABLE IF NOT EXISTS rag_evaluation_run (
  id VARCHAR(64) PRIMARY KEY, index_snapshot_id VARCHAR(64) NOT NULL, baseline_snapshot_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL, summary JSON NOT NULL, passed BOOLEAN NOT NULL DEFAULT FALSE,
  started_at DATETIME NOT NULL, completed_at DATETIME NULL, created_by VARCHAR(128) NOT NULL,
  INDEX idx_rag_eval_run_snapshot (index_snapshot_id, started_at)
);

CREATE TABLE IF NOT EXISTS rag_evaluation_result (
  id VARCHAR(64) PRIMARY KEY, evaluation_run_id VARCHAR(64) NOT NULL, evaluation_case_id VARCHAR(64) NOT NULL,
  metric_values JSON NOT NULL, passed BOOLEAN NOT NULL, failure_reasons JSON NOT NULL, retrieval_run_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_rag_eval_result (evaluation_run_id, evaluation_case_id)
);

CREATE TABLE IF NOT EXISTS rag_badcase (
  id VARCHAR(64) PRIMARY KEY, product_id VARCHAR(64) NOT NULL, stage VARCHAR(32) NOT NULL, badcase_type VARCHAR(64) NOT NULL,
  retrieval_request_id VARCHAR(64) NULL, evidence_preview_id VARCHAR(64) NULL, final_evidence_pack_id VARCHAR(64) NULL,
  chunk_id VARCHAR(64) NULL, claim_id VARCHAR(64) NULL, description TEXT NOT NULL, status VARCHAR(32) NOT NULL,
  owner_role VARCHAR(64) NOT NULL, resolution JSON NULL, created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL, INDEX idx_rag_badcase_status (product_id, stage, status)
);

CREATE TABLE IF NOT EXISTS rag_human_evidence_feedback (
  id VARCHAR(64) PRIMARY KEY, retrieval_request_id VARCHAR(64) NOT NULL, evidence_preview_id VARCHAR(64) NULL,
  final_evidence_pack_id VARCHAR(64) NULL, chunk_id VARCHAR(64) NOT NULL, claim_id VARCHAR(64) NOT NULL,
  feedback_type VARCHAR(64) NOT NULL, actor_id VARCHAR(128) NOT NULL, actor_role VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rag_feedback_request (retrieval_request_id, created_at), INDEX idx_rag_feedback_chunk (chunk_id, claim_id)
);
