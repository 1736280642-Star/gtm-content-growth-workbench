import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const apply = process.argv.includes("--apply");
const baseUrl = (process.argv.find((argument) => argument.startsWith("--base-url="))?.split("=")[1] || "http://127.0.0.1:3047").replace(/\/$/, "");
const statePath = "data/workbench-state.json";
const knowledgeBaseId = "kb-1782896579485-wklime";
const productId = "weike-ai-guardrail";
const pilotKey = "weike-guardrail-pilot-20260714";
const syntheticSourceId = `${pilotKey}-synthetic-sensitive`;
const humanActor = {
  actorId: "user:kari",
  actorRole: "product_owner",
  actorType: "human",
  auditReason: "用户明确选择唯客 AI 护栏作为 V5 首个真实资料灰度产品"
};
const agentActor = {
  actorId: "agent:codex-v5-pilot",
  actorRole: "knowledge_manager",
  actorType: "agent",
  auditReason: "按 V5 文档边界执行唯客 AI 护栏真实资料灰度"
};

const categorySpecs = [
  { code: "pii_privacy", count: 3, pattern: /PII|隐私数据保护|个人信息保护/i },
  { code: "compliance", count: 2, pattern: /内容合规|合规要求|合规方案/i },
  { code: "dify_integration", count: 2, pattern: /Dify安全插件|Dify.*运行时防护/i },
  { code: "performance", count: 2, pattern: /毫秒级|流式检测引擎/i },
  { code: "data_deployment", count: 2, pattern: /私有化部署|数据不出域|数据流/i },
  { code: "input_output", count: 2, pattern: /双向输入输出|输出内容审核/i },
  { code: "jailbreak_hallucination", count: 1, pattern: /提示词越狱|幻觉防控/i },
  { code: "customer_metric", count: 1, pattern: /200\+|落地案例|客户/i }
];

function bodyOf(source) {
  return String(source.extractedText || source.markdown || source.rawText || "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safetyRisks(text) {
  const risks = [];
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)) risks.push("api_key");
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) risks.push("cloud_credential");
  if (/\bpassword\s*[:=]\s*[^\s]{8,}/i.test(text)) risks.push("credential");
  if (/\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b/.test(text)) risks.push("personal_identifier");
  return risks;
}

function qualityFlags(text) {
  const flags = [];
  if (!text) flags.push("empty_content");
  if (text.length < 300) flags.push("content_too_short");
  const templateMatches = text.match(/Sample text|Image from Freepik|Property|write product review/gi) || [];
  if (templateMatches.length >= 8) flags.push("template_noise");
  return flags;
}

function normalizedSentence(text, pattern) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[。！？!?])\s*/).filter((sentence) => sentence.length >= 20);
  const matched = sentences.find((sentence) => pattern.test(sentence)) || sentences.find((sentence) => /唯客|护栏|大模型|LLM|Dify/i.test(sentence)) || sentences[0] || normalized;
  return matched.slice(0, 500);
}

function locatorFor(text, quote) {
  const index = Math.max(0, text.indexOf(quote));
  return {
    headingPath: ["legacy_public_article"],
    paragraphIndex: Math.max(0, text.slice(0, index).split(/\n{2,}/).length - 1),
    characterRange: [index, index + quote.length]
  };
}

