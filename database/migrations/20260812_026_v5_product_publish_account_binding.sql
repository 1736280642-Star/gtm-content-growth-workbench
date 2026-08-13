-- Product-level human confirmation for real publishing targets.

CREATE TABLE IF NOT EXISTS product_publish_account_binding (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  channel VARCHAR(64) NOT NULL,
  account_label VARCHAR(160) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'confirmed',
  confirmed_by VARCHAR(128) NOT NULL,
  confirmed_at DATETIME NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_publish_account_product FOREIGN KEY (product_id) REFERENCES product_entity(id),
  UNIQUE KEY uq_product_publish_account_platform (product_id, platform),
  INDEX idx_product_publish_account_status (product_id, status)
);
