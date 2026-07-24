import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.fromEntries(await Promise.all([
  "database/migrations/20260717_010_v5_single_article_production.sql",
  "src/lib/v5/single-article-production-service.ts",
  "src/lib/v5/formal-generation-service.ts",
  "src/lib/v5/single-article-production-repository.ts",
  "src/app/api/v5/content-tasks/[taskId]/prepare-and-generate/route.ts",
  "src/app/api/v5/drafts/[id]/route.ts",
  "src/app/globals.css",
  "src/components/AppShell.tsx",
  "src/components/BatchGenerationMatrixTable.tsx",
  "src/lib/repositories/local-json.ts",
  "src/lib/permissions.ts",
  "src/app/api/content-tasks/[id]/generate/route.ts"
].map(async (path) => [path, await readFile(path, "utf8")])));

test("single-article migration is additive and persists formal idempotency, runs and drafts", () => {
  const migration = files["database/migrations/20260717_010_v5_single_article_production.sql"];
  for (const table of ["prompt_group", "prompt_group_version", "channel_rule_version", "single_article_operation", "generation_run", "draft_version"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /UNIQUE KEY uq_single_article_idempotency \(task_id, idempotency_key\)/);
  assert.match(migration, /test_only BOOLEAN NOT NULL DEFAULT FALSE/g);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\s+/im);
});

test("orchestration preserves the frozen task version and only calls formal generation after a generatable pack", () => {
  const service = files["src/lib/v5/single-article-production-service.ts"];
  assert.match(service, /readActiveRagIndexSnapshotRecord\(\{ productId: matrix\.productId, namespace: "production_public"/);
  assert.match(service, /await retrieveRag/);
  assert.doesNotMatch(service, /createEvidencePreview/);
  assert.match(service, /await createFinalEvidencePack/);
  assert.match(service, /pack\.taskVersion === context\.taskVersion/);
  assert.match(service, /pack\.indexSnapshotIds\[0\] === snapshot\.indexSnapshotId/);
  assert.match(service, /packTask\.promptGroupVersionId/);
  assert.match(service, /if \(pack\.decision !== "generatable"\)/);
  assert.ok(service.indexOf("pack.decision !== \"generatable\"") < service.indexOf("await generateFormalArticle"));
});

test("formal generation explicitly extracts rules and enforces eight traceable facts", () => {
  const generation = files["src/lib/v5/formal-generation-service.ts"];
  assert.match(generation, /\["text", "description", "action", "pattern", "value", "label"\]/);
  assert.doesNotMatch(generation, /\.map\(String\)/);
  assert.match(generation, /uniqueFacts\.size < 8/);
  assert.match(generation, /traceMatchesEvidence/);
  assert.match(generation, /sourceRevisionId === item\.sourceRevisionId/);
  assert.match(files["src/lib/v5/single-article-production-repository.ts"], /copy_allowed, test_only/);
});

test("formal API, task-row drawer and V4 generation route coexist", () => {
  assert.match(files["src/app/api/v5/content-tasks/[taskId]/prepare-and-generate/route.ts"], /prepareAndGenerateSingleArticle/);
  assert.match(files["src/app/api/v5/drafts/[id]/route.ts"], /readFormalDraftVersion/);
  assert.match(files["src/components/BatchGenerationMatrixTable.tsx"], /预览正文/);
  assert.match(files["src/components/BatchGenerationMatrixTable.tsx"], /<Drawer/);
  assert.match(files["src/components/BatchGenerationMatrixTable.tsx"], /保存并自动复检/);
  assert.doesNotMatch(files["src/components/BatchGenerationMatrixTable.tsx"], /softQualityScore|hardRuleStatus|claimCount/);
  assert.match(files["src/lib/repositories/local-json.ts"], /resolve\(process\.cwd\(\), process\.env\.WORKBENCH_STATE_PATH/);
  assert.match(files["src/lib/permissions.ts"], /"\/batch-generation"/);
  assert.match(files["src/lib/permissions.ts"], /"\/v5\/drafts"/);
  assert.match(files["src/lib/permissions.ts"], /route\.startsWith\(`\$\{allowedRoute\}\//);
  assert.match(files["src/app/globals.css"], /\.page-header > \.ant-space[\s\S]*flex-wrap: wrap/);
  assert.match(files["src/components/AppShell.tsx"], /window\.matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(files["src/app/globals.css"], /\.app-sider\.ant-layout-sider-collapsed \.ant-menu[\s\S]*display: none/);
  assert.match(files["src/app/api/content-tasks/[id]/generate/route.ts"], /generateDraftForTask/);
});
