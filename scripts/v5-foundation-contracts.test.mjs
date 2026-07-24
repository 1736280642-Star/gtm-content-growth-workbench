import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = Object.fromEntries(await Promise.all([
  "src/lib/v5/question-contracts.ts",
  "src/lib/v5/question-service.ts",
  "src/lib/v5/knowledge-workspace-contracts.ts",
  "src/lib/v5/knowledge-workspace-service.ts",
  "src/lib/v5/article-expression-contracts.ts",
  "src/lib/v5/article-expression-service.ts",
  "src/lib/v5/foundation-repository.ts",
  "src/lib/v5/monthly-contracts.ts",
  "data/v5-foundation-state.json",
  "src/app/questions-keywords/page.tsx",
  "src/app/knowledge/[id]/page.tsx",
  "src/app/configuration/page.tsx"
].map(async (path) => [path, await readFile(path, "utf8")])));

test("question availability uses only knowledge readiness and question-pool conflicts", () => {
  const service = files["src/lib/v5/question-service.ts"];
  const contracts = files["src/lib/v5/question-contracts.ts"];
  assert.match(service, /knowledgeReadiness\.hasProductExpressionRulePackage && knowledgeReadiness\.hasFactSourceMapping/);
  assert.match(service, /if \(conflictAssessment\.hasConflict\) return "decision_required"/);
  assert.match(service, /decisionConflictTypes = new Set<V5QuestionConflictType>\(\["semantic", "business"\]\)/);
  assert.doesNotMatch(service, /AVAILABLE_CONFIDENCE|signal\.confidence\s*[><=]+.*available/);
  assert.match(contracts, /knowledgeReadiness: V5QuestionKnowledgeReadiness/);
  assert.match(contracts, /conflictAssessment: V5QuestionConflictAssessment/);
  assert.doesNotMatch(files["src/lib/v5/question-contracts.ts"], /pending_approval|manual_enable|roleAssignment/);
});

test("question fixture covers ready, missing-knowledge and conflicting states without a question confidence field", () => {
  const fixture = JSON.parse(files["data/v5-foundation-state.json"]);
  const byId = new Map(fixture.questions.map((item) => [item.questionId, item]));
  assert.equal(byId.get("question-adp-provider").status, "available");
  assert.equal(byId.get("question-workbuddy-scenes").status, "observing");
  assert.equal(byId.get("question-adp-ownership").status, "decision_required");
  for (const question of fixture.questions) assert.equal(Object.hasOwn(question, "confidence"), false);
});

test("automatic writes retain source, algorithm, confidence and audit", () => {
  const combined = `${files["src/lib/v5/question-service.ts"]}\n${files["src/lib/v5/foundation-repository.ts"]}`;
  assert.match(combined, /algorithmVersion/);
  assert.match(combined, /sourceIds/);
  assert.match(combined, /confidence/);
  assert.match(combined, /appendV5FoundationAudit/);
  assert.match(combined, /idempotency_conflict/);
  assert.match(combined, /assertV5ExpectedVersion/);
});

test("monthly selection freezes the current question version", () => {
  const service = files["src/lib/v5/question-service.ts"];
  assert.match(service, /questionVersionId: question\.currentVersionId/);
  assert.match(service, /if \(existing\) \{\s+locks\.push\(existing\)/);
  assert.match(files["src/lib/v5/monthly-contracts.ts"], /questionVersionIds\?: string\[\]/);
  assert.match(files["src/lib/v5/monthly-contracts.ts"], /questionVersionId\?: string/);
});

test("knowledge workspace exposes only the three actionable categories and keeps noncritical work nonblocking", () => {
  const contracts = files["src/lib/v5/knowledge-workspace-contracts.ts"];
  const service = files["src/lib/v5/knowledge-workspace-service.ts"];
  assert.match(contracts, /"critical_evidence_missing" \| "public_scope_uncertain" \| "unrecoverable_source_failure"/);
  assert.match(service, /productionBlockingActionCount = openActions\.filter\(\(item\) => item\.affectsProduction\)\.length/);
  assert.match(files["src/app/knowledge/[id]/page.tsx"], /资料 \$\{knowledgeBase\.materialCount\}/);
  assert.match(files["src/app/knowledge/[id]/page.tsx"], /系统理解/);
  assert.match(files["src/app/knowledge/[id]/page.tsx"], /待处理 \$\{openActions\.length\}/);
  assert.doesNotMatch(files["src/app/knowledge/[id]/page.tsx"], /Source 数量|Chunk 数量|Claim 数量/);
});

test("expression profiles keep user fields optional and fall back to system rules", () => {
  const service = files["src/lib/v5/article-expression-service.ts"];
  const page = files["src/app/configuration/page.tsx"];
  assert.match(service, /V5_ARTICLE_EXPRESSION_SYSTEM_FORBIDDEN_STYLES/);
  assert.match(service, /systemRuleFallbackFields: fallbackFields/);
  assert.match(service, /systemRuleVersion: V5_ARTICLE_EXPRESSION_SYSTEM_RULE_VERSION/);
  assert.match(service, /evidencePromisePattern/);
  assert.match(page, /structureModules: modules/);
  assert.match(page, /moveModule\(index, -1\)/);
  assert.match(page, /moveModule\(index, 1\)/);
  assert.match(page, /未填写或无法映射的内容会遵循系统规则/);
  assert.match(page, /目标读者（选填）/);
  assert.match(page, /写作重心（选填）/);
  assert.match(page, /其他（选填）/);
  assert.doesNotMatch(page, /Radio\.Group|适用文章类型|适用渠道|读者认知|语气|必须展开/);
  assert.doesNotMatch(files["src/lib/v5/article-expression-contracts.ts"], /fullPrompt|promptText/);
});

test("all foundation API and compatibility route files exist", async () => {
  await Promise.all([
    "src/app/api/v5/questions/route.ts",
    "src/app/api/v5/questions/[id]/route.ts",
    "src/app/api/v5/questions/ingest-signals/route.ts",
    "src/app/api/v5/questions/select-monthly/route.ts",
    "src/app/api/v5/question-decision-exceptions/route.ts",
    "src/app/api/v5/question-decision-exceptions/batch-resolve/route.ts",
    "src/app/api/v5/semantic-keywords/route.ts",
    "src/app/api/v5/semantic-keywords/[id]/exclude/route.ts",
    "src/app/api/v5/semantic-keywords/[id]/restore/route.ts",
    "src/app/api/v5/semantic-keywords/[id]/correct-link/route.ts",
    "src/app/api/v5/knowledge-bases/route.ts",
    "src/app/api/v5/knowledge-bases/[id]/route.ts",
    "src/app/api/v5/knowledge-bases/[id]/materials/route.ts",
    "src/app/api/v5/knowledge-bases/[id]/understanding/route.ts",
    "src/app/api/v5/knowledge-bases/[id]/action-items/route.ts",
    "src/app/api/v5/knowledge-action-items/[id]/route.ts",
    "src/app/api/v5/article-expression-profiles/route.ts",
    "src/app/api/v5/article-expression-profiles/[id]/route.ts",
    "src/app/api/v5/article-expression-profiles/[id]/publish/route.ts",
    "src/app/api/v5/configuration/status/route.ts",
    "src/app/distilled-terms/page.tsx",
    "src/app/ai-config/page.tsx",
    "src/app/real-integration/page.tsx"
  ].map((path) => access(path)));
});
