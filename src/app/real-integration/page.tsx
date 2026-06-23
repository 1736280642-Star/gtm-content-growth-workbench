"use client";

import {
  Alert,
  Button,
  Card,
  List,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import Link from "next/link";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi, formatApiMessage } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import type { RuntimeCapability } from "@/lib/runtime-config";
import type { DataConfidence } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

interface DiagnosticResult {
  key: string;
  label: string;
  ok: boolean;
  status: "ready" | "pending_config" | "failed";
  message: string;
  missingEnv: string[];
  checkedAt?: string;
}

interface DiagnosticResponse {
  ok: boolean;
  status: "ready" | "pending_config" | "failed";
  results: DiagnosticResult[];
}

interface IntegrationItem {
  key: string;
  group: IntegrationGroup;
  stage: string;
  owner: string;
  evidence: string;
  nextAction: string;
}

interface ScheduledTask {
  key: string;
  item: string;
  status: "ready" | "pending_config";
  evidence: string;
  nextStep: ScheduledTaskNextStep;
  actionText: string;
  entry: ScheduledTaskEntry;
}

interface IntegrationSequenceStep {
  key: string;
  step: string;
  status: "ready" | "pending_config" | "failed";
  evidence: string;
  nextStep: string;
  actionText: string;
  entry: { type: "link"; href: string; label: string } | { type: "command"; label: string } | { type: "button"; label: string };
}

type ScheduledTaskNextStep = "run_manual_pipeline" | "run_worker" | "configure_scheduler" | "confirm_channel_template";
type ScheduledTaskEntry = { type: "link"; href: string; label: string } | { type: "command"; label: string };
type IntegrationGroup = "storage" | "ai_provider" | "blog_source" | "log_source";
type IntegrationNextStep = "fill_required_config" | "run_diagnostic" | "inspect_failure" | "verify_storage" | "trial_geo" | "sync_blog" | "import_log";

const integrationGroupLabels: Record<IntegrationGroup, string> = {
  storage: "数据底座",
  ai_provider: "AI Provider",
  blog_source: "博客源",
  log_source: "日志源"
};

const integrationStatusLabels: Record<DiagnosticResult["status"], string> = {
  ready: "就绪",
  pending_config: "待配置",
  failed: "失败"
};

const integrationNextStepLabels: Record<IntegrationNextStep, string> = {
  fill_required_config: "补必填配置",
  run_diagnostic: "执行诊断",
  inspect_failure: "排查失败",
  verify_storage: "验数据库",
  trial_geo: "GEO 试跑",
  sync_blog: "同步博客",
  import_log: "导入日志"
};

const integrationNextStepColors: Record<IntegrationNextStep, string> = {
  fill_required_config: "gold",
  run_diagnostic: "blue",
  inspect_failure: "red",
  verify_storage: "green",
  trial_geo: "green",
  sync_blog: "green",
  import_log: "green"
};

const scheduledTaskNextStepLabels: Record<ScheduledTaskNextStep, string> = {
  run_manual_pipeline: "手动试跑",
  run_worker: "跑 Worker",
  configure_scheduler: "接定时任务",
  confirm_channel_template: "确认模板"
};

const scheduledTaskNextStepColors: Record<ScheduledTaskNextStep, string> = {
  run_manual_pipeline: "green",
  run_worker: "green",
  configure_scheduler: "gold",
  confirm_channel_template: "gold"
};

