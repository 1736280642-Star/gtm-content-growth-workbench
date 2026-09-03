import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { combineMultiSearchEvidencePacks, recomputeChannelStats, runMultiProviderWebSearch, runMultiProviderProbeAnswers } from "../src/lib/v5/geo-search-adapters.ts";
import {
  buildDegradedFrontendBaseline,
  buildGeoEntityResolutionBatches,
  compactGeoBlueprintKnowledgeContext,
  compactGeoBlueprintPreviousOutputs,
  enforceTaskEntityRules,
  inferSupplementaryGap,
  mergeQuestionDiscoveryShardOutputs,
  parseStructuredOutput,
  selectGeoEntityResolutionCandidates
} from "../src/lib/v5/geo-research-provider.ts";
import { pruneGeoResearchCitations } from "../src/lib/v5/geo-evidence-verifier.ts";
import { verifyGeoResearchEvidence } from "../src/lib/v5/geo-evidence-verifier.ts";
import {
  applyGeoEntityResolution,
  buildGeoProductIdentityCard,
  compileIdentityAnchoredQueries
} from "../src/lib/v5/geo-product-identity.ts";

const envNames = [
  "GEO_RESEARCH_ZHIPU_API_KEY",
  "GEO_RESEARCH_ZHIPU_MODEL",
  "GEO_RESEARCH_ZHIPU_BASE_URL",
  "GEO_RESEARCH_DOUBAO_API_KEY",
  "GEO_RESEARCH_DOUBAO_MODEL",
  "GEO_RESEARCH_DOUBAO_BASE_URL",
  "GEO_RESEARCH_QWEN_API_KEY",
  "GEO_RESEARCH_QWEN_MODEL",
  "GEO_RESEARCH_QWEN_BASE_URL",
  "DOUBAO_API_KEY",
  "DOUBAO_MODEL",
  "DOUBAO_BASE_URL",
  "DASHSCOPE_API_KEY",
  "QWEN_MODEL",
  "QWEN_BASE_URL",
  "GEO_SEARCH_PROVIDER_MAX_RETRIES",
  "GEO_SEARCH_PROVIDER_RETRY_BASE_MS",
  "GEO_SEARCH_PROVIDER_TIMEOUT_MS"
];

function withTestConfig() {
  process.env.GEO_RESEARCH_ZHIPU_API_KEY = "test-zhipu";
  process.env.GEO_RESEARCH_ZHIPU_MODEL = "test-zhipu-model";
  process.env.GEO_RESEARCH_ZHIPU_BASE_URL = "https://zhipu.test/v4";
  process.env.GEO_RESEARCH_DOUBAO_API_KEY = "test-doubao";
  process.env.GEO_RESEARCH_DOUBAO_MODEL = "test-doubao-model";
  process.env.GEO_RESEARCH_DOUBAO_BASE_URL = "https://doubao.test/v3";
  process.env.GEO_RESEARCH_QWEN_API_KEY = "test-qwen";
  process.env.GEO_RESEARCH_QWEN_MODEL = "test-qwen-model";
  process.env.GEO_RESEARCH_QWEN_BASE_URL = "https://qwen.test/v1";
  process.env.GEO_SEARCH_PROVIDER_MAX_RETRIES = "0";
  process.env.GEO_SEARCH_PROVIDER_TIMEOUT_MS = "5000";
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

test("blueprint synthesis compacts duplicated research evidence but keeps strategy signals", () => {
  const previousOutputs = [{
    taskType: "live_question_discovery",
    outputSummary: {
      questions: [{ text: "如何选型？", sourceUrls: ["https://example.com/question"] }],
      contentGaps: ["选型证据不足"],
      claimAssessments: [{ claim: "需要实施服务商", sourceUrls: ["https://example.com/question"] }],
      sourceCount: 20,
      liveSearchVerified: true,
      evidenceIds: Array.from({ length: 50 }, (_, index) => `evidence-${index}`),
      researchEvidence: { candidates: [{ excerpt: "x".repeat(50_000) }] },
      responseId: "provider-response"
    }
  }];

  const compacted = compactGeoBlueprintPreviousOutputs(previousOutputs);
  assert.deepEqual(compacted[0].outputSummary.questions, previousOutputs[0].outputSummary.questions);
  assert.deepEqual(compacted[0].outputSummary.contentGaps, ["选型证据不足"]);
  assert.equal(compacted[0].outputSummary.liveSearchVerified, true);
  assert.equal(Object.hasOwn(compacted[0].outputSummary, "researchEvidence"), false);
  assert.equal(Object.hasOwn(compacted[0].outputSummary, "evidenceIds"), false);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(previousOutputs).length / 10);
});

