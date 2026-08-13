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

test("live research requires multi-provider evidence, deterministic citation verification, and raw artifacts", async () => {
  const provider = await read("src/lib/v5/geo-research-provider.ts");
  const adapters = await read("src/lib/v5/geo-search-adapters.ts");
  const verifier = await read("src/lib/v5/geo-evidence-verifier.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  assert.match(adapters, /GEO_RESEARCH_ZHIPU_API_KEY/);
  assert.match(adapters, /GEO_RESEARCH_DOUBAO_API_KEY/);
  assert.match(adapters, /GEO_RESEARCH_QWEN_API_KEY/);
  assert.match(adapters, /requiredSuccessfulProviders = 2/);
  assert.match(adapters, /requiredIndependentSources = 2/);
  assert.match(provider, /provider: "zhipu_synthesis"/);
  assert.match(provider, /runMultiProviderWebSearch/);
  assert.match(provider, /multi_search_evidence_gate_failed/);
  assert.match(provider, /verifyGeoResearchEvidence/);
  assert.match(provider, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(provider, /searchController/);
  assert.match(provider, /synthesisController/);
  assert.match(verifier, /invalidUrls/);
  assert.match(verifier, /missingCitationPaths/);
  assert.match(verifier, /"conflicted"/);
  assert.match(repository, /INSERT INTO geo_research_artifact/);
  assert.match(repository, /INSERT INTO geo_research_evidence/);
  assert.match(repository, /INSERT INTO geo_research_finding/);
  assert.match(repository, /live_search_gate_failed/);
  assert.match(provider, /Build a reusable product question catalog/);
  assert.match(provider, /community_forum\|q_and_a\|review\|social_media/);
  assert.match(repository, /question_opportunity" && evidenceIds\.length === 0/);
});

test("verified GEO questions can enter the pool by system policy while retaining manual correction", async () => {
  const contracts = await read("src/lib/v5/geo-research-contracts.ts");
  const service = await read("src/lib/v5/geo-research-service.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  const questionContracts = await read("src/lib/v5/question-contracts.ts");
  const route = await read("src/app/api/v5/products/[productId]/research-runs/[runId]/question-catalog/route.ts");
  const runPage = await read("src/app/products/[productId]/research/[runId]/page.tsx");
  assert.match(contracts, /GeoResearchQuestionCatalog/);
  assert.match(service, /buildGeoResearchQuestionCatalog/);
  assert.match(service, /human_approval_required/);
  assert.match(service, /importVerifiedGeoResearchQuestionsByPolicy/);
  assert.match(service, /confidence >= 0\.7/);
  assert.match(service, /evidenceGap: true/);
  assert.match(service, /ingestV5QuestionSignals/);
  assert.match(repository, /geo_question_catalog_imported_to_question_pool/);
  assert.match(questionContracts, /"geo_research"/);
  assert.match(route, /importGeoResearchQuestionCatalog/);
  assert.match(runPage, /确认并收录问题池/);
});

test("research synthesis cannot approve business strategy and hands off to the human strategy gate", async () => {
  const service = await read("src/lib/v5/geo-research-service.ts");
  const automation = await read("src/lib/v5/product-automation-service.ts");
  const strategyRepository = await read("src/lib/v5/product-strategy-pack-repository.ts");
  const strategyService = await read("src/lib/v5/product-strategy-pack-service.ts");
  const orchestration = service.slice(
    service.indexOf("export async function runAutomaticGeoResearchOrchestration"),
    service.indexOf("export async function requestGeoBlueprintChanges")
  );
  assert.match(service, /runAutomaticGeoResearchOrchestration/);
  assert.match(orchestration, /research_synthesis_ready/);
  assert.doesNotMatch(orchestration, /approveGeoBlueprint/);
  assert.match(automation, /compileProductStrategyPack/);
  assert.match(automation, /compileProductGeoStrategyContentPlan/);
  assert.match(strategyRepository, /pending_strategy_review/);
  assert.match(strategyService, /human_strategy_approval_required/);
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
  const researchWorkspace = await read("src/components/ProductGeoResearchWorkspace.tsx");
  const runPage = await read("src/app/products/[productId]/research/[runId]/page.tsx");
  const readinessPanel = await read("src/components/geo/GeoReadinessPanel.tsx");
  const researchRail = await read("src/components/geo/GeoResearchRail.tsx");
  const apiRoute = await read("src/app/api/v5/products/route.ts");
  assert.match(productPage, /\/products\/new/);
  assert.match(onboardingPage, /expressionFocus/);
  assert.match(researchPage, /ProductGeoResearchWorkspace/);
  assert.match(researchWorkspace, /research-runs/);
  assert.match(researchWorkspace, /readiness\.canCreateRun/);
  assert.match(runPage, /question-catalog/);
  assert.match(runPage, /GeoResearchRail/);
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

test("automatic orchestration versions project idempotency and does not duplicate a failed run on the same snapshot", async () => {
  const service = await readFile("src/lib/v5/geo-research-service.ts", "utf8");
  const worker = await readFile("workers/geo-research-orchestrator.mjs", "utf8");
  assert.match(service, /auto-geo-project:\$\{product\.productId\}:\$\{hashV5GovernancePayload\(projectRequest\)/);
  assert.match(service, /failedAgainstCurrentSnapshot/);
  assert.match(service, /status: "requires_attention"/);
  assert.match(service, /不自动创建重复 run/);
  assert.doesNotMatch(worker, /waiting_for_sources[^\n]+process\.exitCode\s*=\s*2/);
});

test("formal GEO research rejects test sources and requires traceable A1/A2 product truth", async () => {
  const contracts = await read("src/lib/v5/geo-research-contracts.ts");
  const quality = await read("src/lib/v5/geo-source-quality.ts");
  const repository = await read("src/lib/v5/geo-research-repository.ts");
  const service = await read("src/lib/v5/geo-research-service.ts");
  const automation = await read("src/lib/v5/product-automation-service.ts");
  assert.match(contracts, /GeoSourceSnapshotQuality/);
  assert.match(quality, /test_source_detected/);
  assert.match(quality, /official_product_source_required/);
  assert.match(quality, /approved_for_claim_extraction/);
  assert.match(quality, /safetyStatus === "passed"/);
  assert.doesNotMatch(quality, /WorkBuddy|腾讯云\s*ADP/);
  assert.match(repository, /research_source_quality_blocked/);
  assert.match(repository, /GEO_SOURCE_QUALITY_QUERY/);
  assert.match(service, /sourceSnapshotReady/);
  assert.match(automation, /snapshot\?\.quality\.status !== "ready"/);
});

test("only the human-confirmed product GEO strategy is visible in the monthly strategy workspace", async () => {
  const handoff = await read("src/components/geo/GeoMonthlyStrategyHandoff.tsx");
  const strategyPage = await read("src/app/monthly-matrix/strategy/page.tsx");
  assert.match(handoff, /currentStrategyPack/);
  assert.match(handoff, /strategyPackId/);
  assert.match(handoff, /不是已批准的 MonthlyPlan/);
  assert.match(strategyPage, /GeoMonthlyStrategyHandoff/);
});
