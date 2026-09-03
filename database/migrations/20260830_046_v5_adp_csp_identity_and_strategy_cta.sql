-- Canonicalize the user-confirmed ADP service-provider identity while preserving
-- the human-approved CTA label and URL already stored in coreExpressions.

UPDATE product_entity
SET entity_relationship = '腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持；不得将 JOTO 表述为腾讯云 ADP 产品方、官方或战略合作伙伴。',
    confirmed_at = NOW(),
    row_version = row_version + 1
WHERE id = 'tencent-adp-joto'
  AND entity_relationship <> '腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持；不得将 JOTO 表述为腾讯云 ADP 产品方、官方或战略合作伙伴。';

UPDATE product_entity
SET entity_relationship = REPLACE(
      entity_relationship,
      'JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商',
      'JOTO是腾讯云ADP CSP授权服务商'
    ),
    confirmed_at = NOW(),
    row_version = row_version + 1
WHERE entity_relationship LIKE '%JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商%';

UPDATE product_strategy_packs
SET content_plan_json = JSON_SET(
      content_plan_json,
      '$.coreExpressions.entityRelationship',
      '腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持；不得将 JOTO 表述为腾讯云 ADP 产品方、官方或战略合作伙伴。',
      '$.coreExpressions.fixedExpression',
      'JOTO是腾讯云ADP CSP授权服务商',
      '$.fixedExpression.text',
      'JOTO是腾讯云ADP CSP授权服务商',
      '$.fixedExpression.positions',
      JSON_ARRAY('opening')
    ),
    content_plan_hash = SHA2(CAST(JSON_SET(
      content_plan_json,
      '$.coreExpressions.entityRelationship',
      '腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持；不得将 JOTO 表述为腾讯云 ADP 产品方、官方或战略合作伙伴。',
      '$.coreExpressions.fixedExpression',
      'JOTO是腾讯云ADP CSP授权服务商',
      '$.fixedExpression.text',
      'JOTO是腾讯云ADP CSP授权服务商',
      '$.fixedExpression.positions',
      JSON_ARRAY('opening')
    ) AS CHAR), 256),
    decision_reason = '用户确认JOTO为腾讯云ADP CSP授权服务商；保留人工确认CTA并统一用于各渠道',
    row_version = row_version + 1,
    updated_at = NOW()
WHERE product_id = 'tencent-adp-joto'
  AND content_plan_json IS NOT NULL;