const integrationItems: IntegrationItem[] = [
  {
    key: "mysql_repository",
    group: "storage",
    stage: "生产数据底座",
    owner: "开发 / 运维",
    evidence: "npm.cmd run check:mysql 与 npm.cmd run init:mysql 通过",
    nextAction: "补齐 MYSQL_* 后先跑连接检查，再初始化 schema。"
  },
  {
    key: "qwen",
    group: "ai_provider",
    stage: "通义千问 GEO 与生成",
    owner: "业务负责人 / 开发",
    evidence: "配置诊断返回 ready，通义千问平台测试不再 pending_config",
    nextAction: "提供 DASHSCOPE_API_KEY、QWEN_MODEL，可选 QWEN_BASE_URL。"
  },
  {
    key: "deepseek",
    group: "ai_provider",
    stage: "DeepSeek GEO 与生成",
    owner: "业务负责人 / 开发",
    evidence: "配置诊断返回 ready，DeepSeek 平台测试有回答快照",
    nextAction: "提供 DEEPSEEK_API_KEY、DEEPSEEK_MODEL，可选 DEEPSEEK_BASE_URL。"
  },
  {
    key: "doubao",
    group: "ai_provider",
    stage: "豆包 GEO 测试",
    owner: "业务负责人 / 开发",
    evidence: "配置诊断返回 ready，豆包平台测试有回答快照",
    nextAction: "提供 DOUBAO_API_KEY、DOUBAO_MODEL，可选 DOUBAO_BASE_URL。"
  },
  {
    key: "xcrawl_blog_sync",
    group: "blog_source",
    stage: "官网博客同步",
    owner: "开发 / 内容负责人",
    evidence: "博客同步能从真实源导入 URL、标题、正文 hash",
    nextAction: "提供 XCRAWL_BLOG_INDEX_URL 或稳定 sitemap / JSON 源。"
  },
  {
    key: "nginx_log_import",
    group: "log_source",
    stage: "Nginx 访问日志",
    owner: "运维",
    evidence: "日志路径可访问，AI Bot PV 标记为真实数据",
    nextAction: "提供 NGINX_ACCESS_LOG_PATH，并确认 Codex/Worker 有读取权限。"
  },
  {
    key: "cdn_log_import",
    group: "log_source",
    stage: "CDN 访问日志",
    owner: "运维",
    evidence: "CDN 导出文件可访问，AI Bot PV 标记为真实数据",
    nextAction: "提供 CDN_LOG_EXPORT_PATH，并固定导出字段。"
  }
];

const scheduledTasks: ScheduledTask[] = [
  {
    key: "pipeline_manual",
    item: "手动运行 Pipeline",
    status: "ready",
    evidence: "首页按钮和 /api/pipeline/run 已接通",
    nextStep: "run_manual_pipeline",
    actionText: "去首页手动运行 GTM Pipeline，确认博客同步、日志导入、渠道数据和 GEO 试跑的串联结果。",
    entry: { type: "link", href: "/", label: "去首页" }
  },
  {
    key: "pipeline_worker",
    item: "本地 Worker 运行 Pipeline",
    status: "ready",
    evidence: "npm.cmd run worker:run-pipeline 已存在",
    nextStep: "run_worker",
    actionText: "在本地命令行跑 worker:run-pipeline，确认无浏览器介入时也能写入 Pipeline 运行记录。",
    entry: { type: "command", label: "npm.cmd run worker:run-pipeline" }
  },
  {
    key: "pipeline_scheduler",
    item: "定时运行 Pipeline",
    status: "pending_config",
    evidence: "npm.cmd run worker:schedule-pipeline 已存在，尚未接入系统级计划任务",
    nextStep: "configure_scheduler",
    actionText: "先确认运行间隔和机器环境，再接 Windows Task Scheduler、cron 或生产队列。",
    entry: { type: "command", label: "npm.cmd run worker:schedule-pipeline" }
  },
  {
    key: "channel_templates",
    item: "渠道数据导出模板",
    status: "pending_config",
    evidence: "CSV 导入已接通，微信/CSDN/掘金/知乎/头条字段模板待确认",
    nextStep: "confirm_channel_template",
    actionText: "先固定各渠道导出字段，再去发布队列做一次 CSV 导入校验，避免正式回填时字段错位。",
    entry: { type: "link", href: "/publish", label: "去发布队列" }
  }
];

function getStatusColor(status?: string) {
  if (status === "ready" || status === "success") return "green";
  if (status === "failed") return "red";
  return "gold";
}

function getStatusLabel(status?: string) {
  if (status === "success") return "成功";
  return integrationStatusLabels[status as DiagnosticResult["status"]] || status || "待配置";
}

