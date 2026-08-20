-- Bind AI frontend capture tasks to a concrete user-approved account connection.

CREATE TABLE IF NOT EXISTS ai_frontend_connections (
  connection_id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  account_alias VARCHAR(120) NOT NULL,
  browser_profile_slot VARCHAR(120) NOT NULL DEFAULT 'default',
  status VARCHAR(32) NOT NULL DEFAULT 'isolation_unverified',
  isolation_policy JSON NOT NULL,
  last_verified_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_frontend_connection_slot (device_id, platform, browser_profile_slot),
  INDEX idx_ai_frontend_connection_user (workspace_id, user_id, status),
  INDEX idx_ai_frontend_connection_device (device_id, status),
  INDEX idx_ai_frontend_connection_platform (platform, status)
);

ALTER TABLE capture_tasks ADD COLUMN IF NOT EXISTS connection_id VARCHAR(64) NULL AFTER source_publish_result_id;
CREATE INDEX IF NOT EXISTS idx_capture_task_connection ON capture_tasks (connection_id, status, created_at);
