import assert from "node:assert/strict";
import test from "node:test";

import { compileGeoArticleMission } from "../src/lib/v5/geo-article-mission-contracts";
import { compileProductionContract } from "../src/lib/v5/production-contract-compiler";
import { ProductionDomainError } from "../src/lib/v5/content-production-contracts";
import { evaluateArticleQualityRubric, evaluateBusinessChainRubric } from "../src/lib/v5/production-rubrics";
import { analyzePromotionSubjectCoverage } from "../src/lib/v5/promotion-subject-policy";
import { runHybridRetrieval } from "../src/lib/v5/rag/retrieval-service";

const identity = {
  productId: "tencent-adp-joto",
  canonicalName: "腾讯云智能体开发平台",
  displayName: "腾讯云 ADP",
  aliases: ["Tencent Cloud ADP"],
  brandName: "腾讯云",
  officialEntity: "腾讯云",
  entityRelationship: "腾讯云 ADP 是腾讯云旗下产品；JOTO是腾讯云ADP CSP授权服务商；JOTO 可提供腾讯云 ADP 项目实施、交付培训与后续支持。"
};

function mission() {
  return compileGeoArticleMission({
    identity,
    plan: {
      productPositioning: { promotionPurpose: "提升腾讯云 ADP 在企业智能体选型问题中的正确提及", expressionFocus: "公开服务能力、适用场景和职责边界" },
      geoOpportunities: [{
        opportunityId: "provider-selection",
        title: "服务商选型答案缺少实体关系",
        intent: "企业选型",
        productFit: "用公开能力和责任边界回答服务商选择问题",
        representativeQuestions: ["企业选择腾讯云 ADP 服务商时，应该看哪些公开服务能力、适用场景和职责边界？"],
        sourceIds: ["research-source-1"]
      }]
    },
    articleType: {
      portfolioItemId: "provider-guide",
      name: "服务商选择指南",
      contentGoal: "帮助企业判断腾讯云 ADP 服务商的公开能力、适用场景和职责边界",
      suitableQuestions: ["企业选择腾讯云 ADP 服务商时，应该看哪些公开服务能力、适用场景和职责边界？"],
      questionClusterIds: ["provider-selection"],
      knowledgeClaimIds: ["claim-adp", "claim-service"],
      expectedMentionRationale: "形成腾讯云 ADP、腾讯云与 JOTO 服务关系清晰的选型答案"
    },
    primaryQuestion: "企业选择腾讯云 ADP 服务商时，应该看哪些公开服务能力、适用场景和职责边界？"
  });
}

function evidenceItem(overrides = {}) {
  return {
    evidenceItemId: "evidence-adp",
    claimIds: ["claim-adp", "claim-service"],
    primaryClaimId: "claim-adp",
    sourceRevisionId: "revision-adp",
    originalQuote: "JOTO是腾讯云ADP CSP授权服务商；腾讯云 ADP 支持企业智能体开发，JOTO可提供项目实施、交付培训与后续支持。",
    summary: "JOTO是腾讯云ADP CSP授权服务商，并提供项目实施、交付培训与后续支持。",
    allowedUsage: ["product_mechanism", "official_citation"],
    forbiddenUsage: [],
    conditions: [],
    limitations: [],
    lifecycleStatus: "current",
    visibility: "public",
    status: "active",
    evidenceUsage: "product_fact",
    subjectEntityIds: ["tencent-adp-joto"],
    ...overrides
  };
}