function piiCountOf(text) {
  const patterns = [
    /(?:支持|覆盖|识别|检测)?\s*(\d{1,3})\s*(?:类|种)\s*(?:PII|个人信息)/i,
    /(?:PII|个人信息)[^。；;]{0,30}?(\d{1,3})\s*(?:类|种)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function claimFor(sample, sourceRevisionId) {
  if (["performance", "customer_metric"].includes(sample.category)) return undefined;
  const body = sample.body;
  const quote = normalizedSentence(body, categorySpecs.find((item) => item.code === sample.category)?.pattern || /唯客|护栏/i);
  if (!quote) return undefined;
  const piiCount = sample.category === "pii_privacy" ? piiCountOf(body) : undefined;
  const mapping = {
    pii_privacy: {
      claimType: piiCount ? "security_control" : "scenario",
      normalizedClaim: piiCount
        ? `候选资料声称存在 ${piiCount} 类 PII 识别口径，必须核对统计范围和版本`
        : "PII 与隐私数据保护是唯客 AI 护栏资料覆盖的候选安全场景"
    },
    compliance: {
      claimType: "scenario",
      normalizedClaim: "内容合规与生成式 AI 风险治理是唯客 AI 护栏资料覆盖的候选场景"
    },
    dify_integration: {
      claimType: "integration_compatibility",
      normalizedClaim: "唯客 AI 护栏存在 Dify 集成候选资料，但应用类型和版本范围仍需技术确认"
    },
    data_deployment: {
      claimType: "data_flow_privacy",
      normalizedClaim: "唯客 AI 护栏存在私有化或数据边界候选资料，但数据流和外部处理器尚未确认"
    },
    input_output: {
      claimType: "security_control",
      normalizedClaim: "唯客 AI 护栏存在输入输出双向检测或输出审核候选资料"
    },
    jailbreak_hallucination: {
      claimType: "security_control",
      normalizedClaim: "唯客 AI 护栏存在越狱或幻觉风险检测候选资料"
    }
  }[sample.category];
  if (!mapping) return undefined;
  return {
    claimId: `${pilotKey}-claim-${sample.source.id}`.slice(0, 64),
    productId,
    subjectType: "product",
    claimType: mapping.claimType,
    normalizedClaim: mapping.normalizedClaim,
    originalQuote: quote,
    sourceId: sample.source.id,
    sourceRevisionId,
    sourceLocator: locatorFor(body, quote),
    authorityLevel: "B2",
    supportMode: "direct",
    capabilityStatus: "current",
    claimScope: "public_product",
    conditions: ["仅作为官网博客候选事实，需由对应 Owner 结合正式产品或技术资料确认"],
    limitations: ["不得据此生成绝对安全、保证合规、性能数字、客户效果或数据不出域承诺"],
    productVersion: "unknown",
    confidence: 0.72,
    extractionModel: "deterministic_pilot_extractor",
    extractionPromptVersion: "none",
    extractorVersion: "weike-pilot-extractor-2026.07.14.1",
    parentClaimIds: [],
    reviewStatus: "candidate",
    piiCount
  };
}

async function api(path, options = {}, allowStatuses = []) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${body.code || body.status || "error"} ${body.message || ""}`);
  }
  return { statusCode: response.status, body };
}

const state = JSON.parse(await readFile(statePath, "utf8"));
const knowledgeBase = (state.knowledgeBases || []).find((item) => item.id === knowledgeBaseId);
if (!knowledgeBase) throw new Error(`Knowledge base not found: ${knowledgeBaseId}`);
const candidates = (knowledgeBase.sources || [])
  .map((source) => ({ source, body: bodyOf(source) }))
  .filter(({ source, body }) => source.status === "parsed" && body.length >= 300 && source.url && source.title);
const selected = [];
const selectedIds = new Set();
for (const spec of categorySpecs) {
  const matches = candidates.filter(({ source }) => spec.pattern.test(String(source.title)) && !selectedIds.has(source.id));
  for (const item of matches.slice(0, spec.count)) {
    selectedIds.add(item.source.id);
    selected.push({ ...item, category: spec.code });
  }
}

if (selected.length !== 15) {
  throw new Error(`Pilot selection requires 15 real sources, selected ${selected.length}`);
}

const prepared = selected.map((sample) => {
  const contentHash = sha256(sample.body);
  const risks = safetyRisks(sample.body);
  const flags = qualityFlags(sample.body);
  return { ...sample, contentHash, risks, flags };
});
const plan = {
  ok: true,
  mode: apply ? "apply" : "plan",
  sourceState: statePath,
  knowledgeBaseId,
  knowledgeBaseName: knowledgeBase.name,
  realSampleCount: prepared.length,
  syntheticSafetySampleCount: 1,
  categoryCounts: Object.fromEntries(categorySpecs.map((spec) => [spec.code, prepared.filter((item) => item.category === spec.code).length])),
  selected: prepared.map((item) => ({
    sourceId: item.source.id,
    category: item.category,
    title: item.source.title,
    url: item.source.url,
    sourceStatus: item.source.status,
    bodyLength: item.body.length,
    sha256Ready: item.contentHash.length === 64,
    safetyRiskTypes: item.risks,
    qualityFlags: item.flags
  })),
  syntheticSafetySample: {
    sourceId: syntheticSourceId,
    riskTypes: ["credential"],
    expectedDecision: "isolate",
    containsRealSensitiveData: false
  }
};

if (!apply) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.exit(0);
}

const kbCurrent = await api(`/api/knowledge-governance/knowledge-bases/${knowledgeBaseId}`, {}, [404]);
if (kbCurrent.statusCode === 404 || kbCurrent.body.data?.trustLevel !== "B2") {
  await api("/api/knowledge-governance/knowledge-bases", {
    method: "POST",
    body: JSON.stringify({
      ...humanActor,
      idempotencyKey: `${pilotKey}-knowledge-base-register`,
      expectedVersion: kbCurrent.statusCode === 404 ? 0 : kbCurrent.body.data.rowVersion,
      knowledgeBaseId,
      name: knowledgeBase.name,
      type: knowledgeBase.type || "official_blog",
      trustLevel: "B2",
      status: knowledgeBase.status || "enabled",
      updateMode: knowledgeBase.updateMode || "manual",
      usageScope: "唯客 AI 护栏 V5 治理灰度；官网博客只作为候选与条件事实来源",
      lastSyncedAt: knowledgeBase.lastSyncedAt
    })
  });
}

const productCurrent = await api(`/api/products/${productId}/governance`, {}, [404]);
if (productCurrent.statusCode === 404) {
  await api("/api/product-entities", {
    method: "POST",
    body: JSON.stringify({
      ...humanActor,
      idempotencyKey: `${pilotKey}-product-register`,
      expectedVersion: 0,
      productId,
      canonicalName: "唯客 AI 护栏",
      displayName: "唯客 AI 护栏",
      brandName: "JOTO",
      officialUrl: "https://sec.jotoai.com",
      productCategory: "ai_runtime_guardrail",
      aliases: ["唯客护栏", "AI 护栏", "Weike AI Guardrail"],
      knowledgeBaseIds: [knowledgeBaseId]
    })
  });
}

const batchResponse = await api("/api/knowledge-ingestion/batches", {
  method: "POST",
  body: JSON.stringify({
    ...agentActor,
    idempotencyKey: `${pilotKey}-batch-create`,
    purpose: "weike_ai_guardrail_real_source_pilot",
    targetKnowledgeBaseId: knowledgeBaseId,
    targetProductId: productId,
    sourceCount: prepared.length + 1,
    parserVersion: "legacy-state-parser+sha256-2026.07.14.1",
    classifierVersion: "v5-source-classifier-2026.07.14.1",
    extractorVersion: "weike-pilot-extractor-2026.07.14.1"
  })
});
const batchId = batchResponse.body.data.batchId;

const sourcePayloads = prepared.map((item) => ({
  sourceId: item.source.id,
  knowledgeBaseId,
  importMethod: "url",
  documentType: "official_blog",
  authorityLevel: "B2",
  lifecycleStatus: "current",
  visibility: "public",
  title: item.source.title,
  canonicalUrl: item.source.url,
  mimeType: "text/html",
  language: "zh-CN",
  contentHash: item.contentHash,
  rawAssetRef: `workbench-state://${knowledgeBaseId}/sources/${item.source.id}`,
  normalizedTextRef: `workbench-state://${knowledgeBaseId}/sources/${item.source.id}/extractedText`,
  capturedAt: item.source.parsedAt || item.source.addedAt || new Date().toISOString(),
  sourceUpdatedAt: item.source.parsedAt,
  productCandidates: [productId],
  classificationConfidence: 0.94,
  classificationReasons: ["knowledge_base_product_scope", `title_category:${item.category}`],
  status: "pending_parse",
  qualityFlags: item.flags,
  monthlySupport: {
    supportedContentTypes: ["educational_explainer", "risk_scenario"],
    supportedChannels: ["wechat"],
    evidenceRoles: ["scenario", "candidate_capability"],
    limitationCodes: ["blog_evidence_only", "human_review_required"]
  },
  safetyStatus: "pending",
  safetyRiskTypes: item.risks,
  g0: {
    safetyScanCompleted: true,
    detectedRiskTypes: item.risks,
    visibility: "public",
    restrictedUseApproved: false,
    processingMode: "external_model",
    sourceAuthorized: true
  }
}));
sourcePayloads.push({
  sourceId: syntheticSourceId,
  knowledgeBaseId,
  importMethod: "manual_text",
  documentType: "synthetic_safety_test",
  authorityLevel: "E",
  lifecycleStatus: "unknown",
  visibility: "confidential",
  title: "模拟敏感资料（不含真实隐私）",
  mimeType: "text/plain",
  language: "zh-CN",
  productCandidates: [productId],
  classificationConfidence: 1,
  classificationReasons: ["synthetic_g0_test"],
  status: "pending_parse",
  qualityFlags: ["sensitive_content"],
  monthlySupport: { supportedContentTypes: [], supportedChannels: [], evidenceRoles: [], limitationCodes: ["synthetic_only"] },
  safetyStatus: "pending",
  safetyRiskTypes: ["credential"],
  g0: {
    safetyScanCompleted: true,
    detectedRiskTypes: ["credential"],
    visibility: "confidential",
    restrictedUseApproved: false,
    processingMode: "external_model",
    sourceAuthorized: true
  }
});

