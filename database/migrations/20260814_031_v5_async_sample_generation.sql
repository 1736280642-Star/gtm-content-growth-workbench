-- Durable asynchronous execution state for product sample generation.
-- The user-facing request only enqueues one idempotent operation; the content
-- worker claims it and records explicit progress stages.

ALTER TABLE single_article_operation
  ADD COLUMN progress_stage VARCHAR(64) NULL AFTER status,
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER progress_stage,
  ADD COLUMN recovery_of_operation_id VARCHAR(64) NULL AFTER attempt_count,
  ADD COLUMN available_at DATETIME NULL AFTER recovery_of_operation_id,
  ADD INDEX idx_single_article_queue (status, available_at, updated_at);

UPDATE single_article_operation
SET progress_stage = CASE
  WHEN status = 'completed' THEN 'completed'
  WHEN status IN ('blocked', 'pending_config', 'failed') THEN 'failed'
  WHEN status = 'running' THEN 'calling_provider'
  ELSE 'queued'
END
WHERE progress_stage IS NULL;
