-- Freeze one product-agnostic GEO article mission on every production task.
-- The mission is the shared semantic contract for retrieval, generation and QA.

ALTER TABLE content_matrix_item
  ADD COLUMN IF NOT EXISTS geo_mission_snapshot JSON NULL AFTER platform_expression_snapshot;

ALTER TABLE content_matrix_item
  ADD COLUMN IF NOT EXISTS geo_intent_hash CHAR(64) NULL AFTER geo_mission_snapshot;

ALTER TABLE content_matrix_item
  ADD COLUMN IF NOT EXISTS entity_graph_hash CHAR(64) NULL AFTER geo_intent_hash;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS geo_mission_snapshot JSON NULL AFTER platform_expression_snapshot;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS geo_intent_hash CHAR(64) NULL AFTER geo_mission_snapshot;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS entity_graph_hash CHAR(64) NULL AFTER geo_intent_hash;

ALTER TABLE rag_knowledge_chunk
  ADD COLUMN IF NOT EXISTS evidence_usage VARCHAR(32) NOT NULL DEFAULT 'product_fact' AFTER claim_scope;

ALTER TABLE rag_knowledge_chunk
  ADD COLUMN IF NOT EXISTS subject_entity_ids JSON NULL AFTER evidence_usage;

CREATE INDEX IF NOT EXISTS idx_rag_chunk_geo_usage
  ON rag_knowledge_chunk (index_snapshot_id, product_id, evidence_usage, status);

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS pipeline_diagnostic_result JSON NULL AFTER hard_rule_result;

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS article_quality_result JSON NULL AFTER pipeline_diagnostic_result;

ALTER TABLE draft_version
  ADD COLUMN IF NOT EXISTS article_quality_result JSON NULL AFTER hard_rule_result;