function getCapabilityStatus(capability?: RuntimeCapability, diagnostic?: DiagnosticResult): DiagnosticResult["status"] {
  return diagnostic?.status || capability?.status || "pending_config";
}

function getIntegrationNextStep(item: IntegrationItem, capability?: RuntimeCapability, diagnostic?: DiagnosticResult): IntegrationNextStep {
  if (diagnostic?.status === "failed") {
    return "inspect_failure";
  }

  if (getCapabilityStatus(capability, diagnostic) === "pending_config") {
    return "fill_required_config";
  }

  if (!diagnostic) {
    return "run_diagnostic";
  }

  if (item.key === "mysql_repository") {
    return "verify_storage";
  }

  if (item.key === "xcrawl_blog_sync") {
    return "sync_blog";
  }

  if (item.key === "nginx_log_import" || item.key === "cdn_log_import") {
    return "import_log";
  }

  return "trial_geo";
}

function getIntegrationActionText(item: IntegrationItem, capability?: RuntimeCapability, diagnostic?: DiagnosticResult) {
  const nextStep = getIntegrationNextStep(item, capability, diagnostic);
  const missingEnv = diagnostic?.missingEnv?.length ? diagnostic.missingEnv : capability?.missingEnv || [];

  if (nextStep === "fill_required_config") {
    return `先补齐 ${missingEnv.length ? missingEnv.join(", ") : "必填配置"}，再刷新配置状态或运行诊断。`;
  }

  if (nextStep === "inspect_failure") {
    return diagnostic?.message || "配置已存在但诊断失败，先检查模型、base_url、文件路径或读取权限。";
  }

  if (nextStep === "run_diagnostic") {
    return "环境变量看起来已齐，先运行诊断确认连接、路径或权限，再进入业务页面试跑。";
  }

  if (nextStep === "verify_storage") {
    return "先执行 MySQL 连接检查和 schema 初始化，再跑一周 workflow smoke 验证持久化链路。";
  }

  if (nextStep === "sync_blog") {
    return "去博客监控页同步真实官网博客源，确认文章 URL、标题和正文 hash 能写入台账。";
  }

  if (nextStep === "import_log") {
    return "去博客监控页导入真实日志，确认 AI Bot PV 不再只停留在 Demo 数据。";
  }

  return "去 GEO 测试页对该平台跑真实 Prompt，确认回答快照、引用和候选池承接正常。";
}

function getIntegrationEntry(item: IntegrationItem, capability?: RuntimeCapability, diagnostic?: DiagnosticResult) {
  const nextStep = getIntegrationNextStep(item, capability, diagnostic);

  if (nextStep === "fill_required_config" || nextStep === "inspect_failure") {
    return { type: "link" as const, href: "/ai-config", label: "看配置" };
  }

  if (nextStep === "trial_geo") {
    return { type: "link" as const, href: "/geo-test", label: "去试跑" };
  }

  if (nextStep === "sync_blog" || nextStep === "import_log") {
    return { type: "link" as const, href: "/blog-monitor", label: "去导入" };
  }

  if (nextStep === "verify_storage") {
    return { type: "command" as const, label: "跑 MySQL 检查" };
  }

  return { type: "diagnostic" as const, label: "先诊断" };
}

function isIntegrationReadyStep(step: IntegrationNextStep) {
  return step === "verify_storage" || step === "trial_geo" || step === "sync_blog" || step === "import_log";
}

function inferBotConfidence(values: { dataConfidence: DataConfidence }[]) {
  if (values.some((item) => item.dataConfidence === "real")) return "real";
  if (values.some((item) => item.dataConfidence === "imported")) return "imported";
  if (values.some((item) => item.dataConfidence === "demo")) return "demo";
  return "pending";
}

