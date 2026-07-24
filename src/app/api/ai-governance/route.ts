import { canViewAiGovernance } from "@/lib/permissions";
import { readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const editReasonCategoryLabels = {
  evidence_missing: "证据不足",
  product_expression: "产品表达",
  structure_rewrite: "结构重写",
  channel_tone: "渠道语气",
  qa_risk_handling: "质检风险处理",
  style_polish: "文字润色",
  uncategorized: "未分类"
} as const;

const keepRiskReasonCategoryLabels = {
  false_positive: "质检误报",
  evidence_added: "已补证据",
  business_exception: "业务例外",
  source_quote: "原文引用",
  uncategorized: "未分类"
} as const;

function getEditReasonCategory(action: { type: string; reason?: string }) {
  const text = `${action.type} ${action.reason || ""}`.toLowerCase();

  if (action.type === "delete_risk_segment" || action.type === "keep_risk_segment") return "qa_risk_handling";
  if (text.includes("证据") || text.includes("案例") || text.includes("数据") || text.includes("官网") || text.includes("链接") || text.includes("资料") || text.includes("chunk")) return "evidence_missing";
  if (text.includes("产品") || text.includes("表达") || text.includes("承诺") || text.includes("越界") || text.includes("边界") || text.includes("定位")) return "product_expression";
  if (text.includes("结构") || text.includes("重写") || text.includes("大纲") || text.includes("段落") || text.includes("逻辑")) return "structure_rewrite";
  if (text.includes("渠道") || text.includes("语气") || text.includes("公众号") || text.includes("小红书") || text.includes("知乎") || text.includes("csdn")) return "channel_tone";
  if (action.type === "ai_rewrite_segment" || text.includes("风险") || text.includes("质检") || text.includes("改写")) return "qa_risk_handling";
  if (text.includes("润色") || text.includes("措辞") || text.includes("可读") || text.includes("标题") || text.includes("语句")) return "style_polish";

  return "uncategorized";
}

function getAuditModule(event: string) {
  if (event.includes("draft") || event.includes("content_task")) return { module: "draft", moduleLabel: "正文生成 / 草稿" };
  if (event.includes("geo")) return { module: "geo", moduleLabel: "GEO 可见度" };
  if (event.includes("weekly") || event.includes("next_week")) return { module: "weekly", moduleLabel: "周计划 / 周报" };
  if (event.includes("prompt")) return { module: "prompt", moduleLabel: "Prompt 配置" };
  if (event.includes("pipeline")) return { module: "pipeline", moduleLabel: "自动 Pipeline" };
  if (event.includes("knowledge") || event.includes("product_expression")) return { module: "knowledge", moduleLabel: "知识库 / 产品表达" };
  if (event.includes("distilled")) return { module: "distilled", moduleLabel: "蒸馏词" };
  if (event.includes("publish") || event.includes("channel_metrics")) return { module: "publish", moduleLabel: "发布 / 数据回传" };
  return { module: "system", moduleLabel: "系统事件" };
}

function getAuditStatus(event: string, message: string) {
  const text = `${event} ${message}`.toLowerCase();

  if (text.includes("failed") || text.includes("failure") || text.includes("失败")) return "failed";
  if (text.includes("pending_config") || text.includes("missing") || text.includes("缺失") || text.includes("待配置")) return "pending_config";
  return "success";
}

function getPipelineStepModule(stepName: string) {
  if (stepName === "sync_blog") return { module: "blog", moduleLabel: "官网博客同步" };
  if (stepName === "import_log") return { module: "bot_log", moduleLabel: "AI 访问日志" };
  if (stepName === "import_channel_metrics") return { module: "publish", moduleLabel: "数据回传" };
  if (stepName === "read_weekly_report") return { module: "weekly", moduleLabel: "周报复盘" };
  return { module: "pipeline", moduleLabel: "自动 Pipeline" };
}

function buildCallLogs(state: ReturnType<typeof readWorkbenchState>) {
  const auditRows = state.auditLog.map((item) => {
    const moduleInfo = getAuditModule(item.event);

    return {
      id: `audit-${item.id}`,
      source: "audit_log",
      event: item.event,
      ...moduleInfo,
      provider: undefined,
      model: undefined,
      promptVersion: undefined,
      inputSummary: `系统事件：${item.event}`,
      outputStatus: getAuditStatus(item.event, item.message),
      outputSummary: item.message,
      failureReasons: [],
      fallbackTriggered: false,
      createdAt: item.createdAt
    };
  });
  const draftRows = state.drafts.map((draft) => {
    const productExpressionRuleSummary = draft.generationSource?.productExpressionRuleVersion
      ? `产品表达规则包：${draft.generationSource.productExpressionRuleSource || "未记录来源"} ${draft.generationSource.productExpressionRuleVersion}`
      : "产品表达规则包：未记录";

    return {
      id: `draft-source-${draft.id}`,
      source: "draft_source",
      event: "draft_generation",
      module: "draft",
      moduleLabel: "正文生成",
      provider: draft.generationSource?.provider,
      model: draft.generationSource?.model,
      promptVersion: draft.generationSource?.promptProfile,
      productExpressionRuleVersion: draft.generationSource?.productExpressionRuleVersion,
      productExpressionRuleSource: draft.generationSource?.productExpressionRuleSource,
      inputSummary: `${draft.title}；${productExpressionRuleSummary}`,
      outputStatus: draft.generationSource?.status || "success",
      outputSummary: draft.generationSource?.mode === "ai_provider" ? "通过真实模型接入生成正文。" : "使用本地规则生成，必要时保留本地兜底稿。",
      failureReasons: draft.generationSource?.failureReasons || [],
      fallbackTriggered: Boolean(draft.generationSource?.fallbackTriggered),
      createdAt: draft.generationSource?.generatedAt || draft.updatedAt
    };
  });
  const pipelineRows = state.pipelineRuns.flatMap((run) =>
    run.steps.map((step) => {
      const moduleInfo = getPipelineStepModule(step.name);

      return {
        id: `pipeline-${run.id}-${step.name}`,
        source: "pipeline_run",
        event: `pipeline_${step.name}`,
        ...moduleInfo,
        provider: undefined,
        model: undefined,
        promptVersion: undefined,
        inputSummary: `Pipeline 周期：${run.week}`,
        outputStatus: step.status === "success" ? "success" : step.status === "pending_config" ? "pending_config" : "failed",
        outputSummary: step.message,
        failureReasons: step.missingConfig?.length
          ? [
              {
                code: "missing_config",
                label: "配置缺失",
                severity: "blocker",
                message: `缺少配置：${step.missingConfig.join(", ")}`,
                nextAction: "补齐配置后重试该模块。"
              }
            ]
          : [],
        fallbackTriggered: false,
        createdAt: run.finishedAt
      };
    })
  );

  return [...draftRows, ...pipelineRows, ...auditRows]
    .filter((item) => item.createdAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 200);
}

export function GET() {
  const state = readWorkbenchState();
  const canViewFullGovernance = canViewAiGovernance(state.workspaceSetting.currentRole);
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const publishRecordByDraftId = new Map(state.publishRecords.map((record) => [record.draftId, record]));
  const draftSources = state.drafts.map((draft) => {
    const task = taskById.get(draft.taskId);
    const publishRecord = publishRecordByDraftId.get(draft.id);
    const editActions = draft.qaResult.editActions || [];
    const rewriteActionCount = editActions.filter((item) => item.type === "ai_rewrite_segment").length;
    const deleteRiskSegmentCount = editActions.filter((item) => item.type === "delete_risk_segment").length;
    const keepRiskSegmentCount = editActions.filter((item) => item.type === "keep_risk_segment").length;
    const manualEditActionCount = editActions.filter((item) => item.type === "manual_edit").length;
    const diffActions = editActions.filter((item) => typeof item.changedRatio === "number" && Number.isFinite(item.changedRatio));
    const manualDiffActions = diffActions.filter((item) => item.type === "manual_edit");
    const rewriteDiffActions = diffActions.filter((item) => item.type === "ai_rewrite_segment");
    const totalChangedCharacterCount = diffActions.reduce((sum, item) => sum + (item.changedCharacterCount || 0), 0);
    const manualEditChangedCharacterCount = manualDiffActions.reduce((sum, item) => sum + (item.changedCharacterCount || 0), 0);
    const rewriteChangedCharacterCount = rewriteDiffActions.reduce((sum, item) => sum + (item.changedCharacterCount || 0), 0);
    const maxChangedRatio = diffActions.length ? Math.max(...diffActions.map((item) => item.changedRatio || 0)) : 0;
    const averageChangedRatio = diffActions.length ? diffActions.reduce((sum, item) => sum + (item.changedRatio || 0), 0) / diffActions.length : 0;
    const manualEditAverageChangedRatio = manualDiffActions.length
      ? manualDiffActions.reduce((sum, item) => sum + (item.changedRatio || 0), 0) / manualDiffActions.length
      : 0;
    const qaIssueRuleCounts = new Map<string, { rule: string; severity: NonNullable<(typeof draft.qaResult.issues)>[number]["severity"]; count: number }>();
    const editReasonCounts = new Map<string, { reason: string; count: number }>();
    const editReasonCategoryCounts = new Map<string, { code: string; label: string; count: number }>();
    const keepRiskReasonCategoryCounts = new Map<string, { code: string; label: string; count: number }>();

    for (const issue of draft.qaResult.issues || []) {
      const key = `${issue.severity}:${issue.rule}`;
      const current = qaIssueRuleCounts.get(key) || { rule: issue.rule, severity: issue.severity, count: 0 };
      current.count += 1;
      qaIssueRuleCounts.set(key, current);
    }

    for (const action of editActions) {
      const reason =
        action.reason?.trim() ||
        (action.type === "manual_edit"
          ? "人工修改未填写原因"
          : action.type === "ai_rewrite_segment"
            ? "AI 局部改写"
            : action.type === "delete_risk_segment"
              ? "删除风险片段"
              : action.type === "keep_risk_segment"
                ? "保留高风险片段"
                : "重新运行质检");
      const current = editReasonCounts.get(reason) || { reason, count: 0 };
      current.count += 1;
      editReasonCounts.set(reason, current);

      const categoryCode = getEditReasonCategory(action);
      const category = editReasonCategoryCounts.get(categoryCode) || { code: categoryCode, label: editReasonCategoryLabels[categoryCode], count: 0 };
      category.count += 1;
      editReasonCategoryCounts.set(categoryCode, category);

      if (action.type === "keep_risk_segment") {
        const keepReasonCategoryCode =
          action.keepReasonCategory && action.keepReasonCategory in keepRiskReasonCategoryLabels ? action.keepReasonCategory : "uncategorized";
        const keepReasonCategory = keepRiskReasonCategoryCounts.get(keepReasonCategoryCode) || {
          code: keepReasonCategoryCode,
          label: keepRiskReasonCategoryLabels[keepReasonCategoryCode],
          count: 0
        };
        keepReasonCategory.count += 1;
        keepRiskReasonCategoryCounts.set(keepReasonCategoryCode, keepReasonCategory);
      }
    }

    return {
      id: draft.id,
      taskId: draft.taskId,
      title: draft.title,
      channel: task?.channel,
      product: task?.product,
      contentType: task?.contentType,
      primaryDistilledTerm: task?.primaryDistilledTerm,
      mode: draft.generationSource?.mode || "local_rule",
      provider: draft.generationSource?.provider,
      model: draft.generationSource?.model,
      promptProfile: draft.generationSource?.promptProfile,
      productExpressionRuleVersion: draft.generationSource?.productExpressionRuleVersion,
      productExpressionRuleSource: draft.generationSource?.productExpressionRuleSource,
      fallbackTriggered: Boolean(draft.generationSource?.fallbackTriggered),
      failureReasons: draft.generationSource?.failureReasons || [],
      editActionCount: editActions.length,
      manualEditActionCount,
      rewriteActionCount,
      deleteRiskSegmentCount,
      keepRiskSegmentCount,
      qaAcceptedActionCount: rewriteActionCount + deleteRiskSegmentCount,
      qaPartialAcceptedActionCount: manualEditActionCount,
      qaIgnoredActionCount: keepRiskSegmentCount,
      qaSuspectedFalsePositiveCount: keepRiskSegmentCount,
      qaSuspectedMissCount: draft.qaResult.passed ? manualEditActionCount : 0,
      totalChangedCharacterCount,
      manualEditChangedCharacterCount,
      rewriteChangedCharacterCount,
      maxChangedRatio: Number(maxChangedRatio.toFixed(4)),
      averageChangedRatio: Number(averageChangedRatio.toFixed(4)),
      manualEditAverageChangedRatio: Number(manualEditAverageChangedRatio.toFixed(4)),
      heavyEditCount: maxChangedRatio >= 0.3 ? 1 : 0,
      qaIssueRuleSummary: [...qaIssueRuleCounts.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
      editReasonSummary: [...editReasonCounts.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      editReasonCategorySummary: [...editReasonCategoryCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      keepRiskReasonCategorySummary: [...keepRiskReasonCategoryCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      qaPassed: draft.qaResult.passed,
      qaBlockerCount: draft.qaResult.blockers.length,
      qaWarningCount: draft.qaResult.warnings.length,
      publishStatus: publishRecord?.publishStatus,
      dataReturned: Boolean(publishRecord?.channelMetrics),
      status: draft.generationSource?.status || "success",
      generatedAt: draft.generationSource?.generatedAt || draft.updatedAt
    };
  });

  return NextResponse.json({
    ok: true,
    data: {
      promptTemplates: canViewFullGovernance ? state.promptVersions : [],
      auditLog: canViewFullGovernance ? state.auditLog : [],
      pipelineRuns: canViewFullGovernance ? state.pipelineRuns : [],
      draftSources: canViewFullGovernance ? draftSources : [],
      callLogs: canViewFullGovernance ? buildCallLogs(state) : [],
      access: {
        role: state.workspaceSetting.currentRole,
        canViewFullGovernance,
        message: canViewFullGovernance ? "当前角色可查看 AI 治理摘要。" : "当前角色只显示受限入口；模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"
      }
    }
  });
}