test("blueprint knowledge context keeps governed claim semantics without duplicate quotes and source metadata", () => {
  const compacted = compactGeoBlueprintKnowledgeContext({
    contractVersion: "content-strategy-knowledge.v1",
    productId: "product-1",
    productName: "Product 1",
    sourceFactCount: 1,
    retrievedFactCount: 1,
    profileSource: "parsed",
    authoritativeProfile: { positioning: [], audiences: [], capabilities: [], scenarios: [], boundaries: [] },
    questionClusters: [{
      clusterId: "selection",
      label: "选型",
      questions: ["如何选型？"],
      writableAngles: ["能力边界"],
      facts: [{
        claimId: "claim-1",
        text: "产品支持受治理的知识检索。",
        quote: "产品支持受治理的知识检索。",
        claimType: "capability",
        sourceId: "source-1",
        sourceRevisionId: "revision-1",
        headingPath: ["能力"],
        authorityLevel: "A1",
        reviewStatus: "approved",
        conditions: [],
        limitations: ["以已导入资料为准"],
        relevanceScore: 1
      }]
    }]
  });

  assert.equal(compacted.authoritativeProfileRef, "productKnowledgeProfile");
  assert.equal(compacted.questionClusters[0].facts[0].claimId, "claim-1");
  assert.equal(compacted.questionClusters[0].facts[0].text, "产品支持受治理的知识检索。");
  assert.deepEqual(compacted.questionClusters[0].facts[0].limitations, ["以已导入资料为准"]);
  assert.equal(Object.hasOwn(compacted.questionClusters[0].facts[0], "quote"), false);
  assert.equal(Object.hasOwn(compacted.questionClusters[0].facts[0], "sourceRevisionId"), false);
});

const query = [{
  queryId: "query-1",
  query: "WorkBuddy 用户问题",
  intent: "question_discovery",
  expectedEvidenceRole: "user_demand",
  freshnessRequirement: "year",
  stopCondition: "至少两家 Provider 返回两个独立 URL",
  round: 0
}];
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

test("semantic output parsing accepts only strictly valid object wrappers", () => {
  assert.deepEqual(parseStructuredOutput('{"ok":true}'), { ok: true });
  assert.deepEqual(parseStructuredOutput('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseStructuredOutput('Result:\n{"ok":true}\nEnd.'), { ok: true });
  assert.deepEqual(parseStructuredOutput(JSON.stringify('{"ok":true}')), { ok: true });
  assert.throws(() => parseStructuredOutput("not JSON"), /research_provider_invalid_output|Provider/);
});

test("entity resolution candidates are split deterministically without loss or duplication", () => {
  const candidates = Array.from({ length: 31 }, (_, index) => ({ candidateId: `candidate-${index}` }));
  const batches = buildGeoEntityResolutionBatches(candidates, 12);
  assert.deepEqual(batches.map((batch) => batch.length), [12, 12, 7]);
  assert.deepEqual(batches.flat().map((candidate) => candidate.candidateId), candidates.map((candidate) => candidate.candidateId));
});

test("entity resolution evidence budget preserves query and provider coverage before filling by rank", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    candidateId: `candidate-${index}`,
    queryIds: [index === 18 ? "query-b" : index === 19 ? "query-c" : "query-a"],
    providerKeys: [index === 17 ? "qwen" : index === 16 ? "doubao" : "zhipu"]
  }));
  const selected = selectGeoEntityResolutionCandidates(candidates, 8);
  assert.equal(selected.length, 8);
  assert.deepEqual([...new Set(selected.flatMap((candidate) => candidate.queryIds))].sort(), ["query-a", "query-b", "query-c"]);
  assert.deepEqual([...new Set(selected.flatMap((candidate) => candidate.providerKeys))].sort(), ["doubao", "qwen", "zhipu"]);
  assert.equal(new Set(selected.map((candidate) => candidate.candidateId)).size, selected.length);
});

test("question discovery shards merge deterministically and enforce catalog limits", () => {
  const payload = (questions, clusters = [], gaps = []) => ({
    choices: [{ message: { content: JSON.stringify({ questions, queryClusters: clusters, contentGaps: gaps, claimAssessments: [] }) } }]
  });
  const merged = mergeQuestionDiscoveryShardOutputs([
    payload([{ text: "WorkBuddy 如何部署？" }, { text: "WorkBuddy如何部署" }], ["部署"], ["案例"]),
    payload([{ text: "WorkBuddy 支持哪些集成？" }], ["集成"], ["证据"])
  ]);
  assert.deepEqual(merged.questions.map((item) => item.text), ["WorkBuddy 如何部署？", "WorkBuddy 支持哪些集成？"]);
  assert.deepEqual(merged.queryClusters, ["部署", "集成"]);
  assert.deepEqual(merged.contentGaps, ["案例", "证据"]);
});

test("blueprint synthesis receives governed knowledge context and website coverage in decision order", async () => {
  const [repositorySource, workerSource, providerSource] = await Promise.all([
    readFile("src/lib/v5/geo-research-repository.ts", "utf8"),
    readFile("workers/geo-research-worker.mjs", "utf8"),
    readFile("src/lib/v5/geo-research-provider.ts", "utf8")
  ]);

  assert.match(repositorySource, /deriveContentStrategyQuestionClusters\(previousOutputs\)/);
  assert.match(repositorySource, /readProductKnowledgeBundle/);
  assert.match(repositorySource, /contentStrategyKnowledgeContext: productKnowledge\.contentStrategyKnowledgeContext/);
  assert.match(workerSource, /contentStrategyKnowledgeContext: context\.contentStrategyKnowledgeContext/);
  assert.match(workerSource, /websiteCoverageProfile: context\.websiteCoverageProfile/);
  assert.match(providerSource, /The knowledge context decides what can be written; GEO findings decide what is worth covering; existingArticleTypes decide whether to reuse, adapt, or create a structure/);
  assert.match(providerSource, /synthesisKnowledgeContext = context\.taskType === "blueprint_synthesis"/);
  assert.match(providerSource, /contentStrategyKnowledgeContext: synthesisKnowledgeContext/);
  assert.match(providerSource, /blueprint_synthesis_shard_started/);
  assert.match(providerSource, /research_and_retest/);
  assert.match(providerSource, /content_types_and_evidence/);
  assert.match(providerSource, /distribution_and_monthly/);
  assert.match(providerSource, /blueprint_synthesis_shard_retry/);
  assert.match(providerSource, /Select exactly 3 semantically distinct seeds/);
  assert.match(providerSource, /Use matched only when an active existing version already covers intent, audience, goal, structure and evidence slots/);
  assert.match(providerSource, /blueprint_article_type_expansion_started/);
});

