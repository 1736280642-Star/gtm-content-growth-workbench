"use client";

import { ArrowRightOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Progress, Space, Spin, Tag } from "antd";
import Link from "next/link";
import { useState } from "react";
import { MonthlyPlanConfigPanel } from "@/components/MonthlyPlanConfigPanel";
import { MonthlyStrategyTable } from "@/components/MonthlyMatrixTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { useMonthlyWorkspace } from "@/lib/v5/use-monthly-workspace";

const loadingPlan = {
  month: "",
  businessGoal: "",
  baselineRatio: 20,
  ratioAdjustmentReason: "",
  groups: []
};

export default function MonthlyMatrixPage() {
  const [configOpen, setConfigOpen] = useState(false);
  const { workspace, loading, error, refresh, saveMonthlyPlan } = useMonthlyWorkspace();
  const configuredGoal = workspace?.draftPlan || loadingPlan;
  const strategyTermHits = workspace?.strategyRows || [];
  const totalQuota = configuredGoal.groups.reduce((total, group) => total + group.articleQuota, 0);
  const channelCount = new Set(configuredGoal.groups.flatMap((group) => group.selectedChannels)).size;
  const baselineCount = Math.round(totalQuota * (configuredGoal.baselineRatio / 100));
  const explorationCount = totalQuota - baselineCount;
  const evidenceExceptionCount = strategyTermHits.reduce((total, item) => total + item.estimatedMissingEvidenceItemCount, 0);
  const estimatedGeneratableCount = strategyTermHits.reduce(
    (total, item) => total + item.estimatedReadyItemCount + item.estimatedAutoDowngradeItemCount,
    0
  );

  return (
    <>
      <PageHeader
        title="月度内容矩阵"
        titleExtra={<Tag color="blue">{configuredGoal.month || "读取中"}</Tag>}
        subtitle="V5 唯一计划真源：确认产品规则包、月度配额、蒸馏词命中、GEO 测试目标和证据准备度。"
        actions={
          <Button type="primary" icon={<SettingOutlined />} loading={loading} disabled={!workspace} onClick={() => setConfigOpen(true)}>
            月度计划配置
          </Button>
        }
      />

      {error ? (
        <Alert
          showIcon
          type="error"
          message="V5 月度数据读取失败"
          description={error}
          action={<Button size="small" onClick={() => void refresh().catch(() => undefined)}>重新读取</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Alert
          showIcon
          type={workspace?.source.governanceData === "failed" ? "error" : workspace?.source.governanceData === "pending_config" || workspace?.source.referenceData === "seed_fallback" ? "warning" : workspace?.source.monthlyData === "persisted" ? "success" : "info"}
          message={
            workspace?.source.governanceData === "failed"
              ? "正式 V5 治理数据读取失败"
              : workspace?.source.governanceData === "pending_config"
                ? "正式 V5 治理数据待配置"
                : workspace?.source.monthlyData === "persisted"
                  ? "已读取 V5 月度计划真实数据"
                  : "V5 接口已接通，当前月份尚未建立计划"
          }
          description={
            workspace?.formal.message
              ? `${workspace.formal.message} V4 数据仅用于候选产品名称与渠道映射，不作为生产准入依据。`
              : workspace?.source.referenceData === "seed_fallback"
              ? "未找到 WORKBENCH_STATE_PATH 指向的真实 V4 状态；规则包仅作 seed_fallback 展示，不能进入月度生产池。"
              : "产品名称与候选渠道来自 V4 兼容映射；规则包状态、G6 准备度和生产池准入来自正式 V5 Repository / Service。"
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {loading && !workspace ? <div style={{ marginBottom: 16, textAlign: "center" }}><Spin /><span style={{ marginLeft: 8 }}>正在读取 V5 月度工作区</span></div> : null}

      <V5StatusRail
        items={[
          { label: "本月计划", value: `${totalQuota} 篇`, helper: "月度矩阵总配额", status: workspace?.source.monthlyData === "persisted" ? "real" : "pending_config" },
          { label: "产品规则包", value: configuredGoal.groups.length, helper: "active 且生产就绪" },
          { label: "覆盖渠道", value: channelCount, helper: "沿用现有渠道命名" },
          { label: "GEO 基线", value: `${baselineCount} 篇`, helper: `${configuredGoal.baselineRatio}% 稳定复测` },
          { label: "动态探索", value: `${explorationCount} 篇`, helper: `${100 - configuredGoal.baselineRatio}% 新缺口验证` },
          { label: "策略包", value: "待确认", helper: "草稿版本，需人工审核" },
          { label: "证据异常", value: evidenceExceptionCount, helper: "仅阻断受影响矩阵项" }
        ]}
      />

      <Card className="v5-goal-band" size="small">
        <div>
          <span className="v5-kicker">本月业务目标</span>
          <strong>{configuredGoal.businessGoal || "尚未配置本月业务目标"}</strong>
        </div>
        <Tag>{workspace?.plan ? `V5 persisted · v${workspace.plan.version}` : "pending_config"}</Tag>
      </Card>

      <Card
        id="strategy-package"
        className="v5-strategy-card"
        title="月度策略包审核"
        size="small"
        extra={
          <Space wrap>
            <Button disabled>退回调整</Button>
            <Button disabled>生成策略包</Button>
            <Button type="primary" disabled>确认策略包</Button>
          </Space>
        }
      >
        <div className="v5-geo-allocation">
          <div className="v5-geo-allocation-copy">
            <strong>GEO 测试分配</strong>
            <span>20/80 是内容配额的默认测试结构，不是流量分配；人工调整时必须填写原因。</span>
          </div>
          <div className="v5-geo-allocation-bars">
            <div>
              <span>{`baseline ${configuredGoal.baselineRatio}% · ${baselineCount} 篇`}</span>
              <Progress percent={configuredGoal.baselineRatio} showInfo={false} strokeColor="#6554c0" trailColor="#ece9fb" />
            </div>
            <div>
              <span>{`exploration ${100 - configuredGoal.baselineRatio}% · ${explorationCount} 篇`}</span>
              <Progress percent={100 - configuredGoal.baselineRatio} showInfo={false} strokeColor="#1677ff" trailColor="#e8f1ff" />
            </div>
          </div>
        </div>

        <Alert
          showIcon
          type="warning"
          message="策略可行不等于正文可生成"
          description="本表只展示 Evidence Preview 摘要，不生成文章标题，也不授予正文生成许可。标题冻结后的 Final Evidence Pack 与 Final Evidence Gate 才决定正文生成许可。"
          style={{ marginBottom: 12 }}
        />

        {strategyTermHits.length ? (
          <MonthlyStrategyTable items={strategyTermHits} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前月份还没有真实策略包；保存月度计划后，等待策略生成接口写入。" />
        )}

        <div className="v5-strategy-footer">
          <div>
            <strong>{estimatedGeneratableCount} 项预计可进入矩阵</strong>
            <span>{evidenceExceptionCount} 项需补证据或人工处理；异常不会阻断其余月度生产。</span>
          </div>
          <Link href="/batch-generation">
            <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end">
              进入批量生成中心
            </Button>
          </Link>
        </div>
      </Card>

      <MonthlyPlanConfigPanel
        open={configOpen}
        value={configuredGoal}
        rulePackages={workspace?.rulePackages || []}
        channels={workspace?.channels || []}
        onClose={() => setConfigOpen(false)}
        onSave={saveMonthlyPlan}
      />
    </>
  );
}
