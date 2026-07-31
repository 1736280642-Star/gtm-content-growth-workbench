ALTER TABLE single_article_operation
  ADD COLUMN task_version INT NOT NULL DEFAULT 1 AFTER task_id,
  ADD INDEX idx_single_article_task_version_status (task_id, task_version, status);
