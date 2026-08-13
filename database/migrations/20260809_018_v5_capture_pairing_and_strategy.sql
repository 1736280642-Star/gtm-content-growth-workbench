CREATE TABLE IF NOT EXISTS capture_pairing_codes (
  code_hash CHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_capture_pairing_expiry (expires_at, used_at)
);
