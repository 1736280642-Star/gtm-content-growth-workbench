-- V5 wave 2: keep formal governance statuses without truncating idempotency replay metadata.

ALTER TABLE governance_idempotency_record MODIFY COLUMN response_status VARCHAR(64) NOT NULL;