test("frontend baseline falls back to entity-safe Doubao and Qwen evidence when Zhipu JSON is invalid", () => {
  const result = buildDegradedFrontendBaseline({
    queries: [{ ...query[0], queryId: "query-1", query: "腾讯云 ADP 服务商怎么选？" }],
    candidates: [
      {
        candidateId: "candidate-safe",
        canonicalUrl: "https://example.com/adp",
        queryIds: ["query-1"],
        providerKeys: ["qwen", "doubao"],
        entityClassification: "target_match",
        matchedIdentityAnchors: ["owner", "category"]
      },
      {
        candidateId: "candidate-zhipu-only",
        canonicalUrl: "https://example.com/zhipu-only",
        queryIds: ["query-1"],
        providerKeys: ["zhipu"],
        entityClassification: "target_match",
        matchedIdentityAnchors: ["owner", "category"]
      }
    ]
  });
  assert.equal(result.degraded, true);
  assert.deepEqual(result.fallbackProviders, ["doubao", "qwen"]);
  assert.equal(result.tests[0].targetMentioned, true);
  assert.deepEqual(result.tests[0].citedUrls, ["https://example.com/adp"]);
  assert.equal(result.aggregate.targetMentionRate, 1);
});

test("citation pruning removes out-of-run URLs and drops items left without evidence", () => {
  const evidencePack = {
    candidates: [{ canonicalUrl: "https://allowed.test/source" }]
  };
  const result = pruneGeoResearchCitations({
    questions: [
      { text: "grounded", sourceUrls: ["https://allowed.test/source", "https://outside.test/x"] },
      { text: "unsupported", sourceUrls: ["https://outside.test/y"] }
    ],
    claimAssessments: [
      { claim: "grounded", stance: "supports", sourceUrls: ["https://allowed.test/source"], confidence: 0.8 },
      { claim: "unsupported", stance: "supports", sourceUrls: ["https://outside.test/z"], confidence: 0.8 }
    ]
  }, evidencePack);
  assert.deepEqual(result.structured.questions, [{ text: "grounded", sourceUrls: ["https://allowed.test/source"] }]);
  assert.equal(result.removedInvalidUrls, 3);
  assert.equal(result.removedUncitedItems, 2);
});

test("source-cited research objects do not require a redundant claim assessment", () => {
  const evidencePack = {
    candidates: [{ canonicalUrl: "https://allowed.test/competitor" }]
  };
  const verification = verifyGeoResearchEvidence({
    competitors: [{ name: "可核验竞品", sourceUrls: ["https://allowed.test/competitor"] }],
    claimAssessments: []
  }, evidencePack);
  assert.equal(verification.decision, "passed");
  assert.deepEqual(verification.missingCitationPaths, []);
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("GEO search reuses existing supplier credentials when dedicated overrides are absent", { concurrency: false }, async () => {
  process.env.GEO_RESEARCH_ZHIPU_API_KEY = "test-zhipu";
  process.env.GEO_RESEARCH_ZHIPU_MODEL = "test-zhipu-model";
  process.env.GEO_RESEARCH_ZHIPU_BASE_URL = "https://zhipu.test/v4";
  delete process.env.GEO_RESEARCH_DOUBAO_API_KEY;
  delete process.env.GEO_RESEARCH_DOUBAO_MODEL;
  delete process.env.GEO_RESEARCH_DOUBAO_BASE_URL;
  delete process.env.GEO_RESEARCH_QWEN_API_KEY;
  delete process.env.GEO_RESEARCH_QWEN_MODEL;
  delete process.env.GEO_RESEARCH_QWEN_BASE_URL;
  process.env.DOUBAO_API_KEY = "existing-doubao-key";
  process.env.DOUBAO_MODEL = "existing-doubao-model";
  process.env.DOUBAO_BASE_URL = "https://doubao-existing.test/v3";
  process.env.DASHSCOPE_API_KEY = "existing-qwen-key";
  process.env.QWEN_MODEL = "existing-qwen-model";
  process.env.QWEN_BASE_URL = "https://qwen-existing.test/v1";

  globalThis.fetch = async (url) => {
    if (String(url).includes("zhipu.test")) {
      return jsonResponse({ search_result: [{ link: "https://example.com/zhipu", content: "zhipu" }] });
    }
    return jsonResponse({ sources: [{ url: `https://example.com/${String(url).includes("doubao") ? "doubao" : "qwen"}`, snippet: "source" }] });
  };

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  const doubao = pack.providerRuns.find((run) => run.provider === "doubao");
  const qwen = pack.providerRuns.find((run) => run.provider === "qwen");
  assert.equal(doubao?.status, "success");
  assert.equal(doubao?.model, "existing-doubao-model");
  assert.equal(doubao?.endpoint, "https://doubao-existing.test/v3/responses");
  assert.equal(qwen?.status, "success");
  assert.equal(qwen?.model, "existing-qwen-model");
  assert.equal(qwen?.endpoint, "https://qwen-existing.test/v1/responses");
});

test("three providers fan out, canonical URLs deduplicate, and the evidence gate passes", { concurrency: false }, async () => {
  withTestConfig();
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("zhipu.test")) return jsonResponse({ search_result: [
      { link: "https://example.com/a?utm_source=zhipu", title: "A", content: "fact A" },
      { link: "https://example.com/b", title: "B", content: "fact B" }
    ] });
    return jsonResponse({ output: [{ sources: [
      { url: "https://example.com/a", title: "A", snippet: "fact A from another provider" },
      { url: "https://example.com/b#section", title: "B", snippet: "fact B" }
    ] }] });
  };

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  assert.equal(pack.providerRuns.length, 3);
  assert.equal(pack.candidates.length, 2);
  assert.deepEqual(pack.candidates[0].providerKeys, ["doubao", "qwen", "zhipu"]);
  assert.equal(pack.candidates[0].providerRunIds.length, 3);
  assert.equal(pack.candidates[0].retrievalStatus, "retrieved");
  assert.ok(pack.candidates[0].retrievedAt);
  assert.ok(pack.candidates[0].contentHash);
  assert.equal(pack.gate.decision, "passed");
  assert.equal(pack.gate.successfulProviders.length, 3);
  assert.equal(pack.providerRuns.some((run) => Object.hasOwn(run, "rawResponse")), false);
});

