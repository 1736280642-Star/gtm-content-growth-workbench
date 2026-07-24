-- V5 wave 2: optimistic concurrency fields for mutable knowledge-governance resources.

ALTER TABLE product_entity ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE product_entity_candidate ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE knowledge_base_product_link ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE ingestion_batch ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER current_gate;
ALTER TABLE source_asset ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE product_claim ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER review_status;
ALTER TABLE claim_conflict ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE evidence_gap ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE ingestion_issue ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE product_expression_rule_package ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER active_version_id;
ALTER TABLE rule_package_version ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE rule_package_change ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER review_status;
ALTER TABLE term_candidate ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
ALTER TABLE question_candidate ADD COLUMN row_version INT NOT NULL DEFAULT 1 AFTER status;
