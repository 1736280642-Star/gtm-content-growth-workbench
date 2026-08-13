"use client";

import {
  ArrowLeftOutlined,
  EditOutlined,
  FileAddOutlined,
  PlayCircleOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GeoReadinessPanel } from "@/components/geo/GeoReadinessPanel";
import { GeoResearchRail } from "@/components/geo/GeoResearchRail";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type {
  GeoResearchFindingType,
  GeoResearchReadiness,
  GeoResearchWorkspace
} from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface ProductWorkspaceResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace?: GeoResearchWorkspace & {
    summary?: {
      publicSourceCount: number;
      findingCount: number;
      findingCounts: Partial<Record<GeoResearchFindingType, number>>;
    };
  };
  readiness: GeoResearchReadiness;
}

const channelOptions = [
  { value: "wechat", label: "微信公众号" },
  { value: "official_website", label: "官网 / 博客" },
  { value: "zhihu", label: "知乎" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "csdn", label: "CSDN" }
];

const runStatusLabels: Record<string, string> = {
  planned: "已规划",
  queued: "已排队",
  running: "研究中",
  awaiting_frontend: "等待前台采集",
  synthesizing: "整理策略依据",
  pending_review: "调研综合完成",
  completed: "已完成",
  blocked: "已阻塞",
  failed: "失败",
  cancelled: "已取消"
};

const findingTypeLabels: Record<GeoResearchFindingType, string> = {
  question_opportunity: "问题机会",
  competitor_mention: "竞品提及",
  citation_pattern: "引用模式",
  content_gap: "内容缺口",
  evidence_gap: "证据缺口",
  relationship_error: "关系错误",
  capability_error: "能力错误",
  article_type_recommendation: "文章类型建议",
  channel_recommendation: "渠道建议",
  retest_requirement: "复测要求"
};

