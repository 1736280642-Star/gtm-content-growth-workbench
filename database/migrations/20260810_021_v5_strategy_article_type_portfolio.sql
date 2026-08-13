-- Phase 2C: freeze product-scoped article type versions with the strategy pack.
-- Drafts are created with the pack; only the same human approval transaction
-- may freeze/activate the selected versions.

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS decision_payload_hash CHAR(64) NULL AFTER decision_idempotency_key;

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
