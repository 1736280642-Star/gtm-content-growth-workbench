import assert from "node:assert/strict";
import test from "node:test";
import { attributeProductionTaskProducts, resolveProductionTaskProduct } from "../src/lib/v5/product-attribution.ts";

const products = [{
  productId: "tencent-adp-joto",
  canonicalName: "Tencent Cloud ADP x JOTO",
  displayName: "Tencent Cloud ADP x JOTO",
  officialEntity: "Tencent Cloud ADP",
  aliases: ["腾讯云 ADP", "JOTO ADP"],
  status: "active",
  rowVersion: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z"
}];

function task(overrides = {}) {
  return {
    taskId: "task-1", monthlyPlanId: "monthly-2026-08", strategyPackageId: "strategy-1",
    quotaRuleId: "quota-1", questionVersionId: "question-1", question: "如何启动腾讯云 ADP 项目？",
    baseTopicIndex: 1, title: "企业启动腾讯云 ADP 项目时如何选择场景？", contentType: "guide",
    articleTypeProfileVersionId: "type-1", articleTypeNameSnapshot: "指南", typeMatchRunId: "run-1",
    typeSelectionSource: "user_selected", matchReasonSnapshot: "", articleTypePromptConstraintSnapshot: "",
    articleTypePromptConstraintSnapshotHash: "", channel: "wechat", rulePackageVersionId: "rule-1",
    knowledgeBaseIds: [], sourceSnapshotHash: "source", evidencePackSourceSnapshotHash: "evidence",
    status: "scheduled", recoveryAttemptCount: 0, automaticRepairCount: 0, updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides
  };
}

test("legacy Tencent ADP name resolves to the registered product entity", () => {
  const resolved = resolveProductionTaskProduct(task({ productId: "腾讯云 ADP", productNameSnapshot: "腾讯云 ADP" }), products);
  assert.equal(resolved?.productId, "tencent-adp-joto");
});

test("historical monthly tasks are normalized to canonical product identity", () => {
  const [attributed] = attributeProductionTaskProducts([task({ productId: "腾讯云 ADP", productNameSnapshot: "腾讯云 ADP" })], products);
  assert.equal(attributed.productId, "tencent-adp-joto");
  assert.equal(attributed.productNameSnapshot, "Tencent Cloud ADP x JOTO");
});
