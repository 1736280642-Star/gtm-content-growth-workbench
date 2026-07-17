"use client";

import Link from "next/link";
import { Alert, Button, Card, Drawer, Form, Input, InputNumber, List, Select, Space, Table, Tabs, Tag, message } from "antd";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDefaultRouteForRole, getRouteLabel, workspaceRoleLabels } from "@/lib/permissions";
import { channelLabels, contentTypeLabels, productLabels } from "@/lib/labels";
import type { PromptTemplate } from "@/lib/prompt-templates";
import type { ChannelKey, ContentType, KnowledgeRagConfig, ProductKey, PublishRecord, WorkspaceRole } from "@/lib/types";
import type { RuntimeCapability, RuntimeCapabilityStatus } from "@/lib/runtime-config";

interface AiGovernanceLog {
  id: string;
  event: string;
  message: string;
  createdAt: string;
}

interface AiGovernanceDraftSource {
  id: string;
  taskId?: string;
  title: string;
  channel?: ChannelKey;
  product?: ProductKey;
  contentType?: ContentType;
  primaryDistilledTerm?: string;
  mode: "local_rule" | "ai_provider";
  provider?: string;
  model?: string;
  promptProfile?: string;
  productExpressionRuleVersion?: string;
  productExpressionRuleSource?: string;
  fallbackTriggered?: boolean;
  failureReasons?: Array<{ code: string; label: string; severity: "blocker" | "warning"; message: string; nextAction: string }>;
  editActionCount?: number;
  manualEditActionCount?: number;
  rewriteActionCount?: number;
  deleteRiskSegmentCount?: number;
  keepRiskSegmentCount?: number;
  qaAcceptedActionCount?: number;
  qaPartialAcceptedActionCount?: number;
  qaIgnoredActionCount?: number;
  qaSuspectedFalsePositiveCount?: number;
  qaSuspectedMissCount?: number;
  qaIssueRuleSummary?: Array<{ rule: string; severity: "blocker" | "warning"; count: number }>;
  totalChangedCharacterCount?: number;
  manualEditChangedCharacterCount?: number;
  rewriteChangedCharacterCount?: number;
  maxChangedRatio?: number;
  averageChangedRatio?: number;
  manualEditAverageChangedRatio?: number;
  heavyEditCount?: number;
  editReasonSummary?: Array<{ reason: string; count: number }>;
  editReasonCategorySummary?: Array<{ code: string; label: string; count: number }>;
  keepRiskReasonCategorySummary?: Array<{ code: string; label: string; count: number }>;
  qaPassed?: boolean;
  qaBlockerCount?: number;
  qaWarningCount?: number;
  publishStatus?: PublishRecord["publishStatus"];
  dataReturned?: boolean;
  status: "success" | "pending_config" | "failed";
  generatedAt?: string;
}

type AiCallLogStatus = "success" | "pending_config" | "failed" | "partial";

interface AiGovernanceCallLog {
  id: string;
  source: "audit_log" | "draft_source" | "pipeline_run";
  event: string;
  module: string;
  moduleLabel: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  productExpressionRuleVersion?: string;
  productExpressionRuleSource?: string;
  inputSummary: string;
  outputStatus: AiCallLogStatus;
  outputSummary: string;
  fallbackTriggered: boolean;
  failureReasons?: Array<{ code: string; label: string; severity: "blocker" | "warning"; message: string; nextAction: string }>;
  createdAt: string;
}

interface AiGovernanceResponse {
  data?: {
    promptTemplates: PromptTemplate[];
    auditLog: AiGovernanceLog[];
    pipelineRuns: Array<{ id: string; status: string; week: string; finishedAt: string }>;
    draftSources: AiGovernanceDraftSource[];
    callLogs: AiGovernanceCallLog[];
    access?: {
      role: WorkspaceRole;
      canViewFullGovernance: boolean;
      message: string;
    };
  };
}

type PromptVersionDetail = PromptTemplate & {
  previousVersion?: string;
  status?: "active" | "rolled_back";
  releaseNote?: string;
  rollbackPolicy?: string;
  rollbackReason?: string;
  rolledBackAt?: string;
  updatedAt?: string;
};

interface PromptVersionResponse {
  ok: boolean;
  message: string;
  data?: {
    promptVersion: PromptVersionDetail;
  };
}

interface DiagnosticResult {
  key: string;
  status: "ready" | "pending_config" | "failed";
  message: string;
  checkedAt?: string;
}

interface DiagnosticResponse {
  status: "ready" | "pending_config" | "failed";
  results: DiagnosticResult[];
}

const providers = [
  { key: "qwen", name: "通义千问", usage: "GEO 测试 / 内容生成", model: "QWEN_MODEL" },
  { key: "deepseek", name: "DeepSeek", usage: "GEO 测试 / 内容生成", model: "DEEPSEEK_MODEL" },
  { key: "doubao", name: "豆包", usage: "GEO 测试", model: "DOUBAO_MODEL" },
  { key: "knowledge_url_crawler", name: "URL 抓取", usage: "知识库 URL 导入", model: "XCRAWL_API_KEY / KNOWLEDGE_PROXY_FETCH_BASE_URL" },
  { key: "xcrawl_blog_sync", name: "博客源", usage: "官网博客同步", model: "XCRAWL_BLOG_INDEX_URL" },
  { key: "mysql_repository", name: "MySQL", usage: "生产级数据持久化", model: "MYSQL_*" }
];

const ragChunkingProviderOptions = [
  { value: "qwen", label: "qwen" },
  { value: "doubao", label: "doubao" },
  { value: "deepseek", label: "deepseek" }
];

const ragEmbeddingModelOptions = [
  { value: "qwen_embedding", label: "qwen_embedding" },
  { value: "doubao_embedding", label: "doubao_embedding" }
];

const ragRetrievalStrategyOptions = [
  { value: "keyword", label: "keyword" },
  { value: "vector", label: "vector" },
  { value: "hybrid", label: "hybrid" }
];

const ragChunkingStrategyOptions = [
  { value: "rule", label: "rule" },
  { value: "auto", label: "auto" },
  { value: "semantic_llm", label: "semantic_llm" }
];

const capabilityStatusLabels: Record<RuntimeCapabilityStatus, string> = {
  ready: "就绪",
  pending_config: "待配置"
};

type CapabilityNextStep = "fill_required_env" | "run_diagnostic" | "inspect_failure" | "local_fallback" | "ready";

const capabilityNextStepLabels: Record<CapabilityNextStep, string> = {
  fill_required_env: "补必填配置",
  run_diagnostic: "执行诊断",
  inspect_failure: "排查失败",
  local_fallback: "本地可跑",
  ready: "可试跑"
};

const capabilityNextStepColors: Record<CapabilityNextStep, string> = {
  fill_required_env: "gold",
  run_diagnostic: "blue",
  inspect_failure: "red",
  local_fallback: "default",
  ready: "green"
};

const capabilityNextStepPriority: Record<CapabilityNextStep, number> = {
  inspect_failure: 0,
  fill_required_env: 1,
  run_diagnostic: 2,
  local_fallback: 3,
  ready: 4
};

const callLogStatusLabels: Record<AiCallLogStatus, string> = {
  success: "成功",
  pending_config: "待配置",
  failed: "失败",
  partial: "部分完成"
};

const callLogStatusColors: Record<AiCallLogStatus, string> = {
  success: "green",
  pending_config: "gold",
  failed: "red",
  partial: "blue"
};

function getCapabilityStatusColor(status?: string) {
  if (status === "ready") return "green";
  if (status === "failed") return "red";
  return "gold";
}

function getCapabilityNextStep(capability: RuntimeCapability | undefined, diagnostic?: DiagnosticResult): CapabilityNextStep {
  if (!capability) {
    return "fill_required_env";
  }

  if (diagnostic?.status === "failed") {
    return "inspect_failure";
  }

  if (capability.status === "pending_config" || diagnostic?.status === "pending_config") {
    return "fill_required_env";
  }

  if (capability.key === "local_json_repository" || capability.key === "csv_log_import") {
    return "local_fallback";
  }

  if (!diagnostic) {
    return "run_diagnostic";
  }

  return "ready";
}

function getCapabilityActionText(capability: RuntimeCapability | undefined, diagnostic?: DiagnosticResult) {
  const nextStep = getCapabilityNextStep(capability, diagnostic);

  if (nextStep === "fill_required_env") {
    return "先补齐必填环境变量，再刷新状态或运行诊断。";
  }

  if (nextStep === "inspect_failure") {
    return diagnostic?.message || "配置存在但诊断失败，先检查 model、base_url 或路径权限。";
  }

  if (nextStep === "local_fallback") {
    return "当前本地 fallback 可用，先保证主链路可跑，再逐步切到真实接入。";
  }

  if (nextStep === "run_diagnostic") {
    return "环境变量已齐，下一步先测试连接，再进入真实场景试跑。";
  }

  return "能力已就绪，可进入对应页面做真实试跑。";
}

