CREATE TABLE IF NOT EXISTS source_revision_content (
  source_revision_id VARCHAR(64) PRIMARY KEY,
  content_hash CHAR(64) NOT NULL,
  normalized_text LONGTEXT NOT NULL,
  raw_content LONGBLOB NULL,
  mime_type VARCHAR(128) NULL,
  original_file_name VARCHAR(500) NULL,
  normalized_length INT UNSIGNED NOT NULL DEFAULT 0,
  raw_length BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_source_revision_content_hash (content_hash)
);