test("identity compiler forbids name-only GEO queries", () => {
  const identity = {
    productId: "noteflow",
    canonicalName: "Noteflow",
    displayName: "JOTO Noteflow",
    aliases: ["Noteflow", "JOTO Noteflow"],
    brandName: "JOTO",
    officialEntity: "JOTO",
    officialUrl: "https://noteflow.joto.ai",
    officialDomain: "noteflow.joto.ai",
    productCategory: "企业 AI 知识管理",
    positioning: ["JOTO Noteflow 是面向企业团队的 AI 知识管理产品"],
    audiences: ["面向需要管理企业资料的知识工作者"],
    capabilities: ["支持文档解析、知识检索和引用溯源"],
    scenarios: ["用于企业资料查询和文档问答"],
    boundaries: [],
    profileSource: "parsed",
    profileFactCount: 4
  };
  const queries = compileIdentityAnchoredQueries({
    taskType: "live_competitor_discovery",
    identity,
    maxQueries: 3
  });
  assert.equal(queries.length, 3);
  assert.equal(queries.every((item) => item.identityAnchors.length >= 2), true);
  assert.equal(queries.some((item) => /^Noteflow\s+(?:竞品|功能特点|用户评价)/i.test(item.query)), false);
});

test("identity compiler cleans internal category slugs and markdown fragments", () => {
  const identity = {
    productId: "product-1",
    canonicalName: "Acme Agent",
    displayName: "Acme Agent",
    aliases: ["Acme Agent"],
    brandName: "Acme",
    officialEntity: "Acme Cloud",
    officialUrl: "https://cloud.acme.test/agent",
    officialDomain: "cloud.acme.test",
    productCategory: "enterprise_ai_service",
    positioning: ["面向企业的智能体开发平台"],
    audiences: ["企业团队"],
    capabilities: ["ADP 4.0全新升级，核心打造**以 AgentOps 为核心的生产级企业智能体平台**"],
    scenarios: ["企业智能体开发与治理"],
    boundaries: [],
    profileSource: "parsed",
    profileFactCount: 4
  };
  const queries = compileIdentityAnchoredQueries({ taskType: "live_question_discovery", identity, maxQueries: 3 });
  assert.equal(queries.some((item) => item.query.includes("enterprise_ai_service")), false);
  assert.equal(queries.some((item) => item.query.includes("**")), false);
  assert.equal(queries.some((item) => item.query.includes("全新升级")), false);
  assert.equal(queries.some((item) => item.query.includes("企业级 AI 智能体平台")), true);
  assert.equal(queries.some((item) => item.query.includes("AgentOps")), true);
});

test("research planning persists deterministic identity-safe queries even without a search evidence pack", async () => {
  const providerSource = await readFile(new URL("../src/lib/v5/geo-research-provider.ts", import.meta.url), "utf8");
  assert.match(providerSource, /const structured = evidencePack[\s\S]*: groundedSemanticOutput;/);
  assert.doesNotMatch(providerSource, /const structured = evidencePack[\s\S]*: semanticOutput;/);
});

