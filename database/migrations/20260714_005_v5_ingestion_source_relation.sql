-- V5 wave 2: preserve every batch-to-logical-source discovery without duplicating SourceAsset.

CREATE TABLE IF NOT EXISTS ingestion_batch_source_asset (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  discovery_type VARCHAR(32) NOT NULL DEFAULT 'new',
  discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_batch_source_relation (batch_id, source_id),
  INDEX idx_batch_source_source (source_id)
);