function compile(overrides = {}) {
  const geoMission = mission();
  const evidenceItems = overrides.evidenceItems || [evidenceItem()];
  return compileProductionContract({
    geoMission,
    task: {
      taskId: "task-adp", taskVersion: 1, title: "腾讯云 ADP 服务商怎么选：JOTO的服务能力、适用场景与职责边界", channel: "wechat", contentType: "provider-guide",
      targetAudience: "企业负责人", coreProblem: geoMission.primaryQuestion, coreJudgment: geoMission.desiredAnswer,
      targetEntityIds: geoMission.entityGraph.nodes.map((item) => item.entityId), primaryEntityId: geoMission.primaryEntityId,
      promotionGoal: geoMission.promotionGoal, ctaIntent: "none", promotionRequired: false
    },
    evidencePack: {
      evidencePackId: "pack-adp", snapshotHash: "pack-hash", sourceSnapshotHash: "source-hash", decision: "generatable",
      evidenceItems, gaps: [], conflicts: [], outdatedEvidence: [], unverifiedClaims: []
    },
    productRule: {
      rulePackageVersionId: "rule-adp", sourceSnapshotHash: "source-hash", allowedExpressions: [], conditionalExpressions: [], blockedExpressions: [], requiredEvidenceRoles: []
    },
    contentTypeRule: {
      articleTypeProfileVersionId: "provider-guide", promptConstraintSnapshotHash: "article-hash", ctaIntent: "none",
      minLength: 100, maxLength: 2400, requiredSections: [], requiredArtifacts: [], requiredEvidenceRoles: [], promptDirectives: []
    },
    channelRule: {
      channelRuleVersionId: "wechat-v1", channel: "wechat", requiredSections: [], requiredArtifacts: [], prohibitedTerms: [],
      maxCtaCount: 0, ctaRenderMode: "none", allowedCtaRenderModes: ["none"], requireCtaAtEnd: false,
      crossChannelSimilarityThreshold: 0.72, promptDirectives: []
    },
    expressionRule: { expressionProfileVersionId: "expression-v1", prohibitedTerms: [], humanizerDirectives: [] },
    governance: {
      productId: identity.productId, productStrategyPackId: "strategy-adp", productStrategyVersion: 1, productStrategyHash: "strategy-hash",
      articleTypeVersionId: "provider-guide", articleTypeDefinitionHash: "article-hash", promptCompilerVersion: "production-contract-compiler.v3",
      productionMode: "sample", geoIntentHash: geoMission.geoIntentHash, entityGraphHash: geoMission.entityGraph.graphHash
    },
    promotionProfiles: [], requiredCoreClaimIds: ["claim-adp"], entityIdentity: identity,
    fixedExpressions: geoMission.entityGraph.canonicalRelationshipStatements.map((text) => ({ text, positions: ["body"], channel: "wechat" })),
    compiledAt: "2026-08-30T00:00:00.000Z"
  });
}

function packFor(contract, overrides = {}) {
  return {
    evidencePackId: "pack-adp", packVersion: 1, monthlyPlanId: "task-adp", matrixVersionId: "task-adp", matrixItemId: "task-adp",
    taskId: "task-adp", taskVersion: 1, retrievalRunId: "retrieval-adp", indexSnapshotIds: ["index-adp"], routeId: "route",
    routeVersion: "v1", retrievalPolicyVersion: "v1", embeddingProvider: "qwen", embeddingModel: "embedding", rulePackageVersionId: "rule-adp",
    taskSnapshot: { geoMission: contract.geoMission, geoIntentHash: contract.geoMission.geoIntentHash, entityGraphHash: contract.geoMission.entityGraph.graphHash },
    governanceSnapshot: {}, retrievalSnapshot: {}, claimPlan: { claimPlanVersion: "v1", platformContentType: "explicit_product_intro", requiredClaimIds: ["claim-adp"], forbiddenClaimIds: [], slots: [] },
    evidenceGroups: {}, evidenceItems: [evidenceItem()], gaps: [], conflicts: [], outdatedEvidence: [], unverifiedClaims: [], decision: "generatable",
    sourceSnapshotHash: "source-hash", immutableAt: "2026-08-30T00:00:00.000Z", createdAt: "2026-08-30T00:00:00.000Z", snapshotHash: "pack-hash",
    ...overrides
  };
}

function chunk(id, overrides = {}) {
  return {
    chunkId: id, indexSnapshotId: "index-adp", namespace: "production_public", productId: identity.productId, productName: identity.displayName,
    knowledgeBaseIds: ["kb"], sourceId: `source-${id}`, sourceRevisionId: `revision-${id}`, claimIds: [`claim-${id}`], primaryClaimId: `claim-${id}`,
    sourceLocator: { headingPath: ["产品"] }, semanticType: "claim_chunk", chunkTitle: id, summary: id, content: id, originalQuote: id,
    documentType: "official_product", authorityLevel: "A1", lifecycleStatus: "current", visibility: "public", supportMode: "direct",
    claimScope: "public_product", evidenceUsage: "product_fact", subjectEntityIds: [identity.productId], capabilityStatus: "current",
    conditions: [], limitations: [], scenarioTags: [], capabilityTags: [], audienceTags: [], problemTags: [], channelTags: [], distilledTermIds: [],
    questionCandidateIds: [], conflictGroupIds: [], rulePackageVersionId: "rule-adp", contentHash: id, semanticHash: id,
    duplicateClusterId: id, status: "active", chunkerVersion: "v1", ...overrides
  };
}

