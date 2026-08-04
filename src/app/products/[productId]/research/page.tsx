"use client";

import {
  ArrowLeftOutlined,
  EditOutlined,
  FileAddOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SendOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GeoReadinessPanel } from "@/components/geo/GeoReadinessPanel";
import { GeoResearchRail } from "@/components/geo/GeoResearchRail";
import { GeoStructuredData } from "@/components/geo/GeoStructuredData";
import { PageErrorState } from "@/components/PageErrorState";
import { PageHeader } from "@/components/PageHeader";
import { callJsonApi } from "@/lib/client-api";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { createV5WritePayload } from "@/lib/v5-client";
import type {
  GeoBlueprintVersion,
  GeoResearchFindingType,
  GeoResearchReadiness,
  GeoResearchWorkspace
} from "@/lib/v5/geo-research-contracts";
import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";

interface ProductWorkspaceResponse {
  ok: true;
  product: ProductRegistryItem;
  workspace?: GeoResearchWorkspace;
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
  synthesizing: "归纳蓝图",
  pending_review: "等待人工审核",
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

function BlueprintReview({
  blueprint,
  productId,
  approving,
  onApprove,
  onRequestChanges
}: {
  blueprint: GeoBlueprintVersion;
  productId: string;
  approving: boolean;
  onApprove: () => Promise<void>;
  onRequestChanges: () => void;
}) {
  const approved = blueprint.status === "approved";
  return (
    <Card
      bordered={false}
      title={`GEO 铺设蓝图 · v${blueprint.versionNumber}`}
      extra={<Tag color={approved ? "green" : blueprint.status === "pending_review" ? "gold" : "default"}>
        {approved ? "已批准" : blueprint.status === "pending_review" ? "等待审核" : "已退回"}
      </Tag>}
    >
      <Alert
        showIcon
        type={approved ? "success" : blueprint.status === "pending_review" ? "warning" : "info"}
        message={approved ? "这版蓝图已冻结，可作为月度内容策略候选输入" : blueprint.status === "pending_review" ? "请先审核研究结论，再决定批准或退回" : "请调整研究边界并重新运行"}
        description="蓝图会作为系统生成规则包、问题池和月度内容策略的依据；证据或配置不足时会停在待处理状态，人工可随时修改。"
        style={{ marginBottom: 16 }}
      />
      <Tabs
        items={[
          { key: "questions", label: "用户问题", children: <GeoStructuredData value={blueprint.questionStrategy} /> },
          { key: "competitors", label: "竞品格局", children: <GeoStructuredData value={blueprint.competitorLandscape} /> },
          { key: "citations", label: "引用策略", children: <GeoStructuredData value={blueprint.citationStrategy} /> },
          { key: "content", label: "内容类型", children: <GeoStructuredData value={blueprint.contentTypeStrategy} /> },
          { key: "evidence", label: "证据要求", children: <GeoStructuredData value={blueprint.evidenceRequirements} /> },
          { key: "monthly", label: "月度策略输入", children: <GeoStructuredData value={blueprint.monthlyStrategyInput} /> },
          { key: "retest", label: "复测基线", children: <GeoStructuredData value={blueprint.retestBaseline} /> }
        ]}
      />
      <Space wrap style={{ marginTop: 16 }}>
        {blueprint.status === "pending_review" ? (
          <>
            <Popconfirm
              title="批准这版 GEO 蓝图？"
              description="批准后版本冻结，后续修改需要发起新的研究运行。"
              okText="批准蓝图"
              cancelText="继续检查"
              onConfirm={onApprove}
            >
              <Button type="primary" loading={approving}>批准蓝图</Button>
            </Popconfirm>
            <Button onClick={onRequestChanges}>退回修改</Button>
          </>
        ) : null}
        {approved ? (
          <Link href={`/monthly-matrix/strategy?productId=${encodeURIComponent(productId)}&geoBlueprintVersionId=${encodeURIComponent(blueprint.blueprintVersionId)}`}>
            <Button type="primary" icon={<SendOutlined />} iconPosition="end">带入月度策略工作区</Button>
          </Link>
        ) : null}
      </Space>
    </Card>
  );
}

export default function ProductResearchPage() {
  const params = useParams<{ productId: string }>();
  const productId = params.productId;
  const [messageApi, contextHolder] = message.useMessage();
  const [projectForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [data, setData] = useState<ProductWorkspaceResponse>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingBoundary, setSavingBoundary] = useState(false);
  const [approving, setApproving] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string>();
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      setData(await callJsonApi<ProductWorkspaceResponse>(
        `/api/v5/products/${encodeURIComponent(productId)}`,
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
    const counts = new Map<GeoResearchFindingType, number>();
    for (const finding of data?.workspace?.latestFindings || []) {
      counts.set(finding.findingType, (counts.get(finding.findingType) || 0) + 1);
    }
    return [...counts.entries()];
  }, [data?.workspace?.latestFindings]);

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

  async function approveBlueprint() {
    const blueprint = data?.workspace?.currentBlueprint;
    if (!blueprint) return;
    setApproving(true);
    try {
      const write = createV5WritePayload(workspaceSetting.currentRole, blueprint.rowVersion, "人工确认 GEO 蓝图并允许进入月度策略");
      await callJsonApi(
        `/api/v5/products/${encodeURIComponent(productId)}/blueprints/${encodeURIComponent(blueprint.blueprintVersionId)}/approve`,
        {
          method: "POST",
          headers: { "x-idempotency-key": write.idempotencyKey },
          body: JSON.stringify({ ...write, expectedVersion: blueprint.rowVersion })
        }
      );
      messageApi.success("GEO 蓝图已批准");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "蓝图批准失败");
    } finally {
      setApproving(false);
    }
  }

