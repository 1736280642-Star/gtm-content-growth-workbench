import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSampleArticleFeedback } from "../src/lib/v5/sample-calibration-contracts";
import { containsBlockedAssertion, createFormalModelContract, ensureFrozenTitle, ensureGeoMissionOpening, ensureRequiredCoreClaimEvidence, normalizeMarkdownBlockSpacing, parseFormalProviderOutput, placeFixedExpressions, placeStrategyCta, reconcileCoreClaimTraces, reconcileEvidenceFactTraces, reconcileGovernedFaqFactTraces, removeSyntheticGovernanceSentences, removeUnsupportedFormalPassages, repairFormalOutputLocally, shouldBlockProviderPreflight, validateFormalProviderOutput } from "../src/lib/v5/formal-generation-service";
import {
  compileSampleRevisionDirectives,
  resolveJotoOfficialFixedExpression,
  selectRequiredCoreClaimIds
} from "../src/lib/v5/formal-production-contract-service";
import { compileNarrativeSubjectTitle, createProductSampleStableId, normalizeFrozenArticleTitle, selectRepresentativeSampleQuestion } from "../src/lib/v5/product-sample-article-service";
import { normalizeJotoAdpIdentityPhrasing } from "../src/lib/v5/geo-product-identity";
import { analyzeGovernedFaqCoverage, deriveGovernedFaqPlan, parseGovernedFaqItems, placeGovernedFaqBeforeCta } from "../src/lib/v5/faq-governance-policy";

test("sample stable IDs always fit governed varchar(64) identifiers", () => {
  for (const prefix of ["sample-prompt", "sample-prompt-v1", "sample-wechat-rule", "product-sample"]) {
    const id = createProductSampleStableId(prefix, { productId: "joto-workbuddy", version: "v1.0.0" });
    assert.ok(id.length <= 64, `${prefix} produced ${id.length} characters`);
    assert.ok(id.startsWith(`${prefix}-`));
  }
});

test("fixed expressions are placed deterministically instead of relying on the model", () => {
  const fixed = "JOTO是腾讯云ADP CSP授权服务商。";
  const markdown = placeFixedExpressions(`# 标题\n\n${fixed}\n\n## 正文\n内容。\n\n## 结尾\n总结。`, [{
    text: fixed,
    positions: ["opening", "ending"],
    channel: "wechat"
  }]);
  assert.equal(markdown.split(fixed).length - 1, 2);
  assert.ok(markdown.indexOf(fixed) < markdown.indexOf("\n## 正文"));
  assert.ok(markdown.lastIndexOf(fixed) > markdown.lastIndexOf("\n## 结尾"));
});

test("sample titles keep one question mark and never contain sentence periods", () => {
  assert.equal(normalizeFrozenArticleTitle("腾讯云 ADP 成熟度如何？有哪些行业积累？"), "腾讯云 ADP 成熟度如何，有哪些行业积累？");
  assert.equal(normalizeFrozenArticleTitle("腾讯云 ADP 的能力。"), "腾讯云 ADP 的能力");
});

test("service-provider sample titles name JOTO without repeating the CSP identity sentence", () => {
  assert.equal(compileNarrativeSubjectTitle({
    representativeQuestion: "腾讯云 ADP 的 AgentOps 企业智能体全生命周期运营体系包含哪些环节？",
    productName: "腾讯云 ADP",
    narrativeSubjectName: "JOTO",
    narrativeSubjectRole: "service_provider"
  }), "JOTO如何基于腾讯云 ADP落地AgentOps：全生命周期环节与职责分工");
  assert.equal(compileNarrativeSubjectTitle({
    representativeQuestion: "企业选择腾讯云 ADP 服务商时，应核对哪些公开服务能力？",
    productName: "腾讯云 ADP",
    narrativeSubjectName: "JOTO",
    narrativeSubjectRole: "service_provider"
  }), "腾讯云 ADP服务商怎么选：JOTO的公开服务能力、适用场景与职责边界");
});

test("required Claim follows the article mission instead of the first satisfied slot", () => {
  const pack = {
    taskSnapshot: { title: "腾讯云 ADP 的 AgentOps 全生命周期如何落地？" },
    evidenceItems: [
      {
        evidenceItemId: "workbuddy-like", primaryClaimId: "claim-wrong", claimIds: ["claim-wrong"],
        evidenceUsage: "product_fact", subjectEntityIds: ["tencent-adp-joto"],
        normalizedClaim: "", summary: "面向企业员工的轻量化零门槛 AI 入口。", originalQuote: "面向企业员工的轻量化零门槛 AI 入口。"
      },
      {
        evidenceItemId: "agentops", primaryClaimId: "claim-agentops", claimIds: ["claim-agentops"],
        evidenceUsage: "product_fact", subjectEntityIds: ["tencent-adp-joto"],
        normalizedClaim: "", summary: "AgentOps 覆盖构建、评测、发布、安全与观测的全生命周期。", originalQuote: "AgentOps 覆盖构建、评测、发布、安全与观测的全生命周期。"
      }
    ],
    claimPlan: {
      requiredClaimIds: ["claim-wrong"],
      slots: [{ required: true, status: "satisfied", selectedEvidenceItemIds: ["workbuddy-like"] }]
    }
  };
  const mission = {
    primaryEntityId: "tencent-adp-joto",
    primaryQuestion: "腾讯云 ADP 的 AgentOps 全生命周期如何落地？",
    titlePromiseDimensions: ["AgentOps", "全生命周期"]
  };
  assert.deepEqual(selectRequiredCoreClaimIds(pack, mission), ["claim-agentops"]);
});