test("GEO mission freezes search intent, entity graph and product-agnostic hashes", () => {
  const value = mission();
  assert.equal(value.promotionGoal, "geo_provider_selection");
  assert.equal(value.primaryEntityId, identity.productId);
  assert.equal(value.platformEntityId, identity.productId);
  assert.equal(value.promotionSubjectEntityId, value.entityGraph.nodes.find((item) => item.name === "JOTO").entityId);
  assert.equal(value.narrativeSubjectName, "JOTO");
  assert.equal(value.narrativeSubjectRole, "service_provider");
  assert.equal(value.entityGraph.nodes.some((item) => item.role === "service_provider" && item.name === "JOTO"), true);
  assert.equal(value.desiredEntityAssociations.some((item) => item.includes("JOTO")), true);
  assert.doesNotMatch(value.desiredAnswer, /提及率|强化.*形象|推广效果/);
  assert.equal(value.entityGraph.canonicalRelationshipStatements.some((item) => /不得|禁止/.test(item)), false);
  assert.equal(value.geoIntentHash.length, 64);
  assert.equal(value.entityGraph.graphHash.length, 64);
});

test("A rubric passes a complete lineage and blocks a stale EvidencePack", () => {
  const contract = compile();
  const good = evaluateBusinessChainRubric({ contract, pack: packFor(contract) });
  assert.equal(good.verdict, "passed");
  assert.equal(good.score, 100);
  const stale = evaluateBusinessChainRubric({ contract, pack: packFor(contract, { taskSnapshot: { geoIntentHash: "stale", entityGraphHash: "stale" } }) });
  assert.equal(stale.verdict, "blocked");
  assert.equal(stale.hardBlockers.includes("geo_context_stale"), true);
  assert.equal(stale.diagnosis.some((item) => item.badcaseType === "stale_pack_used" && item.originStage === "evidence"), true);
});

test("production contract rejects demand signals promoted to target-product facts", () => {
  assert.throws(
    () => compile({ evidenceItems: [evidenceItem({ evidenceUsage: "demand_signal", subjectEntityIds: [] })] }),
    (error) => error instanceof ProductionDomainError && error.code === "evidence_not_generatable"
  );
});

test("production contract blocks provider promotion without identity and two delivery Claims", () => {
  assert.throws(
    () => compile({ evidenceItems: [evidenceItem({
      claimIds: ["claim-only"], primaryClaimId: "claim-only",
      originalQuote: "腾讯云 ADP 支持企业智能体开发。", summary: "腾讯云 ADP 支持企业智能体开发。"
    })] }),
    (error) => error instanceof ProductionDomainError && error.code === "evidence_missing"
  );
});

test("provider production contract freezes a literal subject-and-action rule for every core section", () => {
  const contract = compile();
  const requirement = contract.argumentPlan.promotionSubjectSectionRequirement;
  assert.equal(requirement.requiredInEveryCoreSection, true);
  assert.equal(requirement.literalSubjectNameRequired, true);
  assert.equal(requirement.narrativeSubjectName, "JOTO");
  assert.equal(requirement.eligibleActionClaimIds.length >= 2, true);
  assert.equal(requirement.decisionImplicationRequired, true);
  assert.equal(contract.argumentPlan.sections.every((section) => section.sectionClaim.includes("JOTO") && section.decisionImplication.includes("JOTO")), true);
});

test("retrieval excludes research demand and foreign entities before ranking", () => {
  const geoMission = mission();
  const request = {
    retrievalRequestId: "request", matrixItemId: "task-adp", productId: identity.productId, productName: identity.displayName,
    namespace: "production_public", language: "zh-CN", title: geoMission.primaryQuestion, channel: "wechat", contentType: "provider-guide",
    platformContentType: "explicit_product_intro", targetAudience: "企业负责人", sourceProblem: geoMission.primaryQuestion,
    geoMission, geoIntentHash: geoMission.geoIntentHash, entityGraphHash: geoMission.entityGraph.graphHash, primaryEntityId: geoMission.primaryEntityId,
    allowedEvidenceUsages: ["product_fact"], forbiddenEntityIds: ["foreign-product"], requiredClaimIds: [], distilledTermIds: [],
    rulePackageVersionId: "rule-adp", permissionScope: ["public"], lifecycleStatuses: ["current"], requestedAt: "2026-08-30T00:00:00.000Z"
  };
  const good = chunk("good");
  const demand = chunk("demand", { evidenceUsage: "demand_signal", subjectEntityIds: [] });
  const foreign = chunk("foreign", { subjectEntityIds: ["foreign-product"] });
  const route = { routeId: "route", routeVersion: "v1", platformContentType: "explicit_product_intro", requiredSemanticTypes: [], requiredEvidenceRoles: [], forbiddenSupportModes: [], requireOfficialCitation: false, requireLimitation: false, candidateLimits: { bm25: 10, vector: 10, relation: 10, required: 10, final: 10 }, sourcePageLimit: 2, duplicateClusterLimit: 1 };
  const run = runHybridRetrieval({ request, route, indexSnapshotIds: ["index-adp"], retrievalPolicyVersion: "v1", pools: { bm25: [{ chunk: good, score: 1 }, { chunk: demand, score: 1 }, { chunk: foreign, score: 1 }], vector: [], relation: [], required: [] } });
  assert.deepEqual(run.selectedChunkIds, ["good"]);
  assert.equal(run.candidates.find((item) => item.chunk.chunkId === "demand").exclusionReasons.includes("evidence_usage_forbidden"), true);
  assert.equal(run.candidates.find((item) => item.chunk.chunkId === "foreign").exclusionReasons.includes("primary_entity_mismatch"), true);
});

