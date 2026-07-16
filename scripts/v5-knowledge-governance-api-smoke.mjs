const baseUrl = (process.argv.find((argument) => argument.startsWith("--base-url="))?.split("=")[1] || "http://127.0.0.1:3047").replace(/\/$/, "");
const namespace = "v5-api-smoke-20260714";
const productId = `${namespace}-product`;
const knowledgeBaseId = "kb-1782896579485-wklime";
const sourceId = `${namespace}-source`;
const claimId = `${namespace}-claim`;
const rulePackageVersionId = `${namespace}-rule-v1`;
const hash = "b".repeat(64);

const actor = {
  actorId: "v5-api-smoke-owner",
  actorRole: "product_owner",
  actorType: "human",
  auditReason: "V5 governance API integration smoke"
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${body.code || body.status || "error"} ${body.message || ""}`);
  }
  return body;
}

await request("/api/knowledge-governance/knowledge-bases", {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-knowledge-base-upsert`,
    expectedVersion: 0,
    knowledgeBaseId,
    name: "唯客护栏官网博客",
    type: "official_blog",
    trustLevel: "pending_review",
    status: "enabled",
    updateMode: "manual",
    usageScope: "V5 governance API smoke"
  })
});

const product = await request("/api/product-entities", {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-product-upsert`,
    expectedVersion: 0,
    productId,
    canonicalName: "V5 Governance Smoke Product",
    displayName: "V5 治理烟测产品",
    brandName: "JOTO",
    officialUrl: "https://example.com/v5-governance-smoke",
    productCategory: "ai_governance",
    aliases: ["V5 smoke"],
    knowledgeBaseIds: [knowledgeBaseId]
  })
});

const batch = await request("/api/knowledge-ingestion/batches", {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-batch-create`,
    purpose: "backend_integration_smoke",
    targetKnowledgeBaseId: knowledgeBaseId,
    targetProductId: productId,
    sourceCount: 1,
    parserVersion: "smoke-parser-v1",
    classifierVersion: "smoke-classifier-v1",
    extractorVersion: "smoke-extractor-v1"
  })
});
const batchId = batch.data.batchId;

await request(`/api/knowledge-ingestion/batches/${batchId}/sources`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-source-register`,
    expectedVersion: 1,
    sources: [{
      sourceId,
      knowledgeBaseId,
      importMethod: "url",
      documentType: "official_product_page",
      authorityLevel: "A2",
      lifecycleStatus: "current",
      visibility: "public",
      title: "V5 governance smoke source",
      canonicalUrl: "https://example.com/v5-governance-smoke/source",
      mimeType: "text/html",
      language: "zh-CN",
      productCandidates: [productId],
      classificationConfidence: 0.99,
      classificationReasons: ["explicit_product_identity"],
      status: "pending_parse",
      qualityFlags: [],
      monthlySupport: {
        supportedContentTypes: ["product_explainer"],
        supportedChannels: ["wechat"],
        evidenceRoles: ["product_identity"],
        limitationCodes: []
      },
      safetyStatus: "pending",
      safetyRiskTypes: [],
      g0: {
        safetyScanCompleted: true,
        detectedRiskTypes: [],
        visibility: "public",
        restrictedUseApproved: false,
        processingMode: "external_model",
        sourceAuthorized: true
      }
    }]
  })
});

const revision = await request(`/api/source-assets/${sourceId}/revisions`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-revision-create`,
    expectedVersion: 1,
    g1: {
      parseStatus: "parsed",
      normalizedTextRef: `smoke://${sourceId}/normalized`,
      title: "V5 governance smoke source",
      contentHash: hash,
      canonicalResolved: true,
      sourceLocatorAvailable: true,
      contentLength: 120,
      qualityFlags: []
    },
    revision: {
      contentHash: hash,
      normalizedTextRef: `smoke://${sourceId}/normalized`,
      titleSnapshot: "V5 governance smoke source",
      canonicalUrlSnapshot: "https://example.com/v5-governance-smoke/source",
      capturedAt: "2026-07-14T00:00:00.000Z",
      parserName: "smoke_parser",
      parserVersion: "smoke-parser-v1",
      parseStatus: "parsed",
      qualityFlags: [],
      contentLength: 120
    }
  })
});
const sourceRevisionId = revision.data.sourceRevisionId;

