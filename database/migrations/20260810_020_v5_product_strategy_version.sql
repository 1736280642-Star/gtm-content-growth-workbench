-- Phase 2A follow-up: deterministic product-level strategy ordering.
-- The product row lock in the repository serializes version allocation.

ALTER TABLE product_strategy_packs
  ADD COLUMN IF NOT EXISTS strategy_version INT NOT NULL DEFAULT 1 AFTER product_id;

ALTER TABLE product_strategy_packs
  ADD INDEX idx_strategy_pack_product_version (product_id, strategy_version);