test("WorkBuddy and Tencent Cloud ADP service-provider relationships become mandatory web-search intents", () => {
  const fact = (claimId, text) => ({ claimId, text, sourceId: "official-source", sourceRevisionId: "official-revision" });
  const profile = {
    status: "ready",
    factCount: 4,
    positioning: [fact("positioning", "产品用于企业 AI 工作场景。")],
    audiences: [fact("audience", "面向企业项目团队。")],
    capabilities: [fact("delivery", "JOTO 提供场景评估、系统接入、交付培训与验收复盘。")],
    scenarios: [fact("scenario", "适用于企业系统接入与实施交付。")],
    boundaries: [fact("boundary", "客户 Logo 不能自动推断为已验证的 JOTO 成功案例。")],
    source: "parsed"
  };
  const cases = [
    {
      product: {
        productId: "joto-workbuddy", canonicalName: "WorkBuddy", displayName: "WorkBuddy", aliases: ["WorkBuddy"],
        brandName: "腾讯", officialEntity: "腾讯", productCategory: "企业 AI 工作台",
        entityRelationship: "WorkBuddy 是腾讯旗下产品；JOTO是腾讯云ADP CSP授权服务商，支持WorkBuddy专项服务。"
      },
      expectedProduct: "WorkBuddy"
    },
    {
      product: {
        productId: "tencent-adp-joto", canonicalName: "腾讯云 ADP", displayName: "腾讯云 ADP", aliases: ["Tencent Cloud ADP"],
        brandName: "腾讯", officialEntity: "腾讯云", productCategory: "企业智能体开发平台",
        entityRelationship: "腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持。"
      },
      expectedProduct: "腾讯云 ADP"
    }
  ];
  for (const item of cases) {
    const identity = buildGeoProductIdentityCard({ product: item.product, knowledgeProfile: profile });
    assert.equal(identity.serviceProvider?.name, "JOTO");
    assert.match(identity.serviceProvider?.deliveryCapabilities.join(" ") || "", /交付培训|验收复盘/);
    const queries = compileIdentityAnchoredQueries({ taskType: "live_question_discovery", identity, maxQueries: 3 });
    assert.equal(queries[0].expectedEvidenceRole, "service_provider_selection");
    assert.match(queries[0].query, new RegExp(item.expectedProduct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(queries[0].query, /JOTO.*服务商.*选型.*资质.*交付.*验收/);
    assert.ok(queries[0].identityAnchors.includes("JOTO"));
  }
});

test("same-name entities are discarded before evidence persistence even if classified as competitors", () => {
  const identity = {
    productId: "noteflow",
    canonicalName: "Noteflow",
    displayName: "JOTO Noteflow",
    aliases: ["Noteflow", "JOTO Noteflow"],
    brandName: "JOTO",
    officialEntity: "JOTO",
    officialUrl: "https://noteflow.joto.ai",
    officialDomain: "noteflow.joto.ai",
    productCategory: "企业 AI 知识管理",
    positioning: ["JOTO Noteflow 是面向企业团队的 AI 知识管理产品"],
    audiences: ["企业知识工作者"],
    capabilities: ["文档解析、知识检索和引用溯源"],
    scenarios: ["企业资料查询和文档问答"],
    boundaries: [],
    profileSource: "parsed",
    profileFactCount: 4
  };
  const candidate = {
    candidateId: "mergeek-noteflow",
    canonicalUrl: "https://www.mergeek.com/latest/orvEDA4bQPkmzp0y",
    title: "NoteFlow - 情绪感知生产力应用",
    publisher: "Mergeek",
    excerpt: "集成音乐播放器、任务管理、专注模式和 PDF 查看。",
    retrievedAt: new Date(0).toISOString(),
    retrievalStatus: "retrieved",
    sourceType: "unknown",
    authority: "low",
    providerKeys: ["zhipu", "qwen"],
    queryIds: ["query-1"],
    queries: ["JOTO Noteflow 企业 AI 知识管理 竞品"],
    providerRunIds: ["run-zhipu", "run-qwen"],
    rawResponseRefs: ["run-zhipu", "run-qwen"]
  };
  const pack = {
    contractVersion: "geo-multi-search-evidence.v2",
    queries: query,
    providerRuns: [
      { runId: "run-zhipu", provider: "zhipu", queryId: "query-1", query: query[0].query, status: "success", startedAt: "", completedAt: "", sourceCount: 1, model: "test", endpoint: "", round: 0, parameters: {} },
      { runId: "run-qwen", provider: "qwen", queryId: "query-1", query: query[0].query, status: "success", startedAt: "", completedAt: "", sourceCount: 1, model: "test", endpoint: "", round: 0, parameters: {} }
    ],
    candidates: [candidate],
    gate: { decision: "passed", successfulProviders: ["zhipu", "qwen"], configuredProviders: ["zhipu", "qwen"], independentSourceCount: 1, requiredSuccessfulProviders: 2, requiredIndependentSources: 2, gaps: [] },
    compiledAt: new Date(0).toISOString(),
    supplementaryRounds: 0
  };
  const filtered = applyGeoEntityResolution({
    taskType: "live_competitor_discovery",
    identity,
    pack,
    resolutions: [{
      candidateId: candidate.candidateId,
      classification: "verified_competitor",
      matchedIdentityAnchors: ["product_category", "capability"],
      contradictingIdentityAnchors: ["brand", "use_case"],
      competitorRelationshipSupported: true,
      overlapDimensions: ["productivity"],
      confidence: 0.9
    }]
  });
  assert.equal(filtered.candidates.length, 0);
  assert.equal(filtered.providerRuns.every((run) => run.sourceCount === 0), true);
  assert.equal(filtered.gate.decision, "blocked");
});

test("entity-resolved evidence keeps demand signals separate from product facts", () => {
  const identity = {
    productId: "product-1", canonicalName: "Acme Agent", displayName: "Acme Agent",
    aliases: ["Acme Agent"], brandName: "Acme", officialEntity: "Acme Cloud",
    officialDomain: "cloud.acme.test", productCategory: "企业智能体平台",
    positioning: ["企业智能体开发平台"], audiences: ["企业团队"], capabilities: ["智能体开发"],
    scenarios: ["企业流程自动化"], boundaries: [], profileSource: "parsed", profileFactCount: 4
  };
  const baseCandidate = {
    canonicalUrl: "https://example.com/source", retrievedAt: new Date(0).toISOString(), retrievalStatus: "retrieved",
    sourceType: "community", authority: "medium", providerKeys: ["zhipu", "qwen"], queryIds: ["query-1"],
    queries: ["企业智能体平台选型"], providerRunIds: ["run-zhipu", "run-qwen"], rawResponseRefs: ["run-zhipu", "run-qwen"]
  };
  const candidates = [
    { ...baseCandidate, candidateId: "target", title: "Acme Agent", excerpt: "Acme Cloud 企业智能体开发平台" },
    { ...baseCandidate, candidateId: "demand", canonicalUrl: "https://example.com/demand", title: "企业如何选智能体平台", excerpt: "企业采购关注集成与治理" }
  ];
  const pack = {
    contractVersion: "geo-multi-search-evidence.v2", queries: query, providerRuns: [], candidates,
    gate: { decision: "passed", successfulProviders: ["zhipu", "qwen"], configuredProviders: ["zhipu", "qwen"], independentSourceCount: 2, requiredSuccessfulProviders: 2, requiredIndependentSources: 2, gaps: [] },
    compiledAt: new Date(0).toISOString(), supplementaryRounds: 0
  };
  const filtered = applyGeoEntityResolution({
    taskType: "live_question_discovery", identity, pack,
    resolutions: [
      { candidateId: "target", classification: "target_match", matchedIdentityAnchors: ["brand", "category"], contradictingIdentityAnchors: [], competitorRelationshipSupported: false, overlapDimensions: [], confidence: 0.95 },
      { candidateId: "demand", classification: "user_demand", matchedIdentityAnchors: ["category", "purchase_task"], contradictingIdentityAnchors: [], competitorRelationshipSupported: false, overlapDimensions: [], confidence: 0.9 }
    ]
  });
  assert.equal(filtered.candidates.find((item) => item.candidateId === "target")?.evidenceUsage, "product_fact");
  assert.equal(filtered.candidates.find((item) => item.candidateId === "demand")?.evidenceUsage, "demand_signal");
});

test("competitor and AI mention metrics fail closed without verified entity relationships", () => {
  const identity = {
    productId: "noteflow", canonicalName: "Noteflow", displayName: "JOTO Noteflow",
    aliases: ["Noteflow"], brandName: "JOTO", officialEntity: "JOTO",
    officialDomain: "noteflow.joto.ai", productCategory: "企业 AI 知识管理",
    positioning: [], audiences: [], capabilities: ["文档检索"], scenarios: ["企业知识问答"],
    boundaries: [], profileSource: "parsed", profileFactCount: 2
  };
  const competitors = enforceTaskEntityRules("live_competitor_discovery", {
    competitors: [
      { name: "同名 NoteFlow", entityClassification: "homonym", overlapDimensions: ["名称"], relationshipEvidence: "同名", sourceUrls: ["https://example.com/homonym"] },
      { name: "真实竞品", entityClassification: "verified_competitor", overlapDimensions: ["企业文档问答"], relationshipEvidence: "服务相同购买决策", sourceUrls: ["https://example.com/verified"] }
    ]
  }, identity);
  assert.deepEqual(competitors.competitors.map((item) => item.name), ["真实竞品"]);

  const baseline = enforceTaskEntityRules("frontend_baseline", {
    tests: [
      { question: "同名提及", mentionEntityClassification: "target_match", matchedIdentityAnchors: ["name"], targetMentioned: true, competitorsMentioned: [] },
      { question: "实体提及", mentionEntityClassification: "target_match", matchedIdentityAnchors: ["brand", "capability"], targetMentioned: false, competitorsMentioned: [
        { name: "同名产品", entityClassification: "homonym", overlapDimensions: ["名称"] },
        { name: "真实竞品", entityClassification: "verified_competitor", overlapDimensions: ["企业文档问答"] }
      ] }
    ],
    aggregate: { targetMentionRate: 1, competitors: ["同名产品"] }
  }, identity);
  assert.equal(baseline.tests[0].targetMentioned, false);
  assert.equal(baseline.tests[1].targetMentioned, true);
  assert.equal(baseline.aggregate.targetMentionRate, 0.5);
  assert.deepEqual(baseline.aggregate.competitors, ["真实竞品"]);
});

test("one failed provider degrades safely when two providers and two sources remain", { concurrency: false }, async () => {
  withTestConfig();
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("doubao.test")) return jsonResponse({ error: { message: "temporary" } }, 503);
    if (href.includes("zhipu.test")) return jsonResponse({ search_result: [
      { link: "https://example.com/a", content: "fact A" },
      { link: "https://example.com/b", content: "fact B" }
    ] });
    return jsonResponse({ sources: [
      { url: "https://example.com/a", snippet: "fact A" },
      { url: "https://example.com/b", snippet: "fact B" }
    ] });
  };

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  assert.equal(pack.gate.decision, "passed");
  assert.deepEqual(pack.gate.successfulProviders.sort(), ["qwen", "zhipu"]);
  assert.equal(pack.gate.degraded, true);
  assert.deepEqual(pack.gate.failedProviders, ["doubao"]);
  assert.equal(pack.providerRuns.find((item) => item.provider === "doubao")?.status, "failed");
});

