import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyWebsiteCoverageToArticlePortfolio, deriveProductStrategyMonthlyTypeQuotas } from "../src/lib/v5/product-strategy-pack-contracts.ts";
import { computeGeoQuestionMetric } from "../src/lib/v5/geo-monitoring-repository.ts";

function article(portfolioItemId, name, share) {
  return {
    portfolioItemId, origin: "generated", articleTypeId: `type-${portfolioItemId}`, articleTypeVersionId: `type-version-${portfolioItemId}`,
    name, definition: name, suitableQuestions: [], unsuitableQuestions: [], targetAudience: ["企业用户"], contentGoal: name,
    structureModules: [{ key: "answer", purpose: "回答问题", required: true }], emphasisOrder: ["answer"], style: ["客观"],
    lengthRange: { min: 1200, max: 2000 }, evidencePreferences: ["正式资料"], ctaIntent: "了解详情", channelFit: ["official_website"],
    questionClusterIds: [portfolioItemId], recommendationReason: "调研推荐", confidence: 0.9, evidenceReadiness: "ready",
    proposedMonthlyShare: share, definitionHash: `hash-${portfolioItemId}`, raw: {}
  };
}

test("website coverage turns an already sufficient topic into refresh work instead of duplicate article quota", () => {
  const profile = {
    id: "coverage-1", productId: "product-1", profileVersion: 1, knowledgeReadiness: "ready", publicGeoReadiness: "ready",
    officialSources: [], criticalFindingCodes: [], evidenceGaps: [], profileHash: "coverage-hash", generatedAt: "2026-08-17T00:00:00.000Z",
    topicCoverage: [
      { topic: "provider_selection", label: "服务商选择依据", status: "sufficient", pageUrls: ["https://example.com/service"], sourceIds: ["source-1"], claimIds: ["claim-1"], evidenceRequired: true, reason: "covered" },
      { topic: "implementation_delivery", label: "实施与交付说明", status: "missing", pageUrls: [], sourceIds: [], claimIds: [], evidenceRequired: true, reason: "missing" }
    ]
  };
  const portfolio = applyWebsiteCoverageToArticlePortfolio([
    article("provider", "服务商选型与实施伙伴推荐", 0.5),
    article("delivery", "实施交付与验收指南", 0.5)
  ], profile);
  assert.equal(portfolio[0].websiteCoverageDisposition, "refresh_existing");
  assert.equal(portfolio[0].proposedMonthlyShare, 0);
  assert.equal(portfolio[1].websiteCoverageDisposition, "new_content");
  assert.equal(portfolio[1].proposedMonthlyShare, 1);
  const quotas = deriveProductStrategyMonthlyTypeQuotas({ articleTypePortfolio: portfolio }, 3);
  assert.deepEqual(quotas.map((item) => item.portfolioItemId), ["delivery"]);
  assert.equal(quotas[0].count, 3);
});

test("category enumeration metrics measure provider inclusion, relationship accuracy and target solution citation", () => {
  const config = {
    id: "monitor-1", productId: "product-1", questionText: "ADP 服务商有哪些？", targetEntityName: "JOTO",
    expectedRelationship: "JOTO 是 ADP 认证服务商，可提供实施交付。", status: "active", selectionSource: "manual", priority: "high",
    platforms: ["doubao"], locale: "zh-CN", ownedDomains: ["example.com"], targetSolutionUrls: ["https://example.com/solutions/adp"],
    samplesPerMonth: 3, activeFrom: "2026-08-01", approvedBy: "user", approvedAt: "2026-08-01T00:00:00.000Z", rowVersion: 1,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const rows = [
    { monitoring_question_id: "monitor-1", platform: "doubao", status: "completed", payload: { answerText: "JOTO 是可提供实施交付与培训支持的服务商。", targetEntityMentioned: true, citations: [{ url: "https://example.com/solutions/adp", position: 1 }] } },
    { monitoring_question_id: "monitor-1", platform: "doubao", status: "completed", payload: { answerText: "可以评估其他服务商。", targetEntityMentioned: false, citations: [] } },
    { monitoring_question_id: "monitor-1", platform: "doubao", status: "completed", payload: { answerText: "JOTO 是该平台旗下产品和原厂产品。", targetEntityMentioned: true, citations: [{ url: "https://example.com/blog", position: 1 }] } }
  ];
  const metric = computeGeoQuestionMetric(config, rows, "2026-08");
  assert.equal(metric.categoryInclusionRate, 2 / 3);
  assert.equal(metric.relationshipAccuracyRate, 1 / 2);
  assert.equal(metric.targetSolutionCitationRate, 1 / 3);
  assert.equal(metric.platformBreakdown[0].relationshipAccuracyRate, 1 / 2);
});

test("closed-loop persistence is separate from MonthlyPlan and capture no longer mutates strategy per gap", () => {
  const migration = fs.readFileSync("database/migrations/20260817_035_v5_website_geo_closed_loop.sql", "utf8");
  const capture = fs.readFileSync("src/lib/v5/capture-repository.ts", "utf8");
  const optimizer = fs.readFileSync("src/lib/v5/product-geo-optimization-repository.ts", "utf8");
  assert.match(migration, /product_website_coverage_profile/);
  assert.match(migration, /product_geo_optimization_snapshot/);
  assert.match(migration, /scope_mode/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS weekly/i);
  assert.doesNotMatch(capture, /recommendedAdditionalArticles/);
  assert.match(capture, /awaiting_batch_geo_diagnosis/);
  assert.match(optimizer, /automaticExecutionAllowed: false/);
  assert.match(optimizer, /current_month_candidate_pool/);
  assert.doesNotMatch(optimizer, /UPDATE monthly_plan/);
  const websiteCoverage = fs.readFileSync("src/lib/v5/website-coverage-repository.ts", "utf8");
  assert.match(websiteCoverage, /reconcileExistingOfficialWebsiteSources/);
  assert.match(websiteCoverage, /audit_ruleset_version <> \?/);
});
