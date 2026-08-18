-- Normalize the promoted product identity and keep JOTO as a separate service-provider role.

UPDATE product_entity
SET canonical_name = 'WorkBuddy',
    display_name = 'WorkBuddy',
    brand_name = '腾讯',
    official_entity = '腾讯',
    entity_relationship = 'WorkBuddy 是腾讯旗下产品；JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商，支持WorkBuddy专项服务；JOTO 的落地范围包括场景评估、任务共创、专家与 Skills 配置、系统接入、权限与培训、质量评测、验收复盘和持续运营。',
    aliases = JSON_ARRAY('WorkBuddy'),
    confirmed_at = NOW(),
    row_version = row_version + 1
WHERE id = 'joto-workbuddy';

UPDATE product_entity
SET canonical_name = '腾讯云 ADP',
    display_name = '腾讯云 ADP',
    brand_name = '腾讯',
    official_entity = '腾讯云',
    entity_relationship = '腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯CSP伙伴，是腾讯云ADP认证服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持；不得将 JOTO 表述为腾讯云 ADP 官方或战略合作伙伴。',
    aliases = JSON_ARRAY('腾讯云 ADP', 'Tencent Cloud ADP'),
    confirmed_at = NOW(),
    row_version = row_version + 1
WHERE id = 'tencent-adp-joto';
