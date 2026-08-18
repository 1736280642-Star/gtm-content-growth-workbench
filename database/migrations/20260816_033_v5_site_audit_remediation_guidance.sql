-- Page-aware website audit findings and executable remediation prescriptions.

ALTER TABLE geo_site_audit_finding
  ADD COLUMN IF NOT EXISTS remediation_guidance JSON NULL AFTER recommended_remediation;

ALTER TABLE geo_site_audit_run
  ADD COLUMN IF NOT EXISTS technical_readiness_score DECIMAL(5,2) NULL AFTER core_readiness_score;

ALTER TABLE geo_site_audit_run
  ADD COLUMN IF NOT EXISTS content_citability_score DECIMAL(5,2) NULL AFTER technical_readiness_score;

ALTER TABLE geo_site_audit_run
  ADD COLUMN IF NOT EXISTS platform_compliance_score DECIMAL(5,2) NULL AFTER content_citability_score;
