"use client";

import { EyeOutlined, FileTextOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Collapse, Descriptions, Empty, Input, Progress, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import Link from "next/link";
import { EvidenceGateTag } from "@/components/EvidenceGateTag";
import type {
  BatchQueueItem,
  FinalEvidenceGateStatus,
  GenerationStatus,
  MatrixDisplayStatus,
  ScheduleDraftStatus
} from "@/lib/v5-ui-mock-data";
import { useEffect, useMemo, useState } from "react";

const finalGateLabels: Record<FinalEvidenceGateStatus, string> = {
  not_created: "未检查",
  ready: "证据检查通过",
  needs_review: "证据待确认",
  blocked: "证据不足",
  pending_config: "暂不可生成"
};

const finalGateColors: Record<FinalEvidenceGateStatus, string> = {
  not_created: "default",
  ready: "green",
  needs_review: "blue",
  blocked: "red",
  pending_config: "default"
};

const generationLabels: Record<GenerationStatus, string> = {
  title_pending: "标题待确认",
  pending: "待生成",
  generating: "生成中",
  generated: "已生成",
  provider_failed: "生成失败",
  input_expired: "输入已过期"
};

const scheduleLabels: Record<ScheduleDraftStatus, string> = {
  unscheduled: "未排程",
  draft: "排程草稿",
  active: "正式排程",
  pending_config: "需人工发布"
};

const displayStatusLabels: Record<MatrixDisplayStatus, string> = {
  preparing: "准备中",
  ready: "可生成",
  generating: "生成中",
  qualified: "已合格",
  exception: "异常",
  scheduled: "已排程",
  published: "已发布",
  publish_failed: "发布失败"
};

const displayStatusColors: Record<MatrixDisplayStatus, string> = {
  preparing: "default",
  ready: "blue",
  generating: "processing",
  qualified: "green",
  exception: "red",
  scheduled: "cyan",
  published: "green",
  publish_failed: "red"
};

type GroupMode = "product" | "channel" | "displayStatus" | "contentType" | "primaryDistilledTerm" | "none";
type StageTone = "success" | "active" | "warning" | "danger" | "waiting";

function ProductionStage({ label, value, tone }: { label: string; value: string; tone: StageTone }) {
  return (
    <div className={`v5-stage-item is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getEvidenceStage(record: BatchQueueItem): { value: string; tone: StageTone } {
  if (record.finalEvidenceGate === "ready") return { value: "已通过", tone: "success" };
  if (record.finalEvidenceGate === "blocked" || record.evidencePreview === "blocked") return { value: "已阻断", tone: "danger" };
  if (record.evidencePreview === "needs_material") return { value: "需补证据", tone: "warning" };
  if (record.evidencePreview === "ready_with_auto_downgrade") return { value: "自动降级", tone: "active" };
  if (record.finalEvidenceGate === "pending_config") return { value: "暂不可生成", tone: "warning" };
  return { value: "待检查", tone: "waiting" };
}

function getGenerationStage(record: BatchQueueItem): { value: string; tone: StageTone } {
  if (record.generationStatus === "generated") return { value: "已生成", tone: "success" };
  if (record.generationStatus === "generating") return { value: "生成中", tone: "active" };
  if (record.generationStatus === "provider_failed") return { value: "调用失败", tone: "danger" };
  if (record.generationStatus === "input_expired") return { value: "输入过期", tone: "warning" };
  return { value: generationLabels[record.generationStatus], tone: "waiting" };
}

function getQualityStage(record: BatchQueueItem): { value: string; tone: StageTone } {
  if (record.qualityResult === "passed") return { value: "质检通过", tone: "success" };
  if (record.qualityResult === "exception" || record.hardRuleStatus === "blocked") return { value: "需处理", tone: "danger" };
  return { value: "待质检", tone: "waiting" };
}

function getGroupValue(item: BatchQueueItem, mode: GroupMode) {
  if (mode === "product") return item.product;
  if (mode === "channel") return item.channel;
  if (mode === "displayStatus") return displayStatusLabels[item.displayStatus];
  if (mode === "contentType") return item.contentType;
  if (mode === "primaryDistilledTerm") return item.primaryDistilledTerm;
  return "全部内容";
}

function GroupHeader({ label, items }: { label: string; items: BatchQueueItem[] }) {
  const readyCount = items.filter((item) => item.displayStatus === "ready" || item.displayStatus === "qualified").length;
  const exceptionCount = items.filter((item) => item.displayStatus === "exception" || item.displayStatus === "publish_failed").length;
  const scheduledCount = items.filter((item) => item.scheduleStatus === "active" || item.scheduleStatus === "draft").length;

  return (
    <div className="v5-group-header">
      <div className="v5-group-header-main">
        <strong>{label}</strong>
        <Tag>{items.length} 篇</Tag>
        {exceptionCount ? <Tag color="red">异常 {exceptionCount}</Tag> : null}
      </div>
      <span>可生成/合格 {readyCount} · 已排程 {scheduledCount}</span>
    </div>
  );
}

export function BatchGenerationMatrixTable({
  items,
  generatingTaskId,
  onGenerate
}: {
  items: BatchQueueItem[];
  generatingTaskId?: string;
  onGenerate?: (item: BatchQueueItem) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | MatrixDisplayStatus>("all");
  const [channel, setChannel] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("product");
  const [activeGroupKeys, setActiveGroupKeys] = useState<string[]>([]);
  const channelOptions = useMemo(() => Array.from(new Set(items.map((item) => item.channel))).sort(), [items]);
  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return items.filter((item) => {
      const matchesKeyword =
        !normalizedKeyword ||
        [item.title, item.product, item.primaryDistilledTerm, item.channel].some((value) => value.toLowerCase().includes(normalizedKeyword));
      const matchesStatus = status === "all" || item.displayStatus === status;
      const matchesChannel = channel === "all" || item.channel === channel;

      return matchesKeyword && matchesStatus && matchesChannel;
    });
  }, [channel, items, keyword, status]);
  const groups = useMemo(() => {
    const groupedItems = new Map<string, BatchQueueItem[]>();

    for (const item of filteredItems) {
      const groupLabel = getGroupValue(item, groupMode);
      groupedItems.set(groupLabel, [...(groupedItems.get(groupLabel) || []), item]);
    }

    return Array.from(groupedItems.entries()).map(([label, groupItems], index) => ({ key: `${groupMode}-${index}-${label}`, label, items: groupItems }));
  }, [filteredItems, groupMode]);
  const groupKeys = useMemo(() => groups.map((group) => group.key), [groups]);

  useEffect(() => {
    if (keyword.trim()) setActiveGroupKeys(groupKeys);
  }, [groupKeys, keyword]);

  const columns = [
    {
      title: "内容任务",
      key: "task",
      width: "42%",
      render: (_: unknown, record: BatchQueueItem) => (
        <div className="v5-task-primary">
          <Tooltip title={record.title} placement="topLeft">
            <strong className="v5-task-title-single-line">{record.title}</strong>
          </Tooltip>
          <Space size={4} wrap>
            <Tag color={record.priority === "P0" ? "red" : record.priority === "P1" ? "orange" : "blue"}>{record.priority}</Tag>
            <Tag>{record.channel}</Tag>
            <Tag>{record.contentType}</Tag>
          </Space>
          <span>{record.primaryDistilledTerm}</span>
        </div>
      )
    },
    {
      title: "生产进度",
      key: "progress",
      width: "32%",
      responsive: ["md" as const],
      render: (_: unknown, record: BatchQueueItem) => {
        const evidenceStage = getEvidenceStage(record);
        const generationStage = getGenerationStage(record);
        const qualityStage = getQualityStage(record);

        return (
          <div className="v5-stage-strip">
            <ProductionStage label="标题" value={record.titleConfirmed ? "已冻结" : "待确认"} tone={record.titleConfirmed ? "success" : "waiting"} />
            <ProductionStage label="证据" value={evidenceStage.value} tone={evidenceStage.tone} />
            <ProductionStage label="生成" value={generationStage.value} tone={generationStage.tone} />
            <ProductionStage label="质检" value={qualityStage.value} tone={qualityStage.tone} />
          </div>
        );
      }
    },
    {
      title: "排程",
      key: "schedule",
      width: "16%",
      responsive: ["lg" as const],
      render: (_: unknown, record: BatchQueueItem) => (
        <div className="v5-schedule-summary">
          <Tag color={record.scheduleStatus === "active" ? "green" : record.scheduleStatus === "draft" ? "blue" : "default"}>
            {scheduleLabels[record.scheduleStatus]}
          </Tag>
          <strong>{record.scheduleDate ? `${record.scheduleDate.slice(5)} ${record.scheduleTime || ""}` : "尚未安排"}</strong>
        </div>
      )
    },
    {
      title: "状态",
      dataIndex: "displayStatus",
      width: 100,
      render: (value: MatrixDisplayStatus) => <Tag color={displayStatusColors[value]}>{displayStatusLabels[value]}</Tag>
    },
    {
      title: "操作",
      key: "action",
      width: 132,
      render: (_: unknown, record: BatchQueueItem) => {
        if (record.draftId) {
          return <Link href={`/v5/drafts/${record.draftId}`}><Button size="small" icon={<EyeOutlined />}>查看正文</Button></Link>;
        }
        if (record.evidencePreview === "needs_material") {
          return (
          <Link href={`/knowledge/import?matrixItemId=${record.matrixItemId}`}><Button size="small">补证据</Button></Link>
          );
        }
        const blocked = record.finalEvidenceGate === "blocked" || record.evidencePreview === "blocked" || record.evidencePreview === "needs_review";
        const canGenerate = Boolean(record.formal && record.titleConfirmed && !blocked && onGenerate);
        const disabledReason = !record.formal ? "仅正式 MySQL 矩阵项可生成正文"
          : !record.titleConfirmed ? "标题尚未冻结"
          : blocked ? "证据或规则尚未通过"
          : "正式生成暂不可用";
        return (
          <Tooltip title={canGenerate ? "完成检索、冻结 Final EvidencePack 并生成正式正文" : disabledReason}>
            <span>
              <Button
                size="small"
                type="primary"
                icon={<FileTextOutlined />}
                loading={generatingTaskId === record.matrixItemId}
                disabled={!canGenerate || Boolean(generatingTaskId && generatingTaskId !== record.matrixItemId)}
                onClick={() => onGenerate?.(record)}
              >
                生成正文
              </Button>
            </span>
          </Tooltip>
        );
      }
    }
  ];

  return (
    <div className="v5-batch-table-shell">
      <div className="v5-batch-toolbar">
        <Input
          data-testid="batch-task-search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索标题、产品、蒸馏词"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          aria-label="按任务状态筛选"
          value={status}
          onChange={setStatus}
          options={[{ value: "all", label: "全部状态" }, ...Object.entries(displayStatusLabels).map(([value, label]) => ({ value, label }))]}
        />
        <Select
          aria-label="按渠道筛选"
          value={channel}
          onChange={setChannel}
          options={[{ value: "all", label: "全部渠道" }, ...channelOptions.map((value) => ({ value, label: value }))]}
        />
        <Select<GroupMode>
          aria-label="选择任务分组方式"
          value={groupMode}
          onChange={(value) => {
            setGroupMode(value);
            setActiveGroupKeys([]);
          }}
          options={[
            { value: "product", label: "按产品分组" },
            { value: "channel", label: "按渠道分组" },
            { value: "displayStatus", label: "按状态分组" },
            { value: "contentType", label: "按内容类型分组" },
            { value: "primaryDistilledTerm", label: "按主蒸馏词分组" },
            { value: "none", label: "不分组" }
          ]}
        />
        <Space size={4} className="v5-group-toggle-actions">
          <Button size="small" onClick={() => setActiveGroupKeys(groupKeys)}>展开全部</Button>
          <Button size="small" onClick={() => setActiveGroupKeys([])}>全部收起</Button>
        </Space>
        <span className="v5-batch-result-count">当前 {filteredItems.length} / {items.length} 条</span>
      </div>

      {groups.length ? (
        <Collapse
          className="v5-grouped-task-list"
          activeKey={activeGroupKeys}
          onChange={(keys) => setActiveGroupKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
          items={groups.map((group) => ({
            key: group.key,
            label: <GroupHeader label={group.label} items={group.items} />,
            children: (
              <Table
                className="v5-compact-task-table"
                rowKey="matrixItemId"
                size="small"
                tableLayout="fixed"
                pagination={group.items.length > 10 ? { defaultPageSize: 10, pageSizeOptions: ["10", "20", "50"], showSizeChanger: true } : false}
                dataSource={group.items}
                expandable={{
                  expandRowByClick: true,
                  expandedRowRender: (record) => (
                    <div className="v5-task-expanded-detail">
                      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
                        <Descriptions.Item label="主蒸馏词">{record.primaryDistilledTerm}</Descriptions.Item>
                        <Descriptions.Item label="平台表达">{record.platformExpressionType}</Descriptions.Item>
                        <Descriptions.Item label="产品规则">{record.rulePackageVersion}</Descriptions.Item>
                        <Descriptions.Item label="证据准备度"><EvidenceGateTag status={record.evidencePreview} /></Descriptions.Item>
                        <Descriptions.Item label="Evidence Gate"><Tag color={finalGateColors[record.finalEvidenceGate]}>{finalGateLabels[record.finalEvidenceGate]}</Tag></Descriptions.Item>
                        <Descriptions.Item label="可用依据">{record.claimCount} 个</Descriptions.Item>
                        <Descriptions.Item label="规则检查">
                          <Tag color={record.hardRuleStatus === "passed" ? "green" : record.hardRuleStatus === "blocked" ? "red" : "default"}>
                            {record.hardRuleStatus === "passed" ? "通过" : record.hardRuleStatus === "blocked" ? "阻断" : "待检查"}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="内容质量">
                          {typeof record.softQualityScore === "number" ? <Progress percent={record.softQualityScore} size="small" format={(percent) => `${percent} 分`} /> : "待评测"}
                        </Descriptions.Item>
                        <Descriptions.Item label="平台账号">{record.platformAccount || "未选择"}</Descriptions.Item>
                        {record.failureReason ? (
                          <Descriptions.Item label="失败原因" span={3}>
                            <Typography.Text type="danger">{record.failureReason}</Typography.Text>
                            {record.nextAction ? <Typography.Text type="secondary"> 下一步：{record.nextAction}</Typography.Text> : null}
                          </Descriptions.Item>
                        ) : null}
                      </Descriptions>
                    </div>
                  )
                }}
                columns={columns}
              />
            )
          }))}
        />
      ) : (
        <Empty className="v5-batch-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合当前筛选条件的内容任务" />
      )}
    </div>
  );
}