const registered = await api(`/api/knowledge-ingestion/batches/${batchId}/sources`, {
  method: "POST",
  body: JSON.stringify({
    ...agentActor,
    idempotencyKey: `${pilotKey}-sources-register`,
    expectedVersion: 1,
    sources: sourcePayloads
  })
});

const claimRecords = [];
const sourceResults = [];
for (const item of prepared) {
  if (item.risks.length > 0) {
    sourceResults.push({ sourceId: item.source.id, category: item.category, g0: "isolated", g1: "skipped", g2: "skipped", claims: 0 });
    continue;
  }
  const revisionResponse = await api(`/api/source-assets/${item.source.id}/revisions`, {
    method: "POST",
    body: JSON.stringify({
      ...agentActor,
      idempotencyKey: `${pilotKey}-revision-${item.source.id}`,
      expectedVersion: 1,
      g1: {
        parseStatus: "parsed",
        normalizedTextRef: `workbench-state://${knowledgeBaseId}/sources/${item.source.id}/extractedText`,
        title: item.source.title,
        contentHash: item.contentHash,
        canonicalResolved: true,
        sourceLocatorAvailable: true,
        contentLength: item.body.length,
        qualityFlags: item.flags
      },
      revision: {
        contentHash: item.contentHash,
        rawAssetRef: `workbench-state://${knowledgeBaseId}/sources/${item.source.id}`,
        normalizedTextRef: `workbench-state://${knowledgeBaseId}/sources/${item.source.id}/extractedText`,
        titleSnapshot: item.source.title,
        canonicalUrlSnapshot: item.source.url,
        capturedAt: item.source.parsedAt || item.source.addedAt || new Date().toISOString(),
        sourceUpdatedAt: item.source.parsedAt,
        parserName: "legacy_state_parser",
        parserVersion: "legacy-state-parser+sha256-2026.07.14.1",
        parseStatus: "parsed",
        qualityFlags: item.flags,
        contentLength: item.body.length
      }
    })
  }, [409]);
  if (!revisionResponse.body.ok) {
    sourceResults.push({ sourceId: item.source.id, category: item.category, g0: "passed", g1: revisionResponse.body.status, g2: "skipped", claims: 0 });
    continue;
  }
  const sourceRevisionId = revisionResponse.body.data.sourceRevisionId;
  const classificationResponse = await api(`/api/source-assets/${item.source.id}/classification`, {
    method: "PATCH",
    body: JSON.stringify({
      ...agentActor,
      idempotencyKey: `${pilotKey}-classification-${item.source.id}`,
      expectedVersion: 2,
      g2: {
        documentType: "official_blog",
        authorityLevel: "B2",
        lifecycleStatus: "current",
        visibility: "public",
        classificationConfidence: 0.94,
        productMatchStatus: "confirmed",
        productId,
        humanClassificationConfirmed: false,
        requiresHighRiskReview: false
      },
      classification: {
        documentType: "official_blog",
        authorityLevel: "B2",
        lifecycleStatus: "current",
        visibility: "public",
        productCandidates: [productId],
        classificationConfidence: 0.94,
        classificationReasons: ["knowledge_base_product_scope", `title_category:${item.category}`],
        productId
      }
    })
  }, [409]);
  if (!classificationResponse.body.ok) {
    sourceResults.push({ sourceId: item.source.id, category: item.category, g0: "passed", g1: "passed", g2: classificationResponse.body.status, claims: 0 });
    continue;
  }
  const claim = claimFor(item, sourceRevisionId);
  if (!claim) {
    sourceResults.push({ sourceId: item.source.id, category: item.category, g0: "passed", g1: "passed", g2: "passed", claims: 0 });
    continue;
  }
  const { piiCount, ...claimPayload } = claim;
  const claimResponse = await api(`/api/source-assets/${item.source.id}/extract-claims`, {
    method: "POST",
    body: JSON.stringify({
      ...agentActor,
      idempotencyKey: `${pilotKey}-claim-${item.source.id}`,
      sourceRevisionId,
      claims: [claimPayload]
    })
  }, [409]);
  if (claimResponse.body.ok) {
    claimRecords.push({ ...claimPayload, piiCount, category: item.category });
  }
  sourceResults.push({
    sourceId: item.source.id,
    category: item.category,
    g0: "passed",
    g1: "passed",
    g2: "passed",
    claims: claimResponse.body.ok ? 1 : 0,
    g3: claimResponse.body.status
  });
}

