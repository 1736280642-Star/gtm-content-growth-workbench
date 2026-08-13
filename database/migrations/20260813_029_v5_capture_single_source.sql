-- Make MySQL capture_tasks the single formal AI-front-test task source.

ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS question_version_id VARCHAR(64) NULL AFTER question;
ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS published_content_id VARCHAR(64) NULL AFTER question_version_id;
ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS source_publish_result_id VARCHAR(64) NULL AFTER published_content_id;
ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual_once' AFTER source_publish_result_id;
ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS capture_condition JSON NULL AFTER trigger_type;
CREATE INDEX IF NOT EXISTS idx_capture_task_question ON capture_tasks (question_version_id);
CREATE INDEX IF NOT EXISTS idx_capture_task_published_content ON capture_tasks (published_content_id);
CREATE INDEX IF NOT EXISTS idx_capture_task_trigger ON capture_tasks (trigger_type, created_at);

CREATE TABLE IF NOT EXISTS capture_gap_reviews (
  id VARCHAR(64) PRIMARY KEY,
  evidence_id VARCHAR(64) NOT NULL,
  answer_id VARCHAR(96) NOT NULL,
  version INT NOT NULL,
  selected_gap_ids JSON NOT NULL,
  decision VARCHAR(16) NOT NULL,
  destinations JSON NOT NULL,
  note TEXT NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_capture_gap_review_version (answer_id, version),
  INDEX idx_capture_gap_review_evidence (evidence_id)
);