test("a timed out Zhipu factual search does not cancel Doubao and Qwen evidence", { concurrency: false }, async () => {
  withTestConfig();
  process.env.GEO_SEARCH_PROVIDER_TIMEOUT_MS = "5000";
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("zhipu.test")) {
      return await new Promise((resolve, reject) => {
        const onAbort = () => reject(options.signal?.reason || new DOMException("Aborted", "AbortError"));
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return jsonResponse({ sources: [
      { url: `https://example.com/${href.includes("doubao") ? "doubao-a" : "qwen-a"}`, snippet: "fact A" },
      { url: `https://example.com/${href.includes("doubao") ? "doubao-b" : "qwen-b"}`, snippet: "fact B" }
    ] });
  };

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  assert.equal(pack.gate.decision, "passed");
  assert.equal(pack.gate.degraded, true);
  assert.deepEqual(pack.gate.successfulProviders.sort(), ["doubao", "qwen"]);
  assert.deepEqual(pack.gate.failedProviders, ["zhipu"]);
  assert.equal(pack.providerRuns.find((item) => item.provider === "zhipu")?.status, "failed");
});

test("rate limits use bounded Retry-After retries and recover without duplicating provider runs", { concurrency: false }, async () => {
  withTestConfig();
  process.env.GEO_SEARCH_PROVIDER_MAX_RETRIES = "2";
  let zhipuAttempts = 0;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("zhipu.test")) {
      zhipuAttempts += 1;
      if (zhipuAttempts < 3) return jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "0" });
      return jsonResponse({ search_result: [{ link: "https://example.com/zhipu-recovered", content: "recovered" }] });
    }
    return jsonResponse({ sources: [{ url: `https://example.com/${href.includes("doubao") ? "doubao" : "qwen"}`, snippet: "source" }] });
  };

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  assert.equal(zhipuAttempts, 3);
  assert.equal(pack.providerRuns.filter((run) => run.provider === "zhipu").length, 1);
  assert.equal(pack.providerRuns.find((run) => run.provider === "zhipu")?.status, "success");
});