const piiCountClaims = claimRecords.filter((claim) => typeof claim.piiCount === "number");
const distinctPiiCounts = new Set(piiCountClaims.map((claim) => claim.piiCount));
const conflicts = [];
if (piiCountClaims.length >= 2 && distinctPiiCounts.size >= 2) {
  const conflictResponse = await api(`/api/products/${productId}/conflicts`, {
    method: "POST",
    body: JSON.stringify({
      ...agentActor,
      idempotencyKey: `${pilotKey}-conflict-pii-count`,
      conflictId: `${pilotKey}-conflict-pii-count`,
      conflictType: "value_conflict",
      subject: "PII 类型数量口径",
      claimIds: piiCountClaims.map((claim) => claim.claimId),
      sourceIds: piiCountClaims.map((claim) => claim.sourceId),
      temporaryPolicy: "block_public_expression",
      severity: "blocking",
      requiredRoles: ["security_owner", "product_owner"]
    })
  });
  conflicts.push({
    conflictId: conflictResponse.body.data.conflictId,
    severity: "blocking",
    status: "open",
    temporaryPolicy: "block_public_expression",
    requiredRoles: ["security_owner", "product_owner"]
  });
}

const gapDefinitions = [
  {
    gapId: `${pilotKey}-gap-official-product-page`, gapCode: "missing_official_product_page", title: "缺少当前正式产品页与正式产品定义",
    affectedRuleFields: ["productIdentity"], affectedClaimTypes: ["product_identity", "official_entity"], severity: "blocking", ownerRole: "product_owner",
    recommendedAction: "补充当前正式产品页、正式主体、产品类别和版本说明"
  },
  {
    gapId: `${pilotKey}-gap-performance-report`, gapCode: "missing_performance_report", title: "缺少 <300ms 等性能口径的正式测试报告",
    affectedRuleFields: ["performance_metric"], affectedClaimTypes: ["performance_metric"], severity: "blocking", ownerRole: "technical_owner",
    recommendedAction: "补充测试环境、样本量、P95/平均口径、配置和产品版本"
  },
  {
    gapId: `${pilotKey}-gap-dify-compatibility`, gapCode: "missing_compatibility_matrix", title: "缺少 Dify 应用类型与版本兼容矩阵",
    affectedRuleFields: ["capabilities.difyCompatibility"], affectedClaimTypes: ["integration_compatibility"], severity: "high", ownerRole: "technical_owner",
    recommendedAction: "补充支持的 Dify 版本、应用类型、接入位置和不兼容范围"
  },
  {
    gapId: `${pilotKey}-gap-data-flow`, gapCode: "missing_data_flow", title: "缺少云扫描与数据不出域边界的数据流说明",
    affectedRuleFields: ["data_flow_privacy"], affectedClaimTypes: ["data_flow_privacy", "deployment"], severity: "blocking", ownerRole: "privacy_owner",
    recommendedAction: "补充部署架构、第三方处理器、云扫描链路和数据出域条件"
  },
  {
    gapId: `${pilotKey}-gap-security-evaluation`, gapCode: "missing_security_evaluation", title: "缺少检出率、误报率与攻击覆盖的正式评测",
    affectedRuleFields: ["security_control"], affectedClaimTypes: ["security_control", "performance_metric"], severity: "high", ownerRole: "security_owner",
    recommendedAction: "补充评测集、样本量、基线、检出率、误报率和评测版本"
  },
  {
    gapId: `${pilotKey}-gap-customer-authorization`, gapCode: "missing_customer_authorization", title: "缺少客户数量和案例效果的授权证据",
    affectedRuleFields: ["customer_outcome"], affectedClaimTypes: ["customer_case", "customer_outcome"], severity: "blocking", ownerRole: "delivery_owner",
    recommendedAction: "补充客户授权、统计时间、适用范围和测量基线"
  },
  {
    gapId: `${pilotKey}-gap-compliance-qualification`, gapCode: "missing_compliance_certificate", title: "缺少资质与合规主张的正式证明",
    affectedRuleFields: ["compliance_qualification"], affectedClaimTypes: ["compliance_qualification"], severity: "blocking", ownerRole: "legal_owner",
    recommendedAction: "把帮助合规与保证合规分开，并补充可验证资质或正式法律口径"
  }
];
if (conflicts.length === 0) {
  gapDefinitions.push({
    gapId: `${pilotKey}-gap-pii-count`, gapCode: "missing_pii_type_baseline", title: "PII 类型数量口径未形成可裁决的正式基线",
    affectedRuleFields: ["security_control.piiTypeCount"], affectedClaimTypes: ["security_control"], severity: "high", ownerRole: "security_owner",
    recommendedAction: "补充统一 PII taxonomy、统计规则、产品版本和正式规格"
  });
}

