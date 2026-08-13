-- Human-corrected product/entity relationship used by GEO research and strategy compilation.

SET @entity_relationship_column_sql = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'product_entity'
      AND COLUMN_NAME = 'entity_relationship'
  ),
  'SELECT 1',
  'ALTER TABLE product_entity ADD COLUMN entity_relationship TEXT NULL AFTER product_category'
);
PREPARE entity_relationship_column_statement FROM @entity_relationship_column_sql;
EXECUTE entity_relationship_column_statement;
DEALLOCATE PREPARE entity_relationship_column_statement;

-- Correct the WorkBuddy pilot entity without changing its stable product id.
UPDATE product_entity
SET canonical_name = 'WorkBuddy',
    display_name = 'WorkBuddy',
    brand_name = '腾讯',
    official_entity = '腾讯',
    entity_relationship = COALESCE(NULLIF(entity_relationship, ''), 'WorkBuddy 和腾讯云 ADP 均属于腾讯旗下产品；JOTO 提供 WorkBuddy 专项落地服务。'),
    aliases = JSON_ARRAY('WorkBuddy', 'JOTO WorkBuddy'),
    confirmed_at = NOW(),
    row_version = row_version + 1
WHERE id = 'joto-workbuddy' AND canonical_name = 'WorkBuddy x JOTO';
