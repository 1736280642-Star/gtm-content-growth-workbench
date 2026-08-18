-- Persist the exact probe set used by a GEO run. The row is immutable and
-- remains bound to the graph, role/scenario matrix, contract, and source snapshot.
CREATE TABLE IF NOT EXISTS geo_research_probe_set_snapshot (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  entity_graph_version INT NOT NULL,
  role_scenario_matrix_version INT NOT NULL,
  probe_contract_version VARCHAR(64) NOT NULL,
  source_snapshot_id VARCHAR(64) NOT NULL,
  website_coverage_profile_hash CHAR(64) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  compiled_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_probe_snapshot_run (run_id),
  UNIQUE KEY uq_geo_probe_snapshot_hash (snapshot_hash),
  INDEX idx_geo_probe_snapshot_product (product_id, created_at)
);