test("governed provider identity is never selected as the model-authored core Claim", () => {
  const pack = {
    taskSnapshot: { title: "企业选择腾讯云 ADP 服务商时需要核对什么？" },
    evidenceItems: [
      {
        evidenceItemId: "identity", primaryClaimId: "claim-identity", claimIds: ["claim-identity"],
        documentType: "governed_entity_graph", allowedUsage: ["entity_identity"], evidenceUsage: "product_fact",
        subjectEntityIds: ["tencent-adp-joto"], normalizedClaim: "JOTO是腾讯云ADP CSP授权服务商",
        summary: "JOTO是腾讯云ADP CSP授权服务商", originalQuote: "JOTO是腾讯云ADP CSP授权服务商"
      },
      {
        evidenceItemId: "delivery", primaryClaimId: "claim-delivery", claimIds: ["claim-delivery"],
        documentType: "official_product", allowedUsage: ["product_mechanism"], evidenceUsage: "product_fact",
        subjectEntityIds: ["tencent-adp-joto"], normalizedClaim: "JOTO 提供场景咨询、系统集成和项目交付。",
        summary: "JOTO 提供场景咨询、系统集成和项目交付。", originalQuote: "JOTO 提供场景咨询、系统集成和项目交付。"
      }
    ],
    claimPlan: { requiredClaimIds: ["claim-identity", "claim-delivery"], slots: [] }
  };
  const mission = {
    primaryEntityId: "tencent-adp-joto",
    primaryQuestion: "JOTO 的场景咨询、系统集成和项目交付能力如何？",
    titlePromiseDimensions: ["JOTO 服务能力", "系统集成", "项目交付"]
  };
  assert.deepEqual(selectRequiredCoreClaimIds(pack, mission), ["claim-delivery"]);
});

test("industry maturity missions prefer concrete coverage evidence over generic delivery positioning", () => {
  const pack = {
    taskSnapshot: { title: "产品的行业解决方案成熟度如何，有哪些行业积累？" },
    evidenceItems: [
      {
        evidenceItemId: "generic-delivery", primaryClaimId: "claim-generic", claimIds: ["claim-generic"],
        evidenceUsage: "product_fact", subjectEntityIds: ["target-product"],
        normalizedClaim: "", summary: "服务商基于产品底座封装成熟垂直行业解决方案，可直接落地交付。", originalQuote: "服务商基于产品底座封装成熟垂直行业解决方案，可直接落地交付。"
      },
      {
        evidenceItemId: "industry-coverage", primaryClaimId: "claim-coverage", claimIds: ["claim-coverage"],
        evidenceUsage: "product_fact", subjectEntityIds: ["target-product"],
        normalizedClaim: "", summary: "重点覆盖零售、电商、工业、文旅、交通、医疗、金融、传媒、制造等行业；典型场景包含智能客服、知识检索与自动化工作流。", originalQuote: "重点覆盖零售、电商、工业、文旅、交通、医疗、金融、传媒、制造等行业；典型场景包含智能客服、知识检索与自动化工作流。"
      }
    ],
    claimPlan: {
      requiredClaimIds: ["claim-generic"],
      slots: [{ required: true, status: "satisfied", selectedEvidenceItemIds: ["generic-delivery"] }]
    }
  };
  const mission = {
    primaryEntityId: "target-product",
    primaryQuestion: "产品的行业解决方案成熟度如何，有哪些行业积累？",
    titlePromiseDimensions: ["行业解决方案成熟度", "行业积累"]
  };
  assert.deepEqual(selectRequiredCoreClaimIds(pack, mission), ["claim-coverage"]);
});

test("a governance warning is not mistaken for the prohibited assertion itself", () => {
  assert.equal(containsBlockedAssertion("选服务商时应避免绝对化承诺。", "绝对化承诺"), false);
  assert.equal(containsBlockedAssertion("这项服务作出绝对化承诺。", "绝对化承诺"), true);
});

test("transient provider preflight errors fall through to the retried generation call", () => {
  assert.equal(shouldBlockProviderPreflight({ ok: false, status: "failed", errorMessage: "temporary rate limit" }), false);
  assert.equal(shouldBlockProviderPreflight({ ok: false, status: "pending_config" }), true);
  assert.equal(shouldBlockProviderPreflight({ ok: false, status: "failed", errorMessage: "401 unauthorized" }), true);
});

test("frozen title is restored after model output without changing body", () => {
  assert.equal(ensureFrozenTitle("# 模型改写标题\n\n正文。", "冻结标题？"), "# 冻结标题？\n\n正文。");
  assert.equal(ensureFrozenTitle("正文。", "冻结标题？"), "# 冻结标题？\n\n正文。");
});

