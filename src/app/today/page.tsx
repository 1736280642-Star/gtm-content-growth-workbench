"use client";

import { Alert, Button, Card, Checkbox, Drawer, Input, List, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import Link from "next/link";
import { useMemo, useState, type Key } from "react";
import { ActionEmpty } from "@/components/ActionEmpty";
import { MetricCard } from "@/components/MetricCard";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ApiRequestError, callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { isDateInWeek } from "@/lib/date-utils";
import {
  channelLabels,
  channelDistributionTargets,
  distributionPlatformLabels,
  distributionTargetStatusColors,
  distributionTargetStatusLabels,
  fixedDistributionPlatforms,
  productLabels,
  statusLabels
} from "@/lib/labels";
import type {
  ArticleDraft,
  ChannelKey,
  ContentTask,
  DistributionTarget,
  DistributionPlatformKey,
  DraftQualityGrade,
  KnowledgeBase,
  KnowledgeChunk,
  ProductExpressionRuleDraft,
  ProductKey,
  PublishRecord,
  TaskStatus
} from "@/lib/types";

type TodayNextStep =
  | "generate_draft"
  | "fix_generation"
  | "fix_qa"
  | "preview_copy"
  | "confirm_published"
  | "fill_url"
  | "record_metrics"
  | "closed";

type MissingEvidenceItem = {
  taskId: string;
  title: string;
  reasons: string[];
};

const qualityGradeLabels: Record<DraftQualityGrade, string> = {
  A: "A级 可直接分发",
  B: "B级 有提醒，可分发",
  C: "C级 需人工复核",
  D: "D级 阻断，不可分发"
};

const qualityGradeColors: Record<DraftQualityGrade, string> = {
  A: "green",
  B: "gold",
  C: "orange",
  D: "red"
};

const ruleDraftStatusLabels: Record<ProductExpressionRuleDraft["status"], string> = {
  draft: "未生效",
  active: "已生效",
  archived: "已归档"
};

const ruleDraftStatusColors: Record<ProductExpressionRuleDraft["status"], string> = {
  draft: "gold",
  active: "green",
  archived: "default"
};

function getDraftGenerationIssueTags(draft?: ArticleDraft) {
  const reasons = draft?.generationSource?.failureReasons || [];

  if (!reasons.length) {
    return [];
  }

  return reasons.slice(0, 2).map((reason) => ({
    key: `${draft?.id}-${reason.code}`,
    label: reason.label,
    color: reason.severity === "blocker" ? "red" : "gold",
    nextAction: reason.nextAction
  }));
}

function getDraftQualityGrade(draft?: ArticleDraft): DraftQualityGrade | undefined {
  if (!draft) {
    return undefined;
  }

  if (draft.qaResult.qualityGrade) {
    return draft.qaResult.qualityGrade;
  }

  if (!draft.qaResult.passed) {
    return "D";
  }

  return draft.qaResult.warnings.length ? "B" : "A";
}

function isDraftDistributionAllowed(draft?: ArticleDraft) {
  if (!draft) {
    return false;
  }

  return draft.qaResult.distributionAllowed ?? draft.qaResult.copyAllowed ?? draft.qaResult.passed;
}

function getDraftQualityIssues(draft?: ArticleDraft) {
  if (!draft) {
    return ["未生成正文"];
  }

  const issueLabels = (draft.qaResult.issues || [])
    .map((issue) => issue.label || issue.rule)
    .filter((label): label is string => Boolean(label?.trim()));
  const fallbackLabels = [...(draft.qaResult.blockers || []), ...(draft.qaResult.warnings || []), ...getDraftGenerationIssueTags(draft).map((item) => item.label)];
  const uniqueLabels = Array.from(new Set([...issueLabels, ...fallbackLabels]));

  return uniqueLabels.length ? uniqueLabels.slice(0, 3) : ["无高优先级问题"];
}

function canBatchGenerate(task: ContentTask, publishRecord?: PublishRecord) {
  return !publishRecord && ["confirmed", "generated", "qa_failed", "pending_review"].includes(task.status);
}

function getTodayNextStep(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord): TodayNextStep {
  if (publishRecord?.channelMetrics) {
    return "closed";
  }

  if (publishRecord?.publishStatus === "url_filled" || publishRecord?.publishedUrl) {
    return "record_metrics";
  }

  if (publishRecord?.publishStatus === "published") {
    return "fill_url";
  }

  if (publishRecord?.publishStatus === "queued") {
    return "confirm_published";
  }

  if (!draft) {
    return "generate_draft";
  }

  if (draft.generationSource?.status === "pending_config" || draft.generationSource?.status === "failed") {
    return "fix_generation";
  }

  if (!isDraftDistributionAllowed(draft)) {
    return "fix_qa";
  }

  return draft.status === "final" ? "confirm_published" : "preview_copy";
}

function getTodayActionText(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord) {
  const nextStep = getTodayNextStep(task, draft, publishRecord);

  if (nextStep === "generate_draft") {
    return "勾选任务后统一批量生成正文，不在单行里单篇生成。";
  }

  if (nextStep === "fix_generation") {
    const issueTags = getDraftGenerationIssueTags(draft);
    return issueTags[0]?.nextAction || "生成配置或上次生成结果异常，勾选后重新批量生成，必要时联系工作台运营检查配置。";
  }

  if (nextStep === "fix_qa") {
    return "进入草稿预览页处理阻断项，二次质检通过后才能复制发布。";
  }

  if (nextStep === "preview_copy") {
    return "进入草稿预览，人工修改并通过 AI 二次质检后复制全文发布。";
  }

  if (nextStep === "confirm_published") {
    return "外部渠道已经人工发布后，在这里确认已发布，系统会提醒继续回填 URL。";
  }

  if (nextStep === "fill_url") {
    return "正式链接还没回填，先补 URL，后续数据回传才能准确匹配。";
  }

  if (nextStep === "record_metrics") {
    return "发布和 URL 已闭环，去数据回传页导入渠道指标。";
  }

  return "发布、URL 和渠道数据都已闭环。";
}

function getChunkLabel(chunk: KnowledgeChunk) {
  return `${chunk.sourceTitle} / ${chunk.chunkTitle}`;
}

export default function TodayPage() {
  const {
    state: { tasks, weeklyPlan, drafts, publishRecords, platformDraftVariants, distributionTargets, knowledgeBases },
    loading,
    error,
    refresh
  } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchWritingPlatformDrafts, setBatchWritingPlatformDrafts] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Key[]>([]);
  const [markingPublishedTaskId, setMarkingPublishedTaskId] = useState<string>();
  const [fillingUrlTaskId, setFillingUrlTaskId] = useState<string>();
  const [writingPlatformDraftTaskId, setWritingPlatformDraftTaskId] = useState<string>();
  const [urlTask, setUrlTask] = useState<ContentTask>();
  const [publishedUrl, setPublishedUrl] = useState("");
  const [briefTask, setBriefTask] = useState<ContentTask>();
  const [selectedChunkIdsByTask, setSelectedChunkIdsByTask] = useState<Record<string, string[]>>({});
  const [evidenceSupplementByTask, setEvidenceSupplementByTask] = useState<Record<string, string>>({});
  const [serverMissingEvidenceByTask, setServerMissingEvidenceByTask] = useState<Record<string, string[]>>({});
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [channelFilter, setChannelFilter] = useState<ChannelKey[]>([]);
  const [productFilter, setProductFilter] = useState<ProductKey[]>([]);
  const currentWeekTasks = useMemo(
    () => tasks.filter((task) => task.weeklyPlanId === weeklyPlan.id || isDateInWeek(task.publishDate, weeklyPlan.weekStart)),
    [tasks, weeklyPlan.id, weeklyPlan.weekStart]
  );
  const activeTasks = currentWeekTasks.filter((task) => task.status !== "planned");
  const draftByTaskId = useMemo(() => new Map(drafts.map((draft) => [draft.taskId, draft])), [drafts]);
  const enabledChunks = useMemo(
    () =>
      knowledgeBases.flatMap((knowledgeBase) =>
        (knowledgeBase.chunks || [])
          .filter((chunk) => knowledgeBase.status === "enabled" && chunk.status === "enabled")
          .map((chunk) => ({
            ...chunk,
            sourceTitle: chunk.sourceTitle || knowledgeBase.name
          }))
      ),
    [knowledgeBases]
  );
  const publishRecordByTaskId = useMemo(
    () =>
      new Map(
        publishRecords
          .map((record) => {
            const draft = drafts.find((item) => item.id === record.draftId);

            return draft ? ([draft.taskId, record] as const) : undefined;
          })
          .filter((item): item is readonly [string, PublishRecord] => Boolean(item))
      ),
    [drafts, publishRecords]
  );
  const distributionTargetsByPublishRecordId = useMemo(() => {
    const map = new Map<string, DistributionTarget[]>();

    for (const target of distributionTargets || []) {
      const list = map.get(target.publishRecordId) || [];
      list.push(target);
      map.set(target.publishRecordId, list);
    }

    return map;
  }, [distributionTargets]);
  const platformDraftVariantById = useMemo(() => new Map((platformDraftVariants || []).map((variant) => [variant.id, variant])), [platformDraftVariants]);
  const hasActiveFilter = Boolean(statusFilter.length || channelFilter.length || productFilter.length);
  const filteredTodayTasks = activeTasks.filter((task) => {
    const statusMatched = !statusFilter.length || statusFilter.includes(task.status);
    const channelMatched = !channelFilter.length || channelFilter.includes(task.channel);
    const productMatched = !productFilter.length || productFilter.includes(task.product);

    return statusMatched && channelMatched && productMatched;
  });
  const selectedGeneratableIds = selectedTaskIds
    .map(String)
    .filter((taskId) => {
      const task = activeTasks.find((item) => item.id === taskId);
      return Boolean(task && canBatchGenerate(task, publishRecordByTaskId.get(task.id)));
    });
  const pendingGenerateCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "generate_draft").length;
  const pendingUrlCount = filteredTodayTasks.filter((task) => getTodayNextStep(task, draftByTaskId.get(task.id), publishRecordByTaskId.get(task.id)) === "fill_url").length;
  function getTaskDistributionTargets(task: ContentTask) {
    const publishRecord = publishRecordByTaskId.get(task.id);
    return publishRecord ? distributionTargetsByPublishRecordId.get(publishRecord.id) || [] : [];
  }

  function hasPlatformDraftCreated(task: ContentTask) {
    return getTaskDistributionTargets(task).some((target) => target.status === "draft_created");
  }

  function hasPlatformDraftWriteFailure(task: ContentTask) {
    return getTaskDistributionTargets(task).some((target) => target.status === "failed" || target.status === "auth_required");
  }

  function canWritePlatformDraft(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);

    if (!draft || !isDraftDistributionAllowed(draft)) {
      return false;
    }

    return !hasPlatformDraftCreated(task) || hasPlatformDraftWriteFailure(task);
  }

  function getTaskTargetPlatforms(task: ContentTask): DistributionPlatformKey[] {
    return channelDistributionTargets[task.channel] || [];
  }

  const pendingPlatformDraftCount = filteredTodayTasks.filter(canWritePlatformDraft).length;
  const platformDraftCreatedCount = filteredTodayTasks.filter((task) => {
    const publishRecord = publishRecordByTaskId.get(task.id);
    return Boolean(publishRecord && (distributionTargetsByPublishRecordId.get(publishRecord.id) || []).some((target) => target.status === "draft_created"));
  }).length;
  const selectedWritableTasks = selectedTaskIds
    .map(String)
    .map((taskId) => activeTasks.find((item) => item.id === taskId))
    .filter((task): task is ContentTask => Boolean(task && canWritePlatformDraft(task)));
  const selectedBlockedDistributionTasks = selectedTaskIds
    .map(String)
    .map((taskId) => activeTasks.find((item) => item.id === taskId))
    .filter((task): task is ContentTask => {
      if (!task) {
        return false;
      }

      const draft = draftByTaskId.get(task.id);
      return Boolean(draft && !isDraftDistributionAllowed(draft));
    });
  const selectedWarningDistributionCount = selectedWritableTasks.filter((task) => getDraftQualityGrade(draftByTaskId.get(task.id)) === "B").length;
  const briefRecommendedChunks = useMemo(() => (briefTask ? getRecommendedChunks(briefTask).slice(0, 6) : []), [briefTask, enabledChunks]);

  function getRecommendedChunks(task: ContentTask) {
    const term = task.primaryDistilledTerm || "";
    const knowledgeBaseIds = task.knowledgeBaseIds?.length ? task.knowledgeBaseIds : task.knowledgeBaseId ? [task.knowledgeBaseId] : [];
    const candidateChunks = knowledgeBaseIds.length ? enabledChunks.filter((chunk) => knowledgeBaseIds.includes(chunk.knowledgeBaseId)) : enabledChunks;
    const matchedChunks = candidateChunks.filter((chunk) => {
      const text = `${chunk.sourceTitle} ${chunk.chunkTitle} ${chunk.content}`;
      return task.targetKeywords.some((keyword) => text.includes(keyword)) || (term ? text.includes(term) : false);
    });

    return matchedChunks.length ? matchedChunks : candidateChunks;
  }

  function getProductExpressionRuleForTask(task: ContentTask) {
    const candidates = knowledgeBases.filter((knowledgeBase): knowledgeBase is KnowledgeBase & { productExpressionRuleDraft: ProductExpressionRuleDraft } =>
      Boolean(knowledgeBase.productExpressionSource && knowledgeBase.productExpressionRuleDraft)
    );
    const explicitlyBound = task.productExpressionRulePackageId
      ? candidates.find((knowledgeBase) => knowledgeBase.id === task.productExpressionRulePackageId)
      : undefined;

    function isRelevant(knowledgeBase: KnowledgeBase) {
      const draft = knowledgeBase.productExpressionRuleDraft;
      const text = `${knowledgeBase.name} ${knowledgeBase.usageScope} ${knowledgeBase.contentPreview} ${draft?.summary || ""}`.toLowerCase();

      if (task.product === "weike_guardrails") {
        return knowledgeBase.type === "product" || text.includes("唯客") || text.includes("护栏") || text.includes("guardrail");
      }

      return knowledgeBase.type === "brand" || text.includes("joto") || text.includes("dify");
    }

    return (
      explicitlyBound ||
      candidates.find((knowledgeBase) => knowledgeBase.productExpressionRuleDraft.status === "active" && isRelevant(knowledgeBase)) ||
      candidates.find(isRelevant) ||
      candidates.find((knowledgeBase) => knowledgeBase.productExpressionRuleDraft.status === "active") ||
      candidates[0]
    );
  }

  function getSelectedChunkIds(task: ContentTask) {
    const existingSelection = selectedChunkIdsByTask[task.id];

    if (existingSelection) {
      return existingSelection;
    }

    return getRecommendedChunks(task)
      .slice(0, 4)
      .map((chunk) => chunk.id);
  }

  function setSelectedChunkIds(taskId: string, chunkIds: string[]) {
    setSelectedChunkIdsByTask((current) => ({
      ...current,
      [taskId]: chunkIds
    }));
    clearServerMissingEvidence(taskId);
  }

  function setEvidenceSupplement(taskId: string, value: string) {
    setEvidenceSupplementByTask((current) => ({
      ...current,
      [taskId]: value
    }));
    clearServerMissingEvidence(taskId);
  }

  function clearServerMissingEvidence(taskId: string) {
    setServerMissingEvidenceByTask((current) => {
      if (!current[taskId]) {
        return current;
      }

      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function getEvidenceReview(task: ContentTask) {
    const selectedChunkIds = getSelectedChunkIds(task).filter((chunkId) => enabledChunks.some((chunk) => chunk.id === chunkId));
    const evidenceSupplement = evidenceSupplementByTask[task.id]?.trim() || "";
    const missing = !selectedChunkIds.length && !evidenceSupplement;

    return {
      task,
      selectedChunkIds,
      evidenceSupplement,
      missing,
      reason: missing ? task.evidenceNeed || "缺少可直接引用的知识库证据，请在 Brief 中选择证据片段或补充人工证据。" : ""
    };
  }

  function getBatchEvidenceReview(taskIds = selectedGeneratableIds) {
    const reviews = taskIds
      .map((taskId) => activeTasks.find((item) => item.id === taskId))
      .filter((task): task is ContentTask => Boolean(task))
      .map(getEvidenceReview);

    return {
      reviews,
      ready: reviews.filter((item) => !item.missing),
      missingEvidenceReview: reviews.filter((item) => item.missing)
    };
  }

  function renderBatchGenerateDescription() {
    const { reviews, ready, missingEvidenceReview } = getBatchEvidenceReview();

    if (!reviews.length) {
      return "只处理已勾选的已确认任务，不会自动发布到外部平台。";
    }

    return (
      <Space direction="vertical" size={4}>
        <span>{`证据完整性复核：已选 ${reviews.length} 条，可生成 ${ready.length} 条，待补证据 ${missingEvidenceReview.length} 条。`}</span>
        {missingEvidenceReview.length ? (
          <span className="muted">{`待补：${missingEvidenceReview.map((item) => item.task.title).join("、")}`}</span>
        ) : (
          <span className="muted">生成时会记录所选证据片段、人工补充证据和产品表达规则包版本。</span>
        )}
      </Space>
    );
  }

  function buildEvidencePayload(taskIds: string[]) {
    const evidenceByTaskId: Record<string, unknown> = {};

    for (const taskId of taskIds) {
      const task = activeTasks.find((item) => item.id === taskId);

      if (!task) {
        continue;
      }

      const selectedChunkIds = getSelectedChunkIds(task);
      const selectedChunks = enabledChunks.filter((chunk) => selectedChunkIds.includes(chunk.id));
      evidenceByTaskId[taskId] = {
        selectedChunkIds,
        evidenceSummary: selectedChunks.length ? selectedChunks.map(getChunkLabel).join("；") : undefined,
        missingEvidence: selectedChunks.length ? [] : [task.evidenceNeed || "缺少可直接引用的知识库证据。"],
        evidenceSupplement: evidenceSupplementByTask[taskId]
      };
    }

    return evidenceByTaskId;
  }

  function getServerMissingEvidenceItems(payload: unknown): MissingEvidenceItem[] {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return [];
    }

    const data = (payload as { data?: { missingEvidence?: unknown } }).data;
    const missingEvidence = data?.missingEvidence;

    if (!Array.isArray(missingEvidence)) {
      return [];
    }

    return missingEvidence
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return undefined;
        }

        const value = item as Record<string, unknown>;
        const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
        const title = typeof value.title === "string" ? value.title : "待补证据任务";
        const reasons = Array.isArray(value.reasons)
          ? value.reasons.filter((reason): reason is string => typeof reason === "string" && Boolean(reason.trim()))
          : [];

        return taskId ? { taskId, title, reasons } : undefined;
      })
      .filter((item): item is MissingEvidenceItem => Boolean(item));
  }

  function handleServerMissingEvidence(error: unknown) {
    if (!(error instanceof ApiRequestError)) {
      return false;
    }

    const missingEvidence = getServerMissingEvidenceItems(error.payload);

    if (!missingEvidence.length) {
      return false;
    }

    setServerMissingEvidenceByTask((current) => {
      const next = { ...current };

      for (const item of missingEvidence) {
        next[item.taskId] = item.reasons.length ? item.reasons : ["服务端复核发现证据不足，请在 Brief 中选择证据片段或补充人工证据。"];
      }

      return next;
    });

    const firstMissing = missingEvidence[0];
    const firstMissingTask = activeTasks.find((task) => task.id === firstMissing.taskId);

    if (firstMissingTask) {
      setBriefTask(firstMissingTask);
    }

    messageApi.warning("服务端证据复核未通过，已打开待补证据任务的 Brief。");
    return true;
  }

  function clearFilters() {
    setStatusFilter([]);
    setChannelFilter([]);
    setProductFilter([]);
  }

  async function handleBatchGenerate() {
    if (!selectedGeneratableIds.length) {
      messageApi.warning("请先勾选已确认且尚未发布的任务。");
      return;
    }

    const { missingEvidenceReview } = getBatchEvidenceReview();

    if (missingEvidenceReview.length) {
      const firstMissingTask = missingEvidenceReview[0].task;
      setBriefTask(firstMissingTask);
      messageApi.warning("生成前需要先选择知识库证据，或在 Brief 中补充人工证据。");
      return;
    }

    setBatchGenerating(true);

    try {
      const result = await callJsonApi("/api/content-tasks/batch-generate", {
        method: "POST",
        body: JSON.stringify({
          taskIds: selectedGeneratableIds,
          requireEvidence: true,
          evidenceByTaskId: buildEvidencePayload(selectedGeneratableIds)
        })
      });
      await refresh();
      setSelectedTaskIds([]);
      messageApi.success(formatApiMessage(result, "批量生成完成"));
    } catch (error) {
      if (handleServerMissingEvidence(error)) {
        return;
      }

      messageApi.error(error instanceof Error ? error.message : "批量生成失败");
    } finally {
      setBatchGenerating(false);
    }
  }

  async function handleMarkPublished(task: ContentTask) {
    setMarkingPublishedTaskId(task.id);

    try {
      const result = await callJsonApi(`/api/content-tasks/${task.id}/published`, { method: "PATCH" });
      await refresh();
      setUrlTask(task);
      setPublishedUrl("");
      messageApi.success(formatApiMessage(result, "已确认发布"));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认发布失败");
    } finally {
      setMarkingPublishedTaskId(undefined);
    }
  }

  async function ensurePlatformDraftTargets(task: ContentTask, draft?: ArticleDraft, publishRecord?: PublishRecord) {
    let record = publishRecord;

    if (!draft) {
      throw new Error("请先生成正文并通过草稿质检。");
    }

    if (!isDraftDistributionAllowed(draft)) {
      throw new Error("当前稿件为 C/D 级或存在阻断项，请先进入草稿详情页审计修改并重新质检。");
    }

    if (!record || draft.status !== "final") {
      const approved = await callJsonApi(`/api/article-drafts/${draft.id}/approve`, { method: "POST" });
      record = (approved as { data?: { record?: PublishRecord } }).data?.record;
    }

    if (!record) {
      throw new Error("发布记录准备失败。");
    }

    const prepared = await callJsonApi(`/api/publish-records/${record.id}/distribution-targets`, {
      method: "POST",
      body: JSON.stringify({})
    });

    return (prepared as { data?: { record?: PublishRecord; targets?: DistributionTarget[] } }).data?.targets || [];
  }

  async function writePlatformDraftsForTask(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);
    const publishRecord = publishRecordByTaskId.get(task.id);

    const preparedTargets = await ensurePlatformDraftTargets(task, draft, publishRecord);
    const targetsToSend = preparedTargets.filter((target) => target.status !== "draft_created" && target.status !== "cancelled");

    let successCount = 0;
    let failedCount = 0;

    for (const target of targetsToSend) {
      try {
        const result = await callJsonApi(`/api/distribution-targets/${target.id}/send-draft`, { method: "POST" });
        const nextTarget = (result as { data?: { target?: DistributionTarget } }).data?.target;

        if (nextTarget?.status === "draft_created") {
          successCount += 1;
        } else {
          failedCount += 1;
        }
      } catch {
        failedCount += 1;
      }
    }

    return { successCount, failedCount, totalCount: targetsToSend.length || preparedTargets.length };
  }

  async function handleWritePlatformDrafts(task: ContentTask) {
    setWritingPlatformDraftTaskId(task.id);

    try {
      const { successCount, failedCount, totalCount } = await writePlatformDraftsForTask(task);
      await refresh();

      if (!totalCount) {
        messageApi.info("平台草稿已经创建，无需重复写入。");
        return;
      }

      if (successCount && !failedCount) {
        messageApi.success(`已创建 ${successCount} 个平台草稿。请到平台后台人工确认发布。`);
      } else if (successCount) {
        messageApi.warning(`已创建 ${successCount} 个平台草稿，${failedCount} 个平台需要处理。`);
      } else {
        messageApi.error("平台草稿创建失败，请查看状态提示后重试或走人工发布。");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "平台草稿写入失败");
    } finally {
      setWritingPlatformDraftTaskId(undefined);
    }
  }

  function handleBatchWritePlatformDrafts() {
    if (!selectedTaskIds.length) {
      messageApi.warning("请先勾选要写入平台草稿箱的文章。");
      return;
    }

    const involvedPlatforms = Array.from(
      new Set(selectedWritableTasks.flatMap((task) => getTaskTargetPlatforms(task)).filter((platform) => fixedDistributionPlatforms.includes(platform)))
    );

    Modal.confirm({
      title: "批量写入平台草稿箱",
      content: (
        <Space direction="vertical" size={8}>
          <span>{`本次可写入：${selectedWritableTasks.length} 篇`}</span>
          <span>{`有提醒但允许：${selectedWarningDistributionCount} 篇`}</span>
          <span>{`被拦截：${selectedBlockedDistributionTasks.length} 篇`}</span>
          <span>{`涉及平台：${involvedPlatforms.length ? involvedPlatforms.map((platform) => distributionPlatformLabels[platform]).join(" / ") : "暂无可写入平台"}`}</span>
          {selectedBlockedDistributionTasks.length ? <span className="muted">C/D 级文章需先进入草稿详情页审计或修改。</span> : null}
        </Space>
      ),
      okText: "确认写入",
      cancelText: "取消",
      okButtonProps: { disabled: !selectedWritableTasks.length },
      onOk: async () => {
        setBatchWritingPlatformDrafts(true);

        let successCount = 0;
        let failedCount = 0;

        try {
          for (const task of selectedWritableTasks) {
            try {
              const result = await writePlatformDraftsForTask(task);
              successCount += result.successCount;
              failedCount += result.failedCount;
            } catch {
              failedCount += 1;
            }
          }

          await refresh();
          setSelectedTaskIds([]);

          if (successCount && !failedCount) {
            messageApi.success(`批量写入完成，已创建 ${successCount} 个平台草稿。`);
          } else if (successCount) {
            messageApi.warning(`批量写入完成：成功 ${successCount} 个，失败 ${failedCount} 个。`);
          } else {
            messageApi.error("批量写入未创建成功草稿，请查看表格中的失败原因。");
          }
        } finally {
          setBatchWritingPlatformDrafts(false);
        }
      }
    });
  }

  async function handleFillUrl() {
    if (!urlTask) {
      return;
    }

    setFillingUrlTaskId(urlTask.id);

    try {
      const result = await callJsonApi(`/api/content-tasks/${urlTask.id}/url`, {
        method: "PATCH",
        body: JSON.stringify({ publishedUrl })
      });
      await refresh();
      messageApi.success(formatApiMessage(result, "URL 已回填"));
      setUrlTask(undefined);
      setPublishedUrl("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "URL 回填失败");
    } finally {
      setFillingUrlTaskId(undefined);
    }
  }

  function renderDistributionTargetTags(publishRecord?: PublishRecord) {
    const targets = publishRecord ? distributionTargetsByPublishRecordId.get(publishRecord.id) || [] : [];

    if (!publishRecord) {
      return <Tag>未准备</Tag>;
    }

    if (!targets.length) {
      return <Tag color="gold">待准备</Tag>;
    }

    return (
      <Space size={4} wrap>
        {targets.map((target) => {
          const variant = target.platformVariantId ? platformDraftVariantById.get(target.platformVariantId) : undefined;
          const detail = target.mode === "mock" && target.status === "draft_created" ? "模拟" : target.errorMessage || (variant?.status !== "final" ? "待确认终稿" : undefined);

          return (
            <Tag color={distributionTargetStatusColors[target.status]} key={target.id} title={detail}>
              {`${distributionPlatformLabels[target.platform]} ${distributionTargetStatusLabels[target.status]}${detail === "模拟" ? "（模拟）" : ""}`}
            </Tag>
          );
        })}
      </Space>
    );
  }

  function renderTodayEntry(task: ContentTask) {
    const draft = draftByTaskId.get(task.id);
    const publishRecord = publishRecordByTaskId.get(task.id);
    const nextStep = getTodayNextStep(task, draft, publishRecord);
    const platformDraftCreated = hasPlatformDraftCreated(task);
    const platformDraftFailed = hasPlatformDraftWriteFailure(task);

    if (nextStep === "generate_draft" || nextStep === "fix_generation") {
      return (
        <Space wrap>
          <Button size="small" onClick={() => setSelectedTaskIds([task.id])} disabled={!canBatchGenerate(task, publishRecord)}>
            勾选生成
          </Button>
          <Button size="small" onClick={() => setBriefTask(task)} disabled={!canBatchGenerate(task, publishRecord)} data-testid={`today-brief-${task.id}`}>
            Brief
          </Button>
        </Space>
      );
    }

    if (nextStep === "fix_qa") {
      return (
        <Link href={`/drafts/${task.id}`}>
          <Button size="small" type="primary">
            审计修改
          </Button>
        </Link>
      );
    }

    if (nextStep === "preview_copy" || nextStep === "confirm_published") {
      return (
        <Space wrap>
          {draft ? (
            <Link href={`/drafts/${task.id}`}>
              <Button size="small">预览</Button>
            </Link>
          ) : null}
          {!platformDraftCreated || platformDraftFailed ? (
            <Popconfirm
              title={platformDraftFailed ? "重新写入平台草稿箱？" : "写入平台草稿箱？"}
              description="只会写入平台草稿箱，不会正式发布，也不会自动回填 URL。"
              okText="确认写入"
              cancelText="取消"
              okButtonProps={{ "data-testid": `today-write-platform-drafts-confirm-${task.id}` }}
              onConfirm={() => handleWritePlatformDrafts(task)}
            >
              <Button
                size="small"
                type="primary"
                loading={writingPlatformDraftTaskId === task.id}
                disabled={!isDraftDistributionAllowed(draft)}
                data-testid={`today-write-platform-drafts-${task.id}`}
              >
                {platformDraftFailed ? "重新写入" : "写入平台草稿箱"}
              </Button>
            </Popconfirm>
          ) : null}
          {platformDraftCreated ? (
            <Popconfirm
              title="确认已在外部渠道发布？"
              description="确认后会进入 URL 回填，数据回传仍在数据回传页完成。"
              okText="确认已发布"
              cancelText="取消"
              okButtonProps={{ "data-testid": `today-confirm-published-confirm-${task.id}` }}
              onConfirm={() => handleMarkPublished(task)}
            >
              <Button size="small" type="primary" loading={markingPublishedTaskId === task.id} data-testid={`today-confirm-published-${task.id}`}>
                确认已发布
              </Button>
            </Popconfirm>
          ) : (
            <Button size="small" disabled>
              待平台草稿
            </Button>
          )}
        </Space>
      );
    }

    if (nextStep === "fill_url") {
      return (
        <Button
          size="small"
          type="primary"
          data-testid={`today-fill-url-${task.id}`}
          onClick={() => {
            setUrlTask(task);
            setPublishedUrl(publishRecord?.publishedUrl || "");
          }}
        >
          回填 URL
        </Button>
      );
    }

    if (nextStep === "record_metrics") {
      return (
        <Link href="/publish">
          <Button size="small" type="primary">
            去数据回传
          </Button>
        </Link>
      );
    }

    return <span className="muted">无需操作</span>;
  }

  const briefRulePackage = briefTask ? getProductExpressionRuleForTask(briefTask) : undefined;

  return (
    <>
      {contextHolder}
      <PageHeader
        title="今日发布"
        subtitle="批量生成正文后自动二次质检；A/B 级写入平台草稿箱，C/D 级先审计修改，平台发布后手动回填 URL。"
        actions={
          <Space wrap>
            <Popconfirm
              title="批量生成选中正文？"
              description={renderBatchGenerateDescription()}
              okText="生成"
              cancelText="取消"
              okButtonProps={{ disabled: Boolean(getBatchEvidenceReview().missingEvidenceReview.length) }}
              onConfirm={handleBatchGenerate}
            >
              <Button type="primary" loading={batchGenerating} disabled={!selectedGeneratableIds.length}>
                批量生成正文
              </Button>
            </Popconfirm>
            <Button loading={batchWritingPlatformDrafts} disabled={!selectedWritableTasks.length} onClick={handleBatchWritePlatformDrafts}>
              批量写入平台草稿箱
            </Button>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <div className="metric-grid metric-grid-five">
        <MetricCard title="今日任务池" value={filteredTodayTasks.length} suffix="条" />
        <MetricCard title="待生成" value={pendingGenerateCount} suffix="条" />
        <MetricCard title="待写入草稿" value={pendingPlatformDraftCount} suffix="条" />
        <MetricCard title="草稿已创建" value={platformDraftCreatedCount} suffix="条" />
        <MetricCard title="待回填 URL" value={pendingUrlCount} suffix="条" />
      </div>
      <Card>
        <Alert
          showIcon
          type={pendingUrlCount ? "warning" : pendingGenerateCount ? "info" : "success"}
          message={`已选 ${selectedTaskIds.length} 条；可生成 ${selectedGeneratableIds.length} 条，可写入草稿箱 ${selectedWritableTasks.length} 条，被质量拦截 ${selectedBlockedDistributionTasks.length} 条。`}
          description="今日发布页是发布执行台：批量生成正文、自动二次质检、人工只处理异常稿、写入平台草稿箱、平台后台人工发布、回填 URL。"
          style={{ marginBottom: 16 }}
        />
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
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
          <Button onClick={clearFilters} disabled={!hasActiveFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          className="today-task-table"
          rowKey="id"
          loading={loading}
          dataSource={filteredTodayTasks}
          tableLayout="fixed"
          rowSelection={{
            selectedRowKeys: selectedTaskIds,
            onChange: setSelectedTaskIds
          }}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasActiveFilter ? "当前筛选没有任务" : "今日发布还没有任务"}
                description={hasActiveFilter ? "清空筛选或调整条件后再查看。" : "先在周计划页确认计划项，再回到这里批量生成正文。"}
                action={
                  hasActiveFilter ? (
                    <Button type="primary" onClick={clearFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Link href="/weekly-plan">
                      <Button type="primary">去周计划</Button>
                    </Link>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "日期", dataIndex: "publishDate", width: 88 },
            {
              title: "标题",
              dataIndex: "title",
              width: 168,
              className: "today-title-column",
              onHeaderCell: () => ({ className: "today-title-column" }),
              render: (value) => (
                <span className="today-title-cell" title={value}>
                  {value}
                </span>
              )
            },
            { title: "渠道", dataIndex: "channel", render: (value) => channelLabels[value as ChannelKey], width: 88 },
            { title: "产品", dataIndex: "product", render: (value) => productLabels[value as ProductKey], width: 112 },
            {
              title: "文章质量",
              width: 126,
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);
                const grade = getDraftQualityGrade(draft);

                if (!draft) {
                  return <Tag>未生成</Tag>;
                }

                return (
                  <Space wrap>
                    {grade ? <Tag color={qualityGradeColors[grade]}>{qualityGradeLabels[grade]}</Tag> : <Tag>待质检</Tag>}
                    <Tag>{`v${draft.version}`}</Tag>
                    {draft.generationSource?.fallbackTriggered ? <Tag color="gold">本地兜底稿</Tag> : null}
                  </Space>
                );
              }
            },
            {
              title: "质量问题",
              width: 150,
              render: (_, record) => {
                const draft = draftByTaskId.get(record.id);

                return (
                  <Space size={4} wrap>
                    {getDraftQualityIssues(draft).map((issue) => (
                      <Tag color={issue === "无高优先级问题" ? "green" : "gold"} key={issue}>
                        {issue}
                      </Tag>
                    ))}
                  </Space>
                );
              }
            },
            {
              title: "平台草稿",
              render: (_, record) => renderDistributionTargetTags(publishRecordByTaskId.get(record.id)),
              width: 146
            },
            {
              title: "发布状态",
              width: 126,
              render: (_, record) => {
                const publishRecord = publishRecordByTaskId.get(record.id);

                if (!publishRecord) {
                  return <span className="muted">未确认发布</span>;
                }

                if (publishRecord.publishedUrl) {
                  return <Tag color="green">已回填</Tag>;
                }

                return <Tag color={publishRecord.publishStatus === "published" ? "orange" : "gold"}>{publishRecord.publishStatus === "published" ? "待回填" : "待确认发布"}</Tag>;
              }
            },
            {
              title: "操作",
              render: (_, record) => renderTodayEntry(record),
              width: 198
            }
          ]}
        />
      </Card>
      <Modal
        title="回填正式发布 URL"
        open={Boolean(urlTask)}
        onOk={handleFillUrl}
        confirmLoading={Boolean(urlTask && fillingUrlTaskId === urlTask.id)}
        okButtonProps={{ disabled: !publishedUrl.trim(), "data-testid": "today-url-save-button" }}
        onCancel={() => {
          setUrlTask(undefined);
          setPublishedUrl("");
        }}
      >
        <Alert showIcon type="info" message="确认发布后必须回填 URL，后续渠道数据才能准确匹配到这篇文章。" style={{ marginBottom: 12 }} />
        <Input placeholder="https://..." value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} data-testid="today-url-input" />
      </Modal>
      <Drawer title="生成 Brief 与证据选择" width={680} open={Boolean(briefTask)} onClose={() => setBriefTask(undefined)}>
        {briefTask ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Alert
              showIcon
              type="info"
              message="正文生成会锁定周计划字段"
              description="标题、渠道、产品、主蒸馏词和官网链接目标来自已确认任务；AI 只负责在这些边界内生成正文。"
            />
            {serverMissingEvidenceByTask[briefTask.id]?.length ? (
              <Alert
                showIcon
                type="warning"
                message="服务端证据复核未通过"
                description={
                  <Space direction="vertical" size={2}>
                    {serverMissingEvidenceByTask[briefTask.id].map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </Space>
                }
              />
            ) : null}
            <Card size="small" title="任务 Brief">
              <List
                size="small"
                dataSource={[
                  `标题：${briefTask.title}`,
                  `来源问题：${briefTask.sourceProblem || "本周内容增长计划"}`,
                  `主蒸馏词：${briefTask.primaryDistilledTerm || "待补"}`,
                  `渠道：${channelLabels[briefTask.channel]}`,
                  `产品：${productLabels[briefTask.product]}`,
                  `产品表达规则包：${briefRulePackage ? `${briefRulePackage.productExpressionRuleDraft.version} / ${ruleDraftStatusLabels[briefRulePackage.productExpressionRuleDraft.status]}` : "暂无匹配规则包"}`,
                  `官网链接目标：${briefTask.officialLinkTarget || "https://jotoai.com"}`,
                  `证据需求：${briefTask.evidenceNeed || "待补"}`
                ]}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
            <Card size="small" title="产品表达规则包" data-testid={briefTask ? `today-brief-rule-package-${briefTask.id}` : undefined}>
              {briefRulePackage ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag data-testid={`today-brief-rule-source-${briefTask.id}`}>{briefRulePackage.name}</Tag>
                    <Tag color={ruleDraftStatusColors[briefRulePackage.productExpressionRuleDraft.status]} data-testid={`today-brief-rule-status-${briefTask.id}`}>
                      {ruleDraftStatusLabels[briefRulePackage.productExpressionRuleDraft.status]}
                    </Tag>
                    <Tag data-testid={`today-brief-rule-version-${briefTask.id}`}>{briefRulePackage.productExpressionRuleDraft.version}</Tag>
                  </Space>
                  <span className="muted" data-testid={`today-brief-rule-summary-${briefTask.id}`}>
                    {briefRulePackage.productExpressionRuleDraft.summary}
                  </span>
                  {briefRulePackage.productExpressionRuleDraft.status !== "active" ? (
                    <Alert showIcon type="warning" message="这个规则包还未确认生效，生成记录会保留版本痕迹，但建议先去知识库详情页确认。" />
                  ) : null}
                </Space>
              ) : (
                <ActionEmpty title="暂无匹配规则包" description="先在知识库详情页生成并确认产品表达规则包，再进行批量正文生成。" />
              )}
            </Card>
            <Card size="small" title="知识库证据">
              <Checkbox.Group
                style={{ width: "100%" }}
                value={getSelectedChunkIds(briefTask)}
                onChange={(value) => setSelectedChunkIds(briefTask.id, value.map(String))}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  {(briefRecommendedChunks.length ? briefRecommendedChunks : enabledChunks.slice(0, 6)).map((chunk) => (
                    <Checkbox key={chunk.id} value={chunk.id}>
                      <Space direction="vertical" size={0}>
                        <span>{getChunkLabel(chunk)}</span>
                        <span className="muted">{chunk.content.slice(0, 90)}</span>
                      </Space>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
              {!enabledChunks.length ? <Alert showIcon type="warning" message="暂无可用知识库证据片段，生成时会记录证据缺口。" style={{ marginTop: 12 }} /> : null}
            </Card>
            <Card size="small" title="人工补充证据">
              <Input.TextArea
                rows={4}
                placeholder="可补充服务流程、案例事实、官网说明或业务边界。"
                value={evidenceSupplementByTask[briefTask.id] || ""}
                onChange={(event) => setEvidenceSupplement(briefTask.id, event.target.value)}
              />
            </Card>
            <Alert
              showIcon
              type={getSelectedChunkIds(briefTask).length ? "success" : "warning"}
              message={getSelectedChunkIds(briefTask).length ? `已选择 ${getSelectedChunkIds(briefTask).length} 段证据` : "未选择证据，生成记录会标记证据缺口"}
            />
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
