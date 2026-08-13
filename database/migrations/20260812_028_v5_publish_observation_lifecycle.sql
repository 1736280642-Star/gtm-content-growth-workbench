-- Preserve the formal publication fact while recording the 24h/72h URL lifecycle.

ALTER TABLE content_publish_result
  ADD COLUMN publish_schedule_id VARCHAR(64) NULL AFTER external_content_id,
  ADD COLUMN url_status VARCHAR(32) NULL AFTER publish_schedule_id,
  ADD COLUMN first_public_observed_at DATETIME NULL AFTER published_at,
  ADD COLUMN last_verified_at DATETIME NULL AFTER first_public_observed_at,
  ADD COLUMN stable_published_at DATETIME NULL AFTER last_verified_at,
  ADD COLUMN removed_at DATETIME NULL AFTER stable_published_at,
  ADD COLUMN verification_count INT NOT NULL DEFAULT 0 AFTER removed_at,
  ADD INDEX idx_content_publish_result_schedule (publish_schedule_id),
  ADD INDEX idx_content_publish_result_liveness (first_public_observed_at, last_verified_at, removed_at);
