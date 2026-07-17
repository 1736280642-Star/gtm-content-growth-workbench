"use client";

import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState, type Key } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { isDateInWeek } from "@/lib/date-utils";
import { channelLabels, contentTypeLabels, platformContentTypeLabels, productLabels, statusLabels } from "@/lib/labels";
import type { ChannelKey, ContentTask, KnowledgeBase, ProductKey, ProductPlanConfig, TaskStatus, WeeklyPlanGenerationSignal, WeeklyPublishMatrixDay } from "@/lib/types";

const weekdayOrder = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const editRecordSourceLabels = {
  manual: "人工编辑",
  ai_regenerate: "重新生成",
  system: "系统更新"
};

const generationSignalStatusLabels: Record<WeeklyPlanGenerationSignal["status"], { label: string; color: string }> = {
  used: { label: "已参考", color: "green" },
  available: { label: "可参考", color: "blue" },
  missing: { label: "缺失", color: "default" }
};

type PublishMatrixIssue = {
  level: "error" | "warning";
  message: string;
  date?: string;
};

type WeeklyPlanSourceFilter = NonNullable<ContentTask["titleSourceAttributions"]>[number]["key"];
type WeeklyPlanFeedbackFilter = "needs_review" | "rejected" | "risk_accepted" | "manual_edited" | "title_regenerated" | "low_confidence";
type ProductPlanBindingTarget = "knowledge_base" | "rule_package";

const sourceFilterLabels: Record<WeeklyPlanSourceFilter, string> = {
  knowledge_base: "知识库",
  product_expression: "产品表达",
  distilled_terms: "蒸馏词",
  geo_gap: "GEO 缺口",
  blog_diagnosis: "博客诊断",
  weekly_report: "周报建议",
  publish_matrix: "发布矩阵",
  system_rule: "系统规则"
};

const feedbackFilterLabels: Record<WeeklyPlanFeedbackFilter, string> = {
  needs_review: "需复核",
  rejected: "已驳回",
  risk_accepted: "风险已接受",
  manual_edited: "人工编辑",
  title_regenerated: "标题重生成",
  low_confidence: "未达确认阈值"
};

const knowledgeBaseTypeLabels: Record<KnowledgeBase["type"], string> = {
  brand: "品牌",
  product: "产品",
  official_blog: "官网博客",
  channel_history: "渠道历史",
  competitor: "竞品",
  custom: "自定义"
};

const rulePackageStatusLabels: Record<NonNullable<KnowledgeBase["productExpressionRuleDraft"]>["status"], { label: string; color: string }> = {
  draft: { label: "草稿", color: "gold" },
  active: { label: "已生效", color: "green" },
  archived: { label: "已归档", color: "default" }
};

function createUiPublishMatrix(weekStart: string, fallbackDailyCount: number): WeeklyPublishMatrixDay[] {
  const start = new Date(`${weekStart}T00:00:00.000Z`);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const dateText = date.toISOString().slice(0, 10);
    const active = index < 5;

    return {
      date: dateText,
      weekday: weekdayOrder[index],
      plannedCount: active ? fallbackDailyCount : 0,
      paused: !active,
      locked: false,
      source: "system_default"
    };
  });
}

function suggestPublishMatrix(current: WeeklyPublishMatrixDay[], weeklyPlanCount: number): WeeklyPublishMatrixDay[] {
  const workingDays = current.filter((item) => weekdayOrder.slice(0, 5).includes(item.weekday));
  const target = Math.max(weeklyPlanCount || workingDays.reduce((sum, item) => sum + item.plannedCount, 0) || 5, 1);
  let remaining = target;
  const unlockedWorkingDays = workingDays.filter((item) => !item.locked && !item.paused);
  const lockedTotal = current.filter((item) => item.locked || item.paused).reduce((sum, item) => sum + item.plannedCount, 0);
  remaining = Math.max(target - lockedTotal, 0);

  return current.map((item) => {
    if (item.locked || item.paused || !weekdayOrder.slice(0, 5).includes(item.weekday)) {
      return item;
    }

    const divisor = Math.max(unlockedWorkingDays.length, 1);
    const plannedCount = Math.max(0, Math.ceil(remaining / divisor));
    remaining = Math.max(remaining - plannedCount, 0);
    unlockedWorkingDays.shift();

    return {
      ...item,
      plannedCount,
      paused: plannedCount === 0,
      source: "ai_suggested"
    };
  });
}

function createDefaultProductPlans(products: ProductKey[], channels: ChannelKey[]): ProductPlanConfig[] {
  const fallbackChannels: ChannelKey[] = channels.length ? channels : ["wechat"];

  return products.map((product) => ({
    product,
    weeklyQuota: product === "joto_brand" ? 5 : 10,
    channels: fallbackChannels,
    enabled: true
  }));
}

