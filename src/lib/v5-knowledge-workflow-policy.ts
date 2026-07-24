export type V5KnowledgeWorkflowTarget =
  | "claim_extraction"
  | "rule_package_activation"
  | "production_pool_entry"
  | "rag_ingestion"
  | "matrix_approval"
  | "batch_generation"
  | "publish_schedule"
  | "formal_publish"
  | "publication_record"
  | "monthly_review";

export type V5KnowledgeWorkflowDecisionStatus = "success" | "pending_input" | "pending_config" | "failed";

export interface V5KnowledgeWorkflowContext {
  source?: {
    sensitiveDataChecked?: boolean;
    sensitiveDataDetected?: boolean;
    parseStatus?: string;
    sourceId?: string;
    sourceRevisionId?: string;
    sourceLocator?: string;
    productId?: string;
    documentType?: string;
    authorityLevel?: string;
    visibility?: "public" | "internal" | "restricted";
  };
  governance?: {
    approvedClaimCount?: number;
    requiredApprovalsComplete?: boolean;
    unresolvedBlockingConflictCount?: number;
    rulePackageStatus?: string;
    rulePackageVersionId?: string;
    monthlyProductionReady?: boolean;
    allowedContentTypes?: string[];
    allowedChannels?: string[];
    maxMonthlyQuota?: number | null;
    ragManifestId?: string;
  };
  monthly?: {
    monthlyPlanId?: string;
    strategyStatus?: string;
    matrixVersionId?: string;
    matrixItemId?: string;
    matrixStatus?: string;
    evidencePreviewId?: string;
    platformExpressionPrecheck?: {
      evidenceSupported?: boolean;
      bodyProvable?: boolean;
      roleBoundarySafe?: boolean;
      humanConfirmed?: boolean;
    };
  };
  evidence?: {
    finalEvidencePackId?: string;
    gateStatus?: string;
    downgradeApproved?: boolean;
  };
  runtime?: {
    embeddingConfigured?: boolean;
    providerConfigured?: boolean;
    publishingPlatformConfigured?: boolean;
  };
  generation?: {
    mode?: "ai_provider" | "manual_authored" | "local_preview";
    hardRulePassed?: boolean;
    qualityEvaluationPassed?: boolean;
    draftVersionId?: string;
  };
  publishing?: {
    publishScheduleId?: string;
    capability?: "formal_publish" | "draft_only" | "manual_only" | "pending_config";
    approvalStatus?: "pending_approval" | "approved" | "rejected";
    scheduleStatus?: string;
    externalResult?: "success" | "failed" | "unknown";
    publishedUrl?: string;
  };
  review?: {
    usesRealMetricsOnly?: boolean;
    countsDraftCreatedAsPublished?: boolean;
    countsManualHandoffAsPublished?: boolean;
    countsPendingConfigAsPublished?: boolean;
  };
  operation?: {
    idempotencyKey?: string;
    expectedVersion?: number;
    actorId?: string;
    actorType?: "human" | "agent" | "scheduler" | "system";
    auditReason?: string;
  };
}

export interface V5KnowledgeWorkflowRuleDefinition {
  code: string;
  title: string;
  targets: readonly V5KnowledgeWorkflowTarget[];
  principle: string;
  userImpact: string;
  sourceDocs: readonly string[];
}

export interface V5KnowledgeWorkflowRuleResult extends V5KnowledgeWorkflowRuleDefinition {
  passed: boolean;
  status: V5KnowledgeWorkflowDecisionStatus;
  message: string;
  nextAction?: string;
}

export interface V5KnowledgeWorkflowDecision {
  ok: boolean;
  target: V5KnowledgeWorkflowTarget;
  status: V5KnowledgeWorkflowDecisionStatus;
  results: V5KnowledgeWorkflowRuleResult[];
  failures: V5KnowledgeWorkflowRuleResult[];
  nextActions: string[];
}

const foundationRoot = "docs/V5 07-07/agent-knowledge-base-foundation";

