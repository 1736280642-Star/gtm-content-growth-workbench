-- GEO research mention-rate KPI loop: persist the frontend-baseline mention snapshot per run.
-- Normal runs store the baseline; post_publish_retest runs additionally store the mention delta attribution.

ALTER TABLE geo_research_run
  ADD COLUMN IF NOT EXISTS mention_baseline JSON NULL AFTER live_search_verified;
