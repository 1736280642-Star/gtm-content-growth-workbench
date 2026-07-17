import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = parseArgs();
const baseUrl = (typeof args["base-url"] === "string" ? args["base-url"] : process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const failures = [];
const results = [];

if (args.help || args.h) {
  printJson({
    script: "smoke-workflow",
    usage: "node scripts/smoke-workflow.mjs [--base-url http://127.0.0.1:3000]"
  });
  process.exit(0);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf("=");

    if (equalsIndex >= 0) {
      parsed[rawKey.slice(0, equalsIndex)] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }

  return parsed;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function request(pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : {};

  return {
    httpStatus: response.status,
    ok: response.ok,
    body
  };
}

function assertCondition(name, condition, detail) {
  const result = {
    name,
    ok: Boolean(condition),
    detail
  };

  results.push(result);

  if (!result.ok) {
    failures.push(result);
  }
}

async function main() {
  const initial = await request("/api/workbench-state");
  assertCondition("workbench_state_available", initial.ok && Boolean(initial.body.state), `http ${initial.httpStatus}`);

  const runtime = await request("/api/runtime-config/status");
  assertCondition("runtime_config_available", runtime.ok && Array.isArray(runtime.body.capabilities), `http ${runtime.httpStatus}`);

  const configDiagnostics = await request("/api/config-diagnostics");
  assertCondition(
    "config_diagnostics_available",
    configDiagnostics.ok && Array.isArray(configDiagnostics.body.results),
    configDiagnostics.body.message || `http ${configDiagnostics.httpStatus}`
  );

  const preparedRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "workbench_operator"
    })
  });
  assertCondition("workspace_role_prepare", preparedRole.ok && preparedRole.body.data?.workspaceSetting?.currentRole === "workbench_operator", preparedRole.body.message || `http ${preparedRole.httpStatus}`);

  const governanceBefore = await request("/api/ai-governance");
  const bodyPromptBefore = governanceBefore.body.data?.promptTemplates?.find((item) => item.id === "batch_body_generation");
  assertCondition(
    "ai_governance_prompt_versions_available",
    governanceBefore.ok && Boolean(bodyPromptBefore?.version),
    bodyPromptBefore?.version || `http ${governanceBefore.httpStatus}`
  );
  assertCondition(
    "ai_governance_call_logs_available",
    governanceBefore.ok && Array.isArray(governanceBefore.body.data?.callLogs),
    `${governanceBefore.body.data?.callLogs?.length || 0} call logs`
  );

  const promptVersionDetail = await request("/api/prompt-versions/batch_body_generation");
  assertCondition(
    "prompt_version_detail",
    promptVersionDetail.ok && promptVersionDetail.body.data?.promptVersion?.id === "batch_body_generation",
    promptVersionDetail.body.message || `http ${promptVersionDetail.httpStatus}`
  );

  const promptVersionRollback = await request("/api/prompt-versions/batch_body_generation", {
    method: "POST",
    body: JSON.stringify({
      action: "rollback",
      reason: "smoke workflow validates prompt rollback."
    })
  });
  assertCondition(
    "prompt_version_rollback",
    promptVersionRollback.ok &&
      promptVersionRollback.body.data?.promptVersion?.status === "rolled_back" &&
      promptVersionRollback.body.data?.promptVersion?.version === bodyPromptBefore?.previousVersion,
    promptVersionRollback.body.message || `http ${promptVersionRollback.httpStatus}`
  );

  const restrictedRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "content_publisher"
    })
  });
  assertCondition("workspace_role_restrict", restrictedRole.ok && restrictedRole.body.data?.workspaceSetting?.currentRole === "content_publisher", restrictedRole.body.message || `http ${restrictedRole.httpStatus}`);

  const restrictedGovernance = await request("/api/ai-governance");
  assertCondition(
    "ai_governance_restricted_by_role",
    restrictedGovernance.ok &&
      restrictedGovernance.body.data?.access?.canViewFullGovernance === false &&
      (restrictedGovernance.body.data?.auditLog?.length || 0) === 0 &&
      (restrictedGovernance.body.data?.callLogs?.length || 0) === 0,
    restrictedGovernance.body.data?.access?.message || `http ${restrictedGovernance.httpStatus}`
  );

  const restrictedPromptVersionDetail = await request("/api/prompt-versions/batch_body_generation");
  assertCondition(
    "prompt_version_detail_restricted",
    restrictedPromptVersionDetail.httpStatus === 403 && restrictedPromptVersionDetail.body.message?.includes("无权"),
    restrictedPromptVersionDetail.body.message || `http ${restrictedPromptVersionDetail.httpStatus}`
  );

  const restrictedProductExpressionRule = await request("/api/knowledge-bases/kb-001/product-expression", {
    method: "POST",
    body: JSON.stringify({
      action: "regenerate"
    })
  });
  assertCondition(
    "product_expression_rule_restricted_by_role",
    restrictedProductExpressionRule.httpStatus === 403,
    restrictedProductExpressionRule.body.message || `http ${restrictedProductExpressionRule.httpStatus}`
  );

  const savedSetting = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "workbench_operator",
      defaultWeeklyDays: 1,
      defaultDailyCount: 1,
      enabledChannels: ["wechat"],
      enabledProducts: ["joto_brand"],
      finalReviewMode: "manual_review",
      geoPlatforms: ["ChatGPT", "DeepSeek"],
      logMode: "demo_csv"
    })
  });
  assertCondition("workspace_setting_save", savedSetting.ok && savedSetting.body.data?.workspaceSetting?.defaultWeeklyDays === 1, savedSetting.body.message || `http ${savedSetting.httpStatus}`);

  const createdKnowledgeBase = await request("/api/knowledge-bases", {
    method: "POST",
    body: JSON.stringify({
      name: "Smoke 知识库",
      type: "brand",
      sourceType: "manual",
      status: "enabled",
      usageScope: "smoke workflow validation",
      productExpressionSource: true,
      contentPreview: "Smoke 知识库用于验证统一导入、内容预览、规则切片和 Chunk 预览。JOTO 是 Dify 企业版服务商。"
    })
  });
  assertCondition(
    "knowledge_base_create",
    createdKnowledgeBase.ok && Boolean(createdKnowledgeBase.body.data?.knowledgeBase?.id) && (createdKnowledgeBase.body.data?.knowledgeBase?.chunks?.length || 0) >= 1,
    createdKnowledgeBase.body.message || `http ${createdKnowledgeBase.httpStatus}`
  );

  const smokeKnowledgeBase = createdKnowledgeBase.body.data?.knowledgeBase;
  const patchedKnowledgeBase = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Smoke 知识库 已编辑",
      status: "disabled"
    })
  });
  assertCondition(
    "knowledge_base_patch",
    patchedKnowledgeBase.ok && patchedKnowledgeBase.body.data?.knowledgeBase?.status === "disabled",
    patchedKnowledgeBase.body.message || `http ${patchedKnowledgeBase.httpStatus}`
  );

  const regeneratedRuleDraft = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}/product-expression`, {
    method: "POST",
    body: JSON.stringify({ action: "regenerate" })
  });
  assertCondition(
    "product_expression_rule_regenerate",
    regeneratedRuleDraft.ok && regeneratedRuleDraft.body.data?.knowledgeBase?.productExpressionRuleDraft?.status === "draft",
    regeneratedRuleDraft.body.message || `http ${regeneratedRuleDraft.httpStatus}`
  );

  const activatedRuleDraft = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}/product-expression`, {
    method: "POST",
    body: JSON.stringify({ action: "activate" })
  });
  assertCondition(
    "product_expression_rule_activate",
    activatedRuleDraft.ok && activatedRuleDraft.body.data?.knowledgeBase?.productExpressionRuleDraft?.status === "active",
    activatedRuleDraft.body.message || `http ${activatedRuleDraft.httpStatus}`
  );

  const regeneratedRuleDraftForDiscard = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}/product-expression`, {
    method: "POST",
    body: JSON.stringify({ action: "regenerate" })
  });
  assertCondition(
    "product_expression_rule_regenerate_for_discard",
    regeneratedRuleDraftForDiscard.ok &&
      regeneratedRuleDraftForDiscard.body.data?.knowledgeBase?.productExpressionRuleDraft?.status === "draft" &&
      Boolean(regeneratedRuleDraftForDiscard.body.data?.knowledgeBase?.productExpressionRuleDraft?.previousSnapshot),
    regeneratedRuleDraftForDiscard.body.message || `http ${regeneratedRuleDraftForDiscard.httpStatus}`
  );

  const discardedRuleDraft = await request(`/api/knowledge-bases/${smokeKnowledgeBase.id}/product-expression`, {
    method: "POST",
    body: JSON.stringify({ action: "discard" })
  });
  assertCondition(
    "product_expression_rule_discard",
    discardedRuleDraft.ok && discardedRuleDraft.body.data?.knowledgeBase?.productExpressionRuleDraft?.status === "active",
    discardedRuleDraft.body.message || `http ${discardedRuleDraft.httpStatus}`
  );

  const knowledgeBaseAutoPool = await request("/api/distilled-terms/auto-pool", {
    method: "POST",
    body: JSON.stringify({ source: "knowledge_base" })
  });
  const knowledgeBaseAutoPoolCount = (knowledgeBaseAutoPool.body.data?.createdCount || 0) + (knowledgeBaseAutoPool.body.data?.reusedCount || 0);
  assertCondition(
    "distilled_term_knowledge_base_auto_pool",
    knowledgeBaseAutoPool.ok && knowledgeBaseAutoPool.body.data?.source === "knowledge_base" && knowledgeBaseAutoPoolCount >= 1,
    knowledgeBaseAutoPool.body.message || `http ${knowledgeBaseAutoPool.httpStatus}`
  );

  const lowConfidenceDistilledTerm = await request("/api/distilled-terms/extract", {
    method: "POST",
    body: JSON.stringify({ question: "这周午饭吃什么更方便？" })
  });
  assertCondition(
    "distilled_term_low_confidence_discarded",
    lowConfidenceDistilledTerm.ok && lowConfidenceDistilledTerm.body.data?.discarded === true && lowConfidenceDistilledTerm.body.data?.confidence < 0.65,
    lowConfidenceDistilledTerm.body.message || `http ${lowConfidenceDistilledTerm.httpStatus}`
  );

  const ruleDraftDistilledTerm = await request("/api/distilled-terms/extract", {
    method: "POST",
    body: JSON.stringify({ question: "我担心企业内部的知识库会泄露用户真实数据造成提示词越狱，有什么解决方案？" })
  });
  const distilledRuleDraft = ruleDraftDistilledTerm.body.data?.ruleDraft;
  assertCondition(
    "distilled_term_rule_draft_created",
    ruleDraftDistilledTerm.ok && distilledRuleDraft?.mappedTerm === "知识库数据泄露防护" && distilledRuleDraft?.status === "pending",
    ruleDraftDistilledTerm.body.message || `http ${ruleDraftDistilledTerm.httpStatus}`
  );

  const activatedDistilledRuleDraft = await request(`/api/distilled-terms/rule-drafts/${distilledRuleDraft?.id || "missing"}`, {
    method: "PATCH"
  });
  assertCondition(
    "distilled_term_rule_draft_activated",
    activatedDistilledRuleDraft.ok &&
      activatedDistilledRuleDraft.body.data?.ruleDraft?.status === "active" &&
      activatedDistilledRuleDraft.body.data?.term?.term === "知识库数据泄露防护",
    activatedDistilledRuleDraft.body.message || `http ${activatedDistilledRuleDraft.httpStatus}`
  );

  const ruleBackedDistilledTerm = await request("/api/distilled-terms/extract", {
    method: "POST",
    body: JSON.stringify({ question: "企业 RAG 知识库如何避免客户数据泄露？" })
  });
  assertCondition(
    "distilled_term_active_rule_auto_pool",
    ruleBackedDistilledTerm.ok &&
      ruleBackedDistilledTerm.body.data?.term?.term === "知识库数据泄露防护" &&
      ruleBackedDistilledTerm.body.data?.term?.generationMode === "search_question",
    ruleBackedDistilledTerm.body.message || `http ${ruleBackedDistilledTerm.httpStatus}`
  );

  const extractedDistilledTerm = await request("/api/distilled-terms/extract", {
    method: "POST",
    body: JSON.stringify({ question: "如何让 AI 回答里更多引用官网信源？" })
  });
  const smokeDistilledTerm = extractedDistilledTerm.body.data?.term;
  assertCondition(
    "distilled_term_search_question_auto_pool",
    extractedDistilledTerm.ok &&
      smokeDistilledTerm?.term === "官网信源" &&
      smokeDistilledTerm?.generationMode === "search_question" &&
      (smokeDistilledTerm?.confidence || 0) >= 0.65,
    extractedDistilledTerm.body.message || `http ${extractedDistilledTerm.httpStatus}`
  );

  const unsupportedDistilledTermAction = await request(`/api/distilled-terms/${smokeDistilledTerm?.id || "missing"}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "delete" })
  });
  assertCondition(
    "distilled_term_patch_rejects_unsupported_action",
    unsupportedDistilledTermAction.httpStatus === 400 && unsupportedDistilledTermAction.body.message === "不支持的蒸馏词操作。",
    unsupportedDistilledTermAction.body.message || `http ${unsupportedDistilledTermAction.httpStatus}`
  );

  const archivedDistilledTerm = await request(`/api/distilled-terms/${smokeDistilledTerm?.id || "missing"}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "archive" })
  });
  assertCondition(
    "distilled_term_archive",
    archivedDistilledTerm.ok && archivedDistilledTerm.body.data?.term?.status === "watching" && Boolean(archivedDistilledTerm.body.data?.term?.archivedAt),
    archivedDistilledTerm.body.message || `http ${archivedDistilledTerm.httpStatus}`
  );

  const deletedDistilledTerm = await request(`/api/distilled-terms/${smokeDistilledTerm?.id || "missing"}`, {
    method: "DELETE"
  });
  assertCondition(
    "distilled_term_delete",
    deletedDistilledTerm.ok && deletedDistilledTerm.body.data?.term?.status === "disabled" && deletedDistilledTerm.body.data?.term?.validationStatus === "disabled",
    deletedDistilledTerm.body.message || `http ${deletedDistilledTerm.httpStatus}`
  );

  const emptyPublishMatrix = Array.from({ length: 7 }, (_, index) => ({
    date: `2030-01-${String(index + 7).padStart(2, "0")}`,
    weekday: `smoke-${index + 1}`,
    plannedCount: 0,
    paused: true,
    locked: false,
    source: "manual"
  }));
  const blockedEmptyWeeklyPlan = await request("/api/weekly-plans/generate", {
    method: "POST",
    body: JSON.stringify({
      weekStart: "2030-01-07",
      days: 1,
      dailyCount: 0,
      publishMatrix: emptyPublishMatrix,
      channels: ["wechat"]
    })
  });
  assertCondition(
    "weekly_plan_publish_matrix_empty_guard",
    !blockedEmptyWeeklyPlan.ok &&
      blockedEmptyWeeklyPlan.httpStatus === 400 &&
      blockedEmptyWeeklyPlan.body.data?.matrixIssues?.some((issue) => issue.code === "empty_total" && issue.level === "error"),
    blockedEmptyWeeklyPlan.body.message || `http ${blockedEmptyWeeklyPlan.httpStatus}`
  );

  const activeWeekStart = initial.body.state?.weeklyPlan?.weekStart || "2030-01-07";
  const activeWeekStartDate = new Date(`${activeWeekStart}T00:00:00.000Z`);
  const savedPublishMatrix = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(activeWeekStartDate);
    date.setUTCDate(activeWeekStartDate.getUTCDate() + index);

    return {
      date: date.toISOString().slice(0, 10),
      weekday: `smoke-${index + 1}`,
      plannedCount: index === 0 ? 2 : index === 1 ? 1 : 0,
      paused: index > 1,
      locked: index === 0,
      source: index === 0 ? "manual" : "ai_suggested"
    };
  });
  const savedWeeklyPlanMatrix = await request(`/api/weekly-plans/${initial.body.state?.weeklyPlan?.id || "weekly-plan-current"}`, {
    method: "PATCH",
    body: JSON.stringify({
      publishMatrix: savedPublishMatrix,
      targetTotalCount: 3,
      channels: ["wechat"],
      products: ["joto_brand"]
    })
  });
  assertCondition(
    "weekly_plan_publish_matrix_save",
    savedWeeklyPlanMatrix.ok &&
      savedWeeklyPlanMatrix.body.data?.weeklyPlan?.targetTotalCount === 3 &&
      savedWeeklyPlanMatrix.body.data?.weeklyPlan?.publishMatrix?.some((item) => item.locked && item.plannedCount === 2),
    savedWeeklyPlanMatrix.body.message || `http ${savedWeeklyPlanMatrix.httpStatus}`
  );

  const generatedPlan = await request("/api/weekly-plans/generate", {
    method: "POST",
    body: JSON.stringify({
      days: 1,
      dailyCount: 4,
      channels: ["wechat"],
      products: ["joto_brand", "weike_guardrails"],
      productPlans: [
        { product: "joto_brand", weeklyQuota: 2, channels: ["wechat"], knowledgeBaseIds: ["kb-001", "kb-003"], enabled: true },
        { product: "weike_guardrails", weeklyQuota: 2, channels: ["wechat"], enabled: true }
      ],
      generationMode: "replace_all"
    })
  });
  assertCondition(
    "weekly_plan_generate",
    generatedPlan.ok &&
      generatedPlan.body.tasks?.length === 4 &&
      generatedPlan.body.weeklyPlan?.productPlans?.reduce((sum, item) => sum + item.weeklyQuota, 0) === 4,
    generatedPlan.body.message || `http ${generatedPlan.httpStatus}`
  );
  assertCondition(
    "weekly_plan_product_group_multiple_knowledge_bases",
    generatedPlan.ok &&
      generatedPlan.body.weeklyPlan?.productPlans?.some((item) => item.product === "joto_brand" && item.knowledgeBaseIds?.length === 2) &&
      generatedPlan.body.tasks?.some((item) => item.product === "joto_brand" && item.knowledgeBaseIds?.includes("kb-001") && item.knowledgeBaseIds?.includes("kb-003")),
    generatedPlan.body.message || "product group did not preserve multiple knowledge base bindings"
  );
  assertCondition(
    "weekly_plan_generation_source_summary",
    generatedPlan.ok &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "knowledge_base") &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "product_expression") &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "distilled_terms") &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "geo_gap") &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "blog_diagnosis") &&
      generatedPlan.body.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "weekly_report"),
    generatedPlan.body.message || "missing weekly plan generation source summary"
  );
  assertCondition(
    "weekly_plan_task_title_source_attribution",
    generatedPlan.ok &&
      generatedPlan.body.tasks?.some(
        (item) =>
          item.titleSourceAttributions?.some((source) => source.key === "publish_matrix") &&
          item.titleSourceAttributions?.some((source) => source.key === "system_rule") &&
          item.titleSourceAttributions?.some((source) => ["distilled_terms", "knowledge_base", "geo_gap", "blog_diagnosis", "weekly_report"].includes(source.key))
      ),
    generatedPlan.body.message || "missing task title source attribution"
  );

  const taskToDelete = generatedPlan.body.tasks?.[0];
  const task = generatedPlan.body.tasks?.[1];
  const riskAcceptedTask = generatedPlan.body.tasks?.[2];
  const rejectedPoolTask = generatedPlan.body.tasks?.[3];
  assertCondition("task_created", Boolean(task?.id), task?.id || "missing task id");
  assertCondition("risk_acceptance_task_created", Boolean(riskAcceptedTask?.id), riskAcceptedTask?.id || "missing risk acceptance task id");
  assertCondition("rejected_pool_task_created", Boolean(rejectedPoolTask?.id), rejectedPoolTask?.id || "missing rejection task id");

  const lowConfidenceTask = await request(`/api/content-tasks/${taskToDelete.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: taskToDelete.title,
      confidence: 0.5
    })
  });
  const blockedBatchConfirm = await request("/api/content-tasks/confirm", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [taskToDelete.id],
      mode: "batch"
    })
  });
  assertCondition(
    "content_task_batch_confirm_review_guard",
      lowConfidenceTask.ok &&
      !blockedBatchConfirm.ok &&
      blockedBatchConfirm.body.data?.confirmed === 0 &&
      blockedBatchConfirm.body.data?.reviewRequired?.some((item) => item.taskId === taskToDelete.id && item.reasons?.some((reason) => reason.includes("自动确认阈值"))),
    blockedBatchConfirm.body.message || `http ${blockedBatchConfirm.httpStatus}`
  );

  const deletedTask = await request(`/api/content-tasks/${taskToDelete.id}`, { method: "DELETE" });
  assertCondition("content_task_delete", deletedTask.ok && !deletedTask.body.data?.tasks?.some((item) => item.id === taskToDelete.id), deletedTask.body.message || `http ${deletedTask.httpStatus}`);

  const safeConfirmTask = await request(`/api/content-tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: task.title,
      confidence: 0.9,
      officialLinkTarget: "https://jotoai.com",
      primaryDistilledTerm: "Dify 企业版服务商",
      sourceProblem: "企业如何判断 Dify 服务商是否具备长期交付能力？",
      riskNote: "暂无风险"
    })
  });
  const confirmedTask = await request("/api/content-tasks/confirm", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [task.id]
    })
  });
  assertCondition("content_task_confirm", safeConfirmTask.ok && confirmedTask.ok && confirmedTask.body.data?.confirmed === 1, confirmedTask.body.message || `http ${confirmedTask.httpStatus}`);

  const blockedBatchGenerateWithoutEvidence = await request("/api/content-tasks/batch-generate", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [task.id],
      requireEvidence: true,
      evidenceByTaskId: {
        [task.id]: {
          selectedChunkIds: ["missing-smoke-chunk"],
          missingEvidence: ["smoke 缺少正文生成证据"]
        }
      }
    })
  });
  assertCondition(
    "content_task_batch_generate_requires_evidence",
    !blockedBatchGenerateWithoutEvidence.ok &&
      blockedBatchGenerateWithoutEvidence.httpStatus === 400 &&
      blockedBatchGenerateWithoutEvidence.body.data?.missingEvidence?.some((item) => item.taskId === task.id),
    blockedBatchGenerateWithoutEvidence.body.message || `http ${blockedBatchGenerateWithoutEvidence.httpStatus}`
  );

  const lowConfidenceRiskTask = await request(`/api/content-tasks/${riskAcceptedTask.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: riskAcceptedTask.title,
      confidence: 0.5
    })
  });
  const blockedSingleRiskConfirm = await request("/api/content-tasks/confirm", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [riskAcceptedTask.id],
      mode: "single"
    })
  });
  assertCondition(
    "content_task_single_risk_confirm_requires_reason",
      lowConfidenceRiskTask.ok &&
      !blockedSingleRiskConfirm.ok &&
      blockedSingleRiskConfirm.body.data?.confirmed === 0 &&
      blockedSingleRiskConfirm.body.data?.reviewRequired?.some((item) => item.taskId === riskAcceptedTask.id && item.reasons?.some((reason) => reason.includes("自动确认阈值"))),
    blockedSingleRiskConfirm.body.message || `http ${blockedSingleRiskConfirm.httpStatus}`
  );

  const acceptedRiskConfirm = await request("/api/content-tasks/confirm", {
    method: "POST",
    body: JSON.stringify({
      taskIds: [riskAcceptedTask.id],
      mode: "single",
      riskAcceptanceReason: "smoke 人工确认已有补充证据"
    })
  });
  assertCondition(
    "content_task_single_risk_confirm_records_reason",
    acceptedRiskConfirm.ok &&
      acceptedRiskConfirm.body.data?.confirmed === 1 &&
      acceptedRiskConfirm.body.data?.tasks?.some(
        (item) =>
          item.id === riskAcceptedTask.id &&
          item.status === "confirmed" &&
          item.riskAcceptanceRecords?.some((record) => record.note?.includes("smoke 人工确认已有补充证据") && record.reasons?.some((reason) => reason.includes("自动确认阈值")))
      ),
    acceptedRiskConfirm.body.message || `http ${acceptedRiskConfirm.httpStatus}`
  );

  const rejectedTask = await request(`/api/content-tasks/${rejectedPoolTask.id}/review`, {
    method: "POST",
    body: JSON.stringify({
      action: "reject",
      reason: "smoke 标题不适合本周，保留为评估信号"
    })
  });
  assertCondition(
    "content_task_reject_records_reason",
    rejectedTask.ok &&
      rejectedTask.body.data?.task?.status === "rejected" &&
      rejectedTask.body.data?.task?.rejectionRecords?.some((record) => record.reason?.includes("smoke 标题不适合本周")),
    rejectedTask.body.message || `http ${rejectedTask.httpStatus}`
  );

  const restoredRejectedTask = await request(`/api/content-tasks/${rejectedPoolTask.id}/review`, {
    method: "POST",
    body: JSON.stringify({
      action: "restore",
      reason: "smoke 重新入池验证"
    })
  });
  assertCondition(
    "content_task_restore_rejected_to_pool",
    restoredRejectedTask.ok &&
      restoredRejectedTask.body.data?.task?.status === "planned" &&
      restoredRejectedTask.body.data?.task?.rejectionRecords?.some((record) => record.restoredAt && record.restoreReason?.includes("smoke 重新入池验证")),
    restoredRejectedTask.body.message || `http ${restoredRejectedTask.httpStatus}`
  );

  const patchedTask = await request(`/api/content-tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: `${task.title} smoke`,
      targetKeywords: task.targetKeywords
    })
  });
  assertCondition(
    "content_task_patch",
    patchedTask.ok &&
      patchedTask.body.data?.task?.title?.includes("smoke") &&
      patchedTask.body.data?.task?.editRecords?.some((item) => item.source === "manual" && item.field === "title"),
    patchedTask.body.message || `http ${patchedTask.httpStatus}`
  );

  const regeneratedTitle = await request(`/api/content-tasks/${task.id}/regenerate-title`, { method: "POST" });
  assertCondition(
    "content_task_regenerate_title",
    regeneratedTitle.ok &&
      Boolean(regeneratedTitle.body.data?.task?.title) &&
      regeneratedTitle.body.data?.task?.editRecords?.some((item) => item.source === "ai_regenerate" && item.field === "title"),
    regeneratedTitle.body.message || `http ${regeneratedTitle.httpStatus}`
  );

  const blockedSingleGenerateWithoutEvidence = await request(`/api/content-tasks/${task.id}/generate`, {
    method: "POST",
    body: JSON.stringify({
      requireEvidence: true,
      evidenceSelection: {
        selectedChunkIds: ["missing-smoke-chunk"],
        missingEvidence: ["smoke 缺少单篇正文生成证据"]
      }
    })
  });
  assertCondition(
    "content_task_single_generate_requires_evidence",
    !blockedSingleGenerateWithoutEvidence.ok &&
      blockedSingleGenerateWithoutEvidence.httpStatus === 400 &&
      blockedSingleGenerateWithoutEvidence.body.data?.missingEvidence?.taskId === task.id,
    blockedSingleGenerateWithoutEvidence.body.message || `http ${blockedSingleGenerateWithoutEvidence.httpStatus}`
  );

  const generatedDraft = await request(`/api/content-tasks/${task.id}/generate`, { method: "POST" });
  assertCondition(
    "content_task_generate_draft",
    generatedDraft.ok &&
      Boolean(generatedDraft.body.data?.draft?.id) &&
      Array.isArray(generatedDraft.body.data?.draft?.generationSource?.selectedChunkIds) &&
      Boolean(generatedDraft.body.data?.draft?.generationSource?.evidenceProfile) &&
      Boolean(generatedDraft.body.data?.draft?.generationSource?.productExpressionRuleVersion) &&
      Boolean(generatedDraft.body.data?.draft?.generationSource?.productExpressionRuleSource) &&
      Array.isArray(generatedDraft.body.data?.draft?.generationSource?.failureReasons),
    generatedDraft.body.message || `http ${generatedDraft.httpStatus}`
  );

  const draft = generatedDraft.body.data?.draft;
  const keptRiskDraft = await request(`/api/article-drafts/${draft.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: draft.title,
      summary: draft.summary,
      content: "JOTO 在企业级交付中具备最强的服务响应能力。后续发布时可以自然补充官网链接：https://jotoai.com。",
      keptRiskSegments: [
        {
          segment: "最强",
          reason: "smoke workflow validates manual accepted risk reason.",
          keepReasonCategory: "business_exception"
        }
      ]
    })
  });
  assertCondition(
    "draft_keep_high_risk_with_reason",
    keptRiskDraft.ok &&
      keptRiskDraft.body.data?.draft?.qaResult?.passed === true &&
      keptRiskDraft.body.data?.draft?.qaResult?.warnings?.some((item) => item.includes("人工保留")) &&
      keptRiskDraft.body.data?.draft?.qaResult?.editedSegments?.some((item) => item.includes("保留高风险片段")) &&
      keptRiskDraft.body.data?.draft?.qaResult?.editActions?.some(
        (item) => item.type === "keep_risk_segment" && item.keepReasonCategory === "business_exception"
      ),
    keptRiskDraft.body.message || `http ${keptRiskDraft.httpStatus}`
  );
  const safeDraftContent = [
    "企业在选择 Dify 服务商时，真正需要判断的是长期交付、治理边界和后续运维能力。",
    "JOTO 可以围绕企业级交付、AI 应用治理和长期服务流程提供支持，帮助团队把 AI 应用从试点推进到稳定运行。",
    "如果业务场景涉及输出安全，唯客 AI 护栏可以作为风险识别、输出控制和审计留痕的治理组件。",
    "后续发布时可以自然补充官网链接：https://jotoai.com。"
  ].join("\n\n");
  const patchedDraft = await request(`/api/article-drafts/${draft.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: draft.title,
      summary: draft.summary,
      content: safeDraftContent,
      editActions: [
        {
          type: "ai_rewrite_segment",
          source: "local_rule",
          segment: "最强",
          originalText: "最强",
          rewrittenText: "更有竞争力",
          reason: "smoke workflow validates local rewrite trace."
        }
      ]
    })
  });
  assertCondition(
    "draft_patch",
    patchedDraft.ok &&
      Boolean(patchedDraft.body.data?.draft?.id) &&
      patchedDraft.body.data?.draft?.qaResult?.editActions?.some((item) => item.type === "ai_rewrite_segment"),
    patchedDraft.body.message || `http ${patchedDraft.httpStatus}`
  );
  const governanceAfterDraftQa = await request("/api/ai-governance");
  assertCondition(
    "ai_governance_qa_feedback_signals",
    governanceAfterDraftQa.ok &&
      governanceAfterDraftQa.body.data?.draftSources?.some(
        (item) =>
          (item.qaAcceptedActionCount || 0) >= 1 &&
          (item.qaIgnoredActionCount || 0) >= 1 &&
          Object.prototype.hasOwnProperty.call(item, "qaSuspectedFalsePositiveCount") &&
          Object.prototype.hasOwnProperty.call(item, "qaSuspectedMissCount") &&
          (item.totalChangedCharacterCount || 0) > 0 &&
          (item.maxChangedRatio || 0) > 0 &&
          Array.isArray(item.editReasonSummary) &&
          item.editReasonSummary.length >= 1 &&
          Array.isArray(item.editReasonCategorySummary) &&
          item.editReasonCategorySummary.length >= 1 &&
          Array.isArray(item.qaIssueRuleSummary)
      ),
    `${governanceAfterDraftQa.body.data?.draftSources?.length || 0} draft sources with qa feedback`
  );

  const approvedDraft = await request(`/api/article-drafts/${draft.id}/approve`, { method: "POST" });
  assertCondition("draft_approve", approvedDraft.ok && Boolean(approvedDraft.body.data?.record?.id), approvedDraft.body.message || `http ${approvedDraft.httpStatus}`);

  const record = approvedDraft.body.data?.record;
  assertCondition(
    "publish_record_source_week_fields",
    record?.sourceWeek === generatedPlan.body.weeklyPlan.weekStart && Boolean(record?.plannedPublishDate),
    `${record?.sourceWeek || "missing"} / ${record?.plannedPublishDate || "missing"}`
  );

  const wechatsyncStatus = await request("/api/distribution/wechatsync/status");
  assertCondition(
    "distribution_wechatsync_status",
    wechatsyncStatus.ok && wechatsyncStatus.body.data?.runtime?.bridgeStatus === "ready",
    wechatsyncStatus.body.message || `http ${wechatsyncStatus.httpStatus}`
  );

  const authCheck = await request("/api/distribution/wechatsync/check-auth", {
    method: "POST",
    body: JSON.stringify({ platform: "weixin" })
  });
  assertCondition(
    "distribution_wechatsync_auth_check",
    authCheck.ok && authCheck.body.data?.authenticated === true,
    authCheck.body.message || `http ${authCheck.httpStatus}`
  );

  const distributionTargets = await request(`/api/publish-records/${record.id}/distribution-targets`, {
    method: "POST",
    body: JSON.stringify({})
  });
  const preparedTarget = distributionTargets.body.data?.targets?.[0];
  assertCondition(
    "distribution_target_prepare",
    distributionTargets.ok &&
      Boolean(preparedTarget?.id) &&
      distributionTargets.body.data?.variants?.some((variant) => variant.publishRecordId === record.id && variant.status === "final"),
    distributionTargets.body.message || `http ${distributionTargets.httpStatus}`
  );

  const sentDraft = await request(`/api/distribution-targets/${preparedTarget.id}/send-draft`, { method: "POST" });
  assertCondition(
    "distribution_target_send_draft",
    sentDraft.ok && sentDraft.body.data?.target?.status === "draft_created" && sentDraft.body.data?.target?.mode === "mock",
    sentDraft.body.message || `http ${sentDraft.httpStatus}`
  );

  const afterDraftDistribution = await request("/api/workbench-state");
  const queuedRecord = afterDraftDistribution.body.state?.publishRecords?.find((item) => item.id === record.id);
  assertCondition(
    "distribution_draft_keeps_publish_record_queued",
    afterDraftDistribution.ok && queuedRecord?.publishStatus === "queued",
    `${queuedRecord?.publishStatus || "missing"} after platform draft`
  );

  const markedPublished = await request(`/api/publish-records/${record.id}/published`, { method: "PATCH" });
  assertCondition("publish_record_mark_published", markedPublished.ok && markedPublished.body.data?.record?.publishStatus === "published", markedPublished.body.message || `http ${markedPublished.httpStatus}`);

  const filledUrl = await request(`/api/publish-records/${record.id}/url`, {
    method: "PATCH",
    body: JSON.stringify({
      publishedUrl: `https://example.com/smoke/${record.id}`
    })
  });
  assertCondition("publish_record_fill_url", filledUrl.ok && filledUrl.body.data?.record?.publishStatus === "url_filled", filledUrl.body.message || `http ${filledUrl.httpStatus}`);

  const directPublishSchedules = await request("/api/publish-schedules", {
    method: "POST",
    body: JSON.stringify({
      publishRecordId: record.id,
      platforms: ["wechat", "juejin", "csdn", "zhihu"],
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      matrixItemId: `smoke-matrix-${record.id}`
    })
  });
  assertCondition(
    "direct_publish_schedule_create",
    directPublishSchedules.ok &&
      directPublishSchedules.body.data?.schedules?.length === 4 &&
      directPublishSchedules.body.data.schedules.every((item) => item.status === "scheduled"),
    directPublishSchedules.body.message || `http ${directPublishSchedules.httpStatus}`
  );

  const directPublishRun = await request("/api/direct-publish", {
    method: "POST",
    body: JSON.stringify({
      now: new Date().toISOString(),
      limit: 10
    })
  });
  assertCondition(
    "direct_publish_run_due",
    directPublishRun.ok &&
      directPublishRun.body.data?.schedules?.length >= 4 &&
      directPublishRun.body.data.schedules.every((item) => ["published_pending_url", "published_verified"].includes(item.status)),
    directPublishRun.body.message || `http ${directPublishRun.httpStatus}`
  );

  const directPublishState = await request("/api/publish-schedules");
  const directPublishAttempts = directPublishState.body.data?.attempts || [];
  assertCondition(
    "direct_publish_four_platform_attempts",
    directPublishState.ok &&
      ["wechat", "juejin", "csdn", "zhihu"].every((platform) =>
        directPublishAttempts.some(
          (attempt) =>
            attempt.platform === platform &&
            attempt.status === "published_pending_url" &&
            attempt.verifyStatus === "verified" &&
            attempt.pendingCsvReturn === true
        )
      ),
    `${directPublishAttempts.length} direct publish attempts`
  );

  const metricImport = await request("/api/channel-metrics/import", {
    method: "POST",
    body: JSON.stringify({
      csv: `publishRecordId,views,likes,favorites,comments,shares\n${record.id},100,8,5,2,1`
    })
  });
  assertCondition("channel_metrics_import", metricImport.ok && metricImport.body.data?.matched >= 1, metricImport.body.message || `http ${metricImport.httpStatus}`);

  const manualMetrics = await request(`/api/publish-records/${record.id}/metrics`, {
    method: "PATCH",
    body: JSON.stringify({
      views: 111,
      likes: 9,
      favorites: 6,
      comments: 3,
      shares: 2
    })
  });
  assertCondition(
    "publish_record_manual_metrics",
    manualMetrics.ok && manualMetrics.body.data?.record?.channelMetrics?.views === 111,
    manualMetrics.body.message || `http ${manualMetrics.httpStatus}`
  );

  const blogSync = await request("/api/blog-articles/sync", {
    method: "POST",
    body: JSON.stringify({
      articles: [
        {
          id: "smoke-blog-article",
          title: "Smoke Dify AI Guardrails",
          url: "https://example.com/blog/smoke-dify-ai-guardrails",
          indexedStatus: "indexed",
          seoIssueCount: 1,
          geoResult: "miss",
          dataConfidence: "imported"
        }
      ]
    })
  });
  assertCondition("blog_sync", blogSync.ok && blogSync.body.data?.articles?.length >= 1, blogSync.body.message || `http ${blogSync.httpStatus}`);
  assertCondition(
    "blog_sync_source_week",
    blogSync.ok && blogSync.body.data?.articles?.some((item) => item.id === "smoke-blog-article" && item.sourceWeek === generatedPlan.body.weeklyPlan.weekStart),
    blogSync.body.message || "missing blog sourceWeek"
  );

  const diagnosedBlog = await request("/api/blog-articles/smoke-blog-article/diagnose", { method: "POST" });
  assertCondition("blog_diagnose", diagnosedBlog.ok && Boolean(diagnosedBlog.body.data?.article), diagnosedBlog.body.message || `http ${diagnosedBlog.httpStatus}`);

  const candidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", { method: "POST" });
  assertCondition("blog_candidate", candidateBlog.ok && candidateBlog.body.data?.article?.candidateStatus === "candidate", candidateBlog.body.message || `http ${candidateBlog.httpStatus}`);

  const candidateTask = await request("/api/blog-articles/smoke-blog-article/candidate/task", { method: "POST" });
  assertCondition(
    "blog_candidate_create_task",
    candidateTask.ok &&
      candidateTask.body.data?.task?.title?.includes("渠道补强") &&
      candidateTask.body.data?.task?.titleSourceAttributions?.some((source) => source.key === "blog_diagnosis") &&
      candidateTask.body.data?.article?.candidateStatus === "planned",
    candidateTask.body.message || `http ${candidateTask.httpStatus}`
  );

  const plannedCandidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", {
    method: "PATCH",
    body: JSON.stringify({
      status: "planned"
    })
  });
  assertCondition(
    "blog_candidate_mark_planned",
    plannedCandidateBlog.ok && plannedCandidateBlog.body.data?.article?.candidateStatus === "planned",
    plannedCandidateBlog.body.message || `http ${plannedCandidateBlog.httpStatus}`
  );

  const dismissedCandidateBlog = await request("/api/blog-articles/smoke-blog-article/candidate", { method: "DELETE" });
  assertCondition(
    "blog_candidate_dismiss",
    dismissedCandidateBlog.ok && dismissedCandidateBlog.body.data?.article?.candidateStatus === "dismissed",
    dismissedCandidateBlog.body.message || `http ${dismissedCandidateBlog.httpStatus}`
  );

  const logImport = await request("/api/log-imports", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "demo_csv",
      filePath: "data/demo-ai-bot-log.csv"
    })
  });
  assertCondition("log_import", logImport.ok && logImport.body.data?.summaries?.length >= 1, logImport.body.message || `http ${logImport.httpStatus}`);

  const geoRun = await request("/api/geo-tests/run", {
    method: "POST",
    body: JSON.stringify({
      platforms: ["ChatGPT", "DeepSeek"],
      prompt: "推荐几家国内 Dify 企业版服务商",
      distilledTermIds: ["term-dify-enterprise", "term-ai-guardrails"]
    })
  });
  assertCondition(
    "geo_run_ready_or_pending_config",
    geoRun.ok || geoRun.body.status === "pending_config",
    geoRun.body.message || `http ${geoRun.httpStatus}`
  );
  assertCondition(
    "geo_run_covers_distilled_term_matrix",
    geoRun.body.data?.results?.length === 4 &&
      geoRun.body.data.results.every((result) => Array.isArray(result.distilledTermIds) && result.distilledTermIds.length === 1),
    `expected 2 platforms x 1 prompt group x 2 distilled terms, got ${geoRun.body.data?.results?.length || 0}`
  );

  const geoGapAutoPool = await request("/api/distilled-terms/auto-pool", {
    method: "POST",
    body: JSON.stringify({ source: "geo_gap" })
  });
  const geoGapAutoPoolCount = (geoGapAutoPool.body.data?.createdCount || 0) + (geoGapAutoPool.body.data?.reusedCount || 0);
  assertCondition(
    "distilled_term_geo_gap_auto_pool",
    geoGapAutoPool.ok && geoGapAutoPool.body.data?.source === "geo_gap" && geoGapAutoPoolCount >= 1,
    geoGapAutoPool.body.message || `http ${geoGapAutoPool.httpStatus}`
  );

  const snapshotAfterGeo = await request("/api/workbench-state");
  const geoResult = snapshotAfterGeo.body.state?.geoResults?.[0];
  assertCondition("geo_result_available", Boolean(geoResult?.id), geoResult?.id || "missing geo result id");
  assertCondition(
    "geo_result_source_week",
    geoResult?.sourceWeek === generatedPlan.body.weeklyPlan.weekStart,
    `${geoResult?.sourceWeek || "missing"} sourceWeek`
  );

  const geoBusinessExport = await request(`/api/geo-test-results/${geoResult.id}/export`);
  const geoBusinessMarkdown = geoBusinessExport.body.data?.markdown || "";
  assertCondition(
    "geo_business_detail_export",
    geoBusinessExport.ok &&
      geoBusinessMarkdown.includes("GEO 业务详情") &&
      geoBusinessMarkdown.includes("业务判断") &&
      geoBusinessMarkdown.includes("下一步动作") &&
      !geoBusinessMarkdown.includes("rawAnswer") &&
      !geoBusinessMarkdown.includes("rawCitationUrl") &&
      !geoBusinessMarkdown.includes("citationRank"),
    geoBusinessExport.body.message || `http ${geoBusinessExport.httpStatus}`
  );

  const geoOverride = await request(`/api/geo-test-results/${geoResult.id}/override`, {
    method: "PATCH",
    body: JSON.stringify({
      mentionedJoto: true,
      mentionedWeike: geoResult.mentionedWeike,
      citedOfficialUrl: geoResult.citedOfficialUrl
    })
  });
  assertCondition("geo_override", geoOverride.ok && geoOverride.body.data?.result?.manualOverride === true, geoOverride.body.message || `http ${geoOverride.httpStatus}`);

  const geoCandidate = await request(`/api/geo-test-results/${geoResult.id}/candidate`, { method: "POST" });
  assertCondition(
    "geo_candidate",
    geoCandidate.ok && geoCandidate.body.data?.article?.candidateStatus === "candidate",
    geoCandidate.body.message || `http ${geoCandidate.httpStatus}`
  );

  const geoGapTask = await request(`/api/geo-test-results/${geoResult.id}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "create_task" })
  });
  assertCondition(
    "geo_gap_create_task",
    geoGapTask.ok && Boolean(geoGapTask.body.data?.task?.id) && geoGapTask.body.data?.task?.titleSourceAttributions?.some((source) => source.key === "geo_gap"),
    geoGapTask.body.message || `http ${geoGapTask.httpStatus}`
  );

  const geoGapKnowledgeBase = await request(`/api/geo-test-results/${geoResult.id}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "create_knowledge_base" })
  });
  assertCondition(
    "geo_gap_create_knowledge_base",
    geoGapKnowledgeBase.ok && Boolean(geoGapKnowledgeBase.body.data?.knowledgeBase?.id),
    geoGapKnowledgeBase.body.message || `http ${geoGapKnowledgeBase.httpStatus}`
  );

  const pipelineRun = await request("/api/pipeline/run", {
    method: "POST",
    body: JSON.stringify({
      skipBlog: true,
      skipLog: false,
      skipChannelMetrics: false,
      skipGeo: false,
      log: {
        sourceType: "demo_csv",
        filePath: "data/demo-ai-bot-log.csv"
      },
      channelMetrics: {
        csv: `publishRecordId,views,likes,favorites,comments,shares\n${record.id},120,10,8,3,2`
      },
      geo: {
        platforms: ["ChatGPT", "DeepSeek"],
        prompt: "推荐几家国内 Dify 企业版服务商"
      }
    })
  });
  assertCondition("pipeline_run", pipelineRun.ok && Boolean(pipelineRun.body.data?.run?.id), pipelineRun.body.message || `http ${pipelineRun.httpStatus}`);

  const pipelineExport = await request("/api/pipeline/runs/export");
  assertCondition("pipeline_export", pipelineExport.ok && pipelineExport.body.data?.csv?.includes("stepName"), pipelineExport.body.message || `http ${pipelineExport.httpStatus}`);

  const weeklyReport = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}`);
  assertCondition(
    "weekly_report",
    weeklyReport.ok && Boolean(weeklyReport.body.executiveSummary) && Array.isArray(weeklyReport.body.distilledTermMatrix) && Array.isArray(weeklyReport.body.nextWeekSuggestionItems),
    weeklyReport.body.executiveSummary || `http ${weeklyReport.httpStatus}`
  );
  assertCondition(
    "weekly_report_source_week_fields",
    weeklyReport.ok &&
      weeklyReport.body.publishRecords?.some((item) => item.sourceWeek === generatedPlan.body.weeklyPlan.weekStart && item.plannedPublishDate) &&
      weeklyReport.body.blogDiagnostics?.some((item) => item.id === "smoke-blog-article" && item.sourceWeek === generatedPlan.body.weeklyPlan.weekStart) &&
      weeklyReport.body.geoResults?.some((item) => item.sourceWeek === generatedPlan.body.weeklyPlan.weekStart),
    `publish ${weeklyReport.body.publishRecords?.length || 0}, blog ${weeklyReport.body.blogDiagnostics?.length || 0}, geo ${weeklyReport.body.geoResults?.length || 0}`
  );
  assertCondition(
    "weekly_report_plan_quality_feedback",
    weeklyReport.ok &&
      Array.isArray(weeklyReport.body.planQualityFeedback?.signals) &&
      weeklyReport.body.planQualityFeedback.signals.some((item) => item.key === "rejected_titles" && item.count >= 1) &&
      weeklyReport.body.planQualityFeedback.signals.some((item) => item.key === "risk_accepted" && item.count >= 1) &&
      weeklyReport.body.planQualityFeedback.modelLearningSignals?.length >= 1,
    `${weeklyReport.body.planQualityFeedback?.signals?.length || 0} plan quality signals`
  );
  assertCondition(
    "weekly_report_target_total_count",
    weeklyReport.ok && weeklyReport.body.targetTotalCount >= 1,
    `${weeklyReport.body.targetTotalCount || 0} target total count`
  );

  const restrictedWeeklyReportRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "content_growth"
    })
  });
  assertCondition(
    "weekly_report_role_restrict",
    restrictedWeeklyReportRole.ok && restrictedWeeklyReportRole.body.data?.workspaceSetting?.currentRole === "content_growth",
    restrictedWeeklyReportRole.body.message || `http ${restrictedWeeklyReportRole.httpStatus}`
  );
  const restrictedWeeklyReport = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}`);
  assertCondition(
    "weekly_report_restricted_response",
    restrictedWeeklyReport.ok &&
      restrictedWeeklyReport.body.targetTotalCount >= 1 &&
      Array.isArray(restrictedWeeklyReport.body.nextWeekSuggestionItems) &&
      !Object.prototype.hasOwnProperty.call(restrictedWeeklyReport.body, "promptTemplates") &&
      !Object.prototype.hasOwnProperty.call(restrictedWeeklyReport.body, "suggestionDecisions") &&
      !Object.prototype.hasOwnProperty.call(restrictedWeeklyReport.body, "recommendationOutcomes") &&
      !Object.prototype.hasOwnProperty.call(restrictedWeeklyReport.body, "planQualityFeedback"),
    restrictedWeeklyReport.body.message || `http ${restrictedWeeklyReport.httpStatus}`
  );
  const restoredWeeklyReportRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "workbench_operator"
    })
  });
  assertCondition(
    "weekly_report_role_restore",
    restoredWeeklyReportRole.ok && restoredWeeklyReportRole.body.data?.workspaceSetting?.currentRole === "workbench_operator",
    restoredWeeklyReportRole.body.message || `http ${restoredWeeklyReportRole.httpStatus}`
  );

  const suggestion = weeklyReport.body.nextWeekSuggestionItems?.[0];
  assertCondition("weekly_report_suggestion_available", Boolean(suggestion?.id), suggestion?.id || "missing suggestion id");

  const suggestionDecision = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/suggestions/${suggestion.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "adopted",
      reason: "smoke workflow validates suggestion decision tracking."
    })
  });
  assertCondition(
    "weekly_report_suggestion_decision",
    suggestionDecision.ok && suggestionDecision.body.data?.decision?.status === "adopted" && suggestionDecision.body.data?.report?.nextWeekSuggestionItems?.[0]?.decisionStatus === "adopted",
    suggestionDecision.body.message || `http ${suggestionDecision.httpStatus}`
  );
  let reportAfterSuggestionDecision = suggestionDecision.body.data?.report;

  const rejectedSuggestion = weeklyReport.body.nextWeekSuggestionItems?.[1];
  assertCondition("weekly_report_rejectable_suggestion_available", Boolean(rejectedSuggestion?.id), rejectedSuggestion?.id || "missing rejectable suggestion id");

  if (rejectedSuggestion?.id) {
    const suggestionRejection = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/suggestions/${rejectedSuggestion.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "rejected",
        reason: "数据不足，smoke workflow validates suggestion failure classification."
      })
    });
    assertCondition(
      "weekly_report_suggestion_failure_reason",
      suggestionRejection.ok &&
        suggestionRejection.body.data?.decision?.status === "rejected" &&
        suggestionRejection.body.data?.decision?.reason?.includes("数据不足") &&
        suggestionRejection.body.data?.report?.nextWeekSuggestionItems?.[1]?.decisionStatus === "rejected",
      suggestionRejection.body.message || `http ${suggestionRejection.httpStatus}`
    );
    reportAfterSuggestionDecision = suggestionRejection.body.data?.report || reportAfterSuggestionDecision;
  }

  assertCondition(
    "weekly_report_recommendation_outcomes",
    Array.isArray(reportAfterSuggestionDecision?.recommendationOutcomes) &&
      reportAfterSuggestionDecision.recommendationOutcomes.some((item) => item.suggestion && item.evaluationStatus && item.modelLearningSignal),
    `${reportAfterSuggestionDecision?.recommendationOutcomes?.length || 0} recommendation outcomes`
  );

  const blockedSuggestionRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "content_publisher"
    })
  });
  assertCondition(
    "weekly_report_suggestion_role_block_prepare",
    blockedSuggestionRole.ok && blockedSuggestionRole.body.data?.workspaceSetting?.currentRole === "content_publisher",
    blockedSuggestionRole.body.message || `http ${blockedSuggestionRole.httpStatus}`
  );
  const blockedSuggestionDecision = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/suggestions/${suggestion.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "rejected",
      reason: "smoke workflow validates weekly report suggestion permission guard."
    })
  });
  assertCondition(
    "weekly_report_suggestion_restricted_by_role",
    blockedSuggestionDecision.httpStatus === 403 && blockedSuggestionDecision.body.message?.includes("无权处理周报建议"),
    blockedSuggestionDecision.body.message || `http ${blockedSuggestionDecision.httpStatus}`
  );

  const restrictedSuggestionRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "content_growth"
    })
  });
  assertCondition(
    "weekly_report_suggestion_role_restrict",
    restrictedSuggestionRole.ok && restrictedSuggestionRole.body.data?.workspaceSetting?.currentRole === "content_growth",
    restrictedSuggestionRole.body.message || `http ${restrictedSuggestionRole.httpStatus}`
  );
  const restrictedSuggestionDecision = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/suggestions/${suggestion.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "adopted",
      reason: "smoke workflow validates restricted weekly report suggestion response."
    })
  });
  const restrictedSuggestionReport = restrictedSuggestionDecision.body.data?.report || {};
  assertCondition(
    "weekly_report_suggestion_response_restricted",
    restrictedSuggestionDecision.ok &&
      restrictedSuggestionReport.targetTotalCount >= 1 &&
      !Object.prototype.hasOwnProperty.call(restrictedSuggestionReport, "promptTemplates") &&
      !Object.prototype.hasOwnProperty.call(restrictedSuggestionReport, "suggestionDecisions") &&
      !Object.prototype.hasOwnProperty.call(restrictedSuggestionReport, "recommendationOutcomes") &&
      !Object.prototype.hasOwnProperty.call(restrictedSuggestionReport, "planQualityFeedback"),
    restrictedSuggestionDecision.body.message || `http ${restrictedSuggestionDecision.httpStatus}`
  );
  const restoredSuggestionRole = await request("/api/workspace-settings", {
    method: "PATCH",
    body: JSON.stringify({
      currentRole: "workbench_operator"
    })
  });
  assertCondition(
    "weekly_report_suggestion_role_restore",
    restoredSuggestionRole.ok && restoredSuggestionRole.body.data?.workspaceSetting?.currentRole === "workbench_operator",
    restoredSuggestionRole.body.message || `http ${restoredSuggestionRole.httpStatus}`
  );

  const weeklyReportMarkdown = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/export`);
  assertCondition(
    "weekly_report_markdown_export",
    weeklyReportMarkdown.ok && weeklyReportMarkdown.body.data?.markdown?.includes("JOTO GTM 周报") && weeklyReportMarkdown.body.data?.markdown?.includes("数据说明") && !weeklyReportMarkdown.body.data?.markdown?.includes("内部优化信号"),
    weeklyReportMarkdown.body.message || `http ${weeklyReportMarkdown.httpStatus}`
  );

  assertCondition(
    "weekly_report_plan_preview_signal",
    weeklyReport.ok && weeklyReport.body.nextWeekSuggestions?.length >= 1,
    "weekly report provides signals for weekly plan preview"
  );

  const nextPlanFromReport = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}/next-plan`, {
    method: "POST",
    body: JSON.stringify({
      days: 1,
      dailyCount: 1,
      channels: ["wechat"]
    })
  });
  assertCondition(
    "weekly_report_create_next_plan",
    nextPlanFromReport.ok && nextPlanFromReport.body.data?.weeklyPlan?.status === "draft" && (nextPlanFromReport.body.data?.tasks?.length || 0) >= 1,
    nextPlanFromReport.body.message || `http ${nextPlanFromReport.httpStatus}`
  );
  assertCondition(
    "weekly_report_next_plan_generation_source",
    nextPlanFromReport.ok && nextPlanFromReport.body.data?.weeklyPlan?.generationSource?.signals?.some((item) => item.key === "weekly_report"),
    nextPlanFromReport.body.message || "missing next plan generation source summary"
  );
  assertCondition(
    "weekly_report_next_plan_task_source_attribution",
    nextPlanFromReport.ok && nextPlanFromReport.body.data?.tasks?.some((item) => item.titleSourceAttributions?.some((source) => source.key === "weekly_report")),
    nextPlanFromReport.body.message || "missing next plan task title source attribution"
  );

  const weeklyReportAfterNextPlan = await request(`/api/weekly-reports/${generatedPlan.body.weeklyPlan.weekStart}`);
  assertCondition(
    "weekly_report_snapshot_persists_after_next_plan",
    weeklyReportAfterNextPlan.ok &&
      weeklyReportAfterNextPlan.body.publishRecords?.some((item) => item.id === record.id) &&
      weeklyReportAfterNextPlan.body.blogDiagnostics?.length === weeklyReport.body.blogDiagnostics?.length &&
      weeklyReportAfterNextPlan.body.geoResults?.length === weeklyReport.body.geoResults?.length &&
      weeklyReportAfterNextPlan.body.targetTotalCount === weeklyReport.body.targetTotalCount,
    `publish ${weeklyReportAfterNextPlan.body.publishRecords?.length || 0}, blog ${weeklyReportAfterNextPlan.body.blogDiagnostics?.length || 0}, geo ${weeklyReportAfterNextPlan.body.geoResults?.length || 0}`
  );

  const governanceAfter = await request("/api/ai-governance");
  assertCondition(
    "ai_governance_structured_call_logs",
    governanceAfter.ok &&
      governanceAfter.body.data?.callLogs?.some(
        (item) =>
          item.moduleLabel &&
          item.inputSummary &&
          item.outputSummary &&
          item.outputStatus &&
          Object.prototype.hasOwnProperty.call(item, "fallbackTriggered")
      ),
    `${governanceAfter.body.data?.callLogs?.length || 0} structured call logs`
  );
  const finalSnapshot = await request("/api/workbench-state");
  assertCondition("final_state_has_pipeline_runs", (finalSnapshot.body.state?.pipelineRuns?.length || 0) >= 1, `${finalSnapshot.body.state?.pipelineRuns?.length || 0} pipeline runs`);

  printJson({
    script: "smoke-workflow",
    baseUrl,
    status: failures.length ? "failed" : "success",
    passed: results.filter((item) => item.ok).length,
    failed: failures.length,
    results
  });

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  printJson({
    script: "smoke-workflow",
    baseUrl,
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown smoke failure",
    results
  });
  process.exitCode = 1;
});