const gaps = [];
for (const definition of gapDefinitions) {
  const gapResponse = await api(`/api/products/${productId}/evidence-gaps`, {
    method: "POST",
    body: JSON.stringify({
      ...agentActor,
      ...definition,
      idempotencyKey: definition.gapId,
      description: "由 15 份真实官网博客灰度与 V5 产品表达边界核对产生",
      triggerSourceIds: prepared.map((item) => item.source.id)
    })
  });
  gaps.push({
    gapId: gapResponse.body.data.gapId,
    severity: definition.severity,
    status: "open",
    affectedRuleFields: definition.affectedRuleFields,
    ownerRole: definition.ownerRole
  });
}

const disputedClaimIds = new Set(piiCountClaims.map((claim) => claim.claimId));
const draftClaimIds = claimRecords.map((claim) => claim.claimId).filter((claimId) => !disputedClaimIds.has(claimId));
const draftResponse = await api(`/api/products/${productId}/rule-packages/drafts`, {
  method: "POST",
  body: JSON.stringify({
    ...agentActor,
    idempotencyKey: `${pilotKey}-rule-draft`,
    conflicts,
    gaps,
    draft: {
      rulePackageVersionId: `${pilotKey}-rule-v0.1.0`,
      version: "0.1.0-draft.1",
      sourceBatchIds: [batchId],
      linkedKnowledgeBaseIds: [knowledgeBaseId],
      linkedSourceIds: prepared.map((item) => item.source.id),
      linkedClaimIds: draftClaimIds,
      productIdentity: {
        productName: "唯客 AI 护栏",
        productCategory: "ai_runtime_guardrail",
        productDefinition: "大模型应用运行时安全与内容治理产品（待正式产品页确认）",
        evidenceStatus: "blocking_gap"
      },
      capabilities: claimRecords
        .filter((claim) => !disputedClaimIds.has(claim.claimId))
        .map((claim) => ({
          capabilityId: `cap-${claim.claimId}`.slice(0, 64),
          name: claim.normalizedClaim,
          status: "conditional",
          conditions: claim.conditions,
          limitations: claim.limitations,
          applicableVersion: "unknown",
          evidenceClaimIds: [claim.claimId]
        })),
      allowedExpressions: [],
      conditionalExpressions: [
        { text: "可在具体验证范围内帮助识别和治理大模型应用风险", requiredDisclosures: ["具体能力、版本和部署范围以正式资料为准"] },
        { text: "可作为 Dify 等大模型应用链路中的候选安全治理组件", requiredDisclosures: ["兼容版本和应用类型待技术确认"] }
      ],
      blockedExpressions: [
        { riskType: "compliance", description: "禁止把帮助合规写成保证合规", action: "block" },
        { riskType: "performance", description: "无完整测试条件禁止使用 <300ms、毫秒级等绝对性能承诺", action: "block" },
        { riskType: "privacy", description: "无正式数据流资料禁止承诺数据不出域或完全不出网", action: "block" },
        { riskType: "customer_outcome", description: "无客户授权和统计口径禁止客户数量、效果与检出率数字", action: "block" },
        { riskType: "pii_count", description: "PII 类型数量口径未裁决前禁止对外使用具体数量", action: "block" }
      ],
      evidenceRequirements: [
        { claimType: "performance_metric", minimumAuthorityLevel: "A1", requiredFields: ["testEnvironment", "sampleSize", "percentile", "productVersion"] },
        { claimType: "data_flow_privacy", minimumAuthorityLevel: "A1", requiredFields: ["deploymentArchitecture", "externalProcessors", "dataBoundary"] },
        { claimType: "customer_outcome", minimumAuthorityLevel: "B1", requiredFields: ["authorization", "measurementBaseline", "timeRange"] },
        { claimType: "compliance_qualification", minimumAuthorityLevel: "A1", requiredFields: ["certificateOrFormalLegalPosition"] }
      ],
      channelBoundaries: [
        { channel: "wechat", status: "conditional", limitation: "只允许教育型风险解释，不允许强事实与效果数字" },
        { channel: "sales_material", status: "blocked", limitation: "正式规格、数据流、性能与资质未补齐" }
      ],
      officialCitationRules: [{ status: "gap", requirement: "补充当前正式产品页后再建立官方引用规则" }],
      evidenceGapIds: gaps.map((gap) => gap.gapId),
      conflictRefs: conflicts.map((conflict) => conflict.conflictId),
      distilledTermSuggestions: ["AI 护栏", "Dify 运行时安全", "大模型输入输出检测", "PII 风险治理"],
      questionSuggestions: [
        "Dify 应用接入 AI 护栏时需要检查哪些风险点？",
        "AI 护栏如何处理输入与输出两侧风险？",
        "帮助合规与保证合规有什么区别？"
      ],
      monthlyMatrixScope: {
        allowedContentTypes: [],
        conditionalContentTypes: ["risk_education", "concept_explainer"],
        blockedContentTypes: ["performance_benchmark", "customer_case", "compliance_claim", "deployment_guarantee", "product_comparison"],
        allowedChannels: [],
        requiredEvidenceRoles: ["official_product_page", "technical_spec", "data_flow", "security_evaluation"],
        maxMonthlyQuota: null,
        readinessReasonCodes: ["no_active_rule_package", "approved_claim_missing", "blocking_evidence_gaps"]
      },
      changeSet: [{
        changeId: `${pilotKey}-change-initial-draft`,
        section: "governance",
        fieldPath: "rulePackage.initialDraft",
        changeType: "added",
        after: "candidate_only",
        reason: "15 份官网博客只形成候选事实与缺口，不能直接形成 active 生产规则",
        claimIds: draftClaimIds,
        sourceIds: prepared.map((item) => item.source.id),
        riskLevel: "high",
        requiredRoles: ["product_owner", "technical_owner", "security_owner", "privacy_owner", "legal_owner", "delivery_owner"],
        reviewStatus: "pending"
      }],
      pendingRoles: ["product_owner", "technical_owner", "security_owner", "privacy_owner", "legal_owner", "delivery_owner"]
    }
  })
});