function normalizeKnowledgeBaseIds(ids?: string[], legacyId?: string) {
  return Array.from(new Set([...(ids || []), legacyId].map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

function formatKnowledgeBaseNames(ids: string[], nameById: Map<string, string>) {
  if (!ids.length) {
    return "未绑定";
  }

  const names = ids.map((id) => nameById.get(id) || id);
  return names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} 等 ${names.length} 个`;
}

function normalizeUiProductPlans(
  source: ProductPlanConfig[] | undefined,
  products: ProductKey[],
  channels: ChannelKey[]
): ProductPlanConfig[] {
  const defaults = createDefaultProductPlans(products, channels);

  return products.map((product) => {
    const existing = source?.find((item) => item.product === product);
    const fallback = defaults.find((item) => item.product === product) || {
      product,
      weeklyQuota: 1,
      channels,
      enabled: true
    };

    return {
      product,
      weeklyQuota: existing?.weeklyQuota ?? fallback.weeklyQuota,
      channels: existing?.channels?.length ? existing.channels : fallback.channels,
      knowledgeBaseIds: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId),
      knowledgeBaseId: normalizeKnowledgeBaseIds(existing?.knowledgeBaseIds, existing?.knowledgeBaseId)[0],
      productExpressionRulePackageId: existing?.productExpressionRulePackageId,
      enabled: existing?.enabled ?? fallback.enabled
    };
  });
}

function getPublishMatrixIssues(matrix: WeeklyPublishMatrixDay[]): PublishMatrixIssue[] {
  const issues: PublishMatrixIssue[] = [];
  const total = matrix.reduce((sum, item) => sum + item.plannedCount, 0);

  if (total <= 0) {
    issues.push({
      level: "error",
      message: "全周发布量不能为 0，请至少保留 1 篇计划。"
    });
  }

  for (const item of matrix) {
    if (!item.paused && item.plannedCount > 5) {
      issues.push({
        level: "warning",
        date: item.date,
        message: `${item.weekday} 单日发布量超过 5 篇，建议确认是否为特殊活动排期。`
      });
    }

    if (item.locked && item.source === "ai_suggested") {
      issues.push({
        level: "warning",
        date: item.date,
        message: `${item.weekday} 已锁定但仍显示 AI 建议来源，建议人工确认后再生成。`
      });
    }
  }

  return issues;
}

export default function WeeklyPlanPage() {
  const {
    state: { tasks, weeklyPlan, workspaceSetting, knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [form] = Form.useForm();
  const [taskForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [generating, setGenerating] = useState(false);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [regeneratingTaskId, setRegeneratingTaskId] = useState<string>();
  const [confirmingTaskId, setConfirmingTaskId] = useState<string>();
  const [deletingTaskId, setDeletingTaskId] = useState<string>();
  const [reviewingTaskId, setReviewingTaskId] = useState<string>();
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Key[]>([]);
  const [editingTask, setEditingTask] = useState<ContentTask>();
  const [riskConfirmTask, setRiskConfirmTask] = useState<ContentTask>();
  const [riskConfirmReason, setRiskConfirmReason] = useState("");
  const [rejectingTask, setRejectingTask] = useState<ContentTask>();
  const [rejectionReason, setRejectionReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [productFilter, setProductFilter] = useState<ProductKey[]>([]);
  const [sourceFilter, setSourceFilter] = useState<WeeklyPlanSourceFilter[]>([]);
  const [feedbackFilter, setFeedbackFilter] = useState<WeeklyPlanFeedbackFilter[]>([]);
  const [publishMatrix, setPublishMatrix] = useState<WeeklyPublishMatrixDay[]>([]);
  const [productPlans, setProductPlans] = useState<ProductPlanConfig[]>([]);
  const [bindingPicker, setBindingPicker] = useState<{ product: ProductKey; target: ProductPlanBindingTarget }>();
  const [bindingPickerQuery, setBindingPickerQuery] = useState("");
  const watchedChannels = Form.useWatch("channels", form) as ChannelKey[] | undefined;
  const watchedProducts = Form.useWatch("products", form) as ProductKey[] | undefined;

  useEffect(() => {
    const nextMatrix =
      weeklyPlan.publishMatrix?.length
        ? weeklyPlan.publishMatrix
        : createUiPublishMatrix(weeklyPlan.weekStart, workspaceSetting.defaultDailyCount);

    setPublishMatrix(nextMatrix);
    setProductPlans(
      normalizeUiProductPlans(
        weeklyPlan.productPlans?.length ? weeklyPlan.productPlans : workspaceSetting.productPlans,
        workspaceSetting.enabledProducts,
        workspaceSetting.enabledChannels
      )
    );
    form.setFieldsValue({
      days: workspaceSetting.defaultWeeklyDays,
      dailyCount: workspaceSetting.defaultDailyCount,
      channels: workspaceSetting.enabledChannels,
      products: workspaceSetting.enabledProducts
    });
  }, [form, weeklyPlan.publishMatrix, weeklyPlan.weekStart, workspaceSetting]);

  useEffect(() => {
    const nextProducts = watchedProducts?.length ? watchedProducts : workspaceSetting.enabledProducts;
    const nextChannels = watchedChannels?.length ? watchedChannels : workspaceSetting.enabledChannels;

    setProductPlans((current) => normalizeUiProductPlans(current.length ? current : workspaceSetting.productPlans, nextProducts, nextChannels));
  }, [watchedChannels, watchedProducts, workspaceSetting.enabledChannels, workspaceSetting.enabledProducts, workspaceSetting.productPlans]);

  const currentWeekTasks = useMemo(
    () => tasks.filter((task) => task.weeklyPlanId === weeklyPlan.id || isDateInWeek(task.publishDate, weeklyPlan.weekStart)),
    [tasks, weeklyPlan.id, weeklyPlan.weekStart]
  );
  const selectedPlannedTaskIds = selectedTaskIds
    .map(String)
    .filter((taskId) => currentWeekTasks.some((task) => task.id === taskId && task.status === "planned"));
  const plannedTaskCount = currentWeekTasks.filter((task) => task.status === "planned").length;
  const confirmedTaskCount = currentWeekTasks.filter((task) => task.status === "confirmed").length;
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length || sourceFilter.length || feedbackFilter.length);
  const filteredTasks = useMemo(() => {
    return currentWeekTasks.filter((task) => {
      const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
      const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
      const productMatched = !productFilter.length || productFilter.includes(task.product);
      const sourceMatched = !sourceFilter.length || task.titleSourceAttributions?.some((item) => sourceFilter.includes(item.key));
      const feedbackMatched = !feedbackFilter.length || feedbackFilter.some((filter) => taskMatchesFeedbackFilter(task, filter));

      return statusMatched && channelMatched && productMatched && sourceMatched && feedbackMatched;
    });
  }, [channelFilter, currentWeekTasks, feedbackFilter, productFilter, sourceFilter, statusFilter]);
  const channelPlanSummary = Object.entries(channelLabels)
    .map(([channel, label]) => ({ label, count: currentWeekTasks.filter((task) => task.channel === channel).length }))
    .filter((item) => item.count)
    .map((item) => `${item.label} ${item.count}`)
    .join(" / ");
  const productPlanSummary = Object.entries(productLabels)
    .map(([product, label]) => ({ label, count: currentWeekTasks.filter((task) => task.product === product).length }))
    .filter((item) => item.count)
    .map((item) => `${item.label} ${item.count}`)
    .join(" / ");
  const reviewRequiredCount = currentWeekTasks.filter((task) => task.status === "planned" && getConfirmReviewReasons(task).length).length;
  const batchConfirmCandidateIds = selectedPlannedTaskIds.length ? selectedPlannedTaskIds : currentWeekTasks.filter((task) => task.status === "planned").map((task) => task.id);
  const batchConfirmTasks = currentWeekTasks.filter((task) => batchConfirmCandidateIds.includes(task.id));
  const batchConfirmSummary = {
    total: batchConfirmTasks.length,
    confirmableIds: batchConfirmTasks.filter((task) => !getConfirmReviewReasons(task).length).map((task) => task.id),
    reviewRequired: batchConfirmTasks
      .map((task) => ({
        task,
        reasons: getConfirmReviewReasons(task)
      }))
      .filter((item) => item.reasons.length)
  };
  const publishMatrixTotal = publishMatrix.reduce((sum, item) => sum + item.plannedCount, 0);
  const productPlanTotal = productPlans.filter((item) => item.enabled).reduce((sum, item) => sum + item.weeklyQuota, 0);
  const publishMatrixIssues = getPublishMatrixIssues(publishMatrix);
  const productMatrixMismatch = productPlanTotal > 0 && publishMatrixTotal !== productPlanTotal;
  const matrixBlockingIssues = publishMatrixIssues.filter((issue) => issue.level === "error");
  const knowledgeBaseOptions = knowledgeBases
    .filter((item) => item.status === "enabled")
    .map((item) => ({ value: item.id, label: item.name }));
  const rulePackageOptions = knowledgeBases
    .filter((item) => item.productExpressionSource && item.productExpressionRuleDraft)
    .map((item) => ({ value: item.id, label: `${item.name} ${item.productExpressionRuleDraft?.version || ""}`.trim() }));
  const knowledgeBaseNameById = new Map(knowledgeBases.map((item) => [item.id, item.name]));
  const rulePackageNameById = new Map(rulePackageOptions.map((item) => [item.value, item.label]));
  const bindingPickerItems = useMemo(() => {
    if (!bindingPicker) {
      return [];
    }

    const query = bindingPickerQuery.trim().toLowerCase();
    const candidates =
      bindingPicker.target === "knowledge_base"
        ? knowledgeBases.filter((item) => item.status === "enabled")
        : knowledgeBases.filter((item) => item.productExpressionSource && item.productExpressionRuleDraft);

    if (!query) {
      return candidates;
    }

    return candidates.filter((item) => {
      const ruleDraft = item.productExpressionRuleDraft;
      const searchableText = [item.name, item.usageScope, item.contentPreview, ruleDraft?.version, ruleDraft?.summary].filter(Boolean).join(" ").toLowerCase();

      return searchableText.includes(query);
    });
  }, [bindingPicker, bindingPickerQuery, knowledgeBases]);
  const bindingPickerPlan = bindingPicker ? productPlans.find((item) => item.product === bindingPicker.product) : undefined;
  const selectedKnowledgeBaseIds = bindingPickerPlan ? normalizeKnowledgeBaseIds(bindingPickerPlan.knowledgeBaseIds, bindingPickerPlan.knowledgeBaseId) : [];
  const selectedRulePackageId = bindingPickerPlan?.productExpressionRulePackageId;

  function openProductPlanBindingPicker(product: ProductKey, target: ProductPlanBindingTarget) {
    setBindingPicker({ product, target });
    setBindingPickerQuery("");
  }

  function closeProductPlanBindingPicker() {
    setBindingPicker(undefined);
    setBindingPickerQuery("");
  }

  function handleSelectProductPlanBinding(knowledgeBaseId: string) {
    if (!bindingPicker) {
      return;
    }

    if (bindingPicker.target === "knowledge_base") {
      const currentIds = bindingPickerPlan ? normalizeKnowledgeBaseIds(bindingPickerPlan.knowledgeBaseIds, bindingPickerPlan.knowledgeBaseId) : [];
      const nextIds = currentIds.includes(knowledgeBaseId) ? currentIds.filter((id) => id !== knowledgeBaseId) : [...currentIds, knowledgeBaseId];

      updateProductPlan(bindingPicker.product, {
        knowledgeBaseIds: nextIds,
        knowledgeBaseId: nextIds[0]
      });
      return;
    }

    updateProductPlan(
      bindingPicker.product,
      {
        productExpressionRulePackageId: knowledgeBaseId
      }
    );
    closeProductPlanBindingPicker();
  }

  function clearProductPlanBinding(product: ProductKey, target: ProductPlanBindingTarget) {
    updateProductPlan(
      product,
      target === "knowledge_base"
        ? { knowledgeBaseIds: [], knowledgeBaseId: undefined }
        : {
            productExpressionRulePackageId: undefined
          }
    );
  }

  async function handleGeneratePlan() {
    const values = form.getFieldsValue() as { channels?: ChannelKey[]; products?: ProductKey[] };

    if (matrixBlockingIssues.length) {
      messageApi.error(matrixBlockingIssues[0].message);
      return;
    }

    setGenerating(true);

    try {
      const result = await callJsonApi("/api/weekly-plans/generate", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          publishMatrix,
          productPlans,
          generationMode: "refresh_product_groups",
          days: publishMatrix.filter((item) => !item.paused && item.plannedCount > 0).length,
          dailyCount: Math.max(1, Math.round(publishMatrixTotal / Math.max(publishMatrix.filter((item) => !item.paused && item.plannedCount > 0).length, 1)))
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "周计划预览已生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成周计划预览失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSavePublishMatrix() {
    const values = form.getFieldsValue() as { channels?: ChannelKey[]; products?: ProductKey[] };

    if (matrixBlockingIssues.length) {
      messageApi.error(matrixBlockingIssues[0].message);
      return;
    }

    setSavingMatrix(true);

    try {
      const result = await callJsonApi(`/api/weekly-plans/${weeklyPlan.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...values,
          publishMatrix,
          productPlans,
          targetTotalCount: publishMatrixTotal
        })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "周发布设置已保存"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存周发布设置失败");
    } finally {
      setSavingMatrix(false);
    }
  }

  function updateMatrixDay(date: string, patch: Partial<WeeklyPublishMatrixDay>) {
    setPublishMatrix((current) =>
      current.map((item) => {
        if (item.date !== date) {
          return item;
        }

        const plannedCount = patch.plannedCount ?? item.plannedCount;
        const paused = typeof patch.paused === "boolean" ? patch.paused : plannedCount === 0 ? true : item.paused;

        return {
          ...item,
          ...patch,
          plannedCount: paused ? 0 : plannedCount,
          paused,
          source: patch.source || "manual"
        };
      })
    );
  }

  function updateProductPlan(product: ProductKey, patch: Partial<ProductPlanConfig>) {
    setProductPlans((current) =>
      current.map((item) =>
        item.product === product
          ? {
              ...item,
              ...patch,
              channels: patch.channels?.length ? patch.channels : patch.channels ? item.channels : item.channels
            }
          : item
      )
    );
  }

  function syncMatrixFromProductQuota() {
    const target = Math.max(productPlanTotal, 1);
    const activeDays = publishMatrix.filter((item) => !item.locked && !item.paused);
    const lockedTotal = publishMatrix.filter((item) => item.locked || item.paused).reduce((sum, item) => sum + item.plannedCount, 0);
    let remaining = Math.max(target - lockedTotal, 0);
    const candidateDays = activeDays.length ? activeDays : publishMatrix.filter((item) => !item.locked).slice(0, Math.min(workspaceSetting.defaultWeeklyDays, 7));
    const candidateDates = new Set(candidateDays.map((item) => item.date));
    let remainingSlots = Math.max(candidateDays.length, 1);

    setPublishMatrix((current) =>
      current.map((item) => {
        if (item.locked) {
          return item;
        }

        if (!candidateDates.has(item.date)) {
          return {
            ...item,
            plannedCount: 0,
            paused: true,
            source: "manual"
          };
        }

        const plannedCount = Math.max(0, Math.ceil(remaining / remainingSlots));
        remaining = Math.max(remaining - plannedCount, 0);
        remainingSlots = Math.max(remainingSlots - 1, 1);

        return {
          ...item,
          plannedCount,
          paused: plannedCount === 0,
          source: "manual"
        };
      })
    );
    messageApi.success("已按产品配额同步每日发布矩阵。");
  }

  function getProductPlanTaskStats(product: ProductKey) {
    const productTasks = currentWeekTasks.filter((task) => task.product === product);

    return {
      total: productTasks.length,
      planned: productTasks.filter((task) => task.status === "planned").length,
      confirmed: productTasks.filter((task) => task.status === "confirmed").length,
      generated: productTasks.filter((task) => ["generated", "qa_failed", "pending_review", "approved", "queued", "published", "url_filled", "measured"].includes(task.status)).length
    };
  }

  function handleAiSuggestMatrix() {
    setPublishMatrix((current) => suggestPublishMatrix(current, productPlanTotal || weeklyPlan.targetTotalCount || publishMatrixTotal));
    messageApi.success("已按未锁定日期生成发布矩阵建议。");
  }

  function openTaskEditor(task: ContentTask) {
    setEditingTask(task);
    taskForm.setFieldsValue({
      ...task,
      knowledgeBaseIds: normalizeKnowledgeBaseIds(task.knowledgeBaseIds, task.knowledgeBaseId),
      targetKeywords: task.targetKeywords.join("，")
    });
  }

  async function handleSaveTask() {
    if (!editingTask) {
      return;
    }

    const values = taskForm.getFieldsValue();
    setSavingTask(true);

    try {
      const result = await callJsonApi(`/api/content-tasks/${editingTask.id}`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "计划项已保存"));
      setEditingTask(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存计划项失败");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleRegenerateTitle(taskId: string) {
    setRegeneratingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}/regenerate-title`, { method: "POST" });
      await refresh();
      messageApi.success(formatApiMessage(result, "渠道标题已重生成"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重生成失败");
    } finally {
      setRegeneratingTaskId(undefined);
    }
  }

  async function handleConfirmTasks(
    taskIds?: string[],
    mode: "single" | "batch" = taskIds?.length === 1 ? "single" : "batch",
    options: { riskAcceptanceReason?: string } = {}
  ) {
    const ids = taskIds?.length ? taskIds : selectedPlannedTaskIds;
    const isSingle = ids.length === 1;

    if (!ids.length) {
      messageApi.warning("请先选择计划中任务。");
      return false;
    }

    if (isSingle) {
      setConfirmingTaskId(ids[0]);
    } else {
      setBatchConfirming(true);
    }

    try {
      const result = await callJsonApi<{ message?: string; data?: { confirmed?: number; reviewRequired?: Array<{ taskId: string; title: string; reasons: string[] }> } }>("/api/content-tasks/confirm", {
        method: "POST",
        body: JSON.stringify({ taskIds: ids, mode, riskAcceptanceReason: options.riskAcceptanceReason })
      });
      await refresh();
      setSelectedTaskIds((current) => current.filter((taskId) => !ids.includes(String(taskId))));
      const reviewCount = result.data?.reviewRequired?.length || 0;
      messageApi.success(formatApiMessage(result, `已确认 ${result.data?.confirmed || ids.length} 个计划项${reviewCount ? `，${reviewCount} 条保留复核` : ""}`));
      return true;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认计划项失败");
      return false;
    } finally {
      if (isSingle) {
        setConfirmingTaskId(undefined);
      } else {
        setBatchConfirming(false);
      }
    }
  }

  function openRiskConfirmModal(task: ContentTask) {
    setRiskConfirmTask(task);
    setRiskConfirmReason("");
  }

  async function handleAcceptRiskAndConfirm() {
    if (!riskConfirmTask) {
      return;
    }

    const reason = riskConfirmReason.trim();

    if (!reason) {
      messageApi.warning("请填写接受风险原因。");
      return;
    }

    const confirmed = await handleConfirmTasks([riskConfirmTask.id], "single", { riskAcceptanceReason: reason });

    if (confirmed) {
      setRiskConfirmTask(undefined);
      setRiskConfirmReason("");
    }
  }

  async function handleRejectTask() {
    if (!rejectingTask) {
      return;
    }

    const reason = rejectionReason.trim();

    if (!reason) {
      messageApi.warning("请填写驳回原因。");
      return;
    }

    setReviewingTaskId(rejectingTask.id);

    try {
      const result = await callJsonApi(`/api/content-tasks/${rejectingTask.id}/review`, {
        method: "POST",
        body: JSON.stringify({ action: "reject", reason })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "计划项已驳回"));
      setRejectingTask(undefined);
      setRejectionReason("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "驳回计划项失败");
    } finally {
      setReviewingTaskId(undefined);
    }
  }

  async function handleRestoreTask(taskId: string) {
    setReviewingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}/review`, {
        method: "POST",
        body: JSON.stringify({ action: "restore", reason: "人工重新入池，继续作为周计划候选。" })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "计划项已重新入池"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重新入池失败");
    } finally {
      setReviewingTaskId(undefined);
    }
  }

  async function handleDeleteTask(taskId: string) {
    setDeletingTaskId(taskId);

    try {
      const result = await callJsonApi(`/api/content-tasks/${taskId}`, { method: "DELETE" });
      await refresh();
      setSelectedTaskIds((current) => current.filter((id) => String(id) !== taskId));
      messageApi.success(formatApiMessage(result, "计划项已删除"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除计划项失败");
    } finally {
      setDeletingTaskId(undefined);
    }
  }

  function clearTaskFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
    setSourceFilter([]);
    setFeedbackFilter([]);
  }

  function renderOptionalValue(value?: string) {
    return value || <span className="muted">待补</span>;
  }

  function renderOfficialLink(value?: string) {
    if (!value) {
      return <span className="muted">待补</span>;
    }

    return (
      <a href={value} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        {value}
      </a>
    );
  }

  function getRiskTags(record: ContentTask) {
    const risks: Array<{ color: string; label: string }> = [];

    if (!record.primaryDistilledTerm || !record.sourceProblem) {
      risks.push({ color: "orange", label: "语义约束待补" });
    }

    if (!record.officialLinkTarget) {
      risks.push({ color: "red", label: "官网链接待补" });
    }

    if ((record.confidence ?? 1) < 0.65) {
      risks.push({ color: "red", label: "未达确认阈值" });
    }

    if (isBlockingRiskNote(record.riskNote)) {
      risks.push({ color: "gold", label: "需看风险提示" });
    }

    if (record.status === "qa_failed" || record.qaSummary?.includes("阻断")) {
      risks.push({ color: "red", label: "QA 阻断" });
    } else if (record.qaSummary?.includes("警告")) {
      risks.push({ color: "gold", label: "QA 警告" });
    }

    return risks.length ? risks : [{ color: "green", label: "暂无风险" }];
  }

  function getConfirmReviewReasons(record: ContentTask) {
    const reasons: string[] = [];

    if ((record.confidence ?? 1) < 0.65) {
      reasons.push("未达到自动确认阈值");
    }

    if (!record.officialLinkTarget) {
      reasons.push("官网链接缺失");
    }

    if (!record.primaryDistilledTerm || !record.sourceProblem) {
      reasons.push("语义约束待补");
    }

    if (isBlockingRiskNote(record.riskNote)) {
      reasons.push("风险说明需复核");
    }

    return reasons;
  }

  function isBlockingRiskNote(riskNote?: string) {
    if (!riskNote || riskNote.includes("暂无")) {
      return false;
    }

    return /高风险|阻断|缺失|不足|未提到|越界|夸大|承诺|违规|错误|竞品|不建议/.test(riskNote);
  }

  function getConfirmGuidance(record: ContentTask) {
    const reasons = getConfirmReviewReasons(record);

    if (!reasons.length) {
      return { color: "green", label: "可批量确认", detail: "已满足自动确认条件" };
    }

    if (reasons.includes("未达到自动确认阈值")) {
      return { color: "red", label: "需复核", detail: "未达到自动确认阈值，不建议批量确认" };
    }

    return { color: "gold", label: "需复核", detail: "存在硬约束或风险说明待处理" };
  }

  function taskMatchesFeedbackFilter(task: ContentTask, filter: WeeklyPlanFeedbackFilter) {
    if (filter === "needs_review") return task.status === "planned" && getConfirmReviewReasons(task).length > 0;
    if (filter === "rejected") return task.status === "rejected" || Boolean(task.rejectionRecords?.length);
    if (filter === "risk_accepted") return Boolean(task.riskAcceptanceRecords?.length);
    if (filter === "manual_edited") return Boolean(task.editRecords?.some((record) => record.source === "manual"));
    if (filter === "title_regenerated") return Boolean(task.editRecords?.some((record) => record.source === "ai_regenerate" && record.field === "title"));
    if (filter === "low_confidence") return (task.confidence ?? 1) < 0.65;
    return false;
  }

  function renderRiskTags(record: ContentTask) {
    return (
      <Space wrap>
        {getRiskTags(record).map((risk) => (
          <Tag key={risk.label} color={risk.color}>
            {risk.label}
          </Tag>
        ))}
      </Space>
    );
  }

  function renderBatchConfirmDescription() {
    return (
      <Space direction="vertical" size={6}>
        <span>
          可确认 {batchConfirmSummary.confirmableIds.length} 条，需复核 {batchConfirmSummary.reviewRequired.length} 条，总计 {batchConfirmSummary.total} 条。
        </span>
        {batchConfirmSummary.reviewRequired.length ? (
          <Space direction="vertical" size={4}>
            {batchConfirmSummary.reviewRequired.slice(0, 3).map(({ task, reasons }) => (
              <span key={task.id}>
                <Tag color="gold">需复核</Tag>
                {task.title}：{reasons.join("、")}
              </span>
            ))}
            {batchConfirmSummary.reviewRequired.length > 3 ? <span className="muted">还有 {batchConfirmSummary.reviewRequired.length - 3} 条需逐条查看。</span> : null}
          </Space>
        ) : (
          <span className="muted">当前批量范围内没有硬约束缺失或未达确认阈值的任务。</span>
        )}
      </Space>
    );
  }

  function renderPublishMatrixIssues() {
    if (!publishMatrixIssues.length) {
      return null;
    }

    return (
      <Alert
        type={matrixBlockingIssues.length ? "error" : "warning"}
        showIcon
        message="发布矩阵异常"
        description={
          <Space direction="vertical" size={4}>
            {publishMatrixIssues.map((issue) => (
              <span key={`${issue.level}-${issue.date || issue.message}`}>
                <Tag color={issue.level === "error" ? "red" : "gold"}>{issue.level === "error" ? "需处理" : "需确认"}</Tag>
                {issue.message}
              </span>
            ))}
          </Space>
        }
        style={{ marginTop: 12 }}
      />
    );
  }

  function renderGenerationSource() {
    const source = weeklyPlan.generationSource;

    if (!source) {
      return null;
    }

    return (
      <Card
        title="生成来源摘要"
        extra={
          <Space wrap>
            <Tag color={source.mode === "ai_provider" ? "purple" : "blue"}>{source.mode === "ai_provider" ? "AI 生成" : "本地规则生成"}</Tag>
            <Tag>生成规则 {source.promptVersion}</Tag>
            {source.matrixIssueCount ? <Tag color="gold">矩阵提醒 {source.matrixIssueCount}</Tag> : null}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <div className="weekly-source-grid">
          {source.signals.map((signal) => {
            const status = generationSignalStatusLabels[signal.status];

            return (
              <div key={signal.key} className="weekly-source-item">
                <div className="weekly-source-header">
                  <strong>{signal.label}</strong>
                  <Tag color={status.color}>{status.label}</Tag>
                </div>
                <div className="weekly-source-count">{signal.count ?? 0}</div>
                <div className="muted">{signal.summary}</div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  function renderEditRecords(record: ContentTask) {
    const records = (record.editRecords || []).slice(-3).reverse();

    if (!records.length) {
      return <span className="muted">暂无编辑记录</span>;
    }

    return (
      <Space direction="vertical" size={4}>
        {records.map((item) => (
          <span key={item.id}>
            <Tag>{editRecordSourceLabels[item.source]}</Tag>
            {item.label}：{item.before || "空"} → {item.after || "空"}
            <span className="muted"> / {item.editedAt}</span>
          </span>
        ))}
      </Space>
    );
  }

  function renderRiskAcceptanceRecords(record: ContentTask) {
    const records = (record.riskAcceptanceRecords || []).slice(-3).reverse();

    if (!records.length) {
      return <span className="muted">暂无风险确认记录</span>;
    }

    return (
      <Space direction="vertical" size={4}>
        {records.map((item) => (
          <span key={item.id}>
            <Tag color="red">已接受风险</Tag>
            {item.note}
            <span className="muted"> / {item.reasons.join("、")} / {item.acceptedAt}</span>
          </span>
        ))}
      </Space>
    );
  }

  function renderTitleSourceAttributions(record: ContentTask) {
    const attributions = record.titleSourceAttributions || [];

    if (!attributions.length) {
      return <span className="muted">暂无标题来源归因</span>;
    }

    return (
      <Space direction="vertical" size={4}>
        {attributions.map((item) => (
          <span key={`${item.key}-${item.referenceId || item.summary}`}>
            <Tag color={item.role === "primary" ? "green" : "blue"}>{item.role === "primary" ? "主要来源" : "辅助规则"}</Tag>
            <strong>{item.label}</strong>：{item.summary}
          </span>
        ))}
      </Space>
    );
  }

  function renderRejectionRecords(record: ContentTask) {
    const records = (record.rejectionRecords || []).slice(-3).reverse();

    if (!records.length) {
      return <span className="muted">暂无驳回记录</span>;
    }

    return (
      <Space direction="vertical" size={4}>
        {records.map((item) => (
          <span key={item.id}>
            <Tag color={item.restoredAt ? "blue" : "red"}>{item.restoredAt ? "已重新入池" : "已驳回"}</Tag>
            {item.reason}
            <span className="muted">
              {" "}
              / {item.rejectedAt}
              {item.restoredAt ? ` / 重新入池：${item.restoreReason || "未填写原因"}` : ""}
            </span>
          </span>
        ))}
      </Space>
    );
  }

  function renderPlanActions(record: ContentTask) {
    const reviewReasons = getConfirmReviewReasons(record);
    const needsRiskAcceptance = record.status === "planned" && reviewReasons.length > 0;
    const canReject = record.status === "planned" || record.status === "confirmed";
    const canRestore = record.status === "rejected";

    return (
      <Space wrap>
        <Button size="small" onClick={() => openTaskEditor(record)}>
          编辑
        </Button>
        {canRestore ? (
          <Popconfirm
            title="重新放回周计划池？"
            description="重新入池后会回到计划中状态，可继续编辑、确认或再次驳回。"
            okText="重新入池"
            cancelText="取消"
            onConfirm={() => handleRestoreTask(record.id)}
          >
            <Button size="small" type="primary" loading={reviewingTaskId === record.id}>
              重新入池
            </Button>
          </Popconfirm>
        ) : needsRiskAcceptance ? (
          <Button size="small" danger loading={confirmingTaskId === record.id} disabled={record.status !== "planned"} onClick={() => openRiskConfirmModal(record)}>
            接受风险并确认
          </Button>
        ) : (
          <Popconfirm
            title="确认这个计划项？"
            description="确认后只进入本周计划池，正文仍需到今日发布页批量生成。"
            okText="确认"
            cancelText="取消"
            onConfirm={() => handleConfirmTasks([record.id])}
          >
            <Button size="small" type={record.status === "planned" ? "primary" : "default"} loading={confirmingTaskId === record.id} disabled={record.status !== "planned"}>
              确认
            </Button>
          </Popconfirm>
        )}
        <Button size="small" danger disabled={!canReject} loading={reviewingTaskId === record.id} onClick={() => {
          setRejectingTask(record);
          setRejectionReason("");
        }}>
          驳回
        </Button>
        <Popconfirm
          title="重生成渠道标题？"
          description="只更新标题和计划约束，不生成正文。"
          okText="重生成"
          cancelText="取消"
          onConfirm={() => handleRegenerateTitle(record.id)}
        >
          <Button size="small" loading={regeneratingTaskId === record.id} disabled={record.status !== "planned"}>
            重新生成
          </Button>
        </Popconfirm>
        <Popconfirm
          title="删除这个计划项？"
          description="只能删除尚未生成稿件的计划项。"
          okText="删除"
          cancelText="取消"
          onConfirm={() => handleDeleteTask(record.id)}
        >
          <Button size="small" danger loading={deletingTaskId === record.id} disabled={!["planned", "confirmed"].includes(record.status)}>
            删除
          </Button>
        </Popconfirm>
      </Space>
    );
  }

  function renderExpandedTask(record: ContentTask) {
    const confirmGuidance = getConfirmGuidance(record);

    return (
      <div className="weekly-plan-detail-grid">
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">蒸馏词</span>
          <span className="weekly-plan-detail-value">{renderOptionalValue(record.primaryDistilledTerm)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">来源问题</span>
          <span className="weekly-plan-detail-value">{renderOptionalValue(record.sourceProblem)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">官网链接</span>
          <span className="weekly-plan-detail-value">{renderOfficialLink(record.officialLinkTarget)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">风险标记</span>
          <span className="weekly-plan-detail-value">{renderRiskTags(record)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">证据需求</span>
          <span className="weekly-plan-detail-value">{renderOptionalValue(record.evidenceNeed)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">绑定知识库</span>
          <span className="weekly-plan-detail-value">{formatKnowledgeBaseNames(normalizeKnowledgeBaseIds(record.knowledgeBaseIds, record.knowledgeBaseId), knowledgeBaseNameById)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">表达规则包</span>
          <span className="weekly-plan-detail-value">
            {record.productExpressionRulePackageId ? rulePackageNameById.get(record.productExpressionRulePackageId) || record.productExpressionRulePackageId : "未绑定"}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">平台表达准备</span>
          <span className="weekly-plan-detail-value">
            {record.platformExpressionProfileId
              ? record.platformExpressionProfileId + "@" + (record.platformExpressionProfileVersion || "unknown")
              : record.titleRulePackageId
                ? record.titleRulePackageId + "@" + (record.titleRuleVersion || "unknown")
                : "未绑定"}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">平台内容类型</span>
          <span className="weekly-plan-detail-value">
            {record.platformContentType ? platformContentTypeLabels[record.platformContentType] : "待补平台表达准备"}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">标题类别 / 受众</span>
          <span className="weekly-plan-detail-value">
            {renderOptionalValue(record.titleCategory)} / {renderOptionalValue(record.targetAudience)}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">标题证据依据</span>
          <span className="weekly-plan-detail-value">
            {record.titleEvidenceBasis?.length ? record.titleEvidenceBasis.join("；") : "未填写"}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">三项前置检查</span>
          <span className="weekly-plan-detail-value">
            {record.platformExpressionPrecheck || record.titlePrecheck ? (
              <Space size={6} wrap>
                <Tag color={(record.platformExpressionPrecheck || record.titlePrecheck)!.evidenceSupported ? "green" : "red"}>证据支持</Tag>
                <Tag color={(record.platformExpressionPrecheck || record.titlePrecheck)!.bodyProvable ? "green" : "red"}>正文可证明</Tag>
                <Tag color={(record.platformExpressionPrecheck || record.titlePrecheck)!.roleBoundarySafe ? "green" : "red"}>角色边界</Tag>
                {(record.platformExpressionPrecheck || record.titlePrecheck)!.notes.length ? <span className="muted">{(record.platformExpressionPrecheck || record.titlePrecheck)!.notes.join("；")}</span> : null}
              </Space>
            ) : (
              "待补平台表达准备"
            )}
          </span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">AI 生成理由</span>
          <span className="weekly-plan-detail-value">{renderOptionalValue(record.titleReason)}</span>
        </div>
        <div className="weekly-plan-detail-item weekly-plan-detail-actions">
          <span className="weekly-plan-detail-label">标题来源归因</span>
          <span className="weekly-plan-detail-value">{renderTitleSourceAttributions(record)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">风险说明</span>
          <span className="weekly-plan-detail-value">{renderOptionalValue(record.riskNote)}</span>
        </div>
        <div className="weekly-plan-detail-item">
          <span className="weekly-plan-detail-label">确认建议</span>
          <span className="weekly-plan-detail-value">
            <Space size={6} wrap>
              <Tag color={confirmGuidance.color}>{confirmGuidance.label}</Tag>
              <span className="muted">{confirmGuidance.detail}</span>
            </Space>
          </span>
        </div>
        <div className="weekly-plan-detail-item weekly-plan-detail-actions" onClick={(event) => event.stopPropagation()}>
          <span className="weekly-plan-detail-label">人工操作</span>
          <span className="weekly-plan-detail-value">{renderPlanActions(record)}</span>
        </div>
        <div className="weekly-plan-detail-item weekly-plan-detail-actions">
          <span className="weekly-plan-detail-label">编辑记录</span>
          <span className="weekly-plan-detail-value">{renderEditRecords(record)}</span>
        </div>
        <div className="weekly-plan-detail-item weekly-plan-detail-actions">
          <span className="weekly-plan-detail-label">风险确认记录</span>
          <span className="weekly-plan-detail-value">{renderRiskAcceptanceRecords(record)}</span>
        </div>
        <div className="weekly-plan-detail-item weekly-plan-detail-actions">
          <span className="weekly-plan-detail-label">驳回记录</span>
          <span className="weekly-plan-detail-value">{renderRejectionRecords(record)}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {contextHolder}
      <PageHeader
        title="周计划生成预览"
        subtitle="这里只判断本周要写什么：标题、渠道、产品、主蒸馏词和来源问题。正文统一到今日发布页批量生成。"
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="计划项" value={currentWeekTasks.length} suffix="条" />
        <MetricCard title="待确认" value={plannedTaskCount} suffix="条" />
        <MetricCard title="已确认" value={confirmedTaskCount} suffix="条" />
        <MetricCard title="渠道计划量" value={channelPlanSummary || "-"} />
        <MetricCard title="产品计划量" value={productPlanSummary || "-"} />
      </div>
      {renderGenerationSource()}
      <Card
        title={`${weeklyPlan.weekStart} ~ ${weeklyPlan.weekEnd}`}
        extra={<Tag color={reviewRequiredCount ? "gold" : "green"}>{reviewRequiredCount ? `需复核 ${reviewRequiredCount} 条` : "可批量确认"}</Tag>}
        style={{ marginBottom: 16 }}
      >
        <div className="weekly-matrix-layout">
          <div className="weekly-plan-toolbar">
            <Form
              form={form}
              layout="inline"
              className="weekly-plan-generate-form"
              initialValues={{
                channels: workspaceSetting.enabledChannels,
                products: workspaceSetting.enabledProducts
              }}
            >
              <Form.Item label="启用渠道" name="channels">
                <Select mode="multiple" style={{ minWidth: 320 }} options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item label="启用产品" name="products">
                <Select mode="multiple" style={{ minWidth: 240 }} options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </Form>
            <div className="weekly-matrix-actions">
              <Button onClick={handleAiSuggestMatrix}>AI 自动生成发布矩阵</Button>
              <Button loading={savingMatrix} disabled={Boolean(matrixBlockingIssues.length)} onClick={handleSavePublishMatrix}>
                保存周发布设置
              </Button>
              <Popconfirm
                title="批量确认前复核"
                description={renderBatchConfirmDescription()}
                okText="确认"
                cancelText="取消"
                okButtonProps={{ disabled: !batchConfirmSummary.confirmableIds.length }}
                onConfirm={() => handleConfirmTasks(batchConfirmCandidateIds, "batch")}
              >
                <Button loading={batchConfirming} disabled={!plannedTaskCount} data-testid="weekly-plan-batch-confirm-button">
                  批量确认
                </Button>
              </Popconfirm>
              <Popconfirm
                title="按产品分组生成/刷新计划预览？"
                description={`会按当前产品配额生成 ${productPlanTotal || publishMatrixTotal} 条标题级计划；只刷新当前启用产品分组的未执行计划项，保留其他产品和已确认/已生成任务。`}
                okText="生成预览"
                cancelText="取消"
                okButtonProps={{ "data-testid": "weekly-plan-generate-confirm", disabled: Boolean(matrixBlockingIssues.length) }}
                onConfirm={handleGeneratePlan}
              >
                <Button type="primary" loading={generating} disabled={Boolean(matrixBlockingIssues.length)} data-testid="weekly-plan-generate-button">
                  按产品分组生成/刷新计划预览
                </Button>
              </Popconfirm>
            </div>
          </div>
          <div>
            <Card
              size="small"
              title="产品/品牌分组配额"
              extra={
                <Space wrap>
                  <Tag color={productMatrixMismatch ? "gold" : "green"}>{`产品配额 ${productPlanTotal} / 每日矩阵 ${publishMatrixTotal}`}</Tag>
                  <Button size="small" onClick={syncMatrixFromProductQuota} disabled={!productPlanTotal}>
                    按产品配额同步每日矩阵
                  </Button>
                </Space>
              }
              style={{ marginTop: 14 }}
            >
              <div className="weekly-product-plan-grid">
                {productPlans.map((plan) => {
                  const stats = getProductPlanTaskStats(plan.product);
                  const planKnowledgeBaseIds = normalizeKnowledgeBaseIds(plan.knowledgeBaseIds, plan.knowledgeBaseId);

                  return (
                    <div className="weekly-product-plan-card" key={plan.product}>
                      <div className="weekly-product-plan-header">
                        <Space size={8} wrap>
                          <Tag color={plan.enabled ? "purple" : "default"}>{productLabels[plan.product]}</Tag>
                          <Tag>{`已生成 ${stats.total}/${plan.weeklyQuota}`}</Tag>
                        </Space>
                        <Checkbox checked={plan.enabled} onChange={(event) => updateProductPlan(plan.product, { enabled: event.target.checked })}>
                          启用
                        </Checkbox>
                      </div>
                      <div className="weekly-product-plan-controls">
                        <InputNumber
                          min={0}
                          max={50}
                          value={plan.weeklyQuota}
                          addonAfter="篇/周"
                          disabled={!plan.enabled}
                          onChange={(value) => updateProductPlan(plan.product, { weeklyQuota: Number(value || 0) })}
                          style={{ width: "100%" }}
                        />
                        <Select
                          mode="multiple"
                          value={plan.channels}
                          disabled={!plan.enabled}
                          options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
                          onChange={(value) => updateProductPlan(plan.product, { channels: value as ChannelKey[] })}
                          placeholder="选择渠道"
                        />
                      </div>
                      <div className="weekly-product-binding-list">
                        <div className="weekly-product-binding-row">
                          <div className="weekly-product-binding-main">
                            <span className="weekly-product-binding-label">绑定知识库</span>
                            <span className={planKnowledgeBaseIds.length ? "weekly-product-binding-value" : "weekly-product-binding-empty"}>
                              {formatKnowledgeBaseNames(planKnowledgeBaseIds, knowledgeBaseNameById)}
                            </span>
                          </div>
                          <Space size={6} wrap>
                            <Button size="small" disabled={!plan.enabled} onClick={() => openProductPlanBindingPicker(plan.product, "knowledge_base")}>
                              {planKnowledgeBaseIds.length ? "调整" : "选择"}
                            </Button>
                            {planKnowledgeBaseIds.length ? (
                              <Button size="small" disabled={!plan.enabled} onClick={() => clearProductPlanBinding(plan.product, "knowledge_base")}>
                                清除
                              </Button>
                            ) : null}
                          </Space>
                        </div>
                        <div className="weekly-product-binding-row">
                          <div className="weekly-product-binding-main">
                            <span className="weekly-product-binding-label">表达规则包</span>
                            <span className={plan.productExpressionRulePackageId ? "weekly-product-binding-value" : "weekly-product-binding-empty"}>{plan.productExpressionRulePackageId ? rulePackageNameById.get(plan.productExpressionRulePackageId) || "已绑定但规则包不可用" : "未绑定"}</span>
                          </div>
                          <Space size={6} wrap>
                            <Button size="small" disabled={!plan.enabled} onClick={() => openProductPlanBindingPicker(plan.product, "rule_package")}>
                              {plan.productExpressionRulePackageId ? "更换" : "选择"}
                            </Button>
                            {plan.productExpressionRulePackageId ? (
                              <Button size="small" disabled={!plan.enabled} onClick={() => clearProductPlanBinding(plan.product, "rule_package")}>
                                清除
                              </Button>
                            ) : null}
                          </Space>
                        </div>
                      </div>
                      <Space size={6} wrap className="weekly-product-plan-stats">
                        <Tag>{`计划中 ${stats.planned}`}</Tag>
                        <Tag color="blue">{`已确认 ${stats.confirmed}`}</Tag>
                        <Tag color="green">{`已生成 ${stats.generated}`}</Tag>
                      </Space>
                    </div>
                  );
                })}
              </div>
              {productMatrixMismatch ? (
                <Alert
                  showIcon
                  type="warning"
                  style={{ marginTop: 12 }}
                  message="产品配额与每日发布矩阵不一致"
                  description="产品配额决定本周各产品要生成多少篇；每日矩阵决定这些任务排在哪些日期。生成前建议先同步，避免计划总量与运营节奏错位。"
                />
              ) : null}
            </Card>
            <div className="weekly-publish-matrix">
              {publishMatrix.map((day) => (
                <div key={day.date} className={`weekly-publish-day ${day.paused ? "weekly-publish-day-paused" : ""}`}>
                  <div className="weekly-publish-day-header">
                    <span>
                      {day.weekday}
                      <span className="muted"> {day.date.slice(5)}</span>
                    </span>
                    <Checkbox checked={day.locked} onChange={(event) => updateMatrixDay(day.date, { locked: event.target.checked })}>
                      锁定
                    </Checkbox>
                  </div>
                  <InputNumber
                    min={0}
                    max={10}
                    value={day.plannedCount}
                    disabled={day.locked}
                    addonAfter="篇"
                    onChange={(value) => updateMatrixDay(day.date, { plannedCount: Number(value || 0), paused: Number(value || 0) === 0 })}
                    style={{ width: "100%" }}
                  />
                  <Checkbox checked={day.paused} disabled={day.locked} onChange={(event) => updateMatrixDay(day.date, { paused: event.target.checked, plannedCount: event.target.checked ? 0 : Math.max(day.plannedCount, 1) })}>
                    暂停发布
                  </Checkbox>
                  <Tag color={day.source === "ai_suggested" ? "blue" : day.source === "manual" ? "gold" : "default"}>{day.source === "ai_suggested" ? "AI 建议" : day.source === "manual" ? "人工设置" : "默认"}</Tag>
                </div>
              ))}
            </div>
            {renderPublishMatrixIssues()}
          </div>
        </div>
      </Card>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={filteredTasks}
        scroll={{ x: 900 }}
        rowSelection={{
          selectedRowKeys: selectedTaskIds,
          onChange: setSelectedTaskIds,
          getCheckboxProps: (record) => ({
            disabled: record.status !== "planned"
          })
        }}
        title={() => (
          <Space wrap className="weekly-plan-table-filters" style={{ width: "100%" }}>
            <Select
              mode="multiple"
              allowClear
              placeholder="按状态筛选"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 200 }}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按渠道筛选"
              value={channelFilter}
              onChange={(value) => setChannelFilter(value)}
              options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 200 }}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按产品筛选"
              value={productFilter}
              onChange={(value) => setProductFilter(value)}
              options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 220 }}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按来源归因筛选"
              value={sourceFilter}
              onChange={(value) => setSourceFilter(value as WeeklyPlanSourceFilter[])}
              options={Object.entries(sourceFilterLabels).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 220 }}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按反馈信号筛选"
              value={feedbackFilter}
              onChange={(value) => setFeedbackFilter(value as WeeklyPlanFeedbackFilter[])}
              options={Object.entries(feedbackFilterLabels).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 220 }}
            />
            {hasActiveFilter ? (
              <Tag color="blue">
                筛选结果 {filteredTasks.length}/{currentWeekTasks.length}
              </Tag>
            ) : null}
            <Button onClick={clearTaskFilters} disabled={!hasActiveFilter}>
              清空筛选
            </Button>
          </Space>
        )}
        locale={{
          emptyText: (
            <ActionEmpty
              title={hasActiveFilter ? "当前筛选没有计划项" : "还没有周计划预览"}
              description={hasActiveFilter ? "清空筛选或调整条件后再查看。" : "先设置发布节奏、渠道和产品，再生成标题级计划预览。"}
              action={
                hasActiveFilter ? (
                  <Button type="primary" onClick={clearTaskFilters}>
                    清空筛选
                  </Button>
                ) : (
                  <Popconfirm title="生成新的周计划预览？" description="只生成标题级计划，不生成正文。" okText="生成预览" cancelText="取消" onConfirm={handleGeneratePlan}>
                    <Button type="primary" loading={generating}>
                      生成计划预览
                    </Button>
                  </Popconfirm>
                )
              }
            />
          )
        }}
        columns={[
          { title: "日期", dataIndex: "publishDate", width: 110 },
          { title: "标题", dataIndex: "title", ellipsis: true, width: 280 },
          { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as ChannelKey], width: 120 },
          { title: "产品", dataIndex: "product", render: (value) => productLabels[value as ProductKey], width: 140 },
          { title: "状态", dataIndex: "status", render: (value) => <Tag>{statusLabels[value as TaskStatus]}</Tag>, width: 110 }
        ]}
        expandable={{
          expandedRowRender: renderExpandedTask,
          expandRowByClick: true,
          columnWidth: 48
        }}
      />
      <Modal
        title={
          bindingPicker
            ? `${productLabels[bindingPicker.product]} - ${bindingPicker.target === "knowledge_base" ? "选择绑定知识库（可多选）" : "选择表达规则包"}`
            : "选择绑定资料"
        }
        open={Boolean(bindingPicker)}
        footer={null}
        width={860}
        onCancel={closeProductPlanBindingPicker}
      >
        <Input.Search
          allowClear
          value={bindingPickerQuery}
          placeholder={bindingPicker?.target === "knowledge_base" ? "搜索名称或用途" : "搜索名称、用途或摘要"}
          onChange={(event) => setBindingPickerQuery(event.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Table
          rowKey="id"
          size="small"
          dataSource={bindingPickerItems}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          scroll={{ x: 760 }}
          locale={{ emptyText: bindingPicker?.target === "knowledge_base" ? "暂无可绑定知识库" : "暂无可绑定表达规则包" }}
          columns={[
            {
              title: "名称",
              render: (_, record: KnowledgeBase) => (
                <Space direction="vertical" size={2}>
                  <span>{record.name}</span>
                  <span className="muted">{record.usageScope || "未填写用途范围"}</span>
                </Space>
              )
            },
            {
              title: "类型",
              width: 110,
              render: (_, record: KnowledgeBase) => <Tag>{knowledgeBaseTypeLabels[record.type]}</Tag>
            },
            {
              title: bindingPicker?.target === "knowledge_base" ? "状态" : "规则版本",
              width: 130,
              render: (_, record: KnowledgeBase) => {
                if (bindingPicker?.target === "knowledge_base") {
                  return <Tag color={record.status === "enabled" ? "green" : "default"}>{record.status === "enabled" ? "启用" : "停用"}</Tag>;
                }

                const ruleDraft = record.productExpressionRuleDraft;
                const status = ruleDraft ? rulePackageStatusLabels[ruleDraft.status] : undefined;

                return (
                  <Space size={4} wrap>
                    <Tag>{ruleDraft?.version || "未生成"}</Tag>
                    {status ? <Tag color={status.color}>{status.label}</Tag> : null}
                  </Space>
                );
              }
            },
            ...(bindingPicker?.target === "rule_package"
              ? [
                  {
                    title: "摘要",
                    render: (_: unknown, record: KnowledgeBase) => {
                      const summary = record.productExpressionRuleDraft?.summary;

                      return <span className="weekly-binding-picker-summary">{summary || "暂无摘要"}</span>;
                    }
                  }
                ]
              : []),
            {
              title: "操作",
              width: 110,
              render: (_, record: KnowledgeBase) => {
                const selected = bindingPicker?.target === "knowledge_base" ? selectedKnowledgeBaseIds.includes(record.id) : selectedRulePackageId === record.id;

                return (
                  <Button size="small" type={selected ? "primary" : "default"} onClick={() => handleSelectProductPlanBinding(record.id)}>
                    {bindingPicker?.target === "knowledge_base" ? (selected ? "已绑定" : "添加") : selected ? "已选择" : "选择"}
                  </Button>
                );
              }
            }
          ]}
        />
      </Modal>
      <Modal title="编辑计划项" open={Boolean(editingTask)} confirmLoading={savingTask} onOk={handleSaveTask} onCancel={() => setEditingTask(undefined)}>
        <Form form={taskForm} layout="vertical">
          <Form.Item label="发布日期" name="publishDate">
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="渠道" name="channel">
            <Select options={Object.entries(channelLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="产品" name="product">
            <Select options={Object.entries(productLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="内容类型" name="contentType">
            <Select options={Object.entries(contentTypeLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="平台内容类型" name="platformContentType">
            <Select options={Object.entries(platformContentTypeLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="绑定知识库" name="knowledgeBaseIds">
            <Select mode="multiple" allowClear options={knowledgeBaseOptions} placeholder="选择本任务优先引用的知识库" />
          </Form.Item>
          <Form.Item label="表达规则包" name="productExpressionRulePackageId">
            <Select allowClear options={rulePackageOptions} placeholder="选择本任务使用的产品表达规则包" />
          </Form.Item>
          <Form.Item label="标题" name="title">
            <Input />
          </Form.Item>
          <Form.Item label="标题类别" name="titleCategory">
            <Input placeholder="例如：风险现场还原型" />
          </Form.Item>
          <Form.Item label="目标用户" name="targetAudience">
            <Input placeholder="本标题只选择一个主要受众" />
          </Form.Item>
          <Form.Item label="标题证据依据" name="titleEvidenceBasis">
            <Select mode="tags" allowClear placeholder="填写官网、案例、产品文档或调研依据" />
          </Form.Item>
          <Form.Item label="主蒸馏词" name="primaryDistilledTerm">
            <Input />
          </Form.Item>
          <Form.Item label="来源问题" name="sourceProblem">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="官网链接目标" name="officialLinkTarget">
            <Input placeholder="https://jotoai.com" />
          </Form.Item>
          <Form.Item label="证据需求" name="evidenceNeed">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="AI 生成理由" name="titleReason">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="风险说明" name="riskNote">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="locked" valuePropName="checked">
            <Checkbox>锁定该计划项</Checkbox>
          </Form.Item>
          <Form.Item label="目标关键词" name="targetKeywords">
            <Input placeholder="多个关键词用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="接受风险并确认"
        open={Boolean(riskConfirmTask)}
        confirmLoading={riskConfirmTask ? confirmingTaskId === riskConfirmTask.id : false}
        okText="接受风险并确认"
        cancelText="取消"
        okButtonProps={{ disabled: !riskConfirmReason.trim(), danger: true }}
        onOk={handleAcceptRiskAndConfirm}
        onCancel={() => {
          setRiskConfirmTask(undefined);
          setRiskConfirmReason("");
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="该计划项存在需复核风险"
            description={
              <Space direction="vertical" size={4}>
                {riskConfirmTask
                  ? getConfirmReviewReasons(riskConfirmTask).map((reason) => (
                      <span key={reason}>
                        <Tag color="gold">需复核</Tag>
                        {reason}
                      </span>
                    ))
                  : null}
              </Space>
            }
          />
          <Input.TextArea
            rows={4}
            value={riskConfirmReason}
            onChange={(event) => setRiskConfirmReason(event.target.value)}
            placeholder="请说明为什么仍然确认，例如：已有线下案例证据、人工已补充官网链接、该渠道允许轻度风险表达。"
          />
        </Space>
      </Modal>
      <Modal
        title="驳回计划项"
        open={Boolean(rejectingTask)}
        confirmLoading={rejectingTask ? reviewingTaskId === rejectingTask.id : false}
        okText="驳回"
        cancelText="取消"
        okButtonProps={{ disabled: !rejectionReason.trim(), danger: true }}
        onOk={handleRejectTask}
        onCancel={() => {
          setRejectingTask(undefined);
          setRejectionReason("");
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="驳回后不会删除计划项"
            description="该标题会保留为后续模型评估和运营复盘信号，可在需要时重新入池。"
          />
          <Input.TextArea
            rows={4}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="请说明驳回原因，例如：标题不适合本周、证据不足、重复选题、产品表达风险过高。"
          />
        </Space>
      </Modal>
    </>
  );
}
