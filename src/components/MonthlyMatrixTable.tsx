"use client";

import { DeleteOutlined, EyeOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Modal, Space, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import type { ContentQuotaRule, ContentStrategyPackageRecord, ProductionMatrixTask, StrategyPreflightStatus } from "@/lib/v5/monthly-workspace-contracts";

const preflightLabels: Record<StrategyPreflightStatus, { label: string; color: string }> = {
  generatable: { label: "可生产", color: "green" },
  awaiting_material: { label: "待补资料", color: "gold" },
  configuration_error: { label: "配置错误", color: "red" }
};

const promptLabels = ["目标读者", "内容目标", "推荐结构", "篇幅范围", "表达风格", "证据偏好", "CTA策略", "禁止表达"] as const;

function naturalPromptSnapshot(snapshot: string) {
  let source: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) source = parsed as Record<string, unknown>;
  } catch {
    source = { 内容目标: snapshot };
  }
  const aliases: Record<(typeof promptLabels)[number], string[]> = {
    目标读者: ["目标读者", "targetAudience", "audience"],
    内容目标: ["内容目标", "contentGoal", "goal", "objective"],
    推荐结构: ["推荐结构", "recommendedStructure", "structure", "outline"],
    篇幅范围: ["篇幅范围", "lengthRange", "length", "wordCount"],
    表达风格: ["表达风格", "style", "tone"],
    证据偏好: ["证据偏好", "evidencePreference", "evidence"],
    CTA策略: ["CTA策略", "ctaStrategy", "cta"],
    禁止表达: ["禁止表达", "forbiddenExpressions", "forbidden", "avoid"]
  };
  return promptLabels.map((label) => {
    const value = aliases[label].map((key) => source[key]).find((item) => item !== undefined && item !== "");
    return { label, value: Array.isArray(value) ? value.join("；") : typeof value === "object" && value ? Object.values(value).join("；") : String(value || "未在当前快照中单独配置") };
  });
}

function ctaTypeFor(rule: ContentQuotaRule) {
  const prompt = rule.articleTypePromptConstraintSnapshot.toLowerCase();
  if (prompt.includes("demo") || prompt.includes("演示")) return "预约演示";
  if (prompt.includes("trial") || prompt.includes("试用")) return "申请试用";
  if (prompt.includes("consult") || prompt.includes("咨询")) return "联系咨询";
  return "了解服务";
}

