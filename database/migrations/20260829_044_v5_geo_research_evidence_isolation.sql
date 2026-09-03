-- GEO/keyword/competitor/search deliverables describe research observations.
-- They must never be promoted into public product facts or formal-generation evidence.

UPDATE source_asset
SET document_type = 'geo_research_document',
    visibility = 'internal',
    status = 'isolated',
    safety_status = 'isolated',
    isolated_reason = 'GEO research-only source; excluded from product facts and formal generation',
    monthly_support = JSON_SET(
      COALESCE(monthly_support, JSON_OBJECT()),
      '$.evidenceRoles', JSON_ARRAY('research_observation', 'search_strategy', 'badcase'),
      '$.limitationCodes', JSON_ARRAY('production_fact', 'public_citation', 'formal_generation')
    )
WHERE import_method = 'file'
  AND (
    LOWER(COALESCE(title, '')) LIKE '%geo%'
    OR LOWER(COALESCE(file_name, '')) LIKE '%geo%'
    OR COALESCE(title, '') REGEXP '关键词(研究|调研|分析)|竞品(研究|调研|分析)|搜索(结果|记录|策略)|检索(结果|记录|策略)|实体(消歧|混淆)|混淆(记录|分析)|交付物分类|引用网页|研究表'
    OR COALESCE(file_name, '') REGEXP '关键词(研究|调研|分析)|竞品(研究|调研|分析)|搜索(结果|记录|策略)|检索(结果|记录|策略)|实体(消歧|混淆)|混淆(记录|分析)|交付物分类|引用网页|研究表'
  );

UPDATE product_claim claim
JOIN source_asset source ON source.id = claim.source_id
SET claim.review_status = 'rejected',
    claim.limitations = JSON_ARRAY('research_only_source_not_product_fact'),
    claim.reviewed_by = 'geo-research-evidence-isolation@1',
    claim.reviewed_at = NOW()
WHERE source.document_type = 'geo_research_document'
  AND claim.review_status IN ('candidate', 'supported', 'conditional')
  AND claim.claim_type = 'automatic_fact';

UPDATE final_evidence_pack pack
SET pack.invalidated_at = COALESCE(pack.invalidated_at, NOW()),
    pack.invalidation_reason = COALESCE(pack.invalidation_reason, 'research_only_source_removed')
WHERE pack.invalidated_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM product_claim claim
    JOIN source_asset source ON source.id = claim.source_id
    WHERE source.document_type = 'geo_research_document'
      AND claim.review_status = 'rejected'
      AND JSON_SEARCH(pack.evidence_items, 'one', claim.id) IS NOT NULL
  );

UPDATE draft_version draft
JOIN final_evidence_pack pack ON pack.id = draft.final_evidence_pack_id
SET draft.copy_allowed = FALSE
WHERE pack.invalidated_at IS NOT NULL
  AND pack.invalidation_reason = 'research_only_source_removed';

UPDATE product_sample_article_task task
JOIN final_evidence_pack pack ON pack.id = task.final_evidence_pack_id
SET task.evidence_gate_status = 'invalidated',
    task.status = 'blocked',
    task.row_version = task.row_version + 1
WHERE pack.invalidated_at IS NOT NULL
  AND pack.invalidation_reason = 'research_only_source_removed';

UPDATE single_article_operation operation
JOIN final_evidence_pack pack ON pack.id = operation.final_evidence_pack_id
SET operation.status = 'blocked',
    operation.error_code = 'evidence_pack_invalidated',
    operation.error_message = '样文引用了仅供调研使用的资料，已停止展示。',
    operation.next_action = '重新完成 GEO 调研与策略确认后生成新样文。'
WHERE pack.invalidated_at IS NOT NULL
  AND pack.invalidation_reason = 'research_only_source_removed'
  AND operation.status IN ('queued', 'running', 'completed');

UPDATE hosted_review_request review
JOIN draft_version draft ON review.gate_type = 'sample' AND review.target_id = draft.id
JOIN final_evidence_pack pack ON pack.id = draft.final_evidence_pack_id
SET review.status = 'cancelled',
    review.comment = '样文证据包已失效，审核链接已由系统关闭。',
    review.row_version = review.row_version + 1
WHERE review.status = 'pending'
  AND pack.invalidated_at IS NOT NULL
  AND pack.invalidation_reason = 'research_only_source_removed';

-- Product-owner identity and implementation-provider landing pages are separate.
-- official_url is reserved for the owner/product authority; JOTO remains the
-- service provider through entity_relationship and its governed source pages.
UPDATE product_entity
SET official_url = 'https://cloud.tencent.com/document/product/1759',
    row_version = row_version + 1,
    updated_at = NOW()
WHERE id = 'tencent-adp-joto'
  AND (official_url IS NULL OR official_url LIKE 'https://joto.ai/%');
