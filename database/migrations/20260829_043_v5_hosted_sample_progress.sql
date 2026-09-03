-- Bind every hosted order to the exact approved strategy and representative
-- sample operation that it is following. Product-level "latest" pointers may
-- continue to advance without regressing an in-flight hosted order.

ALTER TABLE hosted_promotion_order
  ADD COLUMN current_strategy_pack_id VARCHAR(64) NULL AFTER current_monthly_plan_id,
  ADD COLUMN current_sample_task_id VARCHAR(64) NULL AFTER current_strategy_pack_id,
  ADD COLUMN current_sample_operation_id VARCHAR(64) NULL AFTER current_sample_task_id;

CREATE INDEX idx_hosted_order_strategy
  ON hosted_promotion_order (current_strategy_pack_id);

CREATE INDEX idx_hosted_order_sample
  ON hosted_promotion_order (current_sample_task_id, current_sample_operation_id);
