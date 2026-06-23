"use client";

import Link from "next/link";
import { Alert, Button, Card, Input, Select, Space, Table, Tag, message } from "antd";
import { ActionEmpty } from "@/components/ActionEmpty";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeCapability, RuntimeCapabilityStatus } from "@/lib/runtime-config";

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
  { key: "xcrawl_blog_sync", name: "XCrawl", usage: "官网博客同步", model: "XCRAWL_BLOG_INDEX_URL" },
  { key: "mysql_repository", name: "MySQL", usage: "生产级数据持久化", model: "MYSQL_*" }
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

export default function AiConfigPage() {
  const [capabilities, setCapabilities] = useState<RuntimeCapability[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, DiagnosticResult>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const [copying, setCopying] = useState(false);
  const [testingKey, setTestingKey] = useState<string>();
  const [testingAll, setTestingAll] = useState(false);
  const [loadingCapabilities, setLoadingCapabilities] = useState(true);
  const [capabilityError, setCapabilityError] = useState<string>();
  const [capabilityStatusFilter, setCapabilityStatusFilter] = useState<RuntimeCapabilityStatus[]>([]);

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
    void loadConfigStatus();
  }, [loadConfigStatus]);

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

  return (
    <>
      {contextHolder}
      <PageHeader
        title="AI 配置"
        subtitle="管理模型、API、Prompt 和运行参数；密钥只通过环境变量或配置中心管理。"
        actions={
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
        }
      />
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
              render: (_, record) => {
                const capability = capabilityByKey[record.key];
                const diagnostic = diagnostics[record.key];

                return renderCapabilityEntry(capability, diagnostic);
              }
            },
            {
              title: "诊断",
              render: (_, record) => {
                const capability = capabilityByKey[record.key];
                const diagnostic = diagnostics[record.key];

                return renderCapabilityDiagnosticButton(record.key, capability, diagnostic);
              }
            }
          ]}
        />
      </Card>
      <Card title="能力状态" style={{ marginTop: 16 }}>
        <Table
          rowKey="key"
          dataSource={filteredCapabilities}
          loading={loadingCapabilities}
          pagination={false}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasCapabilityFilter ? "当前筛选没有能力状态" : "还没有能力状态"}
                description={hasCapabilityFilter ? "清空筛选或调整配置状态后再查看。" : "刷新状态后会展示当前外部能力配置状态。"}
                action={
                  hasCapabilityFilter ? (
                    <Button type="primary" onClick={clearCapabilityFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Button type="primary" loading={loadingCapabilities} onClick={() => void loadConfigStatus()}>
                      刷新状态
                    </Button>
                  )
                }
              />
            )
          }}
          columns={[
            { title: "能力", dataIndex: "label" },
            { title: "用途", dataIndex: "purpose" },
            {
              title: "状态",
              dataIndex: "status",
              render: (value) => <Tag color={getCapabilityStatusColor(value)}>{capabilityStatusLabels[value as RuntimeCapabilityStatus]}</Tag>
            },
            {
              title: "必填",
              dataIndex: "requiredEnv",
              render: (value: string[]) => (value.length ? value.join(", ") : "-")
            },
            {
              title: "缺少",
              dataIndex: "missingEnv",
              render: (value: string[]) => (value.length ? value.join(", ") : "-")
            },
            {
              title: "可选",
              dataIndex: "optionalEnv",
              render: (value?: string[]) => (value?.length ? value.join(", ") : "-")
            },
            {
              title: "测试结果",
              render: (_, record) => {
                const diagnostic = diagnostics[record.key];
                return diagnostic ? (
                  <Space direction="vertical" size={0}>
                    <Tag color={diagnostic.status === "ready" ? "green" : diagnostic.status === "failed" ? "red" : "gold"}>{diagnostic.status}</Tag>
                    <span className="muted">{diagnostic.message}</span>
                  </Space>
                ) : (
                  "-"
                );
              }
            },
            {
              title: "下一步",
              render: (_, record) => {
                const nextStep = getCapabilityNextStep(record, diagnostics[record.key]);

                return <Tag color={capabilityNextStepColors[nextStep]}>{capabilityNextStepLabels[nextStep]}</Tag>;
              }
            },
            {
              title: "处理动作",
              render: (_, record) => getCapabilityActionText(record, diagnostics[record.key])
            },
            {
              title: "可执行入口",
              render: (_, record) => {
                return renderCapabilityEntry(record, diagnostics[record.key]);
              }
            },
            {
              title: "诊断",
              render: (_, record) => {
                return renderCapabilityDiagnosticButton(record.key, record, diagnostics[record.key], "测试");
              }
            }
          ]}
        />
      </Card>
      <Card title="真实接入 Checklist" style={{ marginTop: 16 }}>
        <Table
          rowKey="key"
          dataSource={filteredCapabilities}
          loading={loadingCapabilities}
          pagination={false}
          locale={{
            emptyText: (
              <ActionEmpty
                title={hasCapabilityFilter ? "当前筛选没有真实接入项" : "还没有真实接入项"}
                description={hasCapabilityFilter ? "清空筛选或调整配置状态后再查看。" : "刷新状态后会展示需要后续提供的真实接入配置。"}
                action={
                  hasCapabilityFilter ? (
                    <Button type="primary" onClick={clearCapabilityFilters}>
                      清空筛选
                    </Button>
                  ) : (
                    <Button type="primary" loading={loadingCapabilities} onClick={() => void loadConfigStatus()}>
                      刷新状态
                    </Button>
                  )
                }
              />
            )
          }}
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
            },
            {
              title: "处理动作",
              render: (_, record) => getCapabilityActionText(record, diagnostics[record.key])
            },
            {
              title: "可执行入口",
              render: (_, record) => renderCapabilityEntry(record, diagnostics[record.key])
            }
          ]}
        />
      </Card>
      <Card title=".env.local 模板" style={{ marginTop: 16 }}>
        <Input.TextArea rows={18} readOnly value={envTemplate} />
      </Card>
    </>
  );
}
