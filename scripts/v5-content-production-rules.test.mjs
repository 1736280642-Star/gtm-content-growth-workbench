import assert from "node:assert/strict";
import test from "node:test";

import { runContentProduction } from "../src/lib/v5/content-production-service";
import { ProductionDomainError } from "../src/lib/v5/content-production-contracts";
import { compileProductionContract } from "../src/lib/v5/production-contract-compiler";
import { validateProductionOutput } from "../src/lib/v5/production-output-validator";
import { resolvePromotionPlan } from "../src/lib/v5/promotion-resolver";

const NOW = "2026-07-24T00:00:00.000Z";

function createTask(overrides = {}) {
  return {
    taskId: "task-1",
    taskVersion: 1,
    title: "企业如何评估产品 A",
    channel: "wechat",
    contentType: "problem_solution",
    titleCategory: "evaluation",
    targetAudience: "企业 IT 负责人",
    coreProblem: "如何在可追溯事实范围内评估产品",
    coreJudgment: "先核对适用边界，再决定是否试用",
    targetEntityIds: ["product-a"],
    primaryEntityId: "product-a",
    productGroupIds: ["automation"],
    promotionGoal: "qualified_lead",
    ctaIntent: "product_evaluation",
    promotionRequired: true,
    ...overrides
  };
}

function createChannelRule(overrides = {}) {
  return {
    channelRuleVersionId: "channel-wechat-v1",
    channel: "wechat",
    minLength: 80,
    maxLength: 600,
    requiredSections: ["结论"],
    requiredArtifacts: ["list"],
    prohibitedTerms: ["行业第一"],
    maxCtaCount: 1,
    ctaRenderMode: "markdown_link",
    allowedCtaRenderModes: ["markdown_link"],
    requireCtaAtEnd: true,
    crossChannelSimilarityThreshold: 0.8,
    promptDirectives: ["使用适合企业读者的表达"],
    ...overrides
  };
}