function createIntegrationSequenceSteps(input: {
  state: ReturnType<typeof useWorkbenchSnapshot>["state"];
  capabilities: RuntimeCapability[];
  diagnostics: Record<string, DiagnosticResult>;
}) {
  const { state, capabilities, diagnostics } = input;
  const capabilityByKey = Object.fromEntries(capabilities.map((item) => [item.key, item]));
  const mysqlItem = integrationItems.find((item) => item.key === "mysql_repository");
  const blogItem = integrationItems.find((item) => item.key === "xcrawl_blog_sync");
  const logItems = integrationItems.filter((item) => item.key === "nginx_log_import" || item.key === "cdn_log_import");
  const aiItems = integrationItems.filter((item) => item.group === "ai_provider");
  const mysqlStep = mysqlItem ? getIntegrationNextStep(mysqlItem, capabilityByKey[mysqlItem.key], diagnostics[mysqlItem.key]) : "fill_required_config";
  const blogStep = blogItem ? getIntegrationNextStep(blogItem, capabilityByKey[blogItem.key], diagnostics[blogItem.key]) : "fill_required_config";
  const logSteps = logItems.map((item) => getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]));
  const aiStatuses = aiItems.map((item) => getCapabilityStatus(capabilityByKey[item.key], diagnostics[item.key]));
  const aiReadyCount = aiStatuses.filter((item) => item === "ready").length;
  const aiFailedCount = aiStatuses.filter((item) => item === "failed").length;
  const hasPipelineRun = Boolean(state.pipelineRuns?.length);
  const storageMode = String(state.runtime.storage);
  const logModeReady = state.workspaceSetting.logMode === "nginx_log" || state.workspaceSetting.logMode === "cdn_log";

  const storageStatus: IntegrationSequenceStep["status"] = storageMode === "local_json" ? "ready" : "pending_config";
  const mysqlStatus: IntegrationSequenceStep["status"] =
    mysqlStep === "inspect_failure" ? "failed" : mysqlStep === "verify_storage" ? "ready" : "pending_config";
  const aiStatus: IntegrationSequenceStep["status"] = aiFailedCount ? "failed" : aiReadyCount === aiItems.length ? "ready" : "pending_config";
  const sourceStatus: IntegrationSequenceStep["status"] =
    blogStep === "inspect_failure" || logSteps.includes("inspect_failure")
      ? "failed"
      : blogStep === "sync_blog" && logSteps.some((step) => step === "import_log") && logModeReady
        ? "ready"
        : "pending_config";
  const automationStatus: IntegrationSequenceStep["status"] = hasPipelineRun ? "ready" : "pending_config";

  return [
    {
      key: "local_json_chain",
      step: "本地 JSON 主链路",
      status: storageStatus,
      evidence: `当前存储模式：${state.runtime.storage}；状态文件：${state.runtime.statePath}`,
      nextStep: storageStatus === "ready" ? "继续保留 JSON 主链路可跑" : "先恢复 JSON 主链路",
      actionText: storageStatus === "ready" ? "先用本地 JSON 把页面、流程和状态结构跑通，再继续外部接入。" : "先检查运行态和状态文件，避免外部配置问题掩盖页面闭环问题。",
      entry: { type: "link", href: "/", label: "去首页" }
    },
    {
      key: "mysql_storage",
      step: "MySQL 持久化",
      status: mysqlStatus,
      evidence: mysqlItem?.evidence || "待补 MySQL 连接检查",
      nextStep: integrationNextStepLabels[mysqlStep as IntegrationNextStep] || "补配置",
      actionText: mysqlItem ? getIntegrationActionText(mysqlItem, capabilityByKey[mysqlItem.key], diagnostics[mysqlItem.key]) : "先补齐 MySQL 配置。",
      entry: mysqlStep === "verify_storage" ? { type: "command", label: "跑 MySQL 检查" } : { type: "link", href: "/ai-config", label: "看配置" }
    },
    {
      key: "ai_provider_sequence",
      step: "AI Provider 试跑",
      status: aiStatus,
      evidence: `已就绪 ${aiReadyCount}/${aiItems.length} 个 Provider；GEO 平台：${state.workspaceSetting.geoPlatforms.join("、")}`,
      nextStep: aiStatus === "ready" ? "进入 GEO 试跑" : aiFailedCount ? "先排查失败 Provider" : "补齐 Provider 配置并诊断",
      actionText:
        aiStatus === "ready"
          ? "逐个平台跑真实 GEO Prompt，确认回答快照、官网引用和候选池承接正常。"
          : aiFailedCount
            ? "先在 AI 配置页排查失败的 Provider，再决定是否继续试跑其他平台。"
            : "先补必填配置并完成诊断，再进入 GEO 和内容生成试跑。",
      entry: aiStatus === "ready" ? { type: "link", href: "/geo-test", label: "去试跑" } : { type: "link", href: "/ai-config", label: "看配置" }
    },
    {
      key: "blog_log_sources",
      step: "博客源与日志源",
      status: sourceStatus,
      evidence: `日志模式：${state.workspaceSetting.logMode}；Pipeline 运行记录：${state.pipelineRuns?.length || 0} 次`,
      nextStep: sourceStatus === "ready" ? "导入真实博客与日志" : sourceStatus === "failed" ? "排查导入失败" : "补齐博客源或日志路径",
      actionText:
        sourceStatus === "ready"
          ? "去博客监控页同步真实博客与日志，确认 URL、标题、正文 hash 和 AI Bot PV 已不再停留在 Demo。"
          : sourceStatus === "failed"
            ? "先排查博客同步、日志路径或读取权限失败，再恢复真实数据导入。"
            : "先补 XCRAWL_BLOG_INDEX_URL、日志路径和日志模式，再进入博客监控页做导入验证。",
      entry: { type: "link", href: "/blog-monitor", label: "去导入" }
    },
    {
      key: "pipeline_automation",
      step: "自动化与模板收口",
      status: automationStatus,
      evidence: hasPipelineRun ? `最近 Pipeline：${state.pipelineRuns?.[0]?.status || "unknown"} / ${state.pipelineRuns?.[0]?.finishedAt || "-"}` : "尚无 Pipeline 运行记录",
      nextStep: hasPipelineRun ? "继续接定时任务和模板" : "先手动试跑 Pipeline",
      actionText: hasPipelineRun ? "在自动化与模板表继续确认定时任务和渠道模板，避免真实回填时字段错位。" : "先从首页手动运行一次 GTM Pipeline，确认博客、日志、渠道数据和 GEO 试跑已串起来。",
      entry: hasPipelineRun ? { type: "link", href: "/publish", label: "看模板" } : { type: "link", href: "/", label: "去首页" }
    }
  ] satisfies IntegrationSequenceStep[];
}