function getCapabilityLink(capability: RuntimeCapability | undefined, diagnostic?: DiagnosticResult) {
  if (!capability) {
    return { href: "/real-integration", label: "看缺口" };
  }

  const nextStep = getCapabilityNextStep(capability, diagnostic);

  if (capability.key === "qwen" || capability.key === "deepseek" || capability.key === "doubao") {
    return nextStep === "ready" ? { href: "/geo-test", label: "去试跑" } : { href: "/real-integration", label: "看缺口" };
  }

  if (capability.key === "knowledge_url_crawler") {
    return nextStep === "ready" ? { href: "/knowledge/import/url", label: "去解析" } : { href: "/real-integration", label: "看缺口" };
  }

  if (capability.key === "xcrawl_blog_sync") {
    return nextStep === "ready" ? { href: "/blog-monitor", label: "去同步" } : { href: "/real-integration", label: "看缺口" };
  }

  if (capability.key === "csv_log_import" || capability.key === "nginx_log_import" || capability.key === "cdn_log_import") {
    return nextStep === "ready" || nextStep === "local_fallback" ? { href: "/blog-monitor", label: "去导入" } : { href: "/real-integration", label: "看缺口" };
  }

  if (capability.key === "local_json_repository") {
    return { href: "/weekly-plan", label: "去试跑" };
  }

  return { href: "/real-integration", label: "看接入" };
}

function shouldRunCapabilityDiagnostic(capability: RuntimeCapability | undefined, diagnostic?: DiagnosticResult) {
  const nextStep = getCapabilityNextStep(capability, diagnostic);

  return nextStep === "run_diagnostic" || nextStep === "inspect_failure";
}

function buildCountRows(values: Array<string | undefined>, emptyLabel = "未记录") {
  const counts = new Map<string, number>();

  for (const value of values) {
    const label = value && value.trim() ? value.trim() : emptyLabel;
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildDraftQualityRows(
  draftSources: AiGovernanceDraftSource[],
  dimension: string,
  getLabel: (item: AiGovernanceDraftSource) => string | undefined,
  emptyLabel = "未记录"
) {
  const rows = new Map<
    string,
    {
      dimension: string;
      label: string;
      total: number;
      success: number;
      issue: number;
      fallback: number;
      qaPassed: number;
      published: number;
      dataReturned: number;
      edited: number;
      rewrites: number;
      keptRisk: number;
      qaAccepted: number;
      qaPartiallyAccepted: number;
      qaIgnored: number;
      suspectedFalsePositive: number;
      suspectedMiss: number;
      changedCharacters: number;
      editRatioSum: number;
      editRatioSamples: number;
      heavyEdits: number;
      drafts: AiGovernanceDraftSource[];
    }
  >();

  for (const item of draftSources) {
    const label = getLabel(item)?.trim() || emptyLabel;
    const current = rows.get(label) || {
      dimension,
      label,
      total: 0,
      success: 0,
      issue: 0,
      fallback: 0,
      qaPassed: 0,
      published: 0,
      dataReturned: 0,
      edited: 0,
      rewrites: 0,
      keptRisk: 0,
      qaAccepted: 0,
      qaPartiallyAccepted: 0,
      qaIgnored: 0,
      suspectedFalsePositive: 0,
      suspectedMiss: 0,
      changedCharacters: 0,
      editRatioSum: 0,
      editRatioSamples: 0,
      heavyEdits: 0,
      drafts: []
    };
    const hasQaBlocker = item.qaPassed === false || (item.qaBlockerCount || 0) > 0;
    const isPublished = Boolean(item.publishStatus && item.publishStatus !== "queued" && item.publishStatus !== "failed");
    const hasManualHandling = Boolean((item.editActionCount || 0) > 0 || (item.manualEditActionCount || 0) > 0 || (item.deleteRiskSegmentCount || 0) > 0 || (item.keepRiskSegmentCount || 0) > 0);
    current.total += 1;
    current.success += item.status === "success" ? 1 : 0;
    current.issue += item.status === "failed" || item.status === "pending_config" || (item.failureReasons?.length || 0) > 0 || hasQaBlocker ? 1 : 0;
    current.fallback += item.fallbackTriggered || item.mode === "local_rule" ? 1 : 0;
    current.qaPassed += item.qaPassed ? 1 : 0;
    current.published += isPublished ? 1 : 0;
    current.dataReturned += item.dataReturned ? 1 : 0;
    current.edited += hasManualHandling ? 1 : 0;
    current.rewrites += item.rewriteActionCount || 0;
    current.keptRisk += item.keepRiskSegmentCount || 0;
    current.qaAccepted += item.qaAcceptedActionCount || 0;
    current.qaPartiallyAccepted += item.qaPartialAcceptedActionCount || 0;
    current.qaIgnored += item.qaIgnoredActionCount || 0;
    current.suspectedFalsePositive += item.qaSuspectedFalsePositiveCount || 0;
    current.suspectedMiss += item.qaSuspectedMissCount || 0;
    current.changedCharacters += item.totalChangedCharacterCount || 0;
    current.editRatioSum += item.maxChangedRatio || 0;
    current.editRatioSamples += item.maxChangedRatio ? 1 : 0;
    current.heavyEdits += item.heavyEditCount || 0;
    current.drafts.push(item);
    rows.set(label, current);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      successRate: row.total ? Math.round((row.success / row.total) * 100) : 0,
      qaPassRate: row.total ? Math.round((row.qaPassed / row.total) * 100) : 0,
      publishRate: row.total ? Math.round((row.published / row.total) * 100) : 0,
      dataReturnRate: row.total ? Math.round((row.dataReturned / row.total) * 100) : 0,
      editRate: row.total ? Math.round((row.edited / row.total) * 100) : 0,
      qaDecisionCount: row.qaAccepted + row.qaIgnored,
      qaAdoptionRate: row.qaAccepted + row.qaIgnored ? Math.round((row.qaAccepted / (row.qaAccepted + row.qaIgnored)) * 100) : 0,
      averageEditRatio: row.editRatioSamples ? Math.round((row.editRatioSum / row.editRatioSamples) * 100) : 0
    }))
    .sort((a, b) => b.issue - a.issue || b.fallback - a.fallback || b.total - a.total || a.label.localeCompare(b.label));
}

type DraftQualityRow = ReturnType<typeof buildDraftQualityRows>[number];

