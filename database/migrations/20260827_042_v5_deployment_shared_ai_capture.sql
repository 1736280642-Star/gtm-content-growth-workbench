-- Deployment-managed AI frontend capture pool.
-- One always-on Windows companion serves hosted users while every task keeps
-- the requesting workspace/user identity for tenant-safe status and results.

ALTER TABLE capture_pairing_codes
  ADD COLUMN IF NOT EXISTS execution_scope VARCHAR(32) NOT NULL DEFAULT 'user_private' AFTER user_id;

ALTER TABLE capture_devices
  ADD COLUMN IF NOT EXISTS execution_scope VARCHAR(32) NOT NULL DEFAULT 'user_private' AFTER user_id;
CREATE INDEX IF NOT EXISTS idx_capture_device_scope ON capture_devices (execution_scope, status, last_heartbeat_at);

ALTER TABLE ai_frontend_connections
  ADD COLUMN IF NOT EXISTS execution_scope VARCHAR(32) NOT NULL DEFAULT 'user_private' AFTER user_id;
CREATE INDEX IF NOT EXISTS idx_ai_frontend_connection_scope ON ai_frontend_connections (execution_scope, platform, status, revoked_at);

ALTER TABLE capture_tasks
  ADD COLUMN IF NOT EXISTS requested_workspace_id VARCHAR(64) NULL AFTER product_id;
ALTER TABLE capture_tasks
  ADD COLUMN IF NOT EXISTS requested_user_id VARCHAR(64) NULL AFTER requested_workspace_id;
CREATE INDEX IF NOT EXISTS idx_capture_task_requester ON capture_tasks (requested_workspace_id, requested_user_id, created_at);