  async function requestChanges() {
    const blueprint = data?.workspace?.currentBlueprint;
    if (!blueprint) return;
    const values = await reviewForm.validateFields();
    setRequestingChanges(true);
    try {
      const write = createV5WritePayload(workspaceSetting.currentRole, blueprint.rowVersion, "退回 GEO 蓝图并记录修改要求");
      await callJsonApi(
        `/api/v5/products/${encodeURIComponent(productId)}/blueprints/${encodeURIComponent(blueprint.blueprintVersionId)}/request-changes`,
        {
          method: "POST",
          headers: { "x-idempotency-key": write.idempotencyKey },
          body: JSON.stringify({ ...write, expectedVersion: blueprint.rowVersion, reviewNote: values.reviewNote })
        }
      );
      setReviewOpen(false);
      reviewForm.resetFields();
      messageApi.success("蓝图已退回，可调整研究边界后重新运行");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "蓝图退回失败");
    } finally {
      setRequestingChanges(false);
    }
  }

  const runHref = activeRun ? `/products/${encodeURIComponent(productId)}/research/${encodeURIComponent(activeRun.runId)}` : undefined;

  return (
    <>
      {contextHolder}
      <PageHeader
        title={data?.product ? `${data.product.displayName} · GEO 调研` : "产品 GEO 调研"}
        subtitle="从真实产品资料出发，自动记录联网问题、竞品、AI 回答和可见引用，并通过系统门禁生成内容铺设蓝图。"
        actions={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button>
            <Link href="/products"><Button icon={<ArrowLeftOutlined />}>产品列表</Button></Link>
            <Link href={`/knowledge/import/document?productId=${encodeURIComponent(productId)}`}><Button icon={<FileAddOutlined />}>上传资料</Button></Link>
            <Link href={`/knowledge/import/url?productId=${encodeURIComponent(productId)}`}><Button icon={<LinkOutlined />}>导入网页</Button></Link>
          </Space>
        }
      />
      <PageErrorState message={error} loading={loading && !data} onRetry={() => refresh()} />

      {data?.product ? (
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
              extra={<Space><Tag>{runStatusLabels[activeRun.status] || activeRun.status}</Tag>{runHref ? <Link href={runHref}><Button size="small">查看证据与发现</Button></Link> : null}</Space>}
            >
              <div className="geo-run-summary">
                <div><span>任务完成</span><strong>{completedTasks}/{data.workspace.latestTasks.length}</strong><small>任务链自动按依赖解锁</small></div>
                <div><span>公开来源</span><strong>{data.workspace.latestEvidence.filter((item) => Boolean(item.sourceUrl)).length}</strong><small>只统计可复核 URL</small></div>
                <div><span>研究发现</span><strong>{data.workspace.latestFindings.length}</strong><small>均保留证据引用</small></div>
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
            <BlueprintReview
              blueprint={data.workspace.currentBlueprint}
              productId={productId}
              approving={approving}
              onApprove={approveBlueprint}
              onRequestChanges={() => setReviewOpen(true)}
            />
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

      <Modal title="退回 GEO 蓝图" open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={() => void requestChanges()} confirmLoading={requestingChanges} okText="确认退回">
        <Alert showIcon type="info" message="退回后可以修改研究边界并重新运行" style={{ marginBottom: 16 }} />
        <Form form={reviewForm} layout="vertical">
          <Form.Item name="reviewNote" label="需要修改什么" rules={[{ required: true, message: "请填写明确的修改要求" }]}>
            <Input.TextArea rows={5} maxLength={2000} showCount placeholder="例如：补充面向开发者的实施问题；不要把某服务商视为直接竞品。" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