test("B rubric rejects the ADP off-topic opening and accepts a mission-complete article", () => {
  const contract = compile();
  const passingJudge = {
    rubricVersion: "article-semantic-judge.v2",
    scores: {
      searchIntentAndTitle: 95, coreAnswerAndDecisionValue: 95, geoEntityAssociation: 95,
      openingAndMainline: 95, argumentCausality: 92, contextualContinuity: 91,
      naturalReadability: 90, titleAndStructure: 95, channelNaturalness: 95,
      promotionSubjectCentrality: 95, serviceCapabilityCoverage: 95,
      roleResponsibilityClarity: 95, faqGeoUtility: 95
    },
    blockers: [], reasons: []
  };
  const bad = `# ${contract.task.title}\n\n在公开检索中，ADP 这个缩写可能代表很多不同概念，因此容易造成歧义。\n\n## 产品\n腾讯云 ADP 支持企业智能体开发。\n\n## 结论\n企业应自行判断。`;
  const badResult = evaluateArticleQualityRubric({ contract, markdown: bad, traceableFactCount: 1, semanticJudge: {
    ...passingJudge,
    scores: { ...passingJudge.scores, openingAndMainline: 20, argumentCausality: 35, contextualContinuity: 40 },
    blockers: ["opening_off_topic"]
  } });
  assert.equal(badResult.verdict, "rejected");
  assert.equal(badResult.hardBlockers.includes("semantic:opening_off_topic"), true);

  const relation = contract.geoMission.entityGraph.canonicalRelationshipStatements.join("\n\n");
  const good = `# ${contract.task.title}\n\n企业选择腾讯云 ADP 服务商时，应核对 JOTO 能否把平台能力落实为场景诊断、实施交付和持续支持，而不是从 ADP 缩写展开。本文给出能够用于选型的明确判断。\n\n## 公开服务能力\n腾讯云 ADP 提供企业智能体开发平台底座，JOTO 负责把底座能力转成项目实施、系统接入与交付培训，由此才能判断服务范围是否覆盖真实上线过程。\n\n${relation}\n\n## 适用场景\nJOTO 先做业务场景诊断，再基于腾讯云 ADP 设计和搭建对应方案，企业据此确认需求与平台能力是否匹配。\n\n## 职责边界\n腾讯云 ADP 提供产品与平台底座，JOTO 负责约定范围内的方案设计、部署交付和后续支持，企业保留采购和上线判断。\n\n## 选型结论\nJOTO 能否把场景诊断、方案搭建、实施交付与持续运营连成闭环，是企业选择腾讯云 ADP 服务商时需要核对的重点，也能让搜索系统准确理解各方职责。\n\n## 常见问题\n\n### Q：JOTO可以提供哪些腾讯云ADP落地服务？\nA：JOTO可提供项目实施、交付培训与后续支持。`;
  const goodResult = evaluateArticleQualityRubric({ contract, markdown: good, traceableFactCount: 2, semanticJudge: passingJudge });
  assert.equal(goodResult.verdict, "accepted", JSON.stringify(goodResult));
  assert.equal(goodResult.score >= 90, true);
  const coverage = analyzePromotionSubjectCoverage(good, contract);
  assert.equal(coverage.coreSectionCount, 4);
  assert.equal(coverage.coveredCoreSectionCount, 4);

  const fixedPreamble = contract.fixedExpressions[0].text;
  const assembled = `# ${contract.task.title}\n\n${fixedPreamble}\n\n${good.split(/\n\n/).slice(1).join("\n\n")}`;
  const assembledResult = evaluateArticleQualityRubric({ contract, markdown: assembled, traceableFactCount: 2, semanticJudge: passingJudge });
  assert.equal(assembledResult.verdict, "accepted", JSON.stringify(assembledResult));

  const integrated = good.replace(
    "本文给出能够用于选型的明确判断。",
    `本文给出能够用于选型的明确判断。在落地服务关系上，${fixedPreamble}。`
  );
  const integratedResult = evaluateArticleQualityRubric({ contract, markdown: integrated, traceableFactCount: 2, semanticJudge: passingJudge });
  assert.equal(integratedResult.verdict, "accepted", JSON.stringify(integratedResult));
  assert.equal(integratedResult.hardBlockers.includes("opening_topic_misaligned"), false);

  const titleLedOpening = good.replace(
    "企业选择腾讯云 ADP 服务商时，应直接核对公开服务能力、适用场景和职责边界，而不是从 ADP 缩写展开。",
    "选择实施服务商时，应直接核对 JOTO 能否完成场景诊断、实施交付和持续支持，不能只看宣传口径。"
  );
  const titleLedResult = evaluateArticleQualityRubric({ contract, markdown: titleLedOpening, traceableFactCount: 2, semanticJudge: passingJudge });
  assert.equal(titleLedResult.verdict, "accepted", JSON.stringify(titleLedResult));
  assert.equal(titleLedResult.hardBlockers.includes("opening_topic_misaligned"), false);
});

