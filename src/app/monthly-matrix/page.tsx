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
        subtitle="确认本月产品、内容配额、主题方向、GEO 测试目标和证据准备度。"
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
          message="月度计划读取失败"
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
              ? "部分产品暂不可加入本月计划"
              : workspace?.source.governanceData === "pending_config"
                ? "部分产品尚未完成生产准备"
                : workspace?.source.monthlyData === "persisted"
                  ? "本月计划已更新"
                  : "开始配置本月计划"
          }
          description={
            workspace?.source.governanceData === "failed" || workspace?.source.governanceData === "pending_config" || workspace?.source.referenceData === "seed_fallback"
              ? "请先完善产品资料并完成表达规则审核，再配置月度配额。"
              : workspace?.source.monthlyData === "persisted"
                ? "请核对业务目标、产品配额和渠道分配，再确认月度策略。"
                : "先选择本月产品与渠道并填写内容配额，系统将据此生成策略建议。"
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {loading && !workspace ? <div style={{ marginBottom: 16, textAlign: "center" }}><Spin /><span style={{ marginLeft: 8 }}>正在加载月度计划</span></div> : null}

      <V5StatusRail
        items={[
          { label: "本月计划", value: `${totalQuota} 篇`, helper: "月度矩阵总配额" },
          { label: "可用产品", value: configuredGoal.groups.length, helper: "已审核且资料充分" },
          { label: "覆盖渠道", value: channelCount, helper: "已选择的发布渠道" },
          { label: "GEO 基线", value: `${baselineCount} 篇`, helper: `${configuredGoal.baselineRatio}% 稳定复测` },
          { label: "动态探索", value: `${explorationCount} 篇`, helper: `${100 - configuredGoal.baselineRatio}% 新缺口验证` },
          { label: "策略建议", value: "待确认", helper: "确认后进入内容生产" },
          { label: "证据异常", value: evidenceExceptionCount, helper: "仅阻断受影响矩阵项" }
        ]}
      />

      <Card className="v5-goal-band" size="small">
        <div>
          <span className="v5-kicker">本月业务目标</span>
          <strong>{configuredGoal.businessGoal || "尚未配置本月业务目标"}</strong>
        </div>
        <Tag color={workspace?.plan ? "green" : "default"}>{workspace?.plan ? "计划已保存" : "尚未保存"}</Tag>
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
          message="策略方向确认后仍需检查单篇证据"
          description="本表用于审核选题方向和预计证据准备度；标题确认后，系统会逐篇检查事实依据，再决定是否可以生成正文。"
          style={{ marginBottom: 12 }}
        />

        {strategyTermHits.length ? (
          <MonthlyStrategyTable items={strategyTermHits} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本月还没有策略建议；请先保存月度计划，再生成并审核策略。" />
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
