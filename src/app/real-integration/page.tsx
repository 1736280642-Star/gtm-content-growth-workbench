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
import { GovernanceEntry } from "@/components/GovernanceEntry";
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
type IntegrationGroup = "storage" | "ai_provider" | "blog_source" | "log_source" | "distribution";
type IntegrationNextStep =
  | "fill_required_config"
  | "run_diagnostic"
  | "inspect_failure"
  | "verify_storage"
  | "trial_geo"
  | "sync_blog"
  | "import_log"
  | "send_platform_draft";

const integrationGroupLabels: Record<IntegrationGroup, string> = {
  storage: "数据底座",
  ai_provider: "模型接入",
  blog_source: "博客源",
  log_source: "日志源",
  distribution: "平台分发"
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
  import_log: "导入日志",
  send_platform_draft: "发送草稿"
};

const integrationNextStepColors: Record<IntegrationNextStep, string> = {
  fill_required_config: "gold",
  run_diagnostic: "blue",
  inspect_failure: "red",
  verify_storage: "green",
  trial_geo: "green",
  sync_blog: "green",
  import_log: "green",
  send_platform_draft: "green"
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
    stage: "团队数据存储",
    owner: "开发 / 运维",
    evidence: "团队数据存储连接可用，内容记录可以正常保存",
    nextAction: "填写数据库连接信息并完成连接检查。"
  },
  {
    key: "qwen",
    group: "ai_provider",
    stage: "通义千问 GEO 与生成",
    owner: "业务负责人 / 开发",
    evidence: "通义千问可以正常返回 GEO 测试结果",
    nextAction: "填写通义千问模型和授权信息。"
  },
  {
    key: "deepseek",
    group: "ai_provider",
    stage: "DeepSeek GEO 与生成",
    owner: "业务负责人 / 开发",
    evidence: "DeepSeek 可以正常返回 GEO 测试结果",
    nextAction: "填写 DeepSeek 模型和授权信息。"
  },
  {
    key: "doubao",
    group: "ai_provider",
    stage: "豆包 GEO 测试",
    owner: "业务负责人 / 开发",
    evidence: "豆包可以正常返回 GEO 测试结果",
    nextAction: "填写豆包模型和授权信息。"
  },
  {
    key: "knowledge_url_crawler",
    group: "blog_source",
    stage: "知识库 URL 抓取",
    owner: "开发 / 内容负责人",
    evidence: "网页资料可以正常解析，失败时会显示可操作的原因",
    nextAction: "选择网页解析服务并填写授权信息。"
  },
  {
    key: "xcrawl_blog_sync",
    group: "blog_source",
    stage: "官网博客同步",
    owner: "开发 / 内容负责人",
    evidence: "官网博客可以正常同步 URL、标题和正文",
    nextAction: "填写官网博客目录或站点地图地址。"
  },
  {
    key: "wechatsync_bridge",
    group: "distribution",
    stage: "平台草稿连接",
    owner: "开发 / 内容发布",
    evidence: "工作台可以向发布平台发送草稿",
    nextAction: "启用平台草稿连接并完成连接检查。"
  },
  {
    key: "wechat_mp_draft",
    group: "distribution",
    stage: "微信公众号草稿",
    owner: "内容发布 / 公众号管理员",
    evidence: "微信公众号可以正常接收草稿",
    nextAction: "填写公众号授权和默认封面；工作台只创建草稿，不自动发布。"
  },
  {
    key: "csdn_draft",
    group: "distribution",
    stage: "CSDN 草稿",
    owner: "内容发布 / CSDN 账号管理员",
    evidence: "CSDN 可以正常接收草稿",
    nextAction: "填写 CSDN 登录授权；如授权失效，请重新连接账号。"
  },
  {
    key: "juejin_draft",
    group: "distribution",
    stage: "掘金草稿",
    owner: "内容发布 / 掘金账号管理员",
    evidence: "掘金可以正常接收草稿",
    nextAction: "填写掘金登录授权、默认标签和内容分类。"
  },
  {
    key: "zhihu_draft",
    group: "distribution",
    stage: "知乎草稿",
    owner: "内容发布 / 知乎账号管理员",
    evidence: "知乎可以正常接收草稿",
    nextAction: "填写知乎登录授权；如授权失效，请重新连接账号。"
  },
  {
    key: "nginx_log_import",
    group: "log_source",
    stage: "Nginx 访问日志",
    owner: "运维",
    evidence: "日志路径可访问，AI 访问量标记为真实数据",
    nextAction: "填写网站访问日志位置并确认可读取。"
  },
  {
    key: "cdn_log_import",
    group: "log_source",
    stage: "CDN 访问日志",
    owner: "运维",
    evidence: "CDN 导出文件可访问，AI 访问量标记为真实数据",
    nextAction: "填写 CDN 数据文件位置并确认导出字段。"
  }
];

