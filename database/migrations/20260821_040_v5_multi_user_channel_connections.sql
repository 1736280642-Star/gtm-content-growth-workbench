-- Multi-user hosted identity, governed channel account connections, and
-- browser-executor orchestration. Credentials and browser storage never live
-- in these business tables; profile_ref is an opaque executor-owned handle.

CREATE TABLE IF NOT EXISTS hosted_identity_user (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  email_verified_at DATETIME NOT NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_identity_user_email (email),
  INDEX idx_hosted_identity_user_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS hosted_workspace (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hosted_workspace_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS hosted_workspace_member (
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  joined_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  INDEX idx_hosted_workspace_member_user (user_id, status),
  INDEX idx_hosted_workspace_member_role (workspace_id, role, status)
);

CREATE TABLE IF NOT EXISTS hosted_workspace_product (
  workspace_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  linked_by VARCHAR(64) NOT NULL,
  linked_at DATETIME NOT NULL,
  PRIMARY KEY (workspace_id, product_id),
  INDEX idx_hosted_workspace_product_product (product_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS hosted_identity_login_challenge (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  delivery_error VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_login_token (token_hash),
  INDEX idx_hosted_login_email (email, status, created_at),
  INDEX idx_hosted_login_expiry (status, expires_at)
);

CREATE TABLE IF NOT EXISTS hosted_identity_session (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosted_identity_session_token (token_hash),
  INDEX idx_hosted_identity_session_user (user_id, workspace_id, expires_at),
  INDEX idx_hosted_identity_session_expiry (expires_at, revoked_at)
);

CREATE TABLE IF NOT EXISTS publish_account_connection (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  provider_account_ref VARCHAR(191) NOT NULL,
  public_display_name VARCHAR(160) NOT NULL,
  public_avatar_url VARCHAR(1000) NULL,
  public_profile_url VARCHAR(1000) NULL,
  account_fingerprint CHAR(64) NOT NULL,
  executor_type VARCHAR(32) NOT NULL,
  connector_device_id VARCHAR(64) NULL,
  browser_profile_ref VARCHAR(191) NOT NULL,
  authorization_status VARCHAR(32) NOT NULL DEFAULT 'connected',
  capability_status VARCHAR(32) NOT NULL DEFAULT 'unverified',
  capabilities_json JSON NOT NULL,
  last_verified_at DATETIME NULL,
  last_error_code VARCHAR(96) NULL,
  last_error_message VARCHAR(500) NULL,
  row_version INT NOT NULL DEFAULT 1,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_publish_connection_profile (workspace_id, channel, browser_profile_ref),
  INDEX idx_publish_connection_workspace (workspace_id, channel, authorization_status),
  INDEX idx_publish_connection_device (connector_device_id, authorization_status),
  INDEX idx_publish_connection_fingerprint (workspace_id, channel, account_fingerprint)
);

CREATE TABLE IF NOT EXISTS channel_authorization_session (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  executor_type VARCHAR(32) NOT NULL,
  connector_device_id VARCHAR(64) NULL,
  browser_profile_ref VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  nonce_hash CHAR(64) NOT NULL,
  account_connection_id VARCHAR(64) NULL,
  detected_account_json JSON NULL,
  failure_code VARCHAR(96) NULL,
  failure_message VARCHAR(500) NULL,
  expires_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel_authorization_nonce (nonce_hash),
  INDEX idx_channel_authorization_order (workspace_id, order_id, channel, status),
  INDEX idx_channel_authorization_user (workspace_id, user_id, status),
  INDEX idx_channel_authorization_expiry (status, expires_at)
);

CREATE TABLE IF NOT EXISTS channel_authorization_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  authorization_session_id VARCHAR(64) NOT NULL,
  sequence_no INT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  public_payload_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel_authorization_event (authorization_session_id, sequence_no),
  INDEX idx_channel_authorization_event_stream (authorization_session_id, id)
);

CREATE TABLE IF NOT EXISTS browser_executor_node (
  id VARCHAR(64) PRIMARY KEY,
  executor_type VARCHAR(32) NOT NULL,
  workspace_id VARCHAR(64) NULL,
  owner_user_id VARCHAR(64) NULL,
  display_name VARCHAR(160) NOT NULL,
  auth_token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  supported_channels_json JSON NOT NULL,
  capacity INT NOT NULL DEFAULT 1,
  active_lease_count INT NOT NULL DEFAULT 0,
  adapter_version VARCHAR(32) NULL,
  last_heartbeat_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_browser_executor_capacity (executor_type, status, active_lease_count, capacity),
  INDEX idx_browser_executor_workspace (workspace_id, status)
);

CREATE TABLE IF NOT EXISTS browser_executor_pairing_code (
  code_hash CHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_browser_executor_pairing_expiry (expires_at, used_at)
);

CREATE TABLE IF NOT EXISTS browser_execution_job (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  authorization_session_id VARCHAR(64) NULL,
  account_connection_id VARCHAR(64) NULL,
  executor_node_id VARCHAR(64) NULL,
  operation VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  command_json JSON NOT NULL,
  lease_token_hash CHAR(64) NULL,
  lease_expires_at DATETIME NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  result_json JSON NULL,
  failure_code VARCHAR(96) NULL,
  failure_message VARCHAR(500) NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_browser_execution_idempotency (workspace_id, idempotency_key),
  INDEX idx_browser_execution_queue (status, executor_node_id, created_at),
  INDEX idx_browser_execution_connection (workspace_id, account_connection_id, status)
);

ALTER TABLE hosted_promotion_order ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER id;
ALTER TABLE hosted_promotion_order ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER workspace_id;
UPDATE hosted_promotion_order SET workspace_id = 'legacy-default' WHERE workspace_id IS NULL;
UPDATE hosted_promotion_order SET user_id = LEFT(created_by, 64) WHERE user_id IS NULL;
ALTER TABLE hosted_promotion_order MODIFY workspace_id VARCHAR(64) NOT NULL;
ALTER TABLE hosted_promotion_order MODIFY user_id VARCHAR(64) NOT NULL;
ALTER TABLE hosted_promotion_order DROP INDEX IF EXISTS uq_hosted_order_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosted_order_workspace_idempotency ON hosted_promotion_order (workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_hosted_order_workspace ON hosted_promotion_order (workspace_id, status, updated_at);

ALTER TABLE product_publish_account_binding ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER id;
ALTER TABLE product_publish_account_binding ADD COLUMN IF NOT EXISTS account_connection_id VARCHAR(64) NULL AFTER channel;
ALTER TABLE product_publish_account_binding ADD COLUMN IF NOT EXISTS account_fingerprint CHAR(64) NULL AFTER account_label;
UPDATE product_publish_account_binding SET workspace_id = 'legacy-default' WHERE workspace_id IS NULL;
ALTER TABLE product_publish_account_binding MODIFY workspace_id VARCHAR(64) NOT NULL;
ALTER TABLE product_publish_account_binding DROP INDEX IF EXISTS uq_product_publish_account_platform;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_publish_account_workspace_platform ON product_publish_account_binding (workspace_id, product_id, platform);
CREATE INDEX IF NOT EXISTS idx_product_publish_binding_connection ON product_publish_account_binding (workspace_id, account_connection_id, status);