const rulePackageVersionId = draftResponse.body.data.rulePackageVersionId;
const sourceSnapshotHash = draftResponse.body.data.sourceSnapshotHash;
const runResponse = await api("/api/knowledge-governance/runs", {
  method: "POST",
  body: JSON.stringify({ ...agentActor, idempotencyKey: `${pilotKey}-run-create`, batchId, productId })
});
const runId = runResponse.body.data.runId;
let runVersion = 1;
const eligibleSources = prepared.filter((item) => item.risks.length === 0 && !item.flags.includes("empty_content"));
const aggregateContentHash = sha256(eligibleSources.map((item) => item.contentHash).sort().join("\n"));
const gateInputs = {
  G0: {
    safetyScanCompleted: true,
    detectedRiskTypes: [],
    visibility: "public",
    restrictedUseApproved: false,
    processingMode: "external_model",
    sourceAuthorized: true,
    isolatedSourceCount: registered.body.data.isolatedCount,
    eligibleSourceCount: eligibleSources.length
  },
  G1: {
    parseStatus: "parsed",
    normalizedTextRef: `batch://${batchId}/eligible-sources`,
    title: "唯客 AI 护栏真实资料灰度批次",
    contentHash: aggregateContentHash,
    canonicalResolved: true,
    sourceLocatorAvailable: true,
    contentLength: eligibleSources.reduce((sum, item) => sum + item.body.length, 0),
    qualityFlags: Array.from(new Set(eligibleSources.flatMap((item) => item.flags)))
  },
  G2: {
    documentType: "official_blog",
    authorityLevel: "B2",
    lifecycleStatus: "current",
    visibility: "public",
    classificationConfidence: 0.94,
    productMatchStatus: "confirmed",
    productId,
    humanClassificationConfirmed: false,
    requiresHighRiskReview: false
  },
  G3: {
    sourceRevisionId: "batch-multiple-revisions",
    extractorVersion: "weike-pilot-extractor-2026.07.14.1",
    claims: claimRecords.map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      normalizedClaim: claim.normalizedClaim,
      originalQuote: claim.originalQuote,
      sourceId: claim.sourceId,
      sourceRevisionId: claim.sourceRevisionId,
      sourceLocatorAvailable: true,
      authorityLevel: claim.authorityLevel,
      supportMode: claim.supportMode,
      capabilityStatus: claim.capabilityStatus,
      claimScope: claim.claimScope,
      conditions: claim.conditions,
      limitations: claim.limitations,
      productVersion: claim.productVersion,
      reviewStatus: "candidate"
    }))
  },
  G4: { conflicts, gaps },
  G5: {
    actorType: "agent",
    actorId: agentActor.actorId,
    rulePackageVersionId,
    rulePackageStatus: draftResponse.body.data.status,
    productIdentityComplete: false,
    approvedClaimCount: 0,
    pendingRoles: ["product_owner", "technical_owner", "security_owner", "privacy_owner", "legal_owner", "delivery_owner"],
    approvals: [],
    unresolvedBlockingConflictCount: conflicts.filter((item) => item.severity === "blocking").length,
    unresolvedBlockingGapCount: gaps.filter((item) => item.severity === "blocking" && item.affectedRuleFields.includes("productIdentity")).length,
    sourceSnapshotHash
  }
};