await request(`/api/source-assets/${sourceId}/classification`, {
  method: "PATCH",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-classification`,
    expectedVersion: 2,
    g2: {
      documentType: "official_product_page",
      authorityLevel: "A2",
      lifecycleStatus: "current",
      visibility: "public",
      classificationConfidence: 0.99,
      productMatchStatus: "confirmed",
      productId,
      humanClassificationConfirmed: true,
      requiresHighRiskReview: false
    },
    classification: {
      documentType: "official_product_page",
      authorityLevel: "A2",
      lifecycleStatus: "current",
      visibility: "public",
      productCandidates: [productId],
      classificationConfidence: 0.99,
      classificationReasons: ["explicit_product_identity"],
      productId
    }
  })
});

await request(`/api/source-assets/${sourceId}/extract-claims`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-claims-extract`,
    sourceRevisionId,
    claims: [{
      claimId,
      productId,
      subjectType: "product",
      claimType: "capability",
      normalizedClaim: "烟测产品支持可追溯的 V5 知识治理流程",
      originalQuote: "烟测资料明确用于验证可追溯的 V5 知识治理流程。",
      sourceId,
      sourceRevisionId,
      sourceLocator: { headingPath: ["Smoke"], paragraphIndex: 0, characterRange: [0, 30] },
      authorityLevel: "A2",
      supportMode: "direct",
      capabilityStatus: "current",
      claimScope: "public_product",
      conditions: [],
      limitations: ["仅用于集成烟测"],
      productVersion: "smoke-v1",
      confidence: 1,
      extractorVersion: "smoke-extractor-v1",
      parentClaimIds: [],
      reviewStatus: "candidate"
    }]
  })
});

await request(`/api/product-claims/${claimId}/review`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-claim-review`,
    expectedVersion: 1,
    reviewStatus: "supported",
    limitations: ["仅用于集成烟测"]
  })
});

const gap = await request(`/api/products/${productId}/evidence-gaps`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-gap-create`,
    gapId: `${namespace}-gap-performance`,
    gapCode: "missing_performance_report",
    title: "烟测产品没有性能报告",
    affectedRuleFields: ["performance_metric"],
    affectedClaimTypes: ["performance_metric"],
    triggerSourceIds: [sourceId],
    severity: "warning",
    recommendedAction: "保持性能内容类型阻断",
    ownerRole: "technical_owner"
  })
});

const draft = await request(`/api/products/${productId}/rule-packages/drafts`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-rule-draft`,
    conflicts: [],
    gaps: [{
      gapId: gap.data.gapId,
      severity: "warning",
      status: "open",
      affectedRuleFields: ["performance_metric"],
      ownerRole: "technical_owner"
    }],
    draft: {
      rulePackageVersionId,
      version: "0.1.0-draft.1",
      sourceBatchIds: [batchId],
      linkedKnowledgeBaseIds: [knowledgeBaseId],
      linkedSourceIds: [sourceId],
      linkedClaimIds: [claimId],
      productIdentity: {
        productName: "V5 治理烟测产品",
        productCategory: "ai_governance",
        productDefinition: "用于验证 G0-G6 后端流程的非生产烟测产品"
      },
      capabilities: [{
        capabilityId: `${namespace}-capability`,
        name: "可追溯知识治理",
        status: "confirmed",
        conditions: [],
        limitations: ["仅用于集成烟测"],
        evidenceClaimIds: [claimId]
      }],
      allowedExpressions: [{ text: "支持可追溯的 V5 知识治理流程", evidenceClaimIds: [claimId] }],
      conditionalExpressions: [],
      blockedExpressions: [{ riskType: "performance", description: "没有性能报告时禁止性能数字", action: "block" }],
      evidenceRequirements: [{ claimType: "capability", minimumAuthorityLevel: "A2" }],
      channelBoundaries: [{ channel: "wechat", status: "allowed" }],
      officialCitationRules: [],
      evidenceGapIds: [gap.data.gapId],
      conflictRefs: [],
      distilledTermSuggestions: [],
      questionSuggestions: [],
      monthlyMatrixScope: {
        allowedContentTypes: ["product_explainer"],
        conditionalContentTypes: [],
        blockedContentTypes: ["performance_benchmark"],
        allowedChannels: ["wechat"],
        requiredEvidenceRoles: ["product_identity"],
        maxMonthlyQuota: 2,
        readinessReasonCodes: ["smoke_scope_only"]
      },
      changeSet: [{
        changeId: `${namespace}-change-1`,
        section: "capabilities",
        fieldPath: "capabilities.traceable_governance",
        changeType: "added",
        after: "confirmed",
        reason: "首次建立烟测规则",
        claimIds: [claimId],
        sourceIds: [sourceId],
        riskLevel: "info",
        requiredRoles: ["product_owner"],
        reviewStatus: "pending"
      }],
      pendingRoles: ["product_owner"]
    }
  })
});

await request(`/api/rule-package-versions/${rulePackageVersionId}/approve`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-rule-approve`,
    expectedVersion: 1,
    role: "product_owner",
    action: "approve",
    reason: "集成烟测人工批准",
    evidenceSourceIds: [sourceId]
  })
});

