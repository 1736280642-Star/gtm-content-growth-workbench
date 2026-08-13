-- Versioned human correction layered above the parsed product knowledge profile.

CREATE TABLE IF NOT EXISTS product_knowledge_profile_override_version (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  profile_json JSON NOT NULL,
  profile_hash CHAR(64) NOT NULL,
  source_fact_count INT NOT NULL DEFAULT 0,
  approved_by VARCHAR(128) NOT NULL,
  approved_at DATETIME NOT NULL,
  immutable_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_profile_override_product FOREIGN KEY (product_id) REFERENCES product_entity(id),
  UNIQUE KEY uq_product_profile_override_version (product_id, version_number),
  INDEX idx_product_profile_override_active (product_id, status, version_number)
);