test("a single configured provider cannot pass the factual evidence gate", { concurrency: false }, async () => {
  withTestConfig();
  delete process.env.GEO_RESEARCH_DOUBAO_API_KEY;
  delete process.env.GEO_RESEARCH_DOUBAO_MODEL;
  delete process.env.GEO_RESEARCH_QWEN_API_KEY;
  delete process.env.GEO_RESEARCH_QWEN_MODEL;
  globalThis.fetch = async () => jsonResponse({ search_result: [
    { link: "https://example.com/a", content: "fact A" },
    { link: "https://example.com/b", content: "fact B" }
  ] });

  const pack = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  assert.equal(pack.gate.decision, "blocked");
  assert.equal(pack.gate.successfulProviders.length, 1);
  assert.equal(pack.providerRuns.filter((item) => item.status === "pending_config").length, 2);
});

test("semantic conclusions pass only when citations belong to this run and conflicts stay visible", { concurrency: false }, () => {
  const pack = {
    contractVersion: "geo-multi-search-evidence.v2",
    queries: query,
    providerRuns: [],
    candidates: [
      { candidateId: "a", canonicalUrl: "https://example.com/a", sourceType: "official", authority: "high", providerKeys: ["zhipu"], queryIds: ["query-1"], queries: [query[0].query] },
      { candidateId: "b", canonicalUrl: "https://example.com/b", sourceType: "community", authority: "medium", providerKeys: ["qwen"], queryIds: ["query-1"], queries: [query[0].query] }
    ],
    gate: { decision: "passed", successfulProviders: ["zhipu", "qwen"], configuredProviders: ["zhipu", "qwen"], independentSourceCount: 2, requiredSuccessfulProviders: 2, requiredIndependentSources: 2, gaps: [] },
    compiledAt: new Date(0).toISOString()
    , supplementaryRounds: 0
  };
  const verification = verifyGeoResearchEvidence({
    questions: [{ text: "是否支持某功能？", sourceUrls: ["https://example.com/a"] }],
    claimAssessments: [
      { claim: "支持某功能", stance: "supports", sourceUrls: ["https://example.com/a"], confidence: 0.9 },
      { claim: "支持某功能", stance: "opposes", sourceUrls: ["https://example.com/b"], confidence: 0.6 }
    ]
  }, pack);
  assert.equal(verification.decision, "passed");
  assert.equal(verification.verifiedClaims.every((item) => item.status === "conflicted"), true);

  const blocked = verifyGeoResearchEvidence({
    questions: [{ text: "无来源问题", sourceUrls: [] }],
    claimAssessments: [{ claim: "未知事实", stance: "supports", sourceUrls: ["https://outside.test/x"], confidence: 1 }]
  }, pack);
  assert.equal(blocked.decision, "blocked");
  assert.deepEqual(blocked.invalidUrls, ["https://outside.test/x"]);
  assert.ok(blocked.missingCitationPaths.includes("questions[0].sourceUrls"));
});

test("supplementary rounds keep one URL as one source and preserve all provider-run references", { concurrency: false }, async () => {
  withTestConfig();
  globalThis.fetch = async (url) => {
    if (String(url).includes("zhipu.test")) return jsonResponse({ search_result: [
      { link: "https://example.com/a", content: "same source" }
    ] });
    return jsonResponse({ sources: [{ url: "https://example.com/a", snippet: "same source" }] });
  };
  const first = await runMultiProviderWebSearch({ queries: query, signal: new AbortController().signal });
  const second = await runMultiProviderWebSearch({
    queries: [{ ...query[0], queryId: "query-supplement-1", round: 1 }],
    signal: new AbortController().signal
  });
  const combined = combineMultiSearchEvidencePacks([first, second]);
  assert.equal(combined.candidates.length, 1);
  assert.equal(combined.candidates[0].providerRunIds.length, 6);
  assert.equal(combined.supplementaryRounds, 1);
  assert.equal(combined.gate.decision, "blocked");
});


