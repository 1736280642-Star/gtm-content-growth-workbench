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
  "src/app/questions-keywords/page.tsx",
  "src/app/knowledge/[id]/page.tsx",
  "src/app/configuration/page.tsx"
].map(async (path) => [path, await readFile(path, "utf8")])));

test("question automation separates confidence from boundary decisions", () => {
  const service = files["src/lib/v5/question-service.ts"];
  assert.match(service, /AVAILABLE_CONFIDENCE = 0\.75/);
  assert.match(service, /decisionConflictTypes = new Set<V5QuestionConflictType>\(\["subject", "relationship", "safety"\]\)/);
  assert.match(service, /signal\.confidence >= AVAILABLE_CONFIDENCE \? "available" : "observing"/);
  assert.doesNotMatch(files["src/lib/v5/question-contracts.ts"], /pending_approval|manual_enable|roleAssignment/);
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

test("expression profiles are structured, sortable and evidence guarded", () => {
  const service = files["src/lib/v5/article-expression-service.ts"];
  const page = files["src/app/configuration/page.tsx"];
  assert.match(service, /mandatoryForbiddenStyles = \["绝对排名", "泛化承诺", "无证据数据"\]/);
  assert.match(service, /evidencePromisePattern/);
  assert.match(page, /structureModules: modules/);
  assert.match(page, /moveModule\(index, -1\)/);
  assert.match(page, /moveModule\(index, 1\)/);
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