test("markdown headings become distinct blocks before identity placement", () => {
  const spaced = normalizeMarkdownBlockSpacing("# 标题\n首段。\n## 判断\n正文。");
  assert.equal(spaced, "# 标题\n\n首段。\n\n## 判断\n\n正文。");
  const placed = placeFixedExpressions(spaced, [{ text: "JOTO是腾讯云ADP CSP授权服务商", positions: ["opening"], channel: "wechat" }]);
  assert.match(placed, /^# 标题\n\n首段。在落地服务关系上，JOTO是腾讯云ADP CSP授权服务商。/);
  const placedAgain = placeFixedExpressions(placed, [{ text: "JOTO是腾讯云ADP CSP授权服务商", positions: ["opening"], channel: "wechat" }]);
  assert.equal(placedAgain, placed);
});

test("human-approved strategy CTA is appended once at the ending for every channel", () => {
  const plan = {
    selectedVariants: [{
      ctaVariantId: "strategy-cta", promotionProfileVersionId: "strategy-v1", targetEntityId: "tencent-adp-joto",
      label: "了解JOTO腾讯云ADP落地服务", publicUrl: "https://joto.ai/solutions/tencent-adp",
      identityClaimIds: [], serviceClaimIds: [], renderMode: "markdown_link"
    }]
  };
  for (const channel of ["csdn", "juejin", "zhihu"]) {
    const markdown = placeStrategyCta(`# 标题\n\n## 正文\n${channel} 正文。`, plan);
    assert.equal(markdown.split("了解JOTO腾讯云ADP落地服务").length - 1, 1);
    assert.equal(markdown.split("https://joto.ai/solutions/tencent-adp").length - 1, 1);
    assert.equal(markdown.endsWith("[了解JOTO腾讯云ADP落地服务](https://joto.ai/solutions/tencent-adp)"), true);
  }
});

test("semantic variants of fixed expressions are removed before exact placement", () => {
  const fixed = "JOTO是腾讯云ADP CSP授权服务商；JOTO 可提供项目实施与支持。";
  const variant = "JOTO 是腾讯云 ADP CSP 授权服务商；JOTO可提供项目实施与支持。";
  const markdown = placeFixedExpressions(`# 标题\n\n${variant}\n\n## 正文\n内容。`, [{
    text: fixed,
    positions: ["body"],
    channel: "wechat"
  }]);
  assert.equal(markdown.split(fixed).length - 1, 1);
  assert.doesNotMatch(markdown, /JOTO 是腾讯云 ADP CSP 授权服务商/);

  const inverted = placeFixedExpressions(`# 标题\n\n作为腾讯云 ADP CSP 授权服务商，JOTO 基于腾讯云 ADP 底座提供实施支持。\n\n## 正文\n内容。`, [{
    text: "JOTO是腾讯云ADP CSP授权服务商",
    positions: ["opening"],
    channel: "wechat"
  }]);
  assert.doesNotMatch(inverted, /作为腾讯云 ADP CSP 授权服务商/);
  assert.match(inverted, /JOTO 基于腾讯云 ADP 底座提供实施支持。/);
  assert.equal(inverted.split("JOTO是腾讯云ADP CSP授权服务商").length - 1, 1);

  const legacyAccepted = "作为腾讯云 ADP CSP 授权服务商，JOTO 基于腾讯云 ADP 底座提供实施支持。在落地服务关系上，JOTO是腾讯云ADP CSP授权服务商。";
  const presented = normalizeJotoAdpIdentityPhrasing(legacyAccepted);
  assert.equal(presented, "JOTO 基于腾讯云 ADP 底座提供实施支持。在落地服务关系上，JOTO是腾讯云ADP CSP授权服务商。");
});

test("simple duplicate sentences are repaired without rewriting valid colons", () => {
  const sentence = "这是一条足够长并且需要去重的正文判断句。";
  const repaired = repairFormalOutputLocally({
    markdown: `# 标题\n\n## 判断：先看条件\n${sentence}\n${sentence}\n实施建议：先完成权限确认。`,
    factTraces: []
  });
  assert.equal(repaired.markdown.split(sentence).length - 1, 1);
  assert.match(repaired.markdown, /## 判断：先看条件/);
  assert.match(repaired.markdown, /实施建议：先完成权限确认。/);
});

test("incomplete fact traces are removed without deleting prose before final fact validation", () => {
  const sentence = "WorkBuddy 支持任务执行。";
  const repaired = removeUnsupportedFormalPassages({
    markdown: `# 标题\n\n${sentence}`,
    factTraces: [{ sentence, evidenceItemId: "e-1", claimId: "c-wrong", sourceRevisionId: "s-1" }]
  }, [{
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: sentence, normalizedClaim: sentence, summary: sentence, allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  }]);
  assert.equal(repaired.output.factTraces.length, 0);
  assert.match(repaired.output.markdown, /WorkBuddy 支持任务执行/);
});

test("untraced product prose remains available for bounded model repair", () => {
  const sentence = "JOTO 基于腾讯云 ADP 底座提供场景咨询与系统集成服务。";
  const repaired = removeUnsupportedFormalPassages({
    markdown: `# 标题\n\n## 落地判断\n${sentence}\n这让企业可以按业务场景判断实施路径。`,
    factTraces: []
  }, []);
  assert.match(repaired.output.markdown, /JOTO 基于腾讯云 ADP 底座/);
  assert.match(repaired.output.markdown, /这让企业可以按业务场景判断实施路径/);
});

test("natural product wording is deterministically associated with its core Claim", () => {
  const sentence = "WorkBuddy 可以通过可复用的 Skills 承接企业中的重复任务。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "WorkBuddy 支持通过可复用的 Skills 承接企业重复任务。",
    normalizedClaim: "WorkBuddy 支持通过可复用的 Skills 承接企业重复任务。",
    summary: "WorkBuddy 支持通过 Skills 执行重复任务。", allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const reconciled = reconcileCoreClaimTraces({ markdown: `# 标题\n\n${sentence}`, factTraces: [] }, [evidence], ["c-1"]);
  assert.deepEqual(reconciled.factTraces, [{ sentence, evidenceItemId: "e-1", claimId: "c-1", sourceRevisionId: "s-1" }]);
});

test("local wording repairs restore Claim traces for every evidence-backed product fact", () => {
  const sentence = "腾讯云提供 ADP 产品与云能力，JOTO 负责把平台能力接入企业知识、流程与系统。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "腾讯云提供 ADP 产品与云能力；JOTO 负责把平台能力接入企业知识、流程与系统。",
    normalizedClaim: "腾讯云提供 ADP 产品与云能力；JOTO 负责把平台能力接入企业知识、流程与系统。",
    summary: "腾讯云提供 ADP，JOTO 负责企业落地。", allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const reconciled = reconcileEvidenceFactTraces({ markdown: `# 标题\n\n${sentence}`, factTraces: [] }, [evidence]);
  assert.deepEqual(reconciled.factTraces, [{ sentence, evidenceItemId: "e-1", claimId: "c-1", sourceRevisionId: "s-1" }]);
});

test("inferred governance fields are never rendered as reader-facing conditions", () => {
  const synthetic = "企业管理人员需要完成岗位梳理、角色分工、专家配置、任务边界设计。这些前置工作决定了后续安排。";
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "WorkBuddy 支持企业任务执行。", normalizedClaim: "WorkBuddy 支持企业任务执行。",
    summary: "WorkBuddy 支持企业任务执行。", allowedUsage: [], forbiddenUsage: [], conditions: ["岗位梳理、角色分工、专家配置、任务边界设计"],
    limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const cleaned = removeSyntheticGovernanceSentences({ markdown: `# 标题\n\n正文。\n\n${synthetic}`, factTraces: [] }, [evidence]);
  assert.equal(cleaned.removedCount, 2);
  assert.doesNotMatch(cleaned.output.markdown, /岗位梳理|这些前置工作/);
});

test("missing core Claim never causes deterministic evidence sentence injection", () => {
  const evidence = {
    evidenceItemId: "e-1", primaryClaimId: "c-1", claimIds: ["c-1"], sourceRevisionId: "s-1",
    originalQuote: "把行业任务整理为可交付、可评测、可复制的企业场景包。",
    normalizedClaim: "把行业任务整理为可交付、可评测、可复制的企业场景包。",
    summary: "把行业任务整理为可交付、可评测、可复制的企业场景包。", allowedUsage: [], forbiddenUsage: [],
    conditions: ["内部治理条件"], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const completed = ensureRequiredCoreClaimEvidence({ markdown: "# 标题\n\nWorkBuddy 的价值要放到真实任务中理解。", factTraces: [] }, [evidence], ["c-1"]);
  assert.equal(completed.markdown, "# 标题\n\nWorkBuddy 的价值要放到真实任务中理解。");
  assert.equal(completed.factTraces.length, 0);
});

test("one evidence sentence can trace every required Claim without duplicating prose", () => {
  const sentence = "腾讯云 ADP 覆盖构建开发、效果评测、分发集成与安全治理等运营环节。";
  const evidence = {
    evidenceItemId: "e-shared", primaryClaimId: "c-1", claimIds: ["c-1", "c-2"], sourceRevisionId: "s-1",
    originalQuote: sentence, normalizedClaim: sentence, summary: sentence, allowedUsage: [], forbiddenUsage: [],
    conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const completed = ensureRequiredCoreClaimEvidence({ markdown: `# 标题\n\n${sentence}`, factTraces: [] }, [evidence], ["c-1", "c-2"]);
  assert.equal(completed.markdown.split(sentence).length - 1, 1);
  assert.deepEqual(completed.factTraces.map((trace) => trace.claimId).sort(), ["c-1", "c-2"]);
});

test("semicolon fixed expressions survive fact cleanup verbatim", () => {
  const fixed = "JOTO是腾讯云ADP CSP授权服务商；JOTO 可提供项目实施、交付培训与后续支持。";
  const cleaned = removeUnsupportedFormalPassages({ markdown: `# 标题\n\n${fixed}`, factTraces: [] }, [], [fixed]);
  assert.equal(cleaned.output.markdown.split(fixed).length - 1, 1);
  assert.equal(cleaned.removedCount, 0);
});

test("deterministic GEO opener is inserted directly below the title", () => {
  const output = ensureGeoMissionOpening(
    "# 选型问题\n原开头没有命中产品。\n## 正文\n内容。",
    "选型问题",
    {
      primaryQuestion: "企业应如何选型？",
      primaryEntityId: "product-a",
      articleRole: "选型指南",
      titlePromiseDimensions: ["公开能力", "适用边界"],
      entityGraph: { nodes: [{ entityId: "product-a", name: "产品 A" }], edges: [] }
    }
  );
  assert.match(output, /^# 选型问题\n\n围绕“企业应如何选型？”/);
  assert.ok(output.indexOf("围绕“企业应如何选型？”") < output.indexOf("原开头没有命中产品。"));
});

test("fixed expression remains exact and only applies to configured channels", () => {
  const fixed = "JOTO是腾讯云ADP CSP授权服务商。";
  const resolved = resolveJotoOfficialFixedExpression(
    fixed,
    ["wechat"],
    "csdn"
  );
  assert.equal(resolved.text, fixed);
  assert.equal(resolved.appliesToChannel, false);
});

test("JOTO official positioning keeps exact identity while joining a natural opening paragraph", () => {
  const legacyPositioning = "JOTO是腾讯云ADP CSP授权服务商";
  const markdown = placeFixedExpressions(
    "# 标题\n\nJOTO 团队可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。\n\n## 正文\n内容。\n\n## 结尾\nJOTO 团队可在约定项目范围内提供后续支持。如需了解，可继续查看。",
    [{ text: legacyPositioning, positions: ["opening", "ending"], channel: "csdn" }]
  );
  assert.equal(markdown.split(legacyPositioning).length - 1, 2);
  assert.match(markdown, /^# 标题\n\nJOTO 团队可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。在落地服务关系上，JOTO是腾讯云ADP CSP授权服务商。/);
  assert.match(markdown, /JOTO 团队可在约定项目范围内提供项目实施、交付培训与后续支持。开篇判断。/);
  assert.match(markdown, /JOTO 团队可在约定项目范围内提供后续支持。如需了解/);
  assert.match(markdown, /\n\n在落地服务关系上，JOTO是腾讯云ADP CSP授权服务商。$/);
});

test("formal model view keeps enough traceable and boundary evidence while bounding prompt size", () => {
  const evidenceItems = Array.from({ length: 40 }, (_, index) => ({
    evidenceItemId: `e-${index}`,
    claimIds: [`c-${index}`],
    primaryClaimId: `c-${index}`,
    sourceRevisionId: `s-${index}`,
    originalQuote: "原文".repeat(100),
    summary: `事实 ${index}。`,
    allowedUsage: index === 39 ? ["human_boundary"] : [],
    forbiddenUsage: [],
    conditions: index === 39 ? ["需要人工确认"] : [],
    limitations: [],
    lifecycleStatus: "current",
    visibility: "public",
    status: "active"
  }));
  const contract = {
    evidencePack: { evidenceItems, gaps: [], conflicts: [], outdatedEvidence: [], unverifiedClaims: [] },
    productRule: { allowedExpressions: [], conditionalExpressions: [], blockedExpressions: [] },
    allowedExpressions: [], conditionalExpressions: [], promptDirectives: [],
    validatorPolicy: {
      requiredCoreClaimIds: ["c-39"],
      entityIdentity: { productId: "p", canonicalName: "WorkBuddy", displayName: "WorkBuddy", aliases: [] }
    }
  };
  const view = createFormalModelContract(contract);
  assert.equal(view.evidencePack.evidenceItems.length, 5);
  assert.equal(view.evidencePack.evidenceItems[0].evidenceItemId, "e-39");
  assert.equal("originalQuote" in view.evidencePack.evidenceItems[0], false);
  assert.equal("productRule" in view, false);
  assert.equal(JSON.stringify(view).length < 20_000, true);
});

test("formal model view removes service capabilities that have no EvidenceItem claim", () => {
  const unsupported = "JOTO是腾讯云ADP CSP授权服务商；JOTO 可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持。";
  const contract = {
    evidencePack: {
      evidenceItems: [{
        evidenceItemId: "e-implementation", claimIds: ["c-implementation"], primaryClaimId: "c-implementation",
        sourceRevisionId: "s-implementation", normalizedClaim: "JOTO提供项目实施与系统集成。",
        summary: "JOTO提供项目实施与系统集成。", originalQuote: "JOTO提供项目实施与系统集成。",
        allowedUsage: [], forbiddenUsage: [], conditions: [], limitations: [], lifecycleStatus: "current", status: "active"
      }],
      gaps: [], conflicts: [], outdatedEvidence: [], unverifiedClaims: []
    },
    geoMission: {
      contractVersion: "v1", missionId: "mission", productId: "p", platformEntityId: "p", primaryEntityId: "p",
      promotionSubjectEntityId: "joto", narrativeSubjectEntityId: "joto", narrativeSubjectName: "JOTO", narrativeSubjectRole: "service_provider",
      promotionGoal: "geo_provider_selection", articleRole: "服务商说明", primaryQuestion: "如何选择？", representativeQueries: [],
      currentSearchGap: "缺少回答", desiredAnswer: "给出回答", desiredEntityAssociations: [unsupported], expectedAnswerSummary: [unsupported],
      titlePromiseDimensions: [], requiredClaimIds: [], entityGraph: {
        primaryEntityId: "p", nodes: [], relations: [{ subjectEntityId: "p", predicate: "served_by", objectEntityId: "joto", canonicalStatement: unsupported }],
        canonicalRelationshipStatements: [unsupported], forbiddenRelationshipStatements: [], graphHash: "graph"
      }
    },
    fixedExpressions: [{ text: "JOTO是腾讯云ADP CSP授权服务商", positions: ["opening"], channel: "wechat" }],
    faqPlan: { evidenceCandidates: [] }, promptDirectives: [],
    validatorPolicy: { requiredCoreClaimIds: ["c-implementation"], entityIdentity: { productId: "p", canonicalName: "腾讯云 ADP", displayName: "腾讯云 ADP", aliases: [] } }
  };
  const view = createFormalModelContract(contract);
  assert.deepEqual(view.geoMission.entityGraph.canonicalRelationshipStatements, ["JOTO是腾讯云ADP CSP授权服务商"]);
  assert.equal(view.geoMission.expectedAnswerSummary.some((item) => /交付培训|后续支持/.test(item)), false);
  assert.equal(view.geoMission.desiredEntityAssociations.some((item) => /交付培训|后续支持/.test(item)), false);
});

test("provider audit fields are stripped from reader-facing production output", () => {
  const output = parseFormalProviderOutput(JSON.stringify({
    markdown: "# 标题\n\n## 正文\nWorkBuddy 需要保留人工判断边界。",
    factTraces: [{
      sentence: "WorkBuddy 需要保留人工判断边界。",
      evidenceItemId: "evidence-1",
      claimId: "claim-1",
      sourceRevisionId: "source-1",
      originalQuote: "内部原始摘录",
      sourceLocator: { headingPath: ["内部"] }
    }]
  }));
  assert.equal(output.factTraces.length, 1);
  assert.equal("originalQuote" in output.factTraces[0], false);
  assert.equal("sourceLocator" in output.factTraces[0], false);
  assert.doesNotMatch(output.markdown, /内部原始摘录/);
});

test("provider double-escaped markdown newlines are normalized before validation", () => {
  const output = parseFormalProviderOutput(JSON.stringify({
    markdown: "# 标题\\n\\n## 正文\\nJOTO 提供项目实施支持。",
    factTraces: []
  }));
  assert.equal(output.markdown.split(/\r?\n/).length, 4);
  assert.match(output.markdown, /^## 正文$/m);

  const twiceEscaped = parseFormalProviderOutput(JSON.stringify({
    markdown: "# 标题\\\\n\\\\n## 正文\\\\nJOTO 提供项目实施支持。",
    factTraces: []
  }));
  assert.equal(twiceEscaped.markdown.split(/\r?\n/).length, 4);
  assert.match(twiceEscaped.markdown, /^## 正文$/m);
});

test("FAQ plan derives answerable user questions from governed knowledge instead of inventing facts", () => {
  const mission = {
    platformEntityId: "product-a",
    narrativeSubjectName: "JOTO",
    entityGraph: { nodes: [{ entityId: "product-a", name: "腾讯云 ADP" }] }
  };
  const evidencePack = {
    evidenceItems: [{
      evidenceItemId: "e-service", claimIds: ["c-service"], sourceRevisionId: "s-service",
      summary: "JOTO 提供腾讯云 ADP 项目实施、交付培训与后续支持。",
      originalQuote: "JOTO 提供项目实施、交付培训与后续支持。",
      status: "active", lifecycleStatus: "current", visibility: "public"
    }]
  };
  const plan = deriveGovernedFaqPlan({ mission, evidencePack, preferredClaimIds: ["c-service"] });
  assert.equal(plan.required, true);
  assert.equal(plan.evidenceCandidates.length, 1);
  assert.equal(plan.evidenceCandidates[0].claimId, "c-service");
  assert.match(plan.evidenceCandidates[0].suggestedQuestion, /JOTO|腾讯云 ADP/);
});

test("provider-selection FAQ turns governed facts into decision questions", () => {
  const mission = {
    promotionGoal: "geo_provider_selection",
    platformEntityId: "product-a",
    narrativeSubjectName: "JOTO",
    entityGraph: { nodes: [{ entityId: "product-a", name: "腾讯云 ADP" }] }
  };
  const evidencePack = {
    evidenceItems: [
      { evidenceItemId: "e-service", claimIds: ["c-service"], sourceRevisionId: "s-service", summary: "JOTO 提供腾讯云 ADP 项目实施与系统集成。", originalQuote: "JOTO 提供项目实施与系统集成。", status: "active", lifecycleStatus: "current", visibility: "public" },
      { evidenceItemId: "e-scenario", claimIds: ["c-scenario"], sourceRevisionId: "s-scenario", summary: "JOTO 提供企业场景诊断与方案设计。", originalQuote: "JOTO 提供企业场景诊断与方案设计。", status: "active", lifecycleStatus: "current", visibility: "public" }
    ]
  };
  const plan = deriveGovernedFaqPlan({ mission, evidencePack, preferredClaimIds: ["c-service", "c-scenario"] });
  assert.equal(plan.minimumItems, 2);
  assert.equal(plan.evidenceCandidates.some((item) => /选择|核对|评估|适合|比较/.test(item.suggestedQuestion)), true);
});

test("FAQ is normalized as the final body section before the governed CTA", () => {
  const markdown = "# 标题\n\n## 常见问题\n\n### Q：是否支持实施？\nA：JOTO提供实施支持。\n\n## 结论\n正文。";
  const plan = {
    enabled: true, required: true, heading: "常见问题", placement: "before_cta",
    minimumItems: 1, maximumItems: 5, allowedQuestionOrigins: ["knowledge_simulation"],
    evidenceCandidates: [], planHash: "faq-hash"
  };
  const normalized = placeGovernedFaqBeforeCta(markdown, plan);
  assert.ok(normalized.indexOf("## 结论") < normalized.indexOf("## 常见问题"));
  assert.deepEqual(parseGovernedFaqItems(normalized), [{ question: "是否支持实施？", answer: "JOTO提供实施支持。" }]);
});

test("FAQ trace reconciliation accepts the rendered A prefix", () => {
  const markdown = "# 标题\n\n## 正文\n内容。\n\n## 常见问题\n\n### Q：JOTO如何支持实施？\n**A：** JOTO提供项目实施支持。";
  const coverage = analyzeGovernedFaqCoverage({
    markdown,
    contract: {
      ctaPlan: { selectedVariants: [] },
      faqPlan: {
        enabled: true, required: true, heading: "常见问题", placement: "before_cta", minimumItems: 1, maximumItems: 3,
        allowedQuestionOrigins: ["knowledge_simulation"],
        evidenceCandidates: [{ topic: "implementation_deployment", suggestedQuestion: "JOTO如何支持实施？", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }],
        planHash: "faq-hash"
      },
      geoMission: { narrativeSubjectName: "JOTO", titlePromiseDimensions: ["实施"], entityGraph: { nodes: [{ name: "腾讯云 ADP" }] } }
    },
    validTraces: [{ sentence: "**A：** JOTO提供项目实施支持。", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }]
  });
  assert.deepEqual(coverage.untracedQuestions, []);
});

test("FAQ facts receive a deterministic trace only when an allowed Claim supports the answer", () => {
  const output = {
    markdown: "# 标题\n\n## 常见问题\n\n### Q：JOTO如何支持实施？\nA：JOTO提供项目实施支持。",
    factTraces: []
  };
  const evidence = {
    evidenceItemId: "e-faq", primaryClaimId: "c-faq", claimIds: ["c-faq"], sourceRevisionId: "s-faq",
    originalQuote: "JOTO提供项目实施支持。", normalizedClaim: "JOTO提供项目实施支持。", summary: "JOTO提供项目实施支持。",
    allowedUsage: [], forbiddenUsage: [], conditions: [], limitations: [], status: "active", lifecycleStatus: "current", visibility: "public"
  };
  const reconciled = reconcileGovernedFaqFactTraces(output, {
    faqPlan: {
      evidenceCandidates: [{ topic: "implementation_deployment", suggestedQuestion: "JOTO如何支持实施？", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }]
    }
  }, [evidence]);
  assert.deepEqual(reconciled.factTraces, [{
    sentence: "JOTO提供项目实施支持。", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq"
  }]);
});

test("formal hard gate rejects a FAQ answer that has no governed Claim trace", () => {
  const evidence = {
    evidenceItemId: "e-faq", primaryClaimId: "c-faq", claimIds: ["c-faq"], sourceRevisionId: "s-faq",
    originalQuote: "JOTO提供项目实施支持。", normalizedClaim: "JOTO提供项目实施支持。", summary: "JOTO提供项目实施支持。",
    allowedUsage: [], forbiddenUsage: [], conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const faqPlan = {
    enabled: true, required: true, heading: "常见问题", placement: "before_cta", minimumItems: 1, maximumItems: 5,
    allowedQuestionOrigins: ["knowledge_simulation"],
    evidenceCandidates: [{ topic: "implementation_deployment", suggestedQuestion: "JOTO如何支持实施？", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }],
    planHash: "faq-hash"
  };
  const markdown = "# JOTO实施指南\n\n## 实施方式\n正文。\n\n## 常见问题\n\n### Q：JOTO如何支持实施？\nA：JOTO提供项目实施支持。";
  const result = validateFormalProviderOutput({
    contract: {
      faqPlan,
      ctaPlan: { selectedVariants: [] },
      geoMission: { narrativeSubjectName: "JOTO", titlePromiseDimensions: ["实施"], entityGraph: { nodes: [{ name: "腾讯云 ADP" }] } },
      promotionSubjectPlan: { enabled: false, narrativeSubjectName: "JOTO" },
      validatorPolicy: { faqPlan }
    },
    output: { markdown, factTraces: [] },
    title: "JOTO实施指南",
    evidenceItems: [evidence], blockedRuleTexts: [], requiredFormatTexts: [], checkedRuleCount: 1,
    requiredCoreClaimIds: [], entityIdentity: { productId: "p", canonicalName: "腾讯云 ADP", displayName: "腾讯云 ADP", aliases: [] },
    fixedExpressions: [], ctaPlan: { selectedVariants: [] }
  });
  assert.equal(result.passed, false);
  assert.equal(result.blockers.some((item) => item.includes("FAQ 答案没有使用FAQ计划允许的知识库Claim")), true);
});

test("FAQ decision guidance is not misclassified as an untraced product fact", () => {
  const evidence = {
    evidenceItemId: "e-faq", primaryClaimId: "c-faq", claimIds: ["c-faq"], sourceRevisionId: "s-faq",
    originalQuote: "JOTO提供项目实施支持。", normalizedClaim: "JOTO提供项目实施支持。", summary: "JOTO提供项目实施支持。",
    allowedUsage: [], forbiddenUsage: [], conditions: [], limitations: [], status: "active", validity: { lifecycleStatus: "current" }
  };
  const faqPlan = {
    enabled: true, required: true, heading: "常见问题", placement: "before_cta", minimumItems: 1, maximumItems: 5,
    allowedQuestionOrigins: ["knowledge_simulation"],
    evidenceCandidates: [{ topic: "implementation_deployment", suggestedQuestion: "如何核对实施伙伴？", evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }],
    planHash: "faq-hash"
  };
  const markdown = "# JOTO实施指南\n\n## 实施方式\n正文。\n\n## 常见问题\n\n### Q：如何核对实施伙伴？\nA：JOTO提供项目实施支持。应通过核对官方 CSP 授权资质来确认其实施伙伴角色。企业在考察腾讯云 ADP 服务商时，首先需要建立清晰的核验框架。在腾讯云 ADP 的实施过程中，平台方与服务商的职责边界必须明确。通过上述边界划分，企业可以明确 JOTO 在项目中承担的具体工作，避免在实施过程中出现责任推诿或能力盲区。";
  const tracedSentence = "A：JOTO提供项目实施支持。";
  const result = validateFormalProviderOutput({
    contract: {
      faqPlan,
      ctaPlan: { selectedVariants: [] },
      geoMission: { narrativeSubjectName: "JOTO", titlePromiseDimensions: ["实施"], entityGraph: { nodes: [{ name: "腾讯云 ADP" }] } },
      promotionSubjectPlan: { enabled: false, narrativeSubjectName: "JOTO" },
      validatorPolicy: { faqPlan }
    },
    output: { markdown, factTraces: [{ sentence: tracedSentence, evidenceItemId: "e-faq", claimId: "c-faq", sourceRevisionId: "s-faq" }] },
    title: "JOTO实施指南",
    evidenceItems: [evidence], blockedRuleTexts: [], requiredFormatTexts: [], checkedRuleCount: 1,
    requiredCoreClaimIds: ["c-faq"], entityIdentity: { productId: "p", canonicalName: "腾讯云 ADP", displayName: "腾讯云 ADP", aliases: [] },
    fixedExpressions: [], ctaPlan: { selectedVariants: [] }
  });
  assert.equal(result.blockers.some((item) => item.includes("没有 Claim 追溯")), false);
  assert.equal(result.blockers.some((item) => item.includes("FAQ 答案没有使用FAQ计划允许的知识库Claim")), false);
});

test("sample review only needs approval or one direct revision instruction", () => {
  assert.doesNotThrow(() => assertSampleArticleFeedback({ decision: "approved" }));
  assert.doesNotThrow(() => assertSampleArticleFeedback({ decision: "changes_requested", revisionInstruction: "开头从真实业务困境切入。" }));
  assert.throws(() => assertSampleArticleFeedback({ decision: "changes_requested" }), /sample_revision_instruction_required/);
  assert.throws(() => assertSampleArticleFeedback({ decision: "changes_requested", revisionInstruction: "修".repeat(1201) }), /sample_revision_instruction_too_long/);
});

test("phase 2D schema freezes contracts, feedback and expression calibration", async () => {
  const migration = await readFile("database/migrations/20260810_023_v5_production_contract_and_sample_calibration.sql", "utf8");
  const service = await readFile("src/lib/v5/single-article-production-service.ts", "utf8");
  const compilerService = await readFile("src/lib/v5/formal-production-contract-service.ts", "utf8");
  const generation = await readFile("src/lib/v5/formal-generation-service.ts", "utf8");
  for (const table of ["production_contract_snapshot", "sample_article_feedback", "expression_calibration_version"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(service, /compileFormalProductionContract/);
  assert.match(service, /persistProductionContractSnapshot/);
  assert.match(service, /mode: input\.productionMode \|\| "sample"/);
  assert.match(service, /V5_SAMPLE_ARTICLE_PROVIDER \|\| "qwen"/);
  assert.match(compilerService, /input\.mode === "batch" && String\(row\.strategy_status\) !== "production_ready"/);
  assert.match(compilerService, /input\.mode === "batch" && !row\.calibration_version_id/);
  assert.match(compilerService, /\[taskId, taskId, taskId\]/);
  assert.match(compilerService, /definition\.lengthRange/);
  assert.match(compilerService, /explicitArtifacts\(sampleStandard\.requiredArtifacts\)/);
  assert.match(compilerService, /strategyIdentity/);
  assert.match(compilerService, /strategyCtaEnabled/);
  assert.match(compilerService, /promotionProfiles/);
  assert.doesNotMatch(compilerService, /requiredArtifacts: \[\]/);
  assert.match(generation, /JSON\.stringify\(modelContract\)/);
  assert.match(generation, /repairRound <= 1/);
  assert.doesNotMatch(generation, /markdown\.includes\(item\.originalQuote\)/);
});

test("product sample is generated through the formal contract without creating a monthly plan", async () => {
  const migration = await readFile("database/migrations/20260812_025_v5_product_sample_article.sql", "utf8");
  const multiSampleMigration = await readFile("database/migrations/20260816_033_v5_multi_sample_review.sql", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const applyRoute = await readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8");
  const ragRepository = await readFile("src/lib/v5/rag/rag-repository.ts", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_sample_article_task/);
  assert.match(migration, /UNIQUE KEY uq_product_sample_strategy/);
  assert.match(multiSampleMigration, /uq_product_sample_strategy_type \(product_strategy_pack_id, article_type_version_id\)/);
  assert.match(multiSampleMigration, /review_status/);
  assert.match(sampleService, /prepareAndGenerateSingleArticle/);
  assert.match(sampleService, /productionMode: "sample"/);
  assert.match(sampleService, /evidenceReadiness'\)\) = 'ready'/);
  assert.doesNotMatch(sampleService, /INSERT INTO monthly_plan/);
  assert.match(applyRoute, /decision === "approve"/);
  assert.match(applyRoute, /enqueueProductSampleArticles/);
  assert.doesNotMatch(applyRoute, /generateProductSampleArticle/);
  assert.match(ragRepository, /updated\.affectedRows \+ sampleUpdated\.affectedRows !== 1/);
  assert.equal(selectRepresentativeSampleQuestion({
    suitableQuestions: ["产品是什么？", "采用前需要确认哪些条件和边界？"]
  }, "WorkBuddy"), "WorkBuddy 采用前需要确认哪些条件和边界？");
  assert.match(sampleService, /哪些环节可由 AI 执行、哪些判断仍应由人负责/);
});

test("product sample requests enqueue durable work and recover orphaned operations", async () => {
  const migration = await readFile("database/migrations/20260814_031_v5_async_sample_generation.sql", "utf8");
  const repository = await readFile("src/lib/v5/single-article-production-repository.ts", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const sampleRoute = await readFile("src/app/api/v5/products/[productId]/sample-article/route.ts", "utf8");
  const applyRoute = await readFile("src/app/api/v5/products/[productId]/strategy-pack/apply/route.ts", "utf8");
  const worker = await readFile("workers/content-production-worker.mjs", "utf8");
  const listPage = await readFile("src/app/products/[productId]/samples/page.tsx", "utf8");

  assert.match(migration, /progress_stage/);
  assert.match(migration, /recovery_of_operation_id/);
  assert.match(repository, /queueSingleArticleOperation/);
  assert.match(repository, /recoverStaleProductSampleOperations/);
  assert.match(repository, /readQueuedProductSampleOperations/);
  assert.match(repository, /row\.recovery_of_operation_id/);
  assert.match(repository, /singleArticleRequestHash\(String\(row\.task_id\), currentTaskVersion\)/);
  assert.match(sampleService, /enqueueProductSampleArticles/);
  assert.match(sampleService, /for \(const strategy of selectedStrategies\)/);
  assert.match(sampleRoute, /status: 202/);
  assert.match(applyRoute, /enqueueProductSampleArticles/);
  assert.match(worker, /recoverStaleProductSampleOperations/);
  assert.match(worker, /productionMode: "sample"/);
  for (const stage of ["retrieving_evidence", "provider_preflight", "calling_provider", "local_repair", "quality_validation"]) {
    assert.match(listPage, new RegExp(stage));
  }
});

test("changes requested are injected into a new sample contract and approval freezes once", async () => {
  const compiler = await readFile("src/lib/v5/formal-production-contract-service.ts", "utf8");
  const repository = await readFile("src/lib/v5/sample-calibration-repository.ts", "utf8");
  const sampleService = await readFile("src/lib/v5/product-sample-article-service.ts", "utf8");
  const route = await readFile("src/app/api/v5/drafts/[id]/sample-review/route.ts", "utf8");
  const panel = await readFile("src/components/SampleArticleReviewPanel.tsx", "utf8");
  assert.match(compiler, /sample_revision_feedback/);
  assert.match(compiler, /sampleRevisionDirectives/);
  assert.match(compiler, /calibration_sample_markdown/);
  assert.match(repository, /sample_already_approved/);
  assert.match(repository, /remaining === 0 \? "production_ready" : "pending_sample_review"/);
  assert.match(repository, /latest_feedback_json/);
  assert.match(sampleService, /sample_revision_requires_fresh_evidence/);
  assert.match(sampleService, /final_evidence_pack_id = NULL/);
  assert.match(sampleService, /status = 'approved', row_version = row_version \+ 1/);
  assert.match(sampleService, /row_version = row_version \+ 1/);
  assert.match(sampleService, /用户本轮修改要求/);
  assert.match(route, /enqueueProductSampleRevision/);
  assert.match(panel, /按要求重新生成/);
  assert.doesNotMatch(panel, /InputNumber|五项均不低于 4 分|值得保留的表达/);
  assert.deepEqual(compileSampleRevisionDirectives({
    revisionInstruction: "先讲真实场景，删除无证据的效率数字"
  }), ["用户对上一版样文的修改要求：先讲真实场景，删除无证据的效率数字"]);
});
