-- V5 monthly execution closure: formal plan payload, scheduling, publish result and metrics.

ALTER TABLE monthly_plan
  ADD COLUMN question_version_ids JSON NULL AFTER publish_frequency,
  ADD COLUMN workspace_config JSON NULL AFTER question_version_ids;

ALTER TABLE content_matrix_item
  ADD COLUMN question_version_id VARCHAR(64) NULL AFTER source_problem,
  ADD COLUMN scheduled_at DATETIME NULL AFTER publish_time,
  ADD COLUMN platform_account VARCHAR(120) NULL AFTER scheduled_at,
  ADD INDEX idx_matrix_item_question (question_version_id),
  ADD INDEX idx_matrix_item_schedule (scheduled_at, status);

CREATE TABLE IF NOT EXISTS content_publish_result (
  id VARCHAR(64) PRIMARY KEY,
  matrix_item_id VARCHAR(64) NOT NULL,
  draft_version_id VARCHAR(64) NULL,
  channel VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  public_url TEXT NULL,
  external_content_id VARCHAR(255) NULL,
  failure_reason TEXT NULL,
  metrics JSON NOT NULL,
  published_at DATETIME NULL,
  confirmed_by VARCHAR(128) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_publish_result_item (matrix_item_id),
  INDEX idx_content_publish_result_status (status, published_at)
);
