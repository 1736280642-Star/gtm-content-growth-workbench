-- One reviewable sample per approved, evidence-ready strategy article type.

ALTER TABLE product_sample_article_task
  DROP INDEX uq_product_sample_strategy;

ALTER TABLE product_sample_article_task
  ADD UNIQUE KEY uq_product_sample_strategy_type (product_strategy_pack_id, article_type_version_id);

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) NOT NULL DEFAULT 'pending_generation' AFTER status;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS accepted_draft_version_id VARCHAR(64) NULL AFTER review_status;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS accepted_at DATETIME NULL AFTER accepted_draft_version_id;

ALTER TABLE product_sample_article_task
  ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(128) NULL AFTER accepted_at;

CREATE INDEX IF NOT EXISTS idx_product_sample_review
  ON product_sample_article_task (product_strategy_pack_id, review_status, updated_at);

ALTER TABLE expression_calibration_version
  ADD COLUMN IF NOT EXISTS article_type_version_id VARCHAR(64) NULL AFTER product_strategy_pack_id;

CREATE INDEX IF NOT EXISTS idx_expression_calibration_article_type
  ON expression_calibration_version (product_id, article_type_version_id, status, version_number);

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS system_prompt_snapshot MEDIUMTEXT NULL AFTER model;

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS user_prompt_snapshot MEDIUMTEXT NULL AFTER system_prompt_snapshot;

ALTER TABLE generation_run
  ADD COLUMN IF NOT EXISTS brief_snapshot JSON NULL AFTER user_prompt_snapshot;

UPDATE product_sample_article_task task
SET task.review_status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM expression_calibration_version calibration
    JOIN draft_version draft ON draft.id = calibration.source_sample_draft_id
    WHERE draft.task_id = task.id AND calibration.status = 'active'
  ) THEN 'approved'
  WHEN EXISTS (
    SELECT 1 FROM draft_version draft
    WHERE draft.task_id = task.id AND draft.test_only = FALSE AND draft.copy_allowed = TRUE
  ) THEN 'pending_review'
  ELSE 'pending_generation'
END;
