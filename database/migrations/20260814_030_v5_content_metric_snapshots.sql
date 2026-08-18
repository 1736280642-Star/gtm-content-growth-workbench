-- V5 content monitoring: append-only platform metric snapshots and sync health.

CREATE TABLE IF NOT EXISTS content_metric_sync_run (
  id VARCHAR(64) PRIMARY KEY,
  platform VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  scanned_count INT NOT NULL DEFAULT 0,
  captured_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  message TEXT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  next_sync_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_content_metric_sync_platform (platform, started_at),
  INDEX idx_content_metric_sync_next (status, next_sync_at)
);

CREATE TABLE IF NOT EXISTS content_metric_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  -- Restored monthly workspaces can contain a published matrix item before a
  -- content_publish_result row is rebuilt. matrix_item_id stays authoritative.
  publish_result_id VARCHAR(64) NULL,
  matrix_item_id VARCHAR(64) NOT NULL,
  sync_run_id VARCHAR(64) NULL,
  platform VARCHAR(32) NOT NULL,
  metric_date DATE NOT NULL,
  captured_at DATETIME NOT NULL,
  views BIGINT NULL,
  likes BIGINT NULL,
  favorites BIGINT NULL,
  comments BIGINT NULL,
  shares BIGINT NULL,
  source VARCHAR(32) NOT NULL,
  confidence VARCHAR(16) NOT NULL DEFAULT 'real',
  raw_data_hash CHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_content_metric_result_time (publish_result_id, captured_at),
  INDEX idx_content_metric_platform_date (platform, metric_date),
  INDEX idx_content_metric_matrix_date (matrix_item_id, metric_date),
  CONSTRAINT fk_content_metric_publish_result FOREIGN KEY (publish_result_id) REFERENCES content_publish_result(id),
  CONSTRAINT fk_content_metric_sync_run FOREIGN KEY (sync_run_id) REFERENCES content_metric_sync_run(id)
);
