import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("GEO research schema persists the auditable agent chain", async () => {
  const migration = await read("database/migrations/20260730_015_v5_geo_research_foundation.sql");
  for (const table of [
    "geo_research_project",
    "geo_research_run",
    "geo_research_task",
    "geo_research_artifact",
    "geo_research_evidence",
    "geo_research_finding",
    "geo_blueprint_version"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /live_search_required BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /live_search_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /research_run_id VARCHAR\(64\)/);
  assert.doesNotMatch(migration, /weekly[_ -](?:plan|review|report)/i);
});

test("research run cannot start without a governed source snapshot", async () => {
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  assert.match(repository, /FROM source_snapshot/);
  assert.match(repository, /research_source_snapshot_missing/);
  assert.match(repository, /readV5Idempotency/);
  assert.match(repository, /writeV5GovernanceAudit/);
  assert.match(repository, /expectedProjectVersion/);
  for (const taskType of [
    "context_validation",
    "research_planning",
    "live_question_discovery",
    "live_competitor_discovery",
    "frontend_baseline",
    "evidence_alignment",
    "blueprint_synthesis"
  ]) {
    assert.match(repository, new RegExp(taskType));
  }
});

test("live research requires provider web-search traces and persists raw artifacts", async () => {
  const provider = await read("src/lib/v5/geo-research-provider.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  assert.match(provider, /type: "web_search"/);
  assert.match(provider, /webSearchCallCompleted && sources\.length > 0/);
  assert.match(provider, /live_search_evidence_missing/);
  assert.match(repository, /INSERT INTO geo_research_artifact/);
  assert.match(repository, /INSERT INTO geo_research_evidence/);
  assert.match(repository, /INSERT INTO geo_research_finding/);
  assert.match(repository, /live_search_gate_failed/);
});

test("blueprint approval is an explicit human-only transition", async () => {
  const service = await read("src/lib/v5/geo-research-service.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  assert.match(service, /actor\.actorType !== "human"/);
  assert.match(service, /human_approval_required/);
  assert.match(repository, /status = 'approved'/);
  assert.match(repository, /status = 'ready_for_monthly_strategy'/);
  assert.match(repository, /geo_blueprint_approved/);
});

test("managed imports resolve products from product_entity instead of a code allowlist", async () => {
  const contracts = await read("src/lib/v5/rag/managed-source-contracts.ts");
  const service = await read("src/lib/v5/rag/managed-source-import-service.ts");
  assert.doesNotMatch(contracts, /joto-workbuddy|tencent-adp-joto|WorkBuddy|Pharaoh Command/);
  assert.match(service, /assertActiveProductRegistryRecord/);
  assert.match(service, /product\.displayName/);
});

test("question keyword extraction and article templates are product agnostic", async () => {
  const questionService = await read("src/lib/v5/question-service.ts");
  const templates = await read("data/v5-article-type-templates.json");
  assert.doesNotMatch(questionService, /WorkBuddy|腾讯云\\s\*ADP|ADP\\s\*实施/);
  assert.doesNotMatch(templates, /联系 JOTO/);
});

test("the UI exposes product onboarding and research execution routes", async () => {
  const productPage = await read("src/app/products/page.tsx");
  const onboardingPage = await read("src/app/products/new/page.tsx");
  const researchPage = await read("src/app/products/[productId]/research/page.tsx");
  const runPage = await read("src/app/products/[productId]/research/[runId]/page.tsx");
  const readinessPanel = await read("src/components/geo/GeoReadinessPanel.tsx");
  const researchRail = await read("src/components/geo/GeoResearchRail.tsx");
  const apiRoute = await read("src/app/api/v5/products/route.ts");
  assert.match(productPage, /新增产品并创建调研/);
  assert.match(onboardingPage, /expressionFocus/);
  assert.match(researchPage, /启动调研/);
  assert.match(researchPage, /创建任务并等待配置/);
  assert.match(researchPage, /退回修改/);
  assert.match(runPage, /公开来源/);
  assert.match(runPage, /研究发现/);
  assert.match(readinessPanel, /missingConfig/);
  assert.match(researchRail, /frontend_baseline/);
  assert.match(apiRoute, /onboardProductForGeoResearch/);
});

test("GEO setup can be inspected and reviewed before API credentials are configured", async () => {
  const provider = await read("src/lib/v5/geo-research-provider.ts");
  const service = await read("src/lib/v5/geo-research-service.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  const projectRoute = await read("src/app/api/v5/products/[productId]/research-project/route.ts");
  const requestChangesRoute = await read("src/app/api/v5/products/[productId]/blueprints/[blueprintId]/request-changes/route.ts");
  assert.match(provider, /getGeoResearchProviderReadiness/);
  assert.match(service, /canCreateRun/);
  assert.match(service, /canExecuteLiveResearch/);
  assert.match(repository, /readLatestGeoSourceSnapshot/);
  assert.match(repository, /readGeoResearchRunWorkspace/);
  assert.match(repository, /geo_blueprint_changes_requested/);
  assert.match(projectRoute, /export async function PATCH/);
  assert.match(requestChangesRoute, /requestGeoBlueprintChanges/);
});

test("approved GEO blueprint is visible as a candidate in the monthly strategy workspace", async () => {
  const handoff = await read("src/components/geo/GeoMonthlyStrategyHandoff.tsx");
  const strategyPage = await read("src/app/monthly-matrix/strategy/page.tsx");
  assert.match(handoff, /geoBlueprintVersionId/);
  assert.match(handoff, /blueprint\.status !== "approved"/);
  assert.match(handoff, /不是已批准的 MonthlyPlan/);
  assert.match(strategyPage, /GeoMonthlyStrategyHandoff/);
});
