-- Forward-compatible fix for environments that applied migration 021 before
-- decision payload hashing and the frozen external version reference were added.

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS decision_payload_hash CHAR(64) NULL AFTER decision_idempotency_key;

ALTER TABLE product_strategy_article_type_versions
  ADD COLUMN IF NOT EXISTS article_type_version_id VARCHAR(64) NOT NULL AFTER article_type_id;