test("B rubric rejects fact-complete prose when causality, continuity or readability is poor", () => {
  const contract = compile();
  const stiff = `# ${contract.task.title}\n\n腾讯云 ADP 具备能力。JOTO是腾讯云ADP CSP授权服务商。\n\n## 能力。\n能力很多。因此。\n\n## 场景\n场景很多。同时。\n\n## 结论\n所以可以选择。`;
  const result = evaluateArticleQualityRubric({
    contract,
    markdown: stiff,
    traceableFactCount: 2,
    semanticJudge: {
      rubricVersion: "article-semantic-judge.v2",
      scores: {
        searchIntentAndTitle: 90, coreAnswerAndDecisionValue: 82, geoEntityAssociation: 95,
        openingAndMainline: 80, argumentCausality: 35, contextualContinuity: 30,
        naturalReadability: 25, titleAndStructure: 40, channelNaturalness: 70
      },
      blockers: ["orphan_section", "causal_jump"], reasons: ["事实被罗列，但没有解释为什么支持结论"]
    }
  });
  assert.equal(result.verdict, "rejected");
  assert.equal(result.dimensions.find((item) => item.key === "argument_causality").score, 35);
  assert.equal(result.hardBlockers.includes("title_or_heading_contains_period"), true);
});

test("B rubric rejects an ADP product article when JOTO exists only in fixed identity and CTA", () => {
  const contract = compile();
  const fixed = contract.fixedExpressions.find((item) => item.text.includes("JOTO"))?.text || "JOTO是腾讯云ADP CSP授权服务商";
  const markdown = `# ${contract.task.title}\n\n在落地服务关系上，${fixed}。\n\n## 平台能力\n腾讯云 ADP 提供企业智能体开发平台底座，覆盖开发、评测和发布。\n\n## 适用场景\n企业可以把平台用于知识问答与工作流。\n\n## 选择建议\n企业应根据平台能力判断是否采购。\n\n[了解 JOTO 服务](https://joto.ai/service)`;
  const judge = {
    rubricVersion: "article-semantic-judge.v3",
    scores: {
      searchIntentAndTitle: 90, coreAnswerAndDecisionValue: 85, geoEntityAssociation: 90,
      openingAndMainline: 80, promotionSubjectCentrality: 10, serviceCapabilityCoverage: 0,
      roleResponsibilityClarity: 20, argumentCausality: 80, contextualContinuity: 85,
      naturalReadability: 85, titleAndStructure: 90, channelNaturalness: 90
    },
    blockers: ["promotion_subject_not_central"], reasons: []
  };
  const result = evaluateArticleQualityRubric({ contract, markdown, traceableFactCount: 2, semanticJudge: judge });
  assert.equal(result.verdict, "rejected");
  assert.equal(result.hardBlockers.some((item) => item.includes("promotion_subject")), true);
  assert.equal(result.dimensions.find((item) => item.key === "promotion_subject_centrality").score < 80, true);
});