test("probe answer observations preserve one raw answer per provider and probe", { concurrency: false }, async () => {
  withTestConfig();
  globalThis.fetch = async (url) => {
    if (String(url).includes("zhipu.test")) return jsonResponse({ choices: [{ message: { content: "Zhipu answer https://example.com/z" } }] });
    return jsonResponse({ output_text: "Provider answer https://example.com/p", output: [{ content: [{ text: "Provider answer https://example.com/p" }] }] });
  };
  const snapshot = {
    probeSetId: "probe-set-test", productId: "product-1", researchRunId: "run-1", entityGraphVersion: 1, roleScenarioMatrixVersion: 1, probeContractVersion: "geo-probe.v1", websiteCoverageProfileHash: "coverage", sourceSnapshotId: "source", targetProviders: ["zhipu", "doubao", "qwen"], locale: "zh-CN", region: "CN", compiledAt: new Date().toISOString(), snapshotHash: "hash",
    probes: [{ probeId: "geo-probe-001", objective: "public_cognition", roleId: "role", scenarioId: "scenario", journeyStage: "selection", decision: "判断适用性", observationMode: "blind", questionText: "企业如何选择内部知识助手？", promptVisibleEntityIds: [], scoringOnlyEntityIds: ["product-1"], expectedRelations: [], evidenceExpectation: "ai_observation_only", scoringDimensions: ["target_mentioned"], priority: "P0" }]
  };
  const pack = await runMultiProviderProbeAnswers({ snapshot, signal: new AbortController().signal, entityNames: ["Acme Assist"] });
  assert.equal(pack.observations.length, 3);
  assert.equal(pack.observations.filter((item) => item.status === "success").length, 3);
  assert.equal(pack.observations.every((item) => item.probeId === "geo-probe-001"), true);
  assert.equal(Object.keys(pack.rawResponses).length, 3);
  assert.ok(pack.observations.every((item) => item.visibleCitations.length === 1));
});

test("platform queries use a separate budget and zero-sample stats trigger directed supplementation", () => {
  const identity = {
    productId: "product-platform", canonicalName: "Acme Assist", displayName: "Acme Assist", aliases: [],
    brandName: "Acme", officialEntity: "Acme", officialUrl: "https://acme.example.com", officialDomain: "acme.example.com",
    productCategory: "企业知识助手", positioning: ["企业知识助手"], capabilities: ["知识检索"], scenarios: ["客服"], audiences: ["企业"],
    boundaries: [], profileSource: "parsed", profileFactCount: 4
  };
  const channelRules = [
    { channelKey: "csdn", displayName: "CSDN", domains: ["csdn.net"], inclusionPatterns: [], structureRequirements: [] },
    { channelKey: "zhihu", displayName: "知乎", domains: ["zhihu.com"], inclusionPatterns: [], structureRequirements: [] }
  ];
  const queries = compileIdentityAnchoredQueries({ taskType: "live_question_discovery", identity, maxQueries: 6, channelRules });
  assert.equal(queries.filter((item) => item.expectedEvidenceRole === "platform_inclusion_landscape").length, 2);
  assert.deepEqual(queries.filter((item) => item.channelKey).map((item) => item.channelKey), ["csdn", "zhihu"]);
  assert.equal(queries.length, 8);

  const stats = recomputeChannelStats([], ["csdn", "zhihu"]);
  assert.deepEqual(stats, {
    csdn: { candidateCount: 0, verifiedCount: 0 },
    zhihu: { candidateCount: 0, verifiedCount: 0 }
  });
  const pack = {
    contractVersion: "geo-multi-search-evidence.v2",
    queries,
    providerRuns: [],
    candidates: [],
    channelStats: stats,
    gate: { decision: "blocked", failedProviders: [], successfulProviders: [], configuredProviders: ["zhipu", "doubao"], independentSourceCount: 0, requiredSuccessfulProviders: 2, requiredIndependentSources: 2, gaps: ["empty"] },
    compiledAt: new Date(0).toISOString(), supplementaryRounds: 0
  };
  assert.equal(inferSupplementaryGap(pack, ["csdn", "zhihu"], 1), "platform_evidence");
});

test("platform strategy evidence must belong to the same governed channel", () => {
  const evidencePack = {
    contractVersion: "geo-multi-search-evidence.v2",
    queries: [], providerRuns: [],
    candidates: [
      { candidateId: "candidate-csdn", canonicalUrl: "https://blog.csdn.net/a", sourceType: "community", authority: "medium", providerKeys: ["zhipu"], queryIds: ["q1"], queries: ["q"], channelKey: "csdn" },
      { candidateId: "candidate-zhihu", canonicalUrl: "https://zhihu.com/question/1", sourceType: "community", authority: "medium", providerKeys: ["doubao"], queryIds: ["q2"], queries: ["q"], channelKey: "zhihu" }
    ],
    gate: { decision: "passed", failedProviders: [], successfulProviders: ["zhipu", "doubao"], configuredProviders: ["zhipu", "doubao"], independentSourceCount: 2, requiredSuccessfulProviders: 2, requiredIndependentSources: 2, gaps: [] },
    compiledAt: new Date(0).toISOString(), supplementaryRounds: 0
  };
  const result = pruneGeoResearchCitations({
    platformStrategy: [{
      channelKey: "csdn",
      hypothesis: false,
      evidenceBasis: {
        candidateIds: ["invented", "candidate-zhihu"],
        sourceUrls: ["https://zhihu.com/question/1"]
      }
    }]
  }, evidencePack);
  assert.deepEqual(result.structured.platformStrategy[0].evidenceBasis.candidateIds, []);
  assert.deepEqual(result.structured.platformStrategy[0].evidenceBasis.sourceUrls, []);
  assert.equal(result.structured.platformStrategy[0].hypothesis, true);
});
