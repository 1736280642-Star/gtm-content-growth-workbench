-- Deployment-owned personal sender connection for hosted transactional mail.
-- Provider credentials are encrypted by the application before persistence.

CREATE TABLE IF NOT EXISTS hosted_email_sender_connection (
  id VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  sender_email VARCHAR(320) NOT NULL,
  auth_type VARCHAR(32) NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  granted_scopes_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'connected',
  last_verified_at DATETIME(3) NULL,
  last_error_code VARCHAR(128) NULL,
  last_error_message VARCHAR(500) NULL,
  row_version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_hosted_email_sender_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS hosted_email_oauth_state (
  state_hash CHAR(64) PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  encrypted_code_verifier TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_hosted_email_oauth_expiry (expires_at, consumed_at)
);
