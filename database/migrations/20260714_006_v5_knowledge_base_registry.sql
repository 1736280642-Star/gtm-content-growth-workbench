-- V5 wave 2: ensure the existing KnowledgeBase registry is present in the relational truth source.

CREATE TABLE IF NOT EXISTS knowledge_base (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  row_version INT NOT NULL DEFAULT 1,
  update_mode VARCHAR(32) NOT NULL DEFAULT 'manual',
  usage_scope TEXT NULL,
  last_synced_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_knowledge_base_status (status),
  INDEX idx_knowledge_base_type (type)
);
