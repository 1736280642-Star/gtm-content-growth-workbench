-- Destructive V5 cutover: V4 weekly relational data is intentionally discarded.
-- Execution requires the migration runner flag --confirm-drop-v4.

DROP TABLE IF EXISTS publish_record;
DROP TABLE IF EXISTS article_draft;
DROP TABLE IF EXISTS content_task;
DROP TABLE IF EXISTS weekly_plan;

DROP TABLE IF EXISTS v5_migration_item_map;
DROP TABLE IF EXISTS v5_migration_run;