function splitValues(value?: string) {
  return (value || "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}

export function ProductGeoResearchWorkspace({ productId, embedded = false }: { productId: string; embedded?: boolean }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [projectForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [data, setData] = useState<ProductWorkspaceResponse>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingBoundary, setSavingBoundary] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string>();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      setData(await callJsonApi<ProductWorkspaceResponse>(
        `/api/v5/products/${encodeURIComponent(productId)}/research-workspace`,
        { cache: "no-store" }
      ));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "调研工作区加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeRun = data?.workspace?.latestRun;
  const hasOpenRun = Boolean(activeRun && !["completed", "failed", "cancelled"].includes(activeRun.status));
  useEffect(() => {
    if (!hasOpenRun) return;
    const timer = window.setInterval(() => void refresh(true), 8000);
    return () => window.clearInterval(timer);
  }, [hasOpenRun, refresh]);

  const completedTasks = useMemo(
    () => data?.workspace?.latestTasks.filter((task) => task.status === "completed").length || 0,
    [data?.workspace?.latestTasks]
  );
  const findingCounts = useMemo(() => {
    if (data?.workspace?.summary) {
      return Object.entries(data.workspace.summary.findingCounts)
        .filter((item): item is [GeoResearchFindingType, number] => typeof item[1] === "number");
    }
    const counts = new Map<GeoResearchFindingType, number>();
    for (const finding of data?.workspace?.latestFindings || []) {
      counts.set(finding.findingType, (counts.get(finding.findingType) || 0) + 1);
    }
    return [...counts.entries()];
  }, [data?.workspace?.latestFindings, data?.workspace?.summary]);

  async function startResearch() {
    if (!data?.workspace || !data.readiness.canCreateRun) return;
    setStarting(true);
    try {
      const write = createV5WritePayload(workspaceSetting.currentRole, data.workspace.project.rowVersion, "启动产品 GEO 前置研究");
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/research-runs`, {
        method: "POST",
        headers: { "x-idempotency-key": write.idempotencyKey },
        body: JSON.stringify({
          ...write,
          expectedProjectVersion: data.workspace.project.rowVersion,
          triggerType: data.workspace.runs.length ? "manual_refresh" : "product_onboarding"
        })
      });
      messageApi.success(data.readiness.canExecuteLiveResearch ? "GEO 调研任务链已创建" : "任务链已创建，将在模型规划前等待 API 配置");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "启动调研失败");
    } finally {
      setStarting(false);
    }
  }

  async function createProject() {
    const values = await projectForm.validateFields();
    setCreatingProject(true);
    try {
      const write = createV5WritePayload(workspaceSetting.currentRole, 0, "为已登记产品创建 GEO 前置调研项目");
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/research-project`, {
        method: "POST",
        headers: { "x-idempotency-key": write.idempotencyKey },
        body: JSON.stringify({
          ...write,
          expressionFocus: values.expressionFocus,
          forbiddenFocus: splitValues(values.forbiddenFocus),
          researchMarkets: values.researchMarkets,
          languages: values.languages,
          targetChannels: values.targetChannels
        })
      });
      messageApi.success("GEO 调研项目已创建");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "调研项目创建失败");
    } finally {
      setCreatingProject(false);
    }
  }

  function openBoundaryEditor() {
    const project = data?.workspace?.project;
    if (!project) return;
    editForm.setFieldsValue({
      expressionFocus: project.expressionFocus,
      forbiddenFocus: project.forbiddenFocus.join("\n"),
      researchMarkets: project.researchMarkets,
      languages: project.languages,
      targetChannels: project.targetChannels
    });
    setEditOpen(true);
  }

  async function saveBoundary() {
    const project = data?.workspace?.project;
    if (!project) return;
    const values = await editForm.validateFields();
    setSavingBoundary(true);
    try {
      const write = createV5WritePayload(workspaceSetting.currentRole, project.rowVersion, "更新 GEO 研究边界");
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/research-project`, {
        method: "PATCH",
        headers: { "x-idempotency-key": write.idempotencyKey },
        body: JSON.stringify({
          ...write,
          expectedProjectVersion: project.rowVersion,
          expressionFocus: values.expressionFocus,
          forbiddenFocus: splitValues(values.forbiddenFocus),
          researchMarkets: values.researchMarkets,
          languages: values.languages,
          targetChannels: values.targetChannels
        })
      });
      setEditOpen(false);
      messageApi.success("研究边界已更新");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "研究边界保存失败");
    } finally {
      setSavingBoundary(false);
    }
  }

  const runHref = activeRun ? `/products/${encodeURIComponent(productId)}/research/${encodeURIComponent(activeRun.runId)}` : undefined;

  return (
    <>
      {contextHolder}
      {!embedded ? <PageHeader
        title={data?.product ? `${data.product.displayName} · GEO 调研` : "产品 GEO 调研"}
        subtitle="从真实产品资料出发，自动记录联网问题、竞品、AI 回答和可见引用，并整理为产品 GEO 策略。"
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
            <Link href={`/products/${encodeURIComponent(productId)}`}><Button icon={<ArrowLeftOutlined />}>返回产品</Button></Link>
            <Link href={`/products/${encodeURIComponent(productId)}?tab=materials`}><Button icon={<FileAddOutlined />}>管理资料</Button></Link>
          </Space>
        }
      /> : null}
      <PageErrorState message={error} loading={loading && !data} onRetry={() => refresh()} />

      {data?.product && !embedded ? (
        <Card bordered={false} className="geo-research-hero">
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
            <Descriptions.Item label="规范名称">{data.product.canonicalName}</Descriptions.Item>
            <Descriptions.Item label="品类">{data.product.productCategory || "待补充"}</Descriptions.Item>
            <Descriptions.Item label="官方主体">{data.product.officialEntity || "待补充"}</Descriptions.Item>
            <Descriptions.Item label="官网">
              {data.product.officialUrl ? <a href={data.product.officialUrl} target="_blank" rel="noreferrer">打开官网</a> : "待补充"}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      {data?.readiness ? <GeoReadinessPanel readiness={data.readiness} /> : null}

      {!loading && data && !data.workspace ? (
        <Card bordered={false} title="建立 GEO 研究边界" style={{ marginTop: 16 }}>
          <Alert showIcon type="info" message="只填写需要人判断的内容" description="用户问题、竞品和内容类型由研究任务发现；你只需要确认产品希望建立的认知与禁止表达。" style={{ marginBottom: 16 }} />
          <Form form={projectForm} layout="vertical" initialValues={{ researchMarkets: ["CN"], languages: ["zh-CN"], targetChannels: ["wechat", "official_website"] }}>
            <Form.Item name="expressionFocus" label="希望市场记住的表达重点" rules={[{ required: true, message: "请填写产品表达重点" }]}>
              <Input.TextArea rows={6} maxLength={4000} showCount />
            </Form.Item>
            <Form.Item name="forbiddenFocus" label="禁止或谨慎表达" extra="每行一项。"><Input.TextArea rows={3} /></Form.Item>
            <Space wrap align="start">
              <Form.Item name="researchMarkets" label="市场"><Select mode="tags" style={{ minWidth: 180 }} /></Form.Item>
              <Form.Item name="languages" label="语言"><Select mode="tags" style={{ minWidth: 180 }} /></Form.Item>
              <Form.Item name="targetChannels" label="渠道"><Select mode="multiple" style={{ minWidth: 280 }} options={channelOptions} /></Form.Item>
            </Space>
            <div><Button type="primary" loading={creatingProject} onClick={() => void createProject()}>保存研究边界</Button></div>
          </Form>
        </Card>
      ) : null}

      {data?.workspace ? (
        <Space direction="vertical" size={16} style={{ width: "100%", marginTop: 16 }}>
          <Card
            bordered={false}
            title="研究链路"
            extra={
              <Space>
                <Button icon={<EditOutlined />} disabled={hasOpenRun} onClick={openBoundaryEditor}>编辑边界</Button>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={starting}
                  disabled={hasOpenRun || !data.readiness.canCreateRun}
                  onClick={() => void startResearch()}
                >
                  {hasOpenRun ? "调研进行中" : data.readiness.canExecuteLiveResearch ? data.workspace.runs.length ? "重新调研" : "启动调研" : "创建任务并等待配置"}
                </Button>
              </Space>
            }
          >
            <Typography.Paragraph>{data.workspace.project.expressionFocus}</Typography.Paragraph>
            <Space wrap>
              {data.workspace.project.researchMarkets.map((item) => <Tag key={item}>{item}</Tag>)}
              {data.workspace.project.languages.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}
              {data.workspace.project.targetChannels.map((item) => <Tag color="purple" key={item}>{item}</Tag>)}
            </Space>
            {data.workspace.project.forbiddenFocus.length ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
                禁止表达：{data.workspace.project.forbiddenFocus.join("；")}
              </Typography.Paragraph>
            ) : null}
            <GeoResearchRail tasks={data.workspace.latestTasks} runHref={runHref} />
          </Card>

          {activeRun ? (
            <Card
              bordered={false}
              title={`最近运行 · v${activeRun.runVersion}`}
              extra={<Space><Tag>{runStatusLabels[activeRun.status] || activeRun.status}</Tag>{runHref ? <Link href={runHref}><Button size="small">查看 GEO 资料与发现</Button></Link> : null}</Space>}
            >
              <div className="geo-run-summary">
                <div><span>任务完成</span><strong>{completedTasks}/{data.workspace.latestTasks.length}</strong><small>任务链自动按依赖解锁</small></div>
                <div><span>公开来源</span><strong>{data.workspace.summary?.publicSourceCount ?? data.workspace.latestEvidence.filter((item) => Boolean(item.sourceUrl)).length}</strong><small>只统计可复核 URL</small></div>
                <div><span>研究发现</span><strong>{data.workspace.summary?.findingCount ?? data.workspace.latestFindings.length}</strong><small>均保留证据引用</small></div>
                <div><span>联网校验</span><strong>{activeRun.liveSearchVerified ? "通过" : "待完成"}</strong><small>无来源不会生成蓝图</small></div>
              </div>
              {findingCounts.length ? (
                <Space wrap>{findingCounts.map(([type, count]) => <Tag key={type}>{findingTypeLabels[type]} {count}</Tag>)}</Space>
              ) : (
                <Typography.Text type="secondary">
                  当前还没有研究发现。未配置 API Key 时，任务会安全停在“等待配置”，不会生成模拟结果。
                </Typography.Text>
              )}
            </Card>
          ) : null}

          {data.workspace.currentBlueprint ? (
            <Card bordered={false} title="调研综合已完成">
              <Alert
                showIcon
                type="success"
                message="系统正在将调研结果整理到产品 GEO 策略"
                description="你不需要单独审批调研蓝图。请直接在产品 GEO 策略中确认问题、文章类型、表达重点与证据边界。"
                action={<Link href={`/products/${encodeURIComponent(productId)}?tab=geo&geoView=strategy`}><Button type="primary">查看产品 GEO 策略</Button></Link>}
              />
            </Card>
          ) : null}
        </Space>
      ) : null}

      <Modal title="编辑研究边界" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => void saveBoundary()} confirmLoading={savingBoundary} okText="保存边界" width={720}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="expressionFocus" label="希望市场记住的表达重点" rules={[{ required: true, message: "请填写表达重点" }]}>
            <Input.TextArea rows={6} maxLength={4000} showCount />
          </Form.Item>
          <Form.Item name="forbiddenFocus" label="禁止或谨慎表达"><Input.TextArea rows={3} /></Form.Item>
          <Space wrap align="start">
            <Form.Item name="researchMarkets" label="市场"><Select mode="tags" style={{ minWidth: 180 }} /></Form.Item>
            <Form.Item name="languages" label="语言"><Select mode="tags" style={{ minWidth: 180 }} /></Form.Item>
            <Form.Item name="targetChannels" label="渠道"><Select mode="multiple" style={{ minWidth: 280 }} options={channelOptions} /></Form.Item>
          </Space>
        </Form>
      </Modal>

    </>
  );
}
