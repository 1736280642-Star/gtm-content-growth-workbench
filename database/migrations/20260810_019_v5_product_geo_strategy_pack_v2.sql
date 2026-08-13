-- Phase 2A: product GEO strategy is the only human-reviewed product strategy object.
-- Compilation creates a pending review record; only a human decision may update
-- product_entity.strategy_pack_id.

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS contract_version VARCHAR(64) NOT NULL DEFAULT 'product-geo-strategy.v1' AFTER source_snapshot_id;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS content_plan_hash CHAR(64) NULL AFTER content_plan_json;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1 AFTER content_plan_hash;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS strategy_approved_at DATETIME NULL AFTER row_version;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS strategy_approved_by VARCHAR(128) NULL AFTER strategy_approved_at;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS rejected_at DATETIME NULL AFTER strategy_approved_by;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(128) NULL AFTER rejected_at;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS decision_reason VARCHAR(500) NULL AFTER rejected_by;

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS decision_idempotency_key VARCHAR(128) NULL AFTER decision_reason;

ALTER TABLE product_strategy_packs
  MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending_strategy_review';

ALTER TABLE product_strategy_packs
  MODIFY COLUMN contract_version VARCHAR(64) NOT NULL DEFAULT 'product-geo-strategy.v2';

ALTER TABLE product_strategy_packs
  ADD UNIQUE INDEX uq_strategy_pack_decision_idempotency (decision_idempotency_key);