export function MonthlyStrategyTable({ strategyPackage, tasks = [], onDelete }: { strategyPackage: ContentStrategyPackageRecord; tasks?: ProductionMatrixTask[]; onDelete?: (rule: ContentQuotaRule) => Promise<void> | void }) {
  const [detailRule, setDetailRule] = useState<ContentQuotaRule>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const resultByRule = useMemo(() => new Map(strategyPackage.preflightResults.map((item) => [item.quotaRuleId, item])), [strategyPackage.preflightResults]);
  const affectedTasks = detailRule ? tasks.filter((task) => task.quotaRuleId === detailRule.quotaRuleId) : [];
  const publishedTasks = affectedTasks.filter((task) => {
    const publicationStatus = (task as ProductionMatrixTask & { publication?: { status?: string } }).publication?.status;
    return publicationStatus === "published" || (task.status as string) === "published";
  });
  const approved = strategyPackage.status === "approved" || strategyPackage.status === "partially_approved";

  return (
    <>
      <Table
        rowKey="quotaRuleId"
        size="small"
        pagination={false}
        tableLayout="fixed"
        dataSource={strategyPackage.quotaRules}
        columns={[
          { title: "目标问题", dataIndex: "question", render: (value: string) => <strong className="v5-wrap-cell">{value}</strong> },
          { title: "内容类型", key: "contentType", width: 170, render: (_, record) => record.articleTypeNameSnapshot },
          { title: "渠道配额", dataIndex: "channelQuotas", width: 220, render: (value: Record<string, number>) => <Space size={[4, 4]} wrap>{Object.entries(value).map(([channel, quota]) => <Tag key={channel}>{channel} {quota} 篇</Tag>)}</Space> },
          { title: "渠道成品", dataIndex: "expandedDeliverableCount", width: 100, render: (value: number) => <strong>{value} 篇</strong> },
          { title: "生产准入", key: "preflight", width: 130, render: (_, record) => { const result = resultByRule.get(record.quotaRuleId); return result ? <Tag color={preflightLabels[result.status].color}>{preflightLabels[result.status].label}</Tag> : <Tag>待预检</Tag>; } },
          { title: "操作", key: "action", width: 110, render: (_, record) => <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailRule(record)}>查看详情</Button> }
        ]}
      />

      <Modal
        width={780}
        open={Boolean(detailRule)}
        title="策略项详情"
        footer={<Space><Button onClick={() => setDetailRule(undefined)}>关闭</Button><Button danger icon={<DeleteOutlined />} onClick={() => setDeleteOpen(true)}>删除策略项</Button></Space>}
        onCancel={() => setDetailRule(undefined)}
      >
        {detailRule ? <div className="v5-strategy-detail">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="目标问题">{detailRule.question}</Descriptions.Item>
            <Descriptions.Item label="内容类型">{detailRule.articleTypeNameSnapshot}</Descriptions.Item>
            <Descriptions.Item label="匹配理由">{detailRule.matchReasonSnapshot || "未记录匹配理由"}</Descriptions.Item>
          </Descriptions>
          <section>
            <h3>Prompt 约束自然语言快照</h3>
            <div className="v5-prompt-snapshot-grid">{naturalPromptSnapshot(detailRule.articleTypePromptConstraintSnapshot).map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
          </section>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="渠道配额"><Space wrap>{Object.entries(detailRule.channelQuotas).map(([channel, quota]) => <Tag key={channel}>{channel} {quota} 篇</Tag>)}</Space></Descriptions.Item>
            <Descriptions.Item label="CTA 类型">{ctaTypeFor(detailRule)}</Descriptions.Item>
            <Descriptions.Item label="各渠道冻结 CTA 预览"><div className="v5-cta-preview-list">{Object.keys(detailRule.channelQuotas).map((channel) => <div key={channel}><Tag>{channel}</Tag><span>了解 JOTO 对应服务能力与适用场景</span></div>)}</div></Descriptions.Item>
            <Descriptions.Item label="CTA 证据状态"><Tag color={detailRule.evidencePackSourceSnapshotHash ? "green" : "gold"}>{detailRule.evidencePackSourceSnapshotHash ? "证据快照已冻结" : "待补证据"}</Tag></Descriptions.Item>
            <Descriptions.Item label="生产准入结果">{(() => { const result = resultByRule.get(detailRule.quotaRuleId); return result ? <><Tag color={preflightLabels[result.status].color}>{preflightLabels[result.status].label}</Tag>{result.reason ? ` ${result.reason}` : ""}</> : "待预检"; })()}</Descriptions.Item>
          </Descriptions>
        </div> : null}
      </Modal>

      <Modal
        open={deleteOpen}
        title="删除策略项"
        okText={publishedTasks.length ? "从下一版本移除" : approved ? "创建新版本并移除" : "删除策略项"}
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        onCancel={() => setDeleteOpen(false)}
        onOk={async () => { if (!detailRule) return; setDeleting(true); try { await onDelete?.(detailRule); setDeleteOpen(false); setDetailRule(undefined); } finally { setDeleting(false); } }}
      >
        <Alert showIcon type={publishedTasks.length ? "warning" : "info"} message={publishedTasks.length ? "已发布内容只保留历史，并从下一策略版本移除" : approved ? "已批准策略不会原地修改，将创建新策略版本" : "未批准策略项可以直接删除"} />
        {affectedTasks.length ? <div className="v5-delete-impact"><strong>受影响任务 {affectedTasks.length} 篇</strong><ul>{affectedTasks.slice(0, 8).map((task) => <li key={task.taskId}>{task.title}</li>)}</ul>{affectedTasks.length > 8 ? <span>另有 {affectedTasks.length - 8} 篇</span> : null}</div> : <p>当前策略项尚未生成文章任务。</p>}
      </Modal>
    </>
  );
}