const persistedGateResults = [];
for (const gate of ["G0", "G1", "G2", "G3", "G4", "G5"]) {
  const gateResponse = await api(`/api/knowledge-governance/runs/${runId}/gates/${gate}`, {
    method: "POST",
    body: JSON.stringify({
      ...agentActor,
      idempotencyKey: `${pilotKey}-run-${gate.toLowerCase()}`,
      expectedVersion: runVersion,
      input: gateInputs[gate]
    })
  }, [409]);
  if (gateResponse.body.data?.run?.version) runVersion = gateResponse.body.data.run.version;
  persistedGateResults.push({ gate, status: gateResponse.body.status, ok: Boolean(gateResponse.body.ok), reasonCodes: gateResponse.body.data?.gateResult?.reasonCodes || [] });
  if (!gateResponse.body.ok) break;
}

const readinessResponse = await api(`/api/products/${productId}/monthly-production-readiness/evaluate`, {
  method: "POST",
  body: JSON.stringify({
    ...agentActor,
    idempotencyKey: `${pilotKey}-readiness-evaluate`,
    expectedVersion: 0,
    governanceRunId: runId
  })
}, [409]);
const summaryResponse = await api(`/api/products/${productId}/governance`);

process.stdout.write(`${JSON.stringify({
  ...plan,
  mode: "applied",
  batchId,
  productId,
  registeredSourceCount: registered.body.data.sourceCount,
  isolatedSourceCount: registered.body.data.isolatedCount,
  sourceResults,
  candidateClaimCount: claimRecords.length,
  piiCountCandidateCount: piiCountClaims.length,
  piiCountDistinctValues: distinctPiiCounts.size,
  conflictIds: conflicts.map((item) => item.conflictId),
  evidenceGapIds: gaps.map((item) => item.gapId),
  rulePackageVersionId,
  rulePackageStatus: draftResponse.body.data.status,
  pendingRoles: ["product_owner", "technical_owner", "security_owner", "privacy_owner", "legal_owner", "delivery_owner"],
  sourceSnapshotHash,
  governanceRunId: runId,
  governanceGateResults: persistedGateResults,
  monthlyProductionReady: false,
  readinessStatus: readinessResponse.body.status,
  readinessCode: readinessResponse.body.code,
  activationAttempted: false,
  approvalsWritten: 0,
  productSummary: {
    claimStatusCounts: summaryResponse.body.data.claimStatusCounts,
    conflictCount: summaryResponse.body.data.conflicts.length,
    evidenceGapCount: summaryResponse.body.data.evidenceGaps.length,
    rulePackageVersionCount: summaryResponse.body.data.rulePackageVersions.length
  }
})}\n`);