const scheduledTasks: ScheduledTask[] = [
  {
    key: "pipeline_manual",
    item: "手动运行自动任务",
    status: "ready",
    evidence: "自动任务可以手动运行",
    nextStep: "run_manual_pipeline",
    actionText: "运行一次自动任务，确认博客、访问数据、渠道数据和 GEO 测试可以顺利衔接。",
    entry: { type: "command", label: "npm.cmd run worker:run-pipeline" }
  },
  {
    key: "pipeline_worker",
    item: "后台运行自动任务",
    status: "ready",
    evidence: "自动任务可以在后台运行",
    nextStep: "run_worker",
    actionText: "运行一次后台任务，确认任务记录和业务结果均可正常更新。",
    entry: { type: "command", label: "npm.cmd run worker:run-pipeline" }
  },
  {
    key: "pipeline_scheduler",
    item: "定时运行自动任务",
    status: "pending_config",
    evidence: "定时规则尚未启用",
    nextStep: "configure_scheduler",
    actionText: "先确认运行频率和执行时间，再启用定时任务。",
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

  if (item.key === "knowledge_url_crawler" || item.key === "xcrawl_blog_sync") {
    return "sync_blog";
  }

  if (item.key === "nginx_log_import" || item.key === "cdn_log_import") {
    return "import_log";
  }

  if (item.key === "wechatsync_bridge" || item.key === "wechat_mp_draft") {
    return "send_platform_draft";
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
    return "先完成数据存储连接检查，再确认内容记录可以正常保存和读取。";
  }

  if (nextStep === "sync_blog") {
    return "去博客监控页同步官网内容，确认文章 URL、标题和正文可以正常更新。";
  }

  if (nextStep === "import_log") {
    return "去博客监控页导入访问数据，确认 AI 访问趋势可以正常更新。";
  }

  if (nextStep === "send_platform_draft") {
    return item.key === "wechatsync_bridge"
      ? "先启用平台连接，再去今日发布页发送一篇草稿并确认平台已收到。"
      : "去今日发布页发送一篇微信草稿；成功后到公众号后台草稿箱人工预览、发布，再回工作台填 URL。";
  }

    return "去 GEO 测试页运行一组问题，确认回答、引用和候选池均可正常使用。";
}

function getIntegrationEntry(item: IntegrationItem, capability?: RuntimeCapability, diagnostic?: DiagnosticResult) {
  const nextStep = getIntegrationNextStep(item, capability, diagnostic);

  if (nextStep === "fill_required_config" || nextStep === "inspect_failure") {
    return { type: "link" as const, href: "/ai-config", label: "看配置" };
  }

  if (nextStep === "trial_geo") {
    return { type: "link" as const, href: "/geo-test", label: "去试跑" };
  }

  if (item.key === "knowledge_url_crawler" && nextStep === "sync_blog") {
    return { type: "link" as const, href: "/knowledge/import/url", label: "去解析" };
  }

  if (nextStep === "sync_blog" || nextStep === "import_log") {
    return { type: "link" as const, href: "/blog-monitor", label: "去导入" };
  }

  if (nextStep === "send_platform_draft") {
    return { type: "link" as const, href: "/today", label: "去发草稿" };
  }

  if (nextStep === "verify_storage") {
    return { type: "command" as const, label: "跑 MySQL 检查" };
  }

  return { type: "diagnostic" as const, label: "先诊断" };
}

function isIntegrationReadyStep(step: IntegrationNextStep) {
  return step === "verify_storage" || step === "trial_geo" || step === "sync_blog" || step === "import_log" || step === "send_platform_draft";
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
  const crawlerItem = integrationItems.find((item) => item.key === "knowledge_url_crawler");
  const blogItem = integrationItems.find((item) => item.key === "xcrawl_blog_sync");
  const logItems = integrationItems.filter((item) => item.key === "nginx_log_import" || item.key === "cdn_log_import");
  const aiItems = integrationItems.filter((item) => item.group === "ai_provider");
  const mysqlStep = mysqlItem ? getIntegrationNextStep(mysqlItem, capabilityByKey[mysqlItem.key], diagnostics[mysqlItem.key]) : "fill_required_config";
  const crawlerStep = crawlerItem ? getIntegrationNextStep(crawlerItem, capabilityByKey[crawlerItem.key], diagnostics[crawlerItem.key]) : "fill_required_config";
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
    crawlerStep === "inspect_failure" || blogStep === "inspect_failure" || logSteps.includes("inspect_failure")
      ? "failed"
      : crawlerStep === "sync_blog" && blogStep === "sync_blog" && logSteps.some((step) => step === "import_log") && logModeReady
        ? "ready"
        : "pending_config";
  const automationStatus: IntegrationSequenceStep["status"] = hasPipelineRun ? "ready" : "pending_config";

  return [
    {
      key: "local_json_chain",
      step: "内容数据存储",
      status: storageStatus,
      evidence: storageStatus === "ready" ? "内容记录可以正常保存和读取" : "内容记录暂时无法保存",
      nextStep: storageStatus === "ready" ? "继续检查其他连接" : "先恢复内容数据存储",
      actionText: storageStatus === "ready" ? "内容数据存储可用，可以继续检查模型、采集和发布连接。" : "先恢复内容数据存储，再继续处理其他连接。",
      entry: { type: "link", href: "/", label: "去首页" }
    },
    {
      key: "mysql_storage",
      step: "团队数据存储",
      status: mysqlStatus,
      evidence: mysqlItem?.evidence || "待补 MySQL 连接检查",
      nextStep: integrationNextStepLabels[mysqlStep as IntegrationNextStep] || "补配置",
      actionText: mysqlItem ? getIntegrationActionText(mysqlItem, capabilityByKey[mysqlItem.key], diagnostics[mysqlItem.key]) : "先补齐 MySQL 配置。",
      entry: mysqlStep === "verify_storage" ? { type: "command", label: "跑 MySQL 检查" } : { type: "link", href: "/ai-config", label: "看配置" }
    },
    {
      key: "ai_provider_sequence",
      step: "模型连接",
      status: aiStatus,
      evidence: `已就绪 ${aiReadyCount}/${aiItems.length} 个模型接入；GEO 平台：${state.workspaceSetting.geoPlatforms.join("、")}`,
      nextStep: aiStatus === "ready" ? "进入 GEO 试跑" : aiFailedCount ? "先排查失败模型接入" : "补齐模型配置并诊断",
      actionText:
        aiStatus === "ready"
          ? "逐个平台运行 GEO 测试，确认回答、官网引用和候选池承接正常。"
          : aiFailedCount
            ? "先在 AI 配置页排查失败的模型接入，再决定是否继续试跑其他平台。"
            : "先补齐必填信息并完成检查，再进入 GEO 和内容生成。",
      entry: aiStatus === "ready" ? { type: "link", href: "/geo-test", label: "去测试" } : { type: "link", href: "/ai-config", label: "看配置" }
    },
    {
      key: "blog_log_sources",
      step: "博客源与日志源",
      status: sourceStatus,
      evidence: `采集方式：${state.workspaceSetting.logMode}；自动任务 ${state.pipelineRuns?.length || 0} 次`,
      nextStep: sourceStatus === "ready" ? "同步博客与访问数据" : sourceStatus === "failed" ? "排查导入失败" : "补齐博客源或访问数据路径",
      actionText:
        sourceStatus === "ready"
          ? "去博客监控页同步博客与访问数据，确认内容和 AI 访问趋势可以正常更新。"
          : sourceStatus === "failed"
            ? "先排查博客同步、访问数据路径或读取权限，再恢复数据导入。"
            : "先完善博客来源和访问数据路径，再进入博客监控页确认数据。",
      entry: { type: "link", href: "/blog-monitor", label: "去导入" }
    },
    {
      key: "pipeline_automation",
      step: "自动任务与渠道模板",
      status: automationStatus,
      evidence: hasPipelineRun ? `最近自动任务：${state.pipelineRuns?.[0]?.status || "unknown"} / ${state.pipelineRuns?.[0]?.finishedAt || "-"}` : "尚无自动任务记录",
      nextStep: hasPipelineRun ? "继续确认定时任务和模板" : "先运行一次自动任务",
      actionText: hasPipelineRun ? "继续确认定时任务和渠道模板，避免数据回填时字段错位。" : "先运行一次自动任务，确认博客、访问数据、渠道数据和 GEO 测试可以顺利衔接。",
      entry: hasPipelineRun ? { type: "link", href: "/publish", label: "看模板" } : { type: "command", label: "npm.cmd run worker:run-pipeline" }
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
        title="连接管理"
        subtitle="集中管理内容来源、模型、数据采集和发布渠道连接。"
        actions={
          <>
            <Button loading={runningAll} onClick={handleRunAllDiagnostics}>
              运行全部诊断
            </Button>
            <Button loading={loadingCapabilities} onClick={() => void loadCapabilities()}>
              刷新配置状态
            </Button>
            <Button onClick={() => refresh()}>刷新工作台数据</Button>
            <GovernanceEntry
              label="查看 .env 模板"
              type="primary"
              reason="连接信息由工作台运营或管理员维护；业务人员只需要关注是否可用。"
            />
          </>
        }
      />
      <PageErrorState message={error} loading={loading} onRetry={refresh} />
      <PageErrorState
        title="外部配置状态加载失败"
        message={capabilityError}
        loading={loadingCapabilities}
        onRetry={loadCapabilities}
        description={capabilityError ? `${capabilityError}。请重试并确认连接状态后再继续。` : undefined}
      />

      <Alert
        type={capabilityError ? "warning" : failedCount ? "error" : pendingCount ? "warning" : "success"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          capabilityError
            ? "外部配置状态暂不可用。"
            : pendingCount || failedCount
              ? "部分连接尚未完成，请按优先级继续处理。"
              : "所有连接均可用，可以开始业务验证。"
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
            : `可用入口 ${visibleReadyEntryCount} 项，建议逐项进入对应业务页面确认结果。`
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
        <Card title="工作台概况">
          <List
            loading={loading}
            dataSource={[
              `内容节奏：每周 ${state.workspaceSetting.defaultWeeklyDays} 天，每天 ${state.workspaceSetting.defaultDailyCount} 篇`,
              `GEO 平台：${state.workspaceSetting.geoPlatforms.join("、")}`,
              `日志模式：${state.workspaceSetting.logMode}`,
              `AI 访问数据：${botConfidence}`,
              `自动任务记录：${state.pipelineRuns?.length || 0} 次`,
              `最近自动任务：${lastPipelineRun ? `${lastPipelineRun.status} / ${lastPipelineRun.finishedAt}` : "暂无"}`
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
                  record.entry.type === "link" && record.entry.href === "/ai-config" ? (
                    <GovernanceEntry label={record.entry.label} reason="连接信息需要工作台运营或管理员处理。" />
                  ) : record.entry.type === "link" ? (
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

        <Card title="连接清单" style={{ marginTop: 16 }}>
        <Space wrap style={{ width: "100%", marginBottom: 16 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="按连接类型筛选"
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
                title="当前筛选没有连接项"
                description="清空筛选或调整连接类型、可用状态后再查看。"
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
                    {entry.type === "link" && entry.href === "/ai-config" ? (
                      <GovernanceEntry label={entry.label} reason="外部能力配置需要工作台运营或开发管理员处理。" />
                    ) : entry.type === "link" ? (
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
              : "自动任务、定时入口和渠道模板均已可用。"
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
                record.entry.type === "link" && record.entry.href === "/ai-config" ? (
                  <GovernanceEntry label={record.entry.label} reason="定时任务依赖的 AI 配置需要工作台运营或开发管理员处理。" />
                ) : record.entry.type === "link" ? (
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
