-- Product-level sample calibration runs before MonthlyPlan batch production.
-- It reuses the formal RAG / production-contract / draft pipeline without
-- creating a fake calendar-month plan.

CREATE TABLE IF NOT EXISTS product_sample_article_task (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  product_strategy_pack_id VARCHAR(64) NOT NULL,
  article_type_version_id VARCHAR(64) NOT NULL,
  channel VARCHAR(64) NOT NULL DEFAULT 'wechat',
  platform_content_type VARCHAR(64) NOT NULL DEFAULT 'explicit_product_intro',
  title VARCHAR(500) NOT NULL,
  target_audience VARCHAR(255) NULL,
  primary_distilled_term_id VARCHAR(64) NULL,
  secondary_distilled_term_ids JSON NOT NULL,
  knowledge_base_ids JSON NOT NULL,
  rule_package_version_id VARCHAR(64) NOT NULL,
  prompt_group_id VARCHAR(64) NOT NULL,
  prompt_group_version_id VARCHAR(64) NOT NULL,
  channel_rule_version_id VARCHAR(64) NOT NULL,
  platform_expression_snapshot JSON NULL,
  source_problem TEXT NULL,
  final_evidence_pack_id VARCHAR(64) NULL,
  evidence_gate_status VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'approved',
  approved_at DATETIME NOT NULL,
  approved_by VARCHAR(128) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_sample_strategy (product_strategy_pack_id),
  INDEX idx_product_sample_product (product_id, updated_at),
  INDEX idx_product_sample_status (status, updated_at)
);