function createProfile(id = "promotion-a-v1", overrides = {}) {
  return {
    promotionProfileVersionId: id,
    version: 1,
    status: "active",
    targetEntityIds: ["product-a"],
    excludedEntityIds: [],
    applicableProductGroups: [],
    articleScope: "single_product",
    promotionGoal: "qualified_lead",
    ctaIntent: "product_evaluation",
    applicableContentTypes: ["problem_solution"],
    applicableTitleCategories: ["evaluation"],
    allowMultiProduct: false,
    requiresPrimaryEntity: true,
    priority: 100,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.999Z",
    variants: [{
      ctaVariantId: `${id}-wechat`,
      channel: "wechat",
      label: "查看产品 A 评估入口",
      publicUrl: "https://example.com/product-a/evaluate",
      identityClaimIds: ["claim-a"],
      serviceClaimIds: [],
      allowedRenderModes: ["markdown_link"],
      status: "active"
    }],
    approvedBy: "reviewer-1",
    approvedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function createEvidencePack(overrides = {}) {
  return {
    evidencePackId: "evidence-pack-1",
    snapshotHash: "evidence-pack-hash-1",
    sourceSnapshotHash: "source-hash-1",
    decision: "generatable",
    evidenceItems: [
      {
        evidenceItemId: "evidence-a",
        claimIds: ["claim-a"],
        primaryClaimId: "claim-a",
        sourceRevisionId: "source-a-v1",
        originalQuote: "产品 A 支持标准流程编排。",
        summary: "标准流程编排能力",
        canonicalUrl: "https://docs.example.com/product-a",
        allowedUsage: ["product_capability"],
        forbiddenUsage: [],
        conditions: [],
        limitations: [],
        lifecycleStatus: "current",
        visibility: "public",
        status: "active"
      },
      {
        evidenceItemId: "evidence-boundary",
        claimIds: ["claim-boundary"],
        primaryClaimId: "claim-boundary",
        sourceRevisionId: "source-boundary-v1",
        originalQuote: "该能力需要管理员完成授权，并保留人工复核。",
        summary: "授权与人工复核边界",
        allowedUsage: ["human_boundary"],
        forbiddenUsage: [],
        conditions: ["管理员完成授权"],
        limitations: ["保留人工复核"],
        lifecycleStatus: "current",
        visibility: "public",
        status: "active"
      }
    ],
    gaps: [],
    conflicts: [],
    outdatedEvidence: [],
    unverifiedClaims: [],
    ...overrides
  };
}

function createCompileInput(overrides = {}) {
  return {
    task: createTask(),
    evidencePack: createEvidencePack(),
    productRule: {
      rulePackageVersionId: "product-rule-a-v1",
      sourceSnapshotHash: "source-hash-1",
      allowedExpressions: ["标准流程编排"],
      conditionalExpressions: ["需要管理员授权"],
      blockedExpressions: ["零风险"],
      requiredEvidenceRoles: ["product_capability", "human_boundary"]
    },
    contentTypeRule: {
      articleTypeProfileVersionId: "problem-solution-v1",
      promptConstraintSnapshotHash: "prompt-hash-1",
      ctaIntent: "product_evaluation",
      minLength: 60,
      maxLength: 800,
      requiredSections: ["结论"],
      requiredArtifacts: ["list"],
      requiredEvidenceRoles: ["product_capability"],
      promptDirectives: ["结论前置"]
    },
    channelRule: createChannelRule(),
    expressionRule: {
      expressionProfileVersionId: "humanizer-v1",
      prohibitedTerms: ["百分百安全"],
      humanizerDirectives: ["删除聊天式结尾"]
    },
    promotionProfiles: [createProfile()],
    minTraceableFactCount: 2,
    requireHumanBoundary: true,
    compiledAt: NOW,
    ...overrides
  };
}

function createContract(overrides = {}) {
  return compileProductionContract(createCompileInput(overrides));
}

function createGoodOutput(contract) {
  const factA = "产品 A 支持标准流程编排。";
  const boundary = "该能力需要管理员完成授权，并保留人工复核。";
  return {
    markdown: [
      `# ${contract.task.title}`,
      "",
      "## 结论",
      "评估时应先确认业务流程、权限条件和人工责任，再决定是否进入试用。这个顺序能减少把产品能力误写成无条件承诺的风险。",
      "",
      `- ${factA}`,
      `- ${boundary}`,
      "- 团队还应在试用阶段记录实际操作结果，并由负责人作最终判断。",
      "",
      `[${contract.ctaPlan.selectedVariants[0].label}](${contract.ctaPlan.selectedVariants[0].publicUrl})`
    ].join("\n"),
    factTraces: [
      { sentence: factA, evidenceItemId: "evidence-a", claimId: "claim-a", sourceRevisionId: "source-a-v1" },
      { sentence: boundary, evidenceItemId: "evidence-boundary", claimId: "claim-boundary", sourceRevisionId: "source-boundary-v1" }
    ]
  };
}

function expectDomainError(fn, code) {
  assert.throws(fn, (error) => error instanceof ProductionDomainError && error.code === code);
}

test("相同冻结输入产生相同 CTA 和生产合同哈希", () => {
  const first = createContract();
  const second = createContract();
  assert.equal(first.ctaPlan.planHash, second.ctaPlan.planHash);
  assert.equal(first.contractHash, second.contractHash);
});

test("多产品任务按产品、渠道和意图确定性选择 CTA", () => {
  const task = createTask({
    targetEntityIds: ["product-a", "product-b"],
    primaryEntityId: "product-a"
  });
  const channelRule = createChannelRule({ maxCtaCount: 2 });
  const profileA = createProfile("promotion-a-multi", {
    articleScope: "multi_product",
    allowMultiProduct: true,
    requiresPrimaryEntity: false
  });
  const profileB = createProfile("promotion-b-multi", {
    targetEntityIds: ["product-b"],
    articleScope: "multi_product",
    allowMultiProduct: true,
    requiresPrimaryEntity: false,
    variants: [
      {
        ctaVariantId: "promotion-b-linkedin",
        channel: "linkedin",
        label: "Product B on LinkedIn",
        publicUrl: "https://example.com/product-b/linkedin",
        identityClaimIds: ["claim-b"],
        serviceClaimIds: [],
        allowedRenderModes: ["markdown_link"],
        status: "active"
      },
      {
        ctaVariantId: "promotion-b-wechat",
        channel: "wechat",
        label: "查看产品 B 评估入口",
        publicUrl: "https://example.com/product-b/evaluate",
        identityClaimIds: ["claim-b"],
        serviceClaimIds: [],
        allowedRenderModes: ["markdown_link"],
        status: "active"
      }
    ]
  });
  const plan = resolvePromotionPlan({
    task,
    channelRule,
    profiles: [profileB, profileA],
    approvedClaimIds: ["claim-a", "claim-b"],
    now: NOW
  });
  const reversedPlan = resolvePromotionPlan({
    task,
    channelRule,
    profiles: [profileA, profileB],
    approvedClaimIds: ["claim-a", "claim-b"],
    now: NOW
  });
  assert.deepEqual(plan.selectedVariants.map((item) => item.targetEntityId), ["product-a", "product-b"]);
  assert.deepEqual(plan.selectedVariants.map((item) => item.ctaVariantId), ["promotion-a-multi-wechat", "promotion-b-wechat"]);
  assert.equal(plan.planHash, reversedPlan.planHash);
});

test("非必需推广无匹配时生成空 CTAPlan", () => {
  const plan = resolvePromotionPlan({
    task: createTask({ promotionRequired: false }),
    channelRule: createChannelRule(),
    profiles: [],
    approvedClaimIds: [],
    now: NOW
  });
  assert.deepEqual(plan.selectedVariants, []);
  assert.deepEqual(plan.selectionReasons, ["no_applicable_active_promotion"]);
});

test("必需推广无匹配时在生成前阻断", () => {
  expectDomainError(() => resolvePromotionPlan({
    task: createTask(),
    channelRule: createChannelRule(),
    profiles: [],
    approvedClaimIds: [],
    now: NOW
  }), "promotion_required_missing");
});

test("CTA 主张缺少批准 Claim 时阻断", () => {
  expectDomainError(() => resolvePromotionPlan({
    task: createTask(),
    channelRule: createChannelRule(),
    profiles: [createProfile()],
    approvedClaimIds: [],
    now: NOW
  }), "promotion_claim_missing");
});

test("同业务优先级 CTA 冲突时 fail closed", () => {
  expectDomainError(() => resolvePromotionPlan({
    task: createTask(),
    channelRule: createChannelRule(),
    profiles: [createProfile("promotion-a-v1"), createProfile("promotion-a-v2")],
    approvedClaimIds: ["claim-a"],
    now: NOW
  }), "promotion_conflict");
});

test("无关产品的坏配置不会误阻断当前任务", () => {
  const unrelated = createProfile("promotion-unrelated", {
    targetEntityIds: ["product-z"],
    applicableProductGroups: [],
    variants: [{
      ctaVariantId: "unrelated-invalid",
      channel: "wechat",
      label: "无关入口",
      publicUrl: "http://127.0.0.1/private",
      identityClaimIds: ["missing-claim"],
      serviceClaimIds: [],
      allowedRenderModes: ["markdown_link"],
      status: "active"
    }]
  });
  const plan = resolvePromotionPlan({
    task: createTask(),
    channelRule: createChannelRule(),
    profiles: [unrelated, createProfile()],
    approvedClaimIds: ["claim-a"],
    now: NOW
  });
  assert.equal(plan.selectedVariants[0].ctaVariantId, "promotion-a-v1-wechat");
});

test("内容类型与渠道篇幅无交集时阻断", () => {
  expectDomainError(() => createContract({
    channelRule: createChannelRule({ minLength: 900, maxLength: 1000 })
  }), "rule_conflict");
});

test("EvidencePack 不可生成时不会进入模型调用", async () => {
  let modelCalled = false;
  await assert.rejects(async () => {
    const contract = createContract({
      evidencePack: createEvidencePack({ decision: "needs_material", gaps: ["缺少产品能力证据"] })
    });
    await runContentProduction({
      contract,
      model: {
        async generate() { modelCalled = true; throw new Error("must not run"); },
        async repair() { modelCalled = true; throw new Error("must not run"); }
      }
    });
  }, (error) => error instanceof ProductionDomainError && error.code === "evidence_not_generatable");
  assert.equal(modelCalled, false);
});

test("输出校验捕获标题、事实、CTA、URL 和敏感信息问题", () => {
  const contract = createContract();
  const result = validateProductionOutput({
    contract,
    output: {
      markdown: [
        `# ${contract.task.title}补充`,
        "",
        "## 结论",
        "行业第一的方案可以直接使用，详情见 https://unapproved.example.com/path。",
        "- 联系电话 13800138000",
        "- 该段没有受支持的事实追踪。"
      ].join("\n"),
      factTraces: [{
        sentence: "正文不存在的事实句。",
        evidenceItemId: "evidence-a",
        claimId: "claim-a",
        sourceRevisionId: "source-a-v1"
      }]
    }
  });
  const codes = new Set(result.issues.map((item) => item.code));
  for (const code of ["title_mismatch", "prohibited_term", "fact_trace_invalid", "traceable_fact_count_low", "cta_missing", "url_not_allowed", "sensitive_output"]) {
    assert.ok(codes.has(code), `expected validation code: ${code}`);
  }
});

test("首次规则失败后只修复一次并可变为 available", async () => {
  const contract = createContract();
  const good = createGoodOutput(contract);
  let repairs = 0;
  const result = await runContentProduction({
    contract,
    model: {
      async generate() {
        return { ...good, markdown: good.markdown.replace(`# ${contract.task.title}`, "# 错误标题") };
      },
      async repair() {
        repairs += 1;
        return good;
      }
    }
  });
  assert.equal(result.status, "available");
  assert.equal(result.repairCount, 1);
  assert.equal(repairs, 1);
});

test("第二次规则校验仍失败时返回 failed 且不继续修复", async () => {
  const contract = createContract();
  const good = createGoodOutput(contract);
  let repairs = 0;
  const invalid = { ...good, markdown: good.markdown.replace(`# ${contract.task.title}`, "# 错误标题") };
  const result = await runContentProduction({
    contract,
    model: {
      async generate() { return invalid; },
      async repair() { repairs += 1; return invalid; }
    }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.repairCount, 1);
  assert.equal(repairs, 1);
});

test("Provider 技术失败最多重试三次", async () => {
  const contract = createContract();
  const good = createGoodOutput(contract);
  let attempts = 0;
  const recovered = await runContentProduction({
    contract,
    model: {
      async generate() {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary provider failure");
        return good;
      },
      async repair() { return good; }
    }
  });
  assert.equal(recovered.status, "available");
  assert.equal(recovered.technicalRetryCount, 2);

  let failedAttempts = 0;
  const unavailable = await runContentProduction({
    contract,
    model: {
      async generate() {
        failedAttempts += 1;
        throw new Error("provider unavailable");
      },
      async repair() { return good; }
    }
  });
  assert.equal(unavailable.status, "system_recovering");
  assert.equal(failedAttempts, 3);
  assert.equal(unavailable.technicalRetryCount, 3);
});
