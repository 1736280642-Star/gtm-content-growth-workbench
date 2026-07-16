CREATE TABLE IF NOT EXISTS workspace_setting (
  id VARCHAR(64) PRIMARY KEY,
  default_weekly_days INT NOT NULL DEFAULT 5,
  default_daily_count INT NOT NULL DEFAULT 3,
  enabled_channels JSON NOT NULL,
  enabled_products JSON NOT NULL,
  final_review_mode VARCHAR(32) NOT NULL DEFAULT 'default_final',
  geo_platforms JSON NOT NULL,
  log_mode VARCHAR(32) NOT NULL DEFAULT 'demo_csv',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  update_mode VARCHAR(32) NOT NULL DEFAULT 'manual',
  usage_scope TEXT,
  last_synced_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_article (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  url TEXT NOT NULL,
  published_at DATETIME NULL,
  updated_at DATETIME NULL,
  content_hash VARCHAR(128),
  indexed_status VARCHAR(32) DEFAULT 'unknown',
  seo_issue_count INT NOT NULL DEFAULT 0,
  geo_result VARCHAR(32) NOT NULL DEFAULT 'partial',
  candidate_status VARCHAR(32) NOT NULL DEFAULT 'none',
  candidate_reason TEXT,
  candidate_added_at DATETIME NULL,
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'pending',
  source VARCHAR(64) NOT NULL DEFAULT 'xcrawl',
  last_crawled_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  row_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_blog_article_indexed_status (indexed_status),
  INDEX idx_blog_article_geo_result (geo_result),
  INDEX idx_blog_article_candidate_status (candidate_status)
);

CREATE TABLE IF NOT EXISTS blog_diagnosis (
  id VARCHAR(64) PRIMARY KEY,
  blog_article_id VARCHAR(64) NOT NULL,
  seo_issues JSON,
  geo_issues JSON,
  content_gap JSON,
  suggestion_type VARCHAR(64) NOT NULL,
  candidate_status VARCHAR(32) NOT NULL DEFAULT 'none',
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'real',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_blog_diagnosis_blog_article_id (blog_article_id)
);

CREATE TABLE IF NOT EXISTS geo_test_result (
  id VARCHAR(64) PRIMARY KEY,
  platform VARCHAR(64) NOT NULL,
  provider_key VARCHAR(64),
  model_name VARCHAR(128),
  prompt_group VARCHAR(64) NOT NULL,
  prompt TEXT NOT NULL,
  answer_snapshot MEDIUMTEXT NOT NULL,
  mentioned_joto BOOLEAN NOT NULL DEFAULT FALSE,
  mentioned_weike BOOLEAN NOT NULL DEFAULT FALSE,
  cited_official_url BOOLEAN NOT NULL DEFAULT FALSE,
  cited_urls JSON,
  parser_result JSON,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'pending',
  execution_status VARCHAR(32) NOT NULL DEFAULT 'pending_config',
  error_message TEXT,
  tested_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_geo_test_result_platform (platform),
  INDEX idx_geo_test_result_execution_status (execution_status)
);

CREATE TABLE IF NOT EXISTS log_import_batch (
  id VARCHAR(64) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(255),
  imported_at DATETIME NOT NULL,
  imported_by VARCHAR(128),
  row_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_import_batch_source_type (source_type),
  INDEX idx_log_import_batch_status (status)
);

CREATE TABLE IF NOT EXISTS bot_visit_summary (
  id VARCHAR(64) PRIMARY KEY,
  log_import_batch_id VARCHAR(64) NULL,
  blog_article_id VARCHAR(64) NULL,
  path TEXT NOT NULL,
  bot_name VARCHAR(128),
  pv INT NOT NULL DEFAULT 0,
  summary_date DATE NOT NULL,
  data_confidence VARCHAR(32) NOT NULL DEFAULT 'demo',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bot_visit_summary_bot_name (bot_name),
  INDEX idx_bot_visit_summary_summary_date (summary_date)
);

CREATE TABLE IF NOT EXISTS workbench_audit_event (
  id VARCHAR(64) PRIMARY KEY,
  event VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_workbench_audit_event_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS workbench_state_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  storage VARCHAR(32) NOT NULL DEFAULT 'mysql',
  state_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
