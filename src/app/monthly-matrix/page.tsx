"use client";

import { ArrowRightOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Progress, Space, Tag } from "antd";
import Link from "next/link";
import { useState } from "react";
import { MonthlyPlanConfigPanel } from "@/components/MonthlyPlanConfigPanel";
import { MonthlyStrategyTable } from "@/components/MonthlyMatrixTable";
import { PageHeader } from "@/components/PageHeader";
import { V5StatusRail } from "@/components/V5StatusRail";
import { monthlyGoal, strategyTermHits, v5DemoLabel } from "@/lib/v5-ui-mock-data";
import type { MonthlyPlanConfig } from "@/lib/v5-ui-mock-data";

export default function MonthlyMatrixPage() {
  const [configuredGoal, setConfiguredGoal] = useState<MonthlyPlanConfig>(monthlyGoal);
  const [configOpen, setConfigOpen] = useState(false);
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
        titleExtra={<Tag color="blue">{configuredGoal.month}</Tag>}
        subtitle="V5 唯一计划真源：确认产品规则包、月度配额、蒸馏词命中、GEO 测试目标和证据准备度。"
        actions={
          <Button type="primary" icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>
            月度计划配置
          </Button>
        }
      />

      <Alert
        showIcon
        type="info"
        message="当前为 V5 前端流程验证"
        description={`${v5DemoLabel}。页面内保存不会创建真实月度计划、策略包或矩阵版本。`}
        style={{ marginBottom: 16 }}
      />

      <V5StatusRail
        items={[
          { label: "本月计划", value: `${totalQuota} 篇`, helper: "月度矩阵总配额", status: "mock" },
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
          <strong>{configuredGoal.businessGoal}</strong>
        </div>
        <Tag>人工配置 · mock</Tag>
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

        <MonthlyStrategyTable items={strategyTermHits} />

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
        onClose={() => setConfigOpen(false)}
        onSave={setConfiguredGoal}
      />
    </>
  );
}