export const V5_KNOWLEDGE_WORKFLOW_RULES = [
  {
    code: "V5-KB-001",
    title: "敏感资料先隔离",
    targets: ["claim_extraction"],
    principle: "G0 安全准入先于解析、模型调用和事实抽取。",
    userImpact: "避免密钥、隐私或未授权客户资料被送入外部模型或生产索引。",
    sourceDocs: [`${foundationRoot}/02-再设计新增知识库接入流程/00-阶段二新增知识库接入最佳设计总方案.md`]
  },
  {
    code: "V5-KB-002",
    title: "来源必须完整且可追溯",
    targets: ["claim_extraction"],
    principle: "只有解析成功、产品归属明确且能定位原文的来源才可抽取事实。",
    userImpact: "每条产品事实都能回到具体来源，错误页和空页不会伪装成知识。",
    sourceDocs: [`${foundationRoot}/02-再设计新增知识库接入流程/06-验收测试与第三阶段交接.md`]
  },
  {
    code: "V5-KB-003",
    title: "规则包只能由人激活",
    targets: ["rule_package_activation"],
    principle: "AI 只能生成规则包草稿，不能批准产品事实、强效果数字和合规承诺。",
    userImpact: "核心表达判断权保留在人，防止 Agent 把建议直接变成生产规则。",
    sourceDocs: [`${foundationRoot}/02-再设计新增知识库接入流程/03-规则包草稿生成与版本治理.md`]
  },
  {
    code: "V5-KB-004",
    title: "阻断冲突必须先解决",
    targets: ["rule_package_activation", "production_pool_entry", "rag_ingestion", "matrix_approval", "batch_generation", "publish_schedule"],
    principle: "未解决的阻断冲突不能被更有营销力的表达覆盖。",
    userImpact: "冲突资料会进入人工裁决，不会静默污染规则包、检索或正文。",
    sourceDocs: [`${foundationRoot}/02-再设计新增知识库接入流程/04-资料缺口冲突与人工确认.md`]
  },
  {
    code: "V5-KB-005",
    title: "生产池要求 active 与月度准备度",
    targets: ["production_pool_entry", "rag_ingestion", "matrix_approval", "batch_generation", "publish_schedule"],
    principle: "只有 active 规则包且 monthlyProductionReady=true 的产品可以进入月度生产链路。",
    userImpact: "当前四个待确认规则包不会被误当成已经可生产。",
    sourceDocs: [`${foundationRoot}/01-先设计产品表达规则边界/05-通用产品表达规则模板.md`]
  },
  {
    code: "V5-KB-006",
    title: "月度稳定 ID 是唯一追溯主线",
    targets: ["matrix_approval", "batch_generation", "publish_schedule", "formal_publish", "publication_record", "monthly_review"],
    principle: "V5 新写入以 MonthlyPlan 和 ContentMatrixVersion 为真源，周视图只做派生展示。",
    userImpact: "任意生成、发布和复盘结果都能追溯到批准过的月度计划。",
    sourceDocs: [`${foundationRoot}/00-V5月度内容矩阵统一口径与字段映射.md`]
  },
  {
    code: "V5-KB-007",
    title: "策略批准后才能审核矩阵",
    targets: ["matrix_approval"],
    principle: "月度策略先人工批准，再生成带 EvidencePreview 的矩阵草稿。",
    userImpact: "避免策略和矩阵互相倒推，审核对象保持稳定。",
    sourceDocs: [`${foundationRoot}/00-V5月度内容矩阵统一口径与字段映射.md`]
  },
  {
    code: "V5-KB-008",
    title: "矩阵与平台表达必须人工确认",
    targets: ["matrix_approval", "batch_generation", "publish_schedule"],
    principle: "三项平台表达前置检查全通过且人工批准矩阵后，任务才可冻结。",
    userImpact: "标题承诺、正文证据和人机角色边界不会在生成时被模型重新决定。",
    sourceDocs: [`${foundationRoot}/04-再设计内容生成稳定链路/00-平台表达准备/02-三项前置检查规则.md`]
  },
  {
    code: "V5-KB-009",
    title: "Final Evidence Gate 决定生成资格",
    targets: ["batch_generation", "publish_schedule"],
    principle: "EvidencePreview 不授予正文生成权限，批量生成必须读取 Final EvidencePack。",
    userImpact: "只有有最终证据或明确降级批准的矩阵项会消耗模型并产出正文。",
    sourceDocs: [`${foundationRoot}/03-再设计RAG优化策略/04-EvidencePack与证据充分性判断.md`]
  },
  {
    code: "V5-KB-010",
    title: "缺真实配置必须返回 pending_config",
    targets: ["rag_ingestion", "batch_generation", "formal_publish"],
    principle: "Embedding、Provider 或发布能力缺失时，不允许用本地结果伪装成功。",
    userImpact: "用户看到真实阻塞原因和下一步配置动作，不会得到伪向量、伪正文或伪发布。",
    sourceDocs: [
      `${foundationRoot}/03-再设计RAG优化策略/00-阶段三RAG最佳设计总方案.md`,
      `${foundationRoot}/04-再设计内容生成稳定链路/00-阶段四内容生成稳定链路最佳设计总方案.md`
    ]
  },
  {
    code: "V5-KB-011",
    title: "正式生成与质检通过后才能排程",
    targets: ["publish_schedule"],
    principle: "local_preview 不是生产稿，硬规则和软质量均通过后才能进入 PublishSchedule。",
    userImpact: "本地兜底稿和存在阻断项的草稿不会流入发布队列。",
    sourceDocs: [`${foundationRoot}/04-再设计内容生成稳定链路/06-实施迁移验收与第五阶段交接.md`]
  },
  {
    code: "V5-KB-012",
    title: "正式发布要求批准排程和真实能力",
    targets: ["formal_publish"],
    principle: "只有 formal_publish 能力、人工前置确认和已批准排程同时成立才可调用平台。",
    userImpact: "draft_only、manual_only 和 pending_config 不会被误计为正式发布。",
    sourceDocs: [`${foundationRoot}/00-V5月度内容矩阵统一口径与字段映射.md`]
  },
  {
    code: "V5-KB-013",
    title: "published 必须有平台成功证明",
    targets: ["publication_record"],
    principle: "平台返回真实成功且存在公开 URL 后，才能写 published。",
    userImpact: "发布报表和后续渠道回传只统计真实可访问内容。",
    sourceDocs: [`${foundationRoot}/00-V5月度内容矩阵统一口径与字段映射.md`]
  },
  {
    code: "V5-KB-014",
    title: "所有写操作必须幂等、带版本和审计",
    targets: [
      "claim_extraction",
      "rule_package_activation",
      "production_pool_entry",
      "rag_ingestion",
      "matrix_approval",
      "batch_generation",
      "publish_schedule",
      "formal_publish",
      "publication_record",
      "monthly_review"
    ],
    principle: "页面、Agent、Scheduler 和脚本共用同一领域策略与写入约束。",
    userImpact: "重试和并发不会重复创建事实、草稿、排程或发布副作用。",
    sourceDocs: [`${foundationRoot}/06-最后设计Workflow-Agent调度边界/03-工具契约幂等重试补偿与并发控制.md`]
  },
  {
    code: "V5-KB-015",
    title: "月度复盘只统计真实结果",
    targets: ["monthly_review"],
    principle: "draft_created、manual_handoff_ready 和 pending_config 不计为正式发布成功。",
    userImpact: "月度复盘反映真实产出，下一月策略不会被虚假成功率误导。",
    sourceDocs: [`${foundationRoot}/00-V5月度内容矩阵统一口径与字段映射.md`]
  }
] as const satisfies readonly V5KnowledgeWorkflowRuleDefinition[];

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasItems(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function passed(rule: V5KnowledgeWorkflowRuleDefinition, message: string): V5KnowledgeWorkflowRuleResult {
  return { ...rule, passed: true, status: "success", message };
}

function failed(
  rule: V5KnowledgeWorkflowRuleDefinition,
  status: Exclude<V5KnowledgeWorkflowDecisionStatus, "success">,
  message: string,
  nextAction: string
): V5KnowledgeWorkflowRuleResult {
  return { ...rule, passed: false, status, message, nextAction };
}

function evaluateRule(
  rule: V5KnowledgeWorkflowRuleDefinition,
  target: V5KnowledgeWorkflowTarget,
  context: V5KnowledgeWorkflowContext
): V5KnowledgeWorkflowRuleResult {
  const source = context.source || {};
  const governance = context.governance || {};
  const monthly = context.monthly || {};
  const evidence = context.evidence || {};
  const runtime = context.runtime || {};
  const generation = context.generation || {};
  const publishing = context.publishing || {};
  const review = context.review || {};
  const operation = context.operation || {};

  switch (rule.code) {
    case "V5-KB-001":
      if (source.sensitiveDataChecked !== true) {
        return failed(rule, "pending_input", "尚未完成敏感资料检查。", "先执行 G0 安全扫描并记录结果。");
      }
      if (source.sensitiveDataDetected === true) {
        return failed(rule, "failed", "来源包含敏感资料，禁止继续事实抽取。", "隔离资料，完成脱敏或获得授权后重新接入。");
      }
      return passed(rule, "敏感资料检查已通过。");

    case "V5-KB-002": {
      const complete =
        source.parseStatus === "parsed" &&
        hasText(source.sourceId) &&
        hasText(source.sourceRevisionId) &&
        hasText(source.sourceLocator) &&
        hasText(source.productId) &&
        hasText(source.documentType) &&
        hasText(source.authorityLevel) &&
        ["public", "internal"].includes(source.visibility || "");
      return complete
        ? passed(rule, "来源解析、归属和追溯字段完整。")
        : failed(rule, "pending_input", "来源尚未达到事实抽取契约。", "补齐解析正文、稳定版本、原文定位、产品归属、资料类型、权威等级和可见性。");
    }

    case "V5-KB-003":
      if (operation.actorType === "agent") {
        return failed(rule, "failed", "Agent 不得激活产品表达规则包。", "创建人工审批请求，由对应业务、技术或合规负责人决定。");
      }
      if (
        operation.actorType !== "human" ||
        governance.requiredApprovalsComplete !== true ||
        !Number.isInteger(governance.approvedClaimCount) ||
        (governance.approvedClaimCount || 0) <= 0
      ) {
        return failed(rule, "pending_input", "规则包缺少人工批准或已批准事实。", "完成责任人审批，并至少绑定一条 supported 或 conditional ProductClaim。");
      }
      return passed(rule, "规则包激活由人工发起且存在已批准事实。");

    case "V5-KB-004":
      if (!Number.isInteger(governance.unresolvedBlockingConflictCount)) {
        return failed(rule, "pending_input", "尚未计算阻断冲突数量。", "运行冲突检查并保存治理结果。");
      }
      return governance.unresolvedBlockingConflictCount === 0
        ? passed(rule, "没有未解决的阻断冲突。")
        : failed(rule, "failed", `仍有 ${governance.unresolvedBlockingConflictCount} 个阻断冲突。`, "先完成人工裁决、补资料或明确降级范围。");

    case "V5-KB-005": {
      const ready =
        governance.rulePackageStatus === "active" &&
        hasText(governance.rulePackageVersionId) &&
        governance.monthlyProductionReady === true &&
        hasItems(governance.allowedContentTypes) &&
        hasItems(governance.allowedChannels) &&
        typeof governance.maxMonthlyQuota === "number" &&
        governance.maxMonthlyQuota > 0 &&
        (target !== "rag_ingestion" || hasText(governance.ragManifestId));
      return ready
        ? passed(rule, "规则包 active，月度生产范围和配额已明确。")
        : failed(rule, "pending_input", "产品尚未达到月度生产准入。", "完成人工规则包激活，并计算允许内容类型、渠道和正数月度配额。");
    }

    case "V5-KB-006": {
      const needsMatrixItem = target !== "monthly_review";
      const needsSchedule = target === "formal_publish" || target === "publication_record";
      const complete =
        hasText(monthly.monthlyPlanId) &&
        hasText(monthly.matrixVersionId) &&
        (!needsMatrixItem || hasText(monthly.matrixItemId)) &&
        (!needsSchedule || (hasText(publishing.publishScheduleId) && hasText(generation.draftVersionId)));
      return complete
        ? passed(rule, "月度计划、矩阵版本和所需矩阵项 ID 完整。")
        : failed(
            rule,
            "pending_input",
            "缺少 V5 月度稳定 ID。",
            "先建立 MonthlyPlan 与 ContentMatrixVersion；非复盘写入还需 matrixItemId，发布执行还需 publishScheduleId 与 draftVersionId。"
          );
    }

    case "V5-KB-007":
      return monthly.strategyStatus === "approved" && hasText(monthly.evidencePreviewId)
        ? passed(rule, "月度策略已批准，EvidencePreview 已准备。")
        : failed(rule, "pending_input", "策略尚未批准或 EvidencePreview 缺失。", "先完成人工策略审批，再为矩阵草稿生成 EvidencePreview。");

    case "V5-KB-008": {
      const precheck = monthly.platformExpressionPrecheck;
      const precheckPassed =
        precheck?.evidenceSupported === true &&
        precheck.bodyProvable === true &&
        precheck.roleBoundarySafe === true &&
        precheck.humanConfirmed === true;
      if (!precheckPassed) {
        return failed(rule, "pending_input", "平台表达三项检查或人工确认未完成。", "补齐标题证据、正文来源问题和角色边界，并由人工确认平台表达方案。");
      }
      if (target === "matrix_approval" && operation.actorType !== "human") {
        return failed(rule, "failed", "Agent 不得批准月度矩阵。", "提交人工矩阵审批。");
      }
      if (target !== "matrix_approval" && monthly.matrixStatus !== "approved") {
        return failed(rule, "pending_input", "月度矩阵尚未人工批准。", "批准矩阵后再冻结任务并请求批量生成。");
      }
      return passed(rule, "平台表达检查和所需人工确认已完成。");
    }

    case "V5-KB-009": {
      if (!hasText(evidence.finalEvidencePackId)) {
        return failed(rule, "pending_input", "缺少 Final EvidencePack。", "在矩阵批准后生成最终证据包。");
      }
      if (evidence.gateStatus === "generatable") {
        return passed(rule, "Final Evidence Gate 允许生成。");
      }
      if (evidence.gateStatus === "generatable_with_downgrade" && evidence.downgradeApproved === true) {
        return passed(rule, "降级范围已经人工批准，可以生成。");
      }
      return failed(rule, "failed", `Final Evidence Gate 当前为 ${evidence.gateStatus || "unknown"}。`, "补资料、完成人工复核或批准明确降级范围；不得使用 EvidencePreview 替代。");
    }

    case "V5-KB-010":
      if (target === "rag_ingestion" && runtime.embeddingConfigured !== true) {
        return failed(rule, "pending_config", "真实 Embedding 尚未配置。", "配置并验证真实 Embedding，再创建生产索引。");
      }
      if (target === "batch_generation" && runtime.providerConfigured !== true) {
        return failed(rule, "pending_config", "正式正文 Provider 尚未配置。", "配置并验证 Provider；本地预览不能作为生产结果。");
      }
      if (target === "formal_publish" && runtime.publishingPlatformConfigured !== true) {
        return failed(rule, "pending_config", "正式发布平台尚未配置。", "完成平台授权与沙箱验证，或保持 draft_only/manual_only 真实状态。");
      }
      return passed(rule, "目标环节所需真实配置可用。");

    case "V5-KB-011": {
      const ready =
        ["ai_provider", "manual_authored"].includes(generation.mode || "") &&
        generation.hardRulePassed === true &&
        generation.qualityEvaluationPassed === true &&
        hasText(generation.draftVersionId);
      return ready
        ? passed(rule, "正式稿、硬规则和质量评测均满足排程条件。")
        : failed(rule, "failed", "草稿未达到 PublishSchedule 准入。", "使用正式生成或 manual_authored 稿，补齐不可变 DraftVersion，并通过硬规则与质量评测。");
    }

    case "V5-KB-012": {
      const ready =
        publishing.capability === "formal_publish" &&
        publishing.approvalStatus === "approved" &&
        publishing.scheduleStatus === "scheduled";
      return ready
        ? passed(rule, "正式发布能力、人工确认和排程状态均有效。")
        : failed(rule, "failed", "当前发布能力或审批状态不允许正式发布。", "保持真实 capability 状态；只有 formal_publish + approved + scheduled 可执行平台发布。");
    }

    case "V5-KB-013": {
      const published = publishing.externalResult === "success" && hasText(publishing.publishedUrl);
      return published
        ? passed(rule, "平台成功结果和公开 URL 均已确认。")
        : failed(rule, "pending_input", "缺少真实平台成功结果或公开 URL。", "保留 running/failed/manual_handoff_ready 等真实状态，待平台确认后再写 published。");
    }

    case "V5-KB-014": {
      const complete =
        hasText(operation.idempotencyKey) &&
        Number.isInteger(operation.expectedVersion) &&
        (operation.expectedVersion || 0) >= 0 &&
        hasText(operation.actorId) &&
        hasText(operation.auditReason);
      return complete
        ? passed(rule, "写操作包含幂等键、预期版本、操作者和审计原因。")
        : failed(rule, "pending_input", "写操作缺少幂等、版本或审计字段。", "补齐 idempotencyKey、expectedVersion、actorId 和 auditReason 后重试。");
    }

    case "V5-KB-015": {
      const truthful =
        review.usesRealMetricsOnly === true &&
        review.countsDraftCreatedAsPublished === false &&
        review.countsManualHandoffAsPublished === false &&
        review.countsPendingConfigAsPublished === false;
      return truthful
        ? passed(rule, "月度复盘只统计真实生成、发布和回传状态。")
        : failed(rule, "failed", "月度复盘包含伪发布成功口径。", "排除 draft_created、manual_handoff_ready 和 pending_config，再重新聚合指标。");
    }

    default:
      return failed(rule, "failed", `规则 ${rule.code} 尚未实现。`, "补齐规则实现和回归测试后再启用。");
  }
}

const statusPriority: Record<V5KnowledgeWorkflowDecisionStatus, number> = {
  success: 0,
  pending_input: 1,
  pending_config: 2,
  failed: 3
};

export function evaluateV5KnowledgeWorkflow(
  target: V5KnowledgeWorkflowTarget,
  context: V5KnowledgeWorkflowContext
): V5KnowledgeWorkflowDecision {
  const results = V5_KNOWLEDGE_WORKFLOW_RULES.filter((rule) =>
    rule.targets.some((ruleTarget: V5KnowledgeWorkflowTarget) => ruleTarget === target)
  ).map((rule) =>
    evaluateRule(rule, target, context)
  );
  const failures = results.filter((result) => !result.passed);
  const status = failures.reduce<V5KnowledgeWorkflowDecisionStatus>(
    (current, result) => (statusPriority[result.status] > statusPriority[current] ? result.status : current),
    "success"
  );

  return {
    ok: failures.length === 0,
    target,
    status,
    results,
    failures,
    nextActions: Array.from(new Set(failures.map((failure) => failure.nextAction).filter((item): item is string => Boolean(item))))
  };
}