export default function RealIntegrationPage() {
  const { state, loading, error, refresh } = useWorkbenchSnapshot();
  const [messageApi, contextHolder] = message.useMessage();
  const [capabilities, setCapabilities] = useState<RuntimeCapability[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, DiagnosticResult>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [testingKey, setTestingKey] = useState<string>();
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [capabilityError, setCapabilityError] = useState<string>();
  const [integrationGroupFilter, setIntegrationGroupFilter] = useState<IntegrationGroup[]>([]);
  const [integrationStatusFilter, setIntegrationStatusFilter] = useState<DiagnosticResult["status"][]>([]);

  const capabilityByKey = useMemo(() => {
    return Object.fromEntries(capabilities.map((item) => [item.key, item]));
  }, [capabilities]);
  const hasIntegrationFilter = Boolean(integrationGroupFilter.length || integrationStatusFilter.length);
  const filteredIntegrationItems = useMemo(() => {
    return integrationItems.filter((item) => {
      const groupMatched = !integrationGroupFilter.length || integrationGroupFilter.includes(item.group);
      const status = getCapabilityStatus(capabilityByKey[item.key], diagnostics[item.key]);
      const statusMatched = !integrationStatusFilter.length || integrationStatusFilter.includes(status);

      return groupMatched && statusMatched;
    });
  }, [capabilityByKey, diagnostics, integrationGroupFilter, integrationStatusFilter]);
  const visibleFillConfigCount = filteredIntegrationItems.filter(
    (item) => getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]) === "fill_required_config"
  ).length;
  const visibleRunDiagnosticCount = filteredIntegrationItems.filter(
    (item) => getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]) === "run_diagnostic"
  ).length;
  const visibleInspectFailureCount = filteredIntegrationItems.filter(
    (item) => getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]) === "inspect_failure"
  ).length;
  const visibleReadyEntryCount = filteredIntegrationItems.filter((item) =>
    isIntegrationReadyStep(getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]))
  ).length;
  const automationPendingCount = scheduledTasks.filter((item) => item.status !== "ready").length;
  const highestPriorityScheduledTask = scheduledTasks.find((item) => item.status !== "ready");
  const highestPriorityIntegrationItem = filteredIntegrationItems.find((item) => {
    const nextStep = getIntegrationNextStep(item, capabilityByKey[item.key], diagnostics[item.key]);

    return !isIntegrationReadyStep(nextStep);
  });

  const diagnosticList = useMemo(() => Object.values(diagnostics), [diagnostics]);
  const failedCount = diagnosticList.filter((item) => item.status === "failed").length;
  const readyCount = capabilities.filter((item) => getCapabilityStatus(item, diagnostics[item.key]) === "ready").length;
  const pendingCount = capabilities.filter((item) => getCapabilityStatus(item, diagnostics[item.key]) === "pending_config").length;
  const totalCount = capabilities.length || 1;
  const readinessPercent = Math.round((readyCount / totalCount) * 100);
  const lastPipelineRun = state.pipelineRuns?.[0];
  const botConfidence = inferBotConfidence(state.botVisits);
  const integrationSequenceSteps = useMemo(
    () =>
      createIntegrationSequenceSteps({
        state,
        capabilities,
        diagnostics
      }),
    [state, capabilities, diagnostics]
  );

  const loadCapabilities = useCallback(async () => {
    setLoadingCapabilities(true);

    try {
      const response = await fetch("/api/runtime-config/status", { cache: "no-store" });

      if (!response.ok) {
        setCapabilityError(`配置状态接口返回 ${response.status} ${response.statusText || "请求失败"}`);
        return;
      }

      const result = (await response.json()) as { capabilities: RuntimeCapability[] };
      setCapabilities(result.capabilities);
      setCapabilityError(undefined);
    } catch (error) {
      setCapabilityError(error instanceof Error ? error.message : "配置状态加载失败");
    } finally {
      setLoadingCapabilities(false);
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  function clearIntegrationFilters() {
    setIntegrationGroupFilter([]);
    setIntegrationStatusFilter([]);
  }

  async function handleRunAllDiagnostics() {
    setRunningAll(true);

    try {
      const result = await callJsonApi<DiagnosticResponse>("/api/config-diagnostics", { method: "GET" });
      setDiagnostics(Object.fromEntries(result.results.map((item) => [item.key, item])));
      messageApi[result.status === "failed" ? "error" : result.status === "pending_config" ? "warning" : "success"](
        formatApiMessage(result, result.status === "ready" ? "全部配置已就绪" : "配置诊断已完成")
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "配置诊断失败");
    } finally {
      setRunningAll(false);
    }
  }

  async function handleTestCapability(key: string) {
    setTestingKey(key);

    try {
      const result = await callJsonApi<DiagnosticResult>("/api/config-diagnostics", {
        method: "POST",
        body: JSON.stringify({ key })
      });
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

  return (
    <>
      {contextHolder}
      <PageHeader
        title="真实接入"
        subtitle="把外部配置、真实数据源、Pipeline 定时任务和当前运行态集中到一个交接页，避免配置散在文档和页面里。"
        actions={
          <>
            <Button loading={runningAll} onClick={handleRunAllDiagnostics}>
              运行全部诊断
            </Button>
            <Button loading={loadingCapabilities} onClick={() => void loadCapabilities()}>
              刷新配置状态
            </Button>
            <Button onClick={() => refresh()}>刷新运行态</Button>
            <Link href="/ai-config">
              <Button type="primary">查看 .env 模板</Button>
            </Link>
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <PageErrorState
        title="外部配置状态加载失败"
        message={capabilityError}
        loading={loadingCapabilities}
        onRetry={loadCapabilities}
        description={capabilityError ? `${capabilityError}。当前外部能力就绪度可能不准确，请重试后再做真实接入判断。` : undefined}
      />

      <Alert
        type={capabilityError ? "warning" : failedCount ? "error" : pendingCount ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          capabilityError
            ? "外部配置状态暂不可用。"
            : pendingCount || failedCount
              ? "当前仍处在真实接入前的可试运行状态。"
              : "外部能力已全部就绪，可以进入真实数据验收。"
        }
        description="页面只展示配置项名称、状态和缺失字段，不读取或显示任何密钥值。"
      />
      <Alert
        showIcon
        type={visibleInspectFailureCount ? "error" : visibleFillConfigCount ? "warning" : visibleRunDiagnosticCount ? "info" : "success"}
        style={{ marginBottom: 16 }}
        message={`接入缺口共 ${filteredIntegrationItems.length} 项，待补配置 ${visibleFillConfigCount} 项，待诊断 ${visibleRunDiagnosticCount} 项`}
        description={
          highestPriorityIntegrationItem
            ? `当前优先处理：${highestPriorityIntegrationItem.stage}，${getIntegrationActionText(
                highestPriorityIntegrationItem,
                capabilityByKey[highestPriorityIntegrationItem.key],
                diagnostics[highestPriorityIntegrationItem.key]
              )}`
            : `可试跑入口 ${visibleReadyEntryCount} 项，建议逐项进入对应业务页面验证真实数据。`
        }
      />

      <div className="metric-grid">
        <Card size="small">
          <Typography.Text type="secondary">外部能力就绪度</Typography.Text>
          <Progress percent={readinessPercent} size="small" status={failedCount ? "exception" : pendingCount ? "active" : "success"} />
        </Card>
        <Card size="small">已就绪：{readyCount}</Card>
        <Card size="small">待配置：{pendingCount}</Card>
        <Card size="small">诊断失败：{failedCount}</Card>
      </div>

      <div className="two-column">
        <Card title="运行态证据">
          <List
            loading={loading}
            dataSource={[
              `存储模式：${state.runtime.storage}`,
              `状态文件：${state.runtime.statePath}`,
              `工作台设置：每周 ${state.workspaceSetting.defaultWeeklyDays} 天，每天 ${state.workspaceSetting.defaultDailyCount} 篇`,
              `GEO 平台：${state.workspaceSetting.geoPlatforms.join("、")}`,
              `日志模式：${state.workspaceSetting.logMode}`,
              `AI Bot 数据可信度：${botConfidence}`,
              `Pipeline 运行记录：${state.pipelineRuns?.length || 0} 次`,
              `最近 Pipeline：${lastPipelineRun ? `${lastPipelineRun.status} / ${lastPipelineRun.finishedAt}` : "暂无"}`
            ]}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
        </Card>
        <Card title="接入顺序">
          <Table
            rowKey="key"
            pagination={false}
            dataSource={integrationSequenceSteps}
            columns={[
              { title: "步骤", dataIndex: "step" },
              { title: "状态", dataIndex: "status", render: (value) => <Tag color={getStatusColor(value)}>{getStatusLabel(value)}</Tag> },
              { title: "证据", dataIndex: "evidence" },
              {
                title: "下一步",
                dataIndex: "nextStep",
                render: (value) => <Tag color="blue">{value}</Tag>
              },
              { title: "处理动作", dataIndex: "actionText" },
              {
                title: "可执行入口",
                render: (_, record) =>
                  record.entry.type === "link" ? (
                    <Link href={record.entry.href}>
                      <Button size="small">{record.entry.label}</Button>
                    </Link>
                  ) : (
                    <span className="mono">{record.entry.label}</span>
                  )
              }
            ]}
          />
        </Card>
      </div>

      <Card title="外部配置交接表" style={{ marginTop: 16 }}>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按接入类型筛选"
            value={integrationGroupFilter}
            onChange={(value) => setIntegrationGroupFilter(value)}
            options={Object.entries(integrationGroupLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按配置状态筛选"
            value={integrationStatusFilter}
            onChange={(value) => setIntegrationStatusFilter(value)}
            options={Object.entries(integrationStatusLabels).map(([value, label]) => ({ value, label }))}
            style={{ minWidth: 220 }}
          />
          <Button onClick={clearIntegrationFilters} disabled={!hasIntegrationFilter}>
            清空筛选
          </Button>
        </Space>
        <Table
          rowKey="key"
          dataSource={filteredIntegrationItems}
          loading={loadingCapabilities}
          pagination={false}
          locale={{
            emptyText: (
              <ActionEmpty
                title="当前筛选没有真实接入项"
                description="清空筛选或调整接入类型、配置状态后再查看。"
                action={
                  <Button type="primary" onClick={clearIntegrationFilters}>
                    清空筛选
                  </Button>
                }
              />
            )
          }}
          columns={[
            { title: "接入类型", dataIndex: "group", render: (value) => <Tag>{integrationGroupLabels[value as IntegrationGroup]}</Tag> },
            { title: "阶段", dataIndex: "stage" },
            {
              title: "状态",
              render: (_, record) => {
                const capability = capabilityByKey[record.key];
                const diagnostic = diagnostics[record.key];
                const status = getCapabilityStatus(capability, diagnostic);

                return <Tag color={getStatusColor(status)}>{getStatusLabel(status)}</Tag>;
              }
            },
            {
              title: "缺少配置",
              render: (_, record) => {
                const capability = capabilityByKey[record.key];
                const diagnostic = diagnostics[record.key];
                const missingEnv = diagnostic?.missingEnv?.length ? diagnostic.missingEnv : capability?.missingEnv || [];

                return missingEnv.length ? <span className="mono">{missingEnv.join(", ")}</span> : "-";
              }
            },
            { title: "交付证据", dataIndex: "evidence" },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getIntegrationNextStep(record, capabilityByKey[record.key], diagnostics[record.key]);

                return <Tag color={integrationNextStepColors[nextStep]}>{integrationNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getIntegrationActionText(record, capabilityByKey[record.key], diagnostics[record.key])
            },
            { title: "负责人", dataIndex: "owner" },
            {
              title: "可执行入口",
              render: (_, record) => {
                const entry = getIntegrationEntry(record, capabilityByKey[record.key], diagnostics[record.key]);

                return (
                  <Space>
                    <Button
                      size="small"
                      type={entry.type === "diagnostic" ? "primary" : "default"}
                      loading={testingKey === record.key}
                      onClick={() => handleTestCapability(record.key)}
                    >
                      诊断
                    </Button>
                    {entry.type === "link" ? (
                      <Link href={entry.href}>
                        <Button size="small">{entry.label}</Button>
                      </Link>
                    ) : (
                      <span className="muted">{entry.label}</span>
                    )}
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>

      <Card title="自动化与模板" style={{ marginTop: 16 }}>
        <Alert
          showIcon
          type={automationPendingCount ? "warning" : "success"}
          style={{ marginBottom: 16 }}
          message={`自动化与模板共 ${scheduledTasks.length} 项，待配置 ${automationPendingCount} 项`}
          description={
            highestPriorityScheduledTask
              ? `当前优先处理：${highestPriorityScheduledTask.item}，${highestPriorityScheduledTask.actionText}`
              : "手动 Pipeline、本地 Worker、定时入口和渠道模板都已具备试跑入口。"
          }
        />
        <Table
          rowKey="key"
          dataSource={scheduledTasks}
          pagination={false}
          columns={[
            { title: "项目", dataIndex: "item" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={getStatusColor(value)}>{getStatusLabel(value)}</Tag> },
            { title: "证据", dataIndex: "evidence" },
            {
              title: "下一步",
              render: (_, record) => <Tag color={scheduledTaskNextStepColors[record.nextStep]}>{scheduledTaskNextStepLabels[record.nextStep]}</Tag>
            },
            { title: "处理动作", dataIndex: "actionText" },
            {
              title: "可执行入口",
              render: (_, record) =>
                record.entry.type === "link" ? (
                  <Link href={record.entry.href}>
                    <Button size="small">{record.entry.label}</Button>
                  </Link>
                ) : (
                  <span className="mono">{record.entry.label}</span>
                )
            }
          ]}
        />
      </Card>
    </>
  );
}
