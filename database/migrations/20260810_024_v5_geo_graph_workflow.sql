-- Phase 2E: LangGraph shadow workflow, durable MySQL checkpoints and node audit.

CREATE TABLE IF NOT EXISTS geo_graph_workflow_run (
  id VARCHAR(64) PRIMARY KEY,
  thread_id VARCHAR(191) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  source_snapshot_id VARCHAR(64) NOT NULL,
  source_snapshot_hash CHAR(64) NOT NULL,
  research_policy_version VARCHAR(64) NOT NULL,
  execution_mode VARCHAR(32) NOT NULL DEFAULT 'shadow',
  status VARCHAR(64) NOT NULL DEFAULT 'running',
  current_node VARCHAR(64) NULL,
  state_refs JSON NOT NULL,
  research_attempt INT NOT NULL DEFAULT 0,
  supplementary_round INT NOT NULL DEFAULT 0,
  error_codes JSON NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  started_by VARCHAR(128) NOT NULL,
  started_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_geo_graph_thread (thread_id),
  UNIQUE KEY uq_geo_graph_idempotency (product_id, idempotency_key),
  INDEX idx_geo_graph_status (status, updated_at),
  INDEX idx_geo_graph_product (product_id, updated_at)
);

CREATE TABLE IF NOT EXISTS geo_graph_node_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workflow_run_id VARCHAR(64) NOT NULL,
  thread_id VARCHAR(191) NOT NULL,
  node_name VARCHAR(64) NOT NULL,
  attempt INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  input_refs JSON NOT NULL,
  output_refs JSON NOT NULL,
  error_code VARCHAR(64) NULL,
  duration_ms INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_geo_graph_event_run (workflow_run_id, id),
  INDEX idx_geo_graph_event_thread (thread_id, id)
);

CREATE TABLE IF NOT EXISTS langgraph_checkpoint (
  thread_id VARCHAR(191) NOT NULL,
  checkpoint_ns VARCHAR(191) NOT NULL DEFAULT '',
  checkpoint_id VARCHAR(64) NOT NULL,
  parent_checkpoint_id VARCHAR(64) NULL,
  checkpoint_type VARCHAR(32) NOT NULL,
  checkpoint_blob LONGBLOB NOT NULL,
  metadata_type VARCHAR(32) NOT NULL,
  metadata_blob LONGBLOB NOT NULL,
  created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id),
  INDEX idx_langgraph_checkpoint_latest (thread_id, checkpoint_ns, created_at)
);

CREATE TABLE IF NOT EXISTS langgraph_checkpoint_write (
  thread_id VARCHAR(191) NOT NULL,
  checkpoint_ns VARCHAR(191) NOT NULL DEFAULT '',
  checkpoint_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(191) NOT NULL,
  write_index INT NOT NULL,
  channel VARCHAR(191) NOT NULL,
  value_type VARCHAR(32) NOT NULL,
  value_blob LONGBLOB NOT NULL,
  created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index),
  INDEX idx_langgraph_write_checkpoint (thread_id, checkpoint_ns, checkpoint_id)
);
