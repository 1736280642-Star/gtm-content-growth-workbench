import assert from "node:assert/strict";
import test from "node:test";

import { combineMultiSearchEvidencePacks, runMultiProviderWebSearch } from "../src/lib/v5/geo-search-adapters.ts";
import { enforceTaskEntityRules, parseStructuredOutput } from "../src/lib/v5/geo-research-provider.ts";
import { pruneGeoResearchCitations } from "../src/lib/v5/geo-evidence-verifier.ts";
import { verifyGeoResearchEvidence } from "../src/lib/v5/geo-evidence-verifier.ts";
import {
  applyGeoEntityResolution,
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
  "GEO_SEARCH_PROVIDER_RETRY_BASE_MS"
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
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

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
  assert.equal(pack.providerRuns.find((item) => item.provider === "doubao")?.status, "failed");
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