await request(`/api/rule-package-versions/${rulePackageVersionId}/activate`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-rule-activate`,
    expectedVersion: 2
  })
});

const readiness = await request(`/api/products/${productId}/monthly-production-readiness/evaluate`, {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-readiness-evaluate`,
    expectedVersion: 0
  })
});

const run = await request("/api/knowledge-governance/runs", {
  method: "POST",
  body: JSON.stringify({
    ...actor,
    idempotencyKey: `${namespace}-run-create`,
    batchId,
    productId
  })
});
const runId = run.data.runId;
const gateInputs = {
  G0: {
    safetyScanCompleted: true,
    detectedRiskTypes: [],
    visibility: "public",
    restrictedUseApproved: false,
    processingMode: "external_model",
    sourceAuthorized: true
  },
  G1: {
    parseStatus: "parsed",
    normalizedTextRef: `smoke://${sourceId}/normalized`,
    title: "V5 governance smoke source",
    contentHash: hash,
    canonicalResolved: true,
    sourceLocatorAvailable: true,
    contentLength: 120,
    qualityFlags: []
  },
  G2: {
    documentType: "official_product_page",
    authorityLevel: "A2",
    lifecycleStatus: "current",
    visibility: "public",
    classificationConfidence: 0.99,
    productMatchStatus: "confirmed",
    productId,
    humanClassificationConfirmed: true,
    requiresHighRiskReview: false
  },
  G3: {
    sourceRevisionId,
    extractorVersion: "smoke-extractor-v1",
    claims: [{
      claimId,
      claimType: "capability",
      normalizedClaim: "烟测产品支持可追溯的 V5 知识治理流程",
      originalQuote: "烟测资料明确用于验证可追溯的 V5 知识治理流程。",
      sourceId,
      sourceRevisionId,
      sourceLocatorAvailable: true,
      authorityLevel: "A2",
      supportMode: "direct",
      capabilityStatus: "current",
      claimScope: "public_product",
      conditions: [],
      limitations: ["仅用于集成烟测"],
      productVersion: "smoke-v1",
      reviewStatus: "supported"
    }]
  },
  G4: {
    conflicts: [],
    gaps: [{ gapId: gap.data.gapId, severity: "warning", status: "open", affectedRuleFields: ["performance_metric"], ownerRole: "technical_owner" }]
  },
  G5: {
    actorType: "human",
    actorId: actor.actorId,
    rulePackageVersionId,
    rulePackageStatus: "draft_pending_confirmation",
    productIdentityComplete: true,
    approvedClaimCount: 1,
    pendingRoles: [],
    approvals: [{ role: "product_owner", action: "approve", status: "approved" }],
    unresolvedBlockingConflictCount: 0,
    unresolvedBlockingGapCount: 0,
    sourceSnapshotHash: draft.data.sourceSnapshotHash
  },
  G6: {
    productId,
    rulePackageVersionId,
    rulePackageStatus: "active",
    sourceSnapshotHash: draft.data.sourceSnapshotHash,
    allowedContentTypes: ["product_explainer"],
    conditionalContentTypes: [],
    blockedContentTypes: ["performance_benchmark"],
    allowedChannels: ["wechat"],
    requiredEvidenceRoles: ["product_identity"],
    evidenceGapIds: [gap.data.gapId],
    globalBlockingGapIds: [],
    maxMonthlyQuota: 2,
    evaluatorVersion: "smoke-readiness-v1"
  }
};

let runVersion = 1;
for (const gate of ["G0", "G1", "G2", "G3", "G4", "G5", "G6"]) {
  const gateResult = await request(`/api/knowledge-governance/runs/${runId}/gates/${gate}`, {
    method: "POST",
    body: JSON.stringify({
      ...actor,
      idempotencyKey: `${namespace}-run-${gate.toLowerCase()}`,
      expectedVersion: runVersion,
      input: gateInputs[gate]
    })
  });
  runVersion = gateResult.data.run.version;
}

const summary = await request(`/api/products/${productId}/governance`);
const storedReadiness = await request(`/api/products/${productId}/monthly-production-readiness`);

process.stdout.write(`${JSON.stringify({
  ok: true,
  baseUrl,
  productId: product.data.productId,
  batchId,
  sourceRevisionId,
  claimId,
  rulePackageVersionId,
  governanceRunId: runId,
  governanceRunVersion: runVersion,
  monthlyProductionReady: readiness.data.monthlyProductionReady,
  storedMonthlyProductionReady: storedReadiness.data.monthlyProductionReady,
  claimStatusCounts: summary.data.claimStatusCounts,
  rulePackageStatus: summary.data.rulePackageVersions[0]?.status,
  evidenceGapCount: summary.data.evidenceGaps.length
})}\n`);