export default function AiConfigPage() {
  const [ragForm] = Form.useForm<KnowledgeRagConfig>();
  const [capabilities, setCapabilities] = useState<RuntimeCapability[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, DiagnosticResult>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const [copying, setCopying] = useState(false);
  const [testingKey, setTestingKey] = useState<string>();
  const [testingAll, setTestingAll] = useState(false);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [capabilityError, setCapabilityError] = useState<string>();
  const [capabilityStatusFilter, setCapabilityStatusFilter] = useState<RuntimeCapabilityStatus[]>([]);
  const [governanceData, setGovernanceData] = useState<NonNullable<AiGovernanceResponse["data"]>>({
    promptTemplates: [],
    auditLog: [],
    pipelineRuns: [],
    draftSources: [],
    callLogs: [],
    access: {
      role: "content_publisher",
      canViewFullGovernance: false,
      message: "模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"
    }
  });
  const [selectedLog, setSelectedLog] = useState<AiGovernanceCallLog>();
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<PromptVersionDetail>();
  const [selectedQualityRow, setSelectedQualityRow] = useState<DraftQualityRow>();
  const [promptVersionLoading, setPromptVersionLoading] = useState<string>();
  const [callLogModuleFilter, setCallLogModuleFilter] = useState<string[]>([]);
  const [callLogStatusFilter, setCallLogStatusFilter] = useState<AiCallLogStatus[]>([]);
  const [ragConfig, setRagConfig] = useState<KnowledgeRagConfig | undefined>();
  const [savingRagConfig, setSavingRagConfig] = useState(false);
  const canViewFullGovernance = governanceData.access?.canViewFullGovernance === true;

  const envTemplate = useMemo(() => {
    const sections = capabilities.flatMap((capability) => {
      const lines = [`# ${capability.label}`, `# ${capability.purpose}`];

      for (const envName of capability.requiredEnv) {
        lines.push(`${envName}=`);
      }

      if (capability.optionalEnv?.length) {
        lines.push("# Optional");

        for (const envName of capability.optionalEnv) {
          lines.push(`${envName}=`);
        }
      }

      lines.push("");
      return lines;
    });

    return sections.join("\n").trim();
  }, [capabilities]);

  const pendingCapabilities = capabilities.filter((item) => item.status === "pending_config");
  const readyCapabilities = capabilities.filter((item) => item.status === "ready");
  const hasLoadedCapabilities = capabilities.length > 0;
  const hasCapabilityFilter = Boolean(capabilityStatusFilter.length);
  const capabilityByKey = useMemo(() => Object.fromEntries(capabilities.map((item) => [item.key, item])), [capabilities]);
  const filteredProviders = providers.filter((provider) => {
    const capability = capabilityByKey[provider.key];
    const status = capability?.status || "pending_config";

    return !capabilityStatusFilter.length || capabilityStatusFilter.includes(status);
  });
  const filteredCapabilities = capabilities.filter((capability) => !capabilityStatusFilter.length || capabilityStatusFilter.includes(capability.status));
  const diagnosticList = Object.values(diagnostics);
  const diagnosticFailedCount = diagnosticList.filter((item) => item.status === "failed").length;
  const aiProviderDraftCount = governanceData.draftSources.filter((item) => item.mode === "ai_provider").length;
  const localRuleDraftCount = governanceData.draftSources.filter((item) => item.mode === "local_rule").length;
  const failedDraftSourceCount = governanceData.draftSources.filter((item) => item.status === "failed" || item.status === "pending_config").length;
  const fallbackTriggeredCount = governanceData.draftSources.filter((item) => item.fallbackTriggered).length;
  const editActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.editActionCount || 0), 0);
  const manualEditActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.manualEditActionCount || 0), 0);
  const rewriteActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.rewriteActionCount || 0), 0);
  const deletedRiskSegmentCount = governanceData.draftSources.reduce((sum, item) => sum + (item.deleteRiskSegmentCount || 0), 0);
  const keptRiskSegmentCount = governanceData.draftSources.reduce((sum, item) => sum + (item.keepRiskSegmentCount || 0), 0);
  const qaAcceptedActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.qaAcceptedActionCount || 0), 0);
  const qaPartialAcceptedActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.qaPartialAcceptedActionCount || 0), 0);
  const qaIgnoredActionCount = governanceData.draftSources.reduce((sum, item) => sum + (item.qaIgnoredActionCount || 0), 0);
  const qaSuspectedFalsePositiveCount = governanceData.draftSources.reduce((sum, item) => sum + (item.qaSuspectedFalsePositiveCount || 0), 0);
  const qaSuspectedMissCount = governanceData.draftSources.reduce((sum, item) => sum + (item.qaSuspectedMissCount || 0), 0);
  const qaDecisionActionCount = qaAcceptedActionCount + qaIgnoredActionCount;
  const qaAdoptionRate = qaDecisionActionCount ? Math.round((qaAcceptedActionCount / qaDecisionActionCount) * 100) : 0;
  const totalChangedCharacterCount = governanceData.draftSources.reduce((sum, item) => sum + (item.totalChangedCharacterCount || 0), 0);
  const editRatioSampleCount = governanceData.draftSources.filter((item) => (item.maxChangedRatio || 0) > 0).length;
  const averageEditRatio = editRatioSampleCount
    ? Math.round((governanceData.draftSources.reduce((sum, item) => sum + (item.maxChangedRatio || 0), 0) / editRatioSampleCount) * 100)
    : 0;
  const heavyEditDraftCount = governanceData.draftSources.reduce((sum, item) => sum + (item.heavyEditCount || 0), 0);
  const editReasonRecordCount = governanceData.draftSources.reduce((sum, item) => sum + (item.editReasonSummary?.reduce((innerSum, reason) => innerSum + reason.count, 0) || 0), 0);
  const qaBlockedDraftCount = governanceData.draftSources.filter((item) => item.qaPassed === false || (item.qaBlockerCount || 0) > 0).length;
  const publishedDraftCount = governanceData.draftSources.filter((item) => item.publishStatus && item.publishStatus !== "queued" && item.publishStatus !== "failed").length;
  const dataReturnedDraftCount = governanceData.draftSources.filter((item) => item.dataReturned).length;
  const visibleFillEnvCount = filteredCapabilities.filter((capability) => getCapabilityNextStep(capability, diagnostics[capability.key]) === "fill_required_env").length;
  const visibleRunDiagnosticCount = filteredCapabilities.filter((capability) => getCapabilityNextStep(capability, diagnostics[capability.key]) === "run_diagnostic").length;
  const visibleInspectFailureCount = filteredCapabilities.filter((capability) => getCapabilityNextStep(capability, diagnostics[capability.key]) === "inspect_failure").length;
  const visibleFallbackCount = filteredCapabilities.filter((capability) => getCapabilityNextStep(capability, diagnostics[capability.key]) === "local_fallback").length;
  const visibleReadyCount = filteredCapabilities.filter((capability) => getCapabilityNextStep(capability, diagnostics[capability.key]) === "ready").length;
  const capabilityQueueSummary = `诊断失败 ${visibleInspectFailureCount} 项，本地 fallback ${visibleFallbackCount} 项，可直接试跑 ${visibleReadyCount} 项。`;
  const highestPriorityCapability = [...filteredCapabilities]
    .sort((a, b) => capabilityNextStepPriority[getCapabilityNextStep(a, diagnostics[a.key])] - capabilityNextStepPriority[getCapabilityNextStep(b, diagnostics[b.key])])
    .find((capability) => {
      const nextStep = getCapabilityNextStep(capability, diagnostics[capability.key]);

      return nextStep !== "ready" && nextStep !== "local_fallback";
    });
  const callLogModuleOptions = useMemo(() => {
    const moduleMap = new Map<string, string>();

    for (const log of governanceData.callLogs) {
      moduleMap.set(log.module, log.moduleLabel);
    }

    return [...moduleMap.entries()].map(([value, label]) => ({ value, label }));
  }, [governanceData.callLogs]);
  const filteredCallLogs = useMemo(
    () =>
      governanceData.callLogs.filter(
        (log) =>
          (!callLogModuleFilter.length || callLogModuleFilter.includes(log.module)) &&
          (!callLogStatusFilter.length || callLogStatusFilter.includes(log.outputStatus))
      ),
    [callLogModuleFilter, callLogStatusFilter, governanceData.callLogs]
  );
  const hasCallLogFilter = Boolean(callLogModuleFilter.length || callLogStatusFilter.length);
  const filteredCallLogIssueCount = filteredCallLogs.filter((item) => item.outputStatus === "failed" || item.outputStatus === "pending_config").length;
  const filteredCallLogFallbackCount = filteredCallLogs.filter((item) => item.fallbackTriggered).length;
  const filteredProviderCallLogCount = filteredCallLogs.filter((item) => item.provider || item.model).length;
  const failureReasonSummary = useMemo(
    () => buildCountRows(governanceData.draftSources.flatMap((item) => item.failureReasons?.map((reason) => reason.label) || []), "暂无失败原因").slice(0, 5),
    [governanceData.draftSources]
  );
  const productExpressionRuleSummary = useMemo(
    () =>
      buildCountRows(
        governanceData.draftSources.map((item) =>
          item.productExpressionRuleVersion ? [item.productExpressionRuleSource, item.productExpressionRuleVersion].filter(Boolean).join(" / ") : undefined
        ),
        "未记录规则包"
      ).slice(0, 5),
    [governanceData.draftSources]
  );
  const promptVersionSummary = useMemo(
    () => buildCountRows(governanceData.draftSources.map((item) => item.promptProfile), "未记录 Prompt").slice(0, 5),
    [governanceData.draftSources]
  );
  const qaIssueRuleSummary = useMemo(
    () =>
      buildCountRows(
        governanceData.draftSources.flatMap((item) => item.qaIssueRuleSummary?.map((issue) => `${issue.severity === "blocker" ? "阻断" : "提醒"} / ${issue.rule}`) || []),
        "暂无质检问题"
      ).slice(0, 5),
    [governanceData.draftSources]
  );
  const editReasonSummary = useMemo(
    () =>
      buildCountRows(
        governanceData.draftSources.flatMap((item) => item.editReasonSummary?.map((reason) => reason.reason) || []),
        "暂无编辑原因"
      ).slice(0, 5),
    [governanceData.draftSources]
  );
  const editReasonCategorySummary = useMemo(
    () =>
      buildCountRows(
        governanceData.draftSources.flatMap((item) => item.editReasonCategorySummary?.map((category) => category.label) || []),
        "暂无编辑原因分类"
      ).slice(0, 5),
    [governanceData.draftSources]
  );
  const keepRiskReasonCategorySummary = useMemo(
    () =>
      buildCountRows(
        governanceData.draftSources.flatMap((item) => item.keepRiskReasonCategorySummary?.map((category) => category.label) || []),
        "暂无保留原因分类"
      ).slice(0, 5),
    [governanceData.draftSources]
  );
  const qualityAssociationRows = useMemo(
    () =>
      [
        ...buildDraftQualityRows(governanceData.draftSources, "Provider", (item) => item.provider || item.mode, "未记录 Provider"),
        ...buildDraftQualityRows(governanceData.draftSources, "Prompt", (item) => item.promptProfile, "未记录 Prompt"),
        ...buildDraftQualityRows(
          governanceData.draftSources,
          "规则包",
          (item) => (item.productExpressionRuleVersion ? [item.productExpressionRuleSource, item.productExpressionRuleVersion].filter(Boolean).join(" / ") : undefined),
          "未记录规则包"
        ),
        ...buildDraftQualityRows(governanceData.draftSources, "渠道", (item) => (item.channel ? channelLabels[item.channel] : undefined), "未记录渠道"),
        ...buildDraftQualityRows(governanceData.draftSources, "产品", (item) => (item.product ? productLabels[item.product] : undefined), "未记录产品"),
        ...buildDraftQualityRows(governanceData.draftSources, "内容类型", (item) => (item.contentType ? contentTypeLabels[item.contentType] : undefined), "未记录内容类型"),
        ...buildDraftQualityRows(governanceData.draftSources, "蒸馏词", (item) => item.primaryDistilledTerm, "未记录蒸馏词")
      ].slice(0, 16),
    [governanceData.draftSources]
  );

  const loadConfigStatus = useCallback(async () => {
    setLoadingCapabilities(true);

    try {
      const response = await fetch("/api/runtime-config/status", { cache: "no-store" });

      if (!response.ok) {
        setCapabilityError(`配置状态接口返回 ${response.status} ${response.statusText || "请求失败"}`);
        return;
      }

      const status = (await response.json()) as { capabilities: RuntimeCapability[] };
      setCapabilities(status.capabilities);
      setCapabilityError(undefined);
    } catch (error) {
      setCapabilityError(error instanceof Error ? error.message : "配置状态加载失败");
    } finally {
      setLoadingCapabilities(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewFullGovernance) {
      setCapabilities([]);
      setDiagnostics({});
      setLoadingCapabilities(false);
      return;
    }

    void loadConfigStatus();
  }, [canViewFullGovernance, loadConfigStatus]);

  const loadGovernanceData = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-governance", { cache: "no-store" });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as AiGovernanceResponse;
      setGovernanceData({
        promptTemplates: payload.data?.promptTemplates || [],
        auditLog: payload.data?.auditLog || [],
        pipelineRuns: payload.data?.pipelineRuns || [],
        draftSources: payload.data?.draftSources || [],
        callLogs: payload.data?.callLogs || [],
        access: payload.data?.access || {
          role: "content_publisher",
          canViewFullGovernance: false,
          message: "模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"
        }
      });
    } catch {
      // Governance data is auxiliary. Provider readiness remains the primary state.
    }
  }, []);

  useEffect(() => {
    void loadGovernanceData();
  }, [loadGovernanceData]);

  const loadRagConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace-settings", { cache: "no-store" });

      if (!response.ok) return;

      const payload = (await response.json()) as { data?: { workspaceSetting?: { knowledgeRagConfig?: KnowledgeRagConfig } } };
      const nextConfig = payload.data?.workspaceSetting?.knowledgeRagConfig;
      setRagConfig(nextConfig);
      ragForm.setFieldsValue(nextConfig || {});
    } catch {
      // RAG config is optional; absence should stay visible as pending_config in the UI.
    }
  }, [ragForm]);

  useEffect(() => {
    void loadRagConfig();
  }, [loadRagConfig]);

  async function handleSaveRagConfig() {
    const values = ragForm.getFieldsValue();
    const knowledgeRagConfig: KnowledgeRagConfig = {
      chunkingStrategy: values.chunkingStrategy,
      chunkingModelProvider: values.chunkingModelProvider,
      embeddingModelProvider: values.embeddingModelProvider,
      retrievalStrategy: values.retrievalStrategy,
      chunkSize: values.chunkSize,
      chunkOverlap: values.chunkOverlap
    };

    setSavingRagConfig(true);

    try {
      const response = await fetch("/api/workspace-settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ knowledgeRagConfig })
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; data?: { workspaceSetting?: { knowledgeRagConfig?: KnowledgeRagConfig } } };

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "知识库 RAG 配置保存失败");
      }

      const nextConfig = result.data?.workspaceSetting?.knowledgeRagConfig;
      setRagConfig(nextConfig);
      ragForm.setFieldsValue(nextConfig || {});
      messageApi.success(result.message || "知识库 RAG 配置已保存。");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "知识库 RAG 配置保存失败");
    } finally {
      setSavingRagConfig(false);
    }
  }

  async function handleCopyTemplate() {
    setCopying(true);

    try {
      await navigator.clipboard.writeText(envTemplate);
      messageApi.success(".env.local 模板已复制");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "复制模板失败");
    } finally {
      setCopying(false);
    }
  }

  async function handleTestCapability(key: string) {
    setTestingKey(key);

    try {
      const response = await fetch("/api/config-diagnostics", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ key })
      });
      const result = (await response.json()) as DiagnosticResult;
      setDiagnostics((current) => ({
        ...current,
        [key]: result
      }));
      messageApi[result.status === "failed" ? "error" : result.status === "pending_config" ? "warning" : "success"](result.message);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "配置测试失败");
    } finally {
      setTestingKey(undefined);
    }
  }

  async function handleTestAllCapabilities() {
    setTestingAll(true);

    try {
      const response = await fetch("/api/config-diagnostics", { cache: "no-store" });
      const result = (await response.json()) as DiagnosticResponse;
      setDiagnostics(Object.fromEntries(result.results.map((item) => [item.key, item])));
      messageApi[result.status === "failed" ? "error" : result.status === "pending_config" ? "warning" : "success"](
        result.status === "ready" ? "全部配置已就绪。" : "全部配置诊断已完成。"
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "配置诊断失败");
    } finally {
      setTestingAll(false);
    }
  }

  function clearCapabilityFilters() {
    setCapabilityStatusFilter([]);
  }

  function clearCallLogFilters() {
    setCallLogModuleFilter([]);
    setCallLogStatusFilter([]);
  }

  function renderCapabilityEntry(capability: RuntimeCapability | undefined, diagnostic?: DiagnosticResult) {
    const link = getCapabilityLink(capability, diagnostic);

    return (
      <Link href={link.href}>
        <Button size="small">{link.label}</Button>
      </Link>
    );
  }

  function renderCapabilityDiagnosticButton(key: string, capability?: RuntimeCapability, diagnostic?: DiagnosticResult, label = "测试连接") {
    const shouldPrioritizeDiagnostic = shouldRunCapabilityDiagnostic(capability, diagnostic);

    return (
      <Button
        size="small"
        type={shouldPrioritizeDiagnostic ? "primary" : "default"}
        loading={testingKey === key}
        onClick={() => handleTestCapability(key)}
      >
        {label}
      </Button>
    );
  }

  function renderRestrictedGovernance() {
    const currentRole = governanceData.access?.role || "content_publisher";
    const defaultRoute = getDefaultRouteForRole(currentRole);

    return (
      <Card>
        <Alert
          showIcon
          type="warning"
          message="当前角色不显示模型与规则治理详情"
          description={`${governanceData.access?.message || "模型配置、调用记录和规则版本由工作台运营或开发管理员维护。"} 当前角色：${workspaceRoleLabels[currentRole]}。这不会影响你继续在业务页面完成发布、复盘或知识库维护。`}
          action={
            <Space>
              <Link href={defaultRoute}>
                <Button size="small" type="primary">
                  去{getRouteLabel(defaultRoute)}
                </Button>
              </Link>
              <Link href="/settings">
                <Button size="small">切换角色</Button>
              </Link>
            </Space>
          }
        />
        <List
          size="small"
          style={{ marginTop: 16 }}
          dataSource={[
            "内容发布人员继续处理今日发布、草稿质检和数据回填。",
            "内容增长人员继续查看周报、GEO 可见度和下周建议。",
            "知识库维护人员继续管理资料、产品表达规则包和蒸馏词。"
          ]}
          renderItem={(item) => <List.Item>{item}</List.Item>}
        />
      </Card>
    );
  }

  async function handleViewPromptVersion(id: string) {
    setPromptVersionLoading(id);

    try {
      const response = await fetch(`/api/prompt-versions/${id}`, { cache: "no-store" });
      const payload = (await response.json()) as PromptVersionResponse;

      if (!response.ok || !payload.data?.promptVersion) {
        throw new Error(payload.message || "Prompt 版本详情加载失败");
      }

      setSelectedPromptVersion(payload.data.promptVersion);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Prompt 版本详情加载失败");
    } finally {
      setPromptVersionLoading(undefined);
    }
  }

  async function handleRollbackPromptVersion(id: string) {
    setPromptVersionLoading(id);

    try {
      const response = await fetch(`/api/prompt-versions/${id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "rollback",
          reason: "在 AI 配置页申请回滚，用于恢复上一版稳定口径。"
        })
      });
      const payload = (await response.json()) as PromptVersionResponse;

      if (!response.ok || !payload.data?.promptVersion) {
        throw new Error(payload.message || "Prompt 版本回滚失败");
      }

      messageApi.success(payload.message || "Prompt 版本已回滚");
      setSelectedPromptVersion(payload.data.promptVersion);
      await loadGovernanceData();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Prompt 版本回滚失败");
    } finally {
      setPromptVersionLoading(undefined);
    }
  }

  const pageHeaderTitle = canViewFullGovernance ? "AI 配置" : "治理权限说明";
  const pageHeaderSubtitle = canViewFullGovernance
    ? "管理模型、API、Prompt 和运行参数；密钥只通过环境变量或配置中心管理。"
    : "当前角色只看到业务引导；发布、复盘和知识库维护在对应页面继续处理。";

  return (
    <>
      {contextHolder}
      <PageHeader
        title={pageHeaderTitle}
        subtitle={pageHeaderSubtitle}
        actions={
          canViewFullGovernance ? (
            <Space>
              <Button loading={loadingCapabilities} onClick={() => void loadConfigStatus()}>
                刷新状态
              </Button>
              <Button loading={testingAll} onClick={handleTestAllCapabilities}>
                运行全部诊断
              </Button>
              <Button type="primary" loading={copying} onClick={handleCopyTemplate}>
                复制 .env.local 模板
              </Button>
            </Space>
          ) : undefined
        }
      />
      {!canViewFullGovernance ? (
        <div className="report-section">{renderRestrictedGovernance()}</div>
      ) : (
        <>
      <PageErrorState
        title="配置状态加载失败"
        message={capabilityError}
        loading={loadingCapabilities}
        onRetry={loadConfigStatus}
        description={capabilityError ? `${capabilityError}。当前不会展示密钥值，请重试后再判断 ready / pending_config 状态。` : undefined}
      />
      <Alert
        type={!hasLoadedCapabilities ? "warning" : pendingCapabilities.length ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          !hasLoadedCapabilities
            ? "配置状态待加载，暂不能据此判断外部能力是否就绪。"
            : pendingCapabilities.length
              ? "还有真实配置未接入，当前会继续走 fallback。"
              : "所有核心能力已就绪。"
        }
        description={
          !hasLoadedCapabilities
            ? "请先刷新状态或运行全部诊断；页面只展示配置项名称和缺失字段，不展示密钥值。"
            : pendingCapabilities.length
              ? "先保留这些占位符，等你后续提供真实 API / 密钥 / 路径时再补齐。"
              : "页面当前未发现缺失配置。"
        }
      />
      <Alert
        showIcon
        type={visibleInspectFailureCount ? "error" : visibleFillEnvCount ? "warning" : visibleRunDiagnosticCount ? "info" : "success"}
        style={{ marginBottom: 16 }}
        message={`能力共 ${filteredCapabilities.length} 项，待补配置 ${visibleFillEnvCount} 项，待执行诊断 ${visibleRunDiagnosticCount} 项`}
        description={
          highestPriorityCapability
            ? `${capabilityQueueSummary} 当前优先处理：${highestPriorityCapability.label}，${getCapabilityActionText(
                highestPriorityCapability,
                diagnostics[highestPriorityCapability.key]
              )}`
            : capabilityQueueSummary
        }
      />
      <div className="metric-grid">
        <Card size="small">已就绪：{readyCapabilities.length}</Card>
        <Card size="small">待配置：{pendingCapabilities.length}</Card>
        <Card size="small">总能力：{capabilities.length}</Card>
        <Card size="small">诊断失败：{diagnosticFailedCount}</Card>
      </div>
      <Tabs
        items={[
          {
            key: "provider",
            label: "Provider",
            children: (
              <Card title="Provider">
                <Space wrap style={{ width: "100%", marginBottom: 16 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="按配置状态筛选"
                    value={capabilityStatusFilter}
                    onChange={(value) => setCapabilityStatusFilter(value)}
                    options={Object.entries(capabilityStatusLabels).map(([value, label]) => ({ value, label }))}
                    style={{ minWidth: 220 }}
                  />
                  <Button onClick={clearCapabilityFilters} disabled={!hasCapabilityFilter}>
                    清空筛选
                  </Button>
                </Space>
                <Table
                  rowKey="key"
                  dataSource={filteredProviders}
                  loading={loadingCapabilities}
                  locale={{
                    emptyText: (
                      <ActionEmpty
                        title="当前筛选没有 Provider"
                        description="清空筛选或调整配置状态后再查看。"
                        action={
                          <Button type="primary" onClick={clearCapabilityFilters}>
                            清空筛选
                          </Button>
                        }
                      />
                    )
                  }}
                  columns={[
                    { title: "Provider", dataIndex: "name" },
                    { title: "用途", dataIndex: "usage" },
                    { title: "Model Env", dataIndex: "model" },
                    {
                      title: "状态",
                      render: (_, record) => {
                        const capability = capabilityByKey[record.key];
                        const status = capability?.status || "pending_config";

                        return <Tag color={getCapabilityStatusColor(status)}>{capabilityStatusLabels[status as RuntimeCapabilityStatus] || status}</Tag>;
                      }
                    },
                    {
                      title: "缺少配置",
                      render: (_, record) => {
                        const capability = capabilityByKey[record.key];
                        return capability?.missingEnv.length ? capability.missingEnv.join(", ") : "-";
                      }
                    },
                    {
                      title: "下一步",
                      render: (_, record) => {
                        const capability = capabilityByKey[record.key];
                        const nextStep = getCapabilityNextStep(capability, diagnostics[record.key]);

                        return <Tag color={capabilityNextStepColors[nextStep]}>{capabilityNextStepLabels[nextStep]}</Tag>;
                      }
                    },
                    {
                      title: "处理动作",
                      render: (_, record) => getCapabilityActionText(capabilityByKey[record.key], diagnostics[record.key])
                    },
                    {
                      title: "可执行入口",
                      render: (_, record) => renderCapabilityEntry(capabilityByKey[record.key], diagnostics[record.key])
                    },
                    {
                      title: "诊断",
                      render: (_, record) => renderCapabilityDiagnosticButton(record.key, capabilityByKey[record.key], diagnostics[record.key])
                    }
                  ]}
                />
              </Card>
            )
          },
          {
            key: "knowledge-rag",
            label: "知识库 RAG 配置",
            children: governanceData.access?.canViewFullGovernance === false ? (
              renderRestrictedGovernance()
            ) : (
              <Card title="知识库 RAG 配置">
                <Alert
                  showIcon
                  type={ragConfig?.embeddingModelProvider ? "info" : "warning"}
                  message={ragConfig?.embeddingModelProvider ? "已选择 embedding 模型，仍需真实接口配置后才能写入真实向量。" : "当前 embedding 未配置，知识库向量状态会显示 pending_config。"}
                  description="这里保存全局 RAG 策略，不设置默认值；未选择模型时不会用 fallback hash 冒充真实向量。切片可先走规则切片，AI 语义切片需要选择切片模型并完成真实 Provider 配置。"
                  style={{ marginBottom: 16 }}
                />
                <Form form={ragForm} layout="vertical">
                  <div className="two-column">
                    <Card size="small" title="切片模型">
                      <Form.Item label="切片策略" name="chunkingStrategy">
                        <Select allowClear placeholder="请选择切片策略" options={ragChunkingStrategyOptions} />
                      </Form.Item>
                      <Form.Item label="切片模型" name="chunkingModelProvider">
                        <Select allowClear placeholder="请选择 qwen / doubao / deepseek" options={ragChunkingProviderOptions} />
                      </Form.Item>
                      <Space wrap>
                        <Form.Item label="Chunk 长度" name="chunkSize">
                          <InputNumber min={200} max={2000} placeholder="未配置" />
                        </Form.Item>
                        <Form.Item label="重叠长度" name="chunkOverlap">
                          <InputNumber min={0} max={500} placeholder="未配置" />
                        </Form.Item>
                      </Space>
                    </Card>
                    <Card size="small" title="向量与检索">
                      <Form.Item label="Embedding 模型" name="embeddingModelProvider">
                        <Select allowClear placeholder="请选择 embedding 模型" options={ragEmbeddingModelOptions} />
                      </Form.Item>
                      <Form.Item label="检索策略" name="retrievalStrategy">
                        <Select allowClear placeholder="请选择 keyword / vector / hybrid" options={ragRetrievalStrategyOptions} />
                      </Form.Item>
                      <Space wrap>
                        <Tag color={ragConfig?.chunkingModelProvider ? "blue" : "gold"}>切片模型：{ragConfig?.chunkingModelProvider || "pending_config"}</Tag>
                        <Tag color={ragConfig?.embeddingModelProvider ? "blue" : "gold"}>Embedding：{ragConfig?.embeddingModelProvider || "pending_config"}</Tag>
                        <Tag color={ragConfig?.retrievalStrategy ? "blue" : "gold"}>检索策略：{ragConfig?.retrievalStrategy || "pending_config"}</Tag>
                      </Space>
                    </Card>
                  </div>
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" loading={savingRagConfig} onClick={handleSaveRagConfig}>
                      保存 RAG 配置
                    </Button>
                    <Button onClick={() => ragForm.resetFields()}>清空当前编辑</Button>
                  </Space>
                </Form>
              </Card>
            )
          },
          {
            key: "prompt-version",
            label: "Prompt 版本",
            children: governanceData.access?.canViewFullGovernance === false ? (
              renderRestrictedGovernance()
            ) : (
              <Card title="Prompt 版本">
                <Alert
                  showIcon
                  type="info"
                  message="这里只展示模板版本、输入输出契约和失败规则，不展示 Prompt 原文。"
                  description="查看版本说明可看到生效口径、上一版本和回滚策略；申请回滚会写入审计记录，并影响后续生成来源版本。"
                  style={{ marginBottom: 16 }}
                />
                <Table
                  rowKey="id"
                  dataSource={governanceData.promptTemplates}
                  pagination={false}
                  columns={[
                    { title: "模板", dataIndex: "name" },
                    { title: "版本", dataIndex: "version", render: (value) => <Tag>{value}</Tag> },
                    { title: "使用位置", dataIndex: "usedAt" },
                    { title: "输入契约", dataIndex: "inputContract", render: (value: string[]) => value.join(" / ") },
                    { title: "输出契约", dataIndex: "outputContract", render: (value: string[]) => value.join(" / ") },
                    { title: "失败规则", dataIndex: "failureRules", render: (value: string[]) => value.join(" / ") },
                    { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "rolled_back" ? "gold" : "green"}>{value === "rolled_back" ? "已回滚" : "生效中"}</Tag> },
                    {
                      title: "操作",
                      render: (_, record) => (
                        <Space>
                          <Button size="small" loading={promptVersionLoading === record.id} onClick={() => handleViewPromptVersion(record.id)}>
                            查看版本说明
                          </Button>
                          <Button size="small" loading={promptVersionLoading === record.id} onClick={() => handleRollbackPromptVersion(record.id)}>
                            申请回滚
                          </Button>
                        </Space>
                      )
                    }
                  ]}
                />
              </Card>
            )
          },
          {
            key: "local-rules",
            label: "本地规则",
            children: (
              <div className="two-column">
                <Card title="本地规则与 fallback">
                  <List
                    dataSource={[
                      "周计划：发布日期、渠道、产品、官网链接目标仍由系统规则或人工确认。",
                      "正文生成：Provider 不可用时生成 local_rule 草稿，并保留生成来源。",
                      "草稿质检：阻断项、复制权限和高风险片段处理仍由本地规则兜底。",
                      "蒸馏词：confidence >= 0.65 自动入池，低于阈值直接丢弃。",
                      "GEO：原始回答和引用 URL 进入详情，不进入普通业务页。"
                    ]}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                </Card>
                <Card title="真实接入 Checklist">
                  <Table
                    rowKey="key"
                    size="small"
                    dataSource={filteredCapabilities}
                    loading={loadingCapabilities}
                    pagination={false}
                    columns={[
                      { title: "接入项", dataIndex: "label" },
                      { title: "需要提供", dataIndex: "requiredEnv", render: (value: string[]) => (value.length ? value.join(", ") : "无") },
                      { title: "可选配置", dataIndex: "optionalEnv", render: (value?: string[]) => (value?.length ? value.join(", ") : "-") },
                      {
                        title: "下一步",
                        render: (_, record) => {
                          const nextStep = getCapabilityNextStep(record, diagnostics[record.key]);

                          return <Tag color={capabilityNextStepColors[nextStep]}>{capabilityNextStepLabels[nextStep]}</Tag>;
                        }
                      }
                    ]}
                  />
                </Card>
              </div>
            )
          },
          {
            key: "call-log",
            label: "调用日志",
            children: governanceData.access?.canViewFullGovernance === false ? (
              renderRestrictedGovernance()
            ) : (
              <Card title="调用日志">
                <div className="ai-call-log-summary-grid">
                  <div className="ai-call-log-summary-item">
                    <span>当前日志</span>
                    <strong>{filteredCallLogs.length}</strong>
                  </div>
                  <div className="ai-call-log-summary-item">
                    <span>异常 / 待配置</span>
                    <strong>{filteredCallLogIssueCount}</strong>
                  </div>
                  <div className="ai-call-log-summary-item">
                    <span>Provider / Model</span>
                    <strong>{filteredProviderCallLogCount}</strong>
                  </div>
                  <div className="ai-call-log-summary-item">
                    <span>fallback</span>
                    <strong>{filteredCallLogFallbackCount}</strong>
                  </div>
                </div>
                <Space wrap style={{ width: "100%", marginBottom: 16 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="按模块筛选"
                    value={callLogModuleFilter}
                    onChange={(value) => setCallLogModuleFilter(value)}
                    options={callLogModuleOptions}
                    style={{ minWidth: 220 }}
                  />
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="按输出状态筛选"
                    value={callLogStatusFilter}
                    onChange={(value) => setCallLogStatusFilter(value)}
                    options={Object.entries(callLogStatusLabels).map(([value, label]) => ({ value, label }))}
                    style={{ minWidth: 220 }}
                  />
                  <Button onClick={clearCallLogFilters} disabled={!hasCallLogFilter}>
                    清空筛选
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  dataSource={filteredCallLogs}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  scroll={{ x: 1080 }}
                  locale={{ emptyText: <ActionEmpty title="暂无调用日志" description="生成、质检、GEO 和配置诊断动作会写入审计记录。" /> }}
                  columns={[
                    { title: "时间", dataIndex: "createdAt" },
                    { title: "模块", dataIndex: "moduleLabel", render: (value) => <Tag>{value}</Tag> },
                    {
                      title: "Provider / Model",
                      render: (_, record) => [record.provider, record.model].filter(Boolean).join(" / ") || "-"
                    },
                    { title: "Prompt 版本", dataIndex: "promptVersion", render: (value) => value || "-" },
                    {
                      title: "规则包",
                      render: (_, record) =>
                        record.productExpressionRuleVersion ? (
                          <Tag color="blue">
                            {[record.productExpressionRuleSource, record.productExpressionRuleVersion].filter(Boolean).join(" / ")}
                          </Tag>
                        ) : (
                          <span className="muted">未记录</span>
                        )
                    },
                    {
                      title: "输出状态",
                      dataIndex: "outputStatus",
                      render: (value) => <Tag color={callLogStatusColors[value as AiCallLogStatus]}>{callLogStatusLabels[value as AiCallLogStatus]}</Tag>
                    },
                    {
                      title: "fallback 是否触发",
                      dataIndex: "fallbackTriggered",
                      render: (value) => <Tag color={value ? "gold" : "green"}>{value ? "已触发" : "未触发"}</Tag>
                    },
                    {
                      title: "失败原因",
                      render: (_, record) =>
                        record.failureReasons?.length ? (
                          <Space wrap>
                            {record.failureReasons.slice(0, 2).map((reason) => (
                              <Tag key={`${record.id}-${reason.code}`} color={reason.severity === "blocker" ? "red" : "gold"}>
                                {reason.label}
                              </Tag>
                            ))}
                          </Space>
                        ) : (
                          <span className="muted">无</span>
                        )
                    },
                    { title: "输入摘要", dataIndex: "inputSummary" },
                    {
                      title: "详情",
                      render: (_, record) => (
                        <Button size="small" onClick={() => setSelectedLog(record)}>
                          查看
                        </Button>
                      )
                    }
                  ]}
                />
              </Card>
            )
          },
          {
            key: "effect-summary",
            label: "效果摘要",
            children: governanceData.access?.canViewFullGovernance === false ? (
              renderRestrictedGovernance()
            ) : (
              <div className="two-column">
                <Card title="生成来源摘要">
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={governanceData.draftSources}
                    pagination={{ pageSize: 6, showSizeChanger: false }}
                    locale={{ emptyText: <ActionEmpty title="暂无正文生成记录" description="批量生成正文后会在这里显示 Provider、Model、Prompt 版本和 fallback 状态。" /> }}
                    columns={[
                      { title: "标题", dataIndex: "title" },
                      { title: "来源", dataIndex: "mode", render: (value) => <Tag color={value === "ai_provider" ? "green" : "default"}>{value}</Tag> },
                      { title: "Provider", dataIndex: "provider", render: (value) => value || "-" },
                      { title: "Prompt 版本", dataIndex: "promptProfile", render: (value) => value || "-" },
                      {
                        title: "规则包",
                        render: (_, record) =>
                          record.productExpressionRuleVersion ? (
                            <Tag color="blue">
                              {[record.productExpressionRuleSource, record.productExpressionRuleVersion].filter(Boolean).join(" / ")}
                            </Tag>
                          ) : (
                            <span className="muted">未记录</span>
                          )
                      },
                      {
                        title: "失败分类",
                        render: (_, record) =>
                          record.failureReasons?.length ? (
                            <Space wrap>
                              {record.failureReasons.slice(0, 2).map((reason) => (
                                <Tag key={`${record.id}-${reason.code}`} color={reason.severity === "blocker" ? "red" : "gold"}>
                                  {reason.label}
                                </Tag>
                              ))}
                            </Space>
                          ) : (
                            <span className="muted">无</span>
                          )
                      },
                      { title: "改写", dataIndex: "rewriteActionCount", render: (value) => (value ? `${value} 次` : "-") },
                      {
                        title: "质检反馈",
                        render: (_, record) => (
                          <Space wrap>
                            {record.qaAcceptedActionCount ? <Tag color="green">采纳 {record.qaAcceptedActionCount}</Tag> : null}
                            {record.qaPartialAcceptedActionCount ? <Tag color="blue">部分采纳 {record.qaPartialAcceptedActionCount}</Tag> : null}
                            {record.qaIgnoredActionCount ? <Tag color="gold">忽略 {record.qaIgnoredActionCount}</Tag> : null}
                            {!record.qaAcceptedActionCount && !record.qaPartialAcceptedActionCount && !record.qaIgnoredActionCount ? <span className="muted">暂无</span> : null}
                          </Space>
                        )
                      },
                      { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
                    ]}
                  />
                </Card>
                <Card title="效果摘要">
                  <List
                    dataSource={[
                      `AI Provider 生成：${aiProviderDraftCount} 篇`,
                      `本地规则 fallback：${localRuleDraftCount} 篇`,
                      `fallback 触发：${fallbackTriggeredCount} 次`,
                      `人工处理动作：${editActionCount} 次`,
                      `人工直接编辑：${manualEditActionCount} 次`,
                      `局部改写：${rewriteActionCount} 次`,
                      `删除风险片段：${deletedRiskSegmentCount} 次`,
                      `保留高风险：${keptRiskSegmentCount} 次`,
                      `质检采纳动作：${qaAcceptedActionCount} 次`,
                      `质检部分采纳：${qaPartialAcceptedActionCount} 次`,
                      `人工忽略质检：${qaIgnoredActionCount} 次`,
                      `质检采纳率：${qaDecisionActionCount ? `${qaAdoptionRate}%` : "暂无样本"}`,
                      `疑似误报信号：${qaSuspectedFalsePositiveCount} 次`,
                      `疑似漏检信号：${qaSuspectedMissCount} 次`,
                      `正文改动字符：${totalChangedCharacterCount} 字`,
                      `平均编辑比例：${editRatioSampleCount ? `${averageEditRatio}%` : "暂无样本"}`,
                      `重度编辑稿件：${heavyEditDraftCount} 篇`,
                      `编辑原因记录：${editReasonRecordCount} 条`,
                      `质检阻断：${qaBlockedDraftCount} 篇`,
                      `已发布：${publishedDraftCount} 篇`,
                      `已回传数据：${dataReturnedDraftCount} 篇`,
                      `待配置或失败：${failedDraftSourceCount} 篇`,
                      `最近 Pipeline：${governanceData.pipelineRuns[0]?.status || "暂无"}`
                    ]}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                  <Alert
                    showIcon
                    type={failedDraftSourceCount || fallbackTriggeredCount || qaSuspectedFalsePositiveCount || qaSuspectedMissCount || heavyEditDraftCount ? "warning" : "success"}
                    style={{ marginBottom: 16 }}
                    message="运营判断摘要"
                    description={
                      failedDraftSourceCount || fallbackTriggeredCount || qaSuspectedFalsePositiveCount || qaSuspectedMissCount || heavyEditDraftCount
                        ? "当前需要优先查看失败原因、fallback、规则包版本分布、质检反馈和正文改动强度，判断问题来自 Provider、Prompt、知识库证据、产品表达规则还是质检规则。"
                        : "当前生成链路没有明显失败、fallback、质检反馈异常或重度编辑信号，可继续观察 Prompt 和规则包表现。"
                    }
                  />
                  <List
                    size="small"
                    header="失败原因 Top 5"
                    dataSource={failureReasonSummary}
                    locale={{ emptyText: "暂无失败原因记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="red">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="质检问题类型 Top 5"
                    dataSource={qaIssueRuleSummary}
                    locale={{ emptyText: "暂无质检问题记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="orange">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="编辑原因 Top 5"
                    dataSource={editReasonSummary}
                    locale={{ emptyText: "暂无编辑原因记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="purple">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="编辑原因分类 Top 5"
                    dataSource={editReasonCategorySummary}
                    locale={{ emptyText: "暂无编辑原因分类记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="geekblue">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="高风险保留原因分类"
                    dataSource={keepRiskReasonCategorySummary}
                    locale={{ emptyText: "暂无高风险保留原因分类。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="gold">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="规则包使用分布"
                    dataSource={productExpressionRuleSummary}
                    locale={{ emptyText: "暂无规则包使用记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="blue">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    size="small"
                    header="Prompt 使用分布"
                    dataSource={promptVersionSummary}
                    locale={{ emptyText: "暂无 Prompt 使用记录。" }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space>
                          <Tag color="green">{item.count}</Tag>
                          <span>{item.label}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <Table
                    rowKey={(record) => `${record.dimension}-${record.label}`}
                    size="small"
                    title={() => "质量关联摘要"}
                    dataSource={qualityAssociationRows}
                    pagination={false}
                    scroll={{ x: 1480 }}
                    locale={{ emptyText: <ActionEmpty title="暂无质量关联数据" description="生成记录积累后，这里会按 Provider、Prompt、规则包、渠道、产品和蒸馏词展示质量表现。" /> }}
                    columns={[
                      { title: "维度", dataIndex: "dimension", width: 90 },
                      { title: "对象", dataIndex: "label" },
                      { title: "记录", dataIndex: "total", width: 80 },
                      { title: "成功率", dataIndex: "successRate", width: 90, render: (value) => `${value}%` },
                      { title: "质检通过", dataIndex: "qaPassRate", width: 100, render: (value) => `${value}%` },
                      { title: "发布率", dataIndex: "publishRate", width: 90, render: (value) => `${value}%` },
                      { title: "回传率", dataIndex: "dataReturnRate", width: 90, render: (value) => `${value}%` },
                      { title: "人工处理", dataIndex: "editRate", width: 100, render: (value) => `${value}%` },
                      { title: "平均改动", dataIndex: "averageEditRatio", width: 100, render: (value, record) => (record.editRatioSamples ? `${value}%` : "-") },
                      { title: "重度编辑", dataIndex: "heavyEdits", width: 90 },
                      { title: "质检采纳", dataIndex: "qaAdoptionRate", width: 100, render: (value, record) => (record.qaDecisionCount ? `${value}%` : "-") },
                      { title: "AI 改写", dataIndex: "rewrites", width: 90 },
                      { title: "保留风险", dataIndex: "keptRisk", width: 90 },
                      { title: "疑似误报", dataIndex: "suspectedFalsePositive", width: 100 },
                      { title: "疑似漏检", dataIndex: "suspectedMiss", width: 100 },
                      { title: "异常", dataIndex: "issue", width: 80, render: (value) => <Tag color={value ? "red" : "green"}>{value}</Tag> },
                      { title: "fallback", dataIndex: "fallback", width: 90, render: (value) => <Tag color={value ? "gold" : "green"}>{value}</Tag> },
                      {
                        title: "详情",
                        width: 80,
                        render: (_, record) => (
                          <Button size="small" onClick={() => setSelectedQualityRow(record)}>
                            查看
                          </Button>
                        )
                      }
                    ]}
                  />
                </Card>
              </div>
            )
          },
          {
            key: "env-template",
            label: ".env 模板",
            children: (
              <Card title=".env.local 模板">
                <Input.TextArea rows={18} readOnly value={envTemplate} />
              </Card>
            )
          }
        ]}
      />
      <Drawer title="调用日志详情" open={Boolean(selectedLog)} width={520} onClose={() => setSelectedLog(undefined)}>
        {selectedLog ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Space wrap>
              <Tag>{selectedLog.moduleLabel}</Tag>
              <Tag color={callLogStatusColors[selectedLog.outputStatus]}>{callLogStatusLabels[selectedLog.outputStatus]}</Tag>
              <Tag color={selectedLog.fallbackTriggered ? "gold" : "green"}>{selectedLog.fallbackTriggered ? "fallback 已触发" : "fallback 未触发"}</Tag>
            </Space>
            <span className="muted">{selectedLog.createdAt}</span>
            <Card size="small" title="Provider / Model">
              {[selectedLog.provider, selectedLog.model].filter(Boolean).join(" / ") || "无 Provider / Model 记录"}
            </Card>
            <Card size="small" title="Prompt 版本">
              {selectedLog.promptVersion || "无 Prompt 版本记录"}
            </Card>
            <Card size="small" title="产品表达规则包">
              {selectedLog.productExpressionRuleVersion
                ? [selectedLog.productExpressionRuleSource, selectedLog.productExpressionRuleVersion].filter(Boolean).join(" / ")
                : "无规则包版本记录"}
            </Card>
            <Card size="small" title="输入摘要">
              {selectedLog.inputSummary}
            </Card>
            <Card size="small" title="输出摘要">
              {selectedLog.outputSummary}
            </Card>
            {selectedLog.failureReasons?.length ? (
              <Card size="small" title="失败原因">
                <List
                  size="small"
                  dataSource={selectedLog.failureReasons}
                  renderItem={(reason) => (
                    <List.Item>
                      <Space direction="vertical" size={4}>
                        <Tag color={reason.severity === "blocker" ? "red" : "gold"}>{reason.label}</Tag>
                        <span>{reason.message}</span>
                        <span className="muted">{reason.nextAction}</span>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ) : (
              <Alert showIcon type="success" message="本次调用没有记录失败原因。" />
            )}
            <Alert showIcon type="info" message="该抽屉只展示调用摘要，不展示密钥、完整 Prompt 原文或模型 trace。" />
          </Space>
        ) : null}
      </Drawer>
      <Drawer title="Prompt 版本说明" open={Boolean(selectedPromptVersion)} width={640} onClose={() => setSelectedPromptVersion(undefined)}>
        {selectedPromptVersion ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Space wrap>
              <Tag color="blue">{selectedPromptVersion.version}</Tag>
              <Tag color={selectedPromptVersion.status === "rolled_back" ? "gold" : "green"}>
                {selectedPromptVersion.status === "rolled_back" ? "已回滚" : "生效中"}
              </Tag>
              {selectedPromptVersion.previousVersion ? <Tag>上一版本 {selectedPromptVersion.previousVersion}</Tag> : null}
            </Space>
            <Alert showIcon type="info" message={selectedPromptVersion.releaseNote || "当前版本只展示治理摘要，不展示 Prompt 原文。"} />
            <Card size="small" title="使用位置">
              {selectedPromptVersion.usedAt}
            </Card>
            <Card size="small" title="输入输出契约">
              <List
                size="small"
                dataSource={[
                  `输入：${selectedPromptVersion.inputContract.join(" / ")}`,
                  `输出：${selectedPromptVersion.outputContract.join(" / ")}`,
                  `失败规则：${selectedPromptVersion.failureRules.join(" / ")}`
                ]}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
            <Card size="small" title="回滚策略">
              <p>{selectedPromptVersion.rollbackPolicy || "回滚由工作台运营或产品 owner 发起，并写入审计记录。"}</p>
              {selectedPromptVersion.rollbackReason ? <p className="muted">最近回滚原因：{selectedPromptVersion.rollbackReason}</p> : null}
              {selectedPromptVersion.rolledBackAt ? <p className="muted">回滚时间：{selectedPromptVersion.rolledBackAt}</p> : null}
            </Card>
            <Alert showIcon type="warning" message="该抽屉不展示 Prompt 原文、模型 trace、密钥或完整调用日志。" />
          </Space>
        ) : null}
      </Drawer>
      <Drawer title="质检反馈详情" open={Boolean(selectedQualityRow)} width={760} onClose={() => setSelectedQualityRow(undefined)}>
        {selectedQualityRow ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Space wrap>
              <Tag color="blue">{selectedQualityRow.dimension}</Tag>
              <Tag>{selectedQualityRow.label}</Tag>
              <Tag>记录 {selectedQualityRow.total}</Tag>
              <Tag color={selectedQualityRow.editRatioSamples ? "purple" : "default"}>
                平均改动 {selectedQualityRow.editRatioSamples ? `${selectedQualityRow.averageEditRatio}%` : "暂无样本"}
              </Tag>
              {selectedQualityRow.heavyEdits ? <Tag color="red">重度编辑 {selectedQualityRow.heavyEdits}</Tag> : null}
              <Tag color={selectedQualityRow.qaDecisionCount ? "green" : "default"}>
                质检采纳 {selectedQualityRow.qaDecisionCount ? `${selectedQualityRow.qaAdoptionRate}%` : "暂无样本"}
              </Tag>
              {selectedQualityRow.suspectedFalsePositive ? <Tag color="gold">疑似误报 {selectedQualityRow.suspectedFalsePositive}</Tag> : null}
              {selectedQualityRow.suspectedMiss ? <Tag color="orange">疑似漏检 {selectedQualityRow.suspectedMiss}</Tag> : null}
            </Space>
            <Alert
              showIcon
              type="info"
              message="这里展示的是质检反馈运营信号"
              description="删除风险片段和 AI 改写暂记为采纳，保留高风险暂记为疑似误报，人工直接编辑暂记为疑似漏检信号；正文改动比例来自轻量 diff 估算，真实评测仍需要结合人工原因、编辑耗时和后续发布结果。"
            />
            <Table
              rowKey="id"
              size="small"
              dataSource={selectedQualityRow.drafts}
              pagination={false}
              scroll={{ x: 1200 }}
              columns={[
                {
                  title: "稿件",
                  dataIndex: "title",
                  width: 220,
                  render: (value, record) => (record.taskId ? <Link href={`/drafts/${record.taskId}`}>{value}</Link> : value)
                },
                {
                  title: "反馈动作",
                  width: 180,
                  render: (_, record) => (
                    <Space wrap>
                      {record.qaAcceptedActionCount ? <Tag color="green">采纳 {record.qaAcceptedActionCount}</Tag> : null}
                      {record.qaPartialAcceptedActionCount ? <Tag color="blue">部分采纳 {record.qaPartialAcceptedActionCount}</Tag> : null}
                      {record.qaIgnoredActionCount ? <Tag color="gold">忽略 {record.qaIgnoredActionCount}</Tag> : null}
                      {!record.qaAcceptedActionCount && !record.qaPartialAcceptedActionCount && !record.qaIgnoredActionCount ? <span className="muted">暂无</span> : null}
                    </Space>
                  )
                },
                {
                  title: "改动强度",
                  width: 150,
                  render: (_, record) =>
                    record.maxChangedRatio ? (
                      <Space direction="vertical" size={2}>
                        <Tag color={record.maxChangedRatio >= 0.3 ? "red" : record.maxChangedRatio >= 0.1 ? "gold" : "green"}>
                          {Math.round(record.maxChangedRatio * 100)}%
                        </Tag>
                        <span className="muted">约 {record.totalChangedCharacterCount || 0} 字</span>
                      </Space>
                    ) : (
                      <span className="muted">暂无</span>
                    )
                },
                {
                  title: "编辑原因",
                  width: 220,
                  render: (_, record) =>
                    record.editReasonSummary?.length ? (
                      <Space wrap>
                        {record.editReasonSummary.slice(0, 3).map((reason) => (
                          <Tag key={`${record.id}-${reason.reason}`} color="purple">
                            {reason.reason} {reason.count}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <span className="muted">暂无</span>
                    )
                },
                {
                  title: "原因分类",
                  width: 160,
                  render: (_, record) =>
                    record.editReasonCategorySummary?.length ? (
                      <Space wrap>
                        {record.editReasonCategorySummary.slice(0, 3).map((category) => (
                          <Tag key={`${record.id}-${category.code}`} color="geekblue">
                            {category.label} {category.count}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <span className="muted">暂无</span>
                    )
                },
                {
                  title: "问题类型",
                  width: 220,
                  render: (_, record) =>
                    record.qaIssueRuleSummary?.length ? (
                      <Space wrap>
                        {record.qaIssueRuleSummary.slice(0, 3).map((issue) => (
                          <Tag key={`${record.id}-${issue.severity}-${issue.rule}`} color={issue.severity === "blocker" ? "red" : "gold"}>
                            {issue.severity === "blocker" ? "阻断" : "提醒"} / {issue.rule} {issue.count}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <span className="muted">暂无</span>
                    )
                },
                {
                  title: "来源",
                  width: 180,
                  render: (_, record) => (
                    <Space direction="vertical" size={2}>
                      <span>{[record.provider || record.mode, record.promptProfile].filter(Boolean).join(" / ") || "未记录"}</span>
                      <span className="muted">
                        {[record.product ? productLabels[record.product] : undefined, record.channel ? channelLabels[record.channel] : undefined].filter(Boolean).join(" / ") || "未记录业务维度"}
                      </span>
                    </Space>
                  )
                },
                {
                  title: "规则包",
                  width: 180,
                  render: (_, record) =>
                    record.productExpressionRuleVersion ? (
                      <Tag color="blue">{[record.productExpressionRuleSource, record.productExpressionRuleVersion].filter(Boolean).join(" / ")}</Tag>
                    ) : (
                      <span className="muted">未记录</span>
                    )
                }
              ]}
            />
          </Space>
        ) : null}
      </Drawer>
        </>
      )}
    </>
  );
}
