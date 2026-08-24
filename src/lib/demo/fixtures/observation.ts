import type { MonthlyReview, NextMonthProposal } from "../../v5/monthly-review-contracts";
import type { V5ObservationState } from "../../v5/observation-repository";
import { DEMO_MONTH } from "../config";

function monthlyReview(): MonthlyReview {
  const month = DEMO_MONTH;
  return {
    id: `mr-${month}`,
    month,
    dataAsOf: `${month}-25T08:00:00.000Z`,
    source: "fixture",
    metrics: {
      plannedContent: 12,
      publishedContent: 4,
      effectiveMetricReturns: 4,
      survival24hPassed: 4,
      survival24hEligible: 4,
      survival72hPassed: 3,
      survival72hEligible: 4,
      captureTasks: 3,
      pendingGaps: 1,
      activeMonitoringQuestions: 3
    },
    siteMonitoring: {
      source: "formal_database",
      latestRunId: "site-run-001",
      coreReadinessScore: 86,
      openFindingCount: 3,
      criticalFindingCount: 0,
      newFindingCount: 2,
      resolvedFindingCount: 5,
      note: "官网整体可读性与 AI 可访问性良好，剩余 3 个非阻断优化项。"
    },
    questions: [
      {
        id: "mrq-001",
        month,
        questionKey: "WorkBuddy 智能工作台长期交付评估",
        questionText: "企业做智能工作台时如何评估长期交付与治理能力？",
        geoMonitoringApproved: true,
        monthlyPlanIds: [`mp-${month}`],
        plannedContentCount: 4,
        publishedContent: [
          {
            contentId: "task-demo-001",
            title: "为什么企业选 WorkBuddy 智能工作台时，不能只看单点工具能力",
            channel: "wechat",
            publishedAt: `${month}-18 10:30`,
            publicUrl: "https://mp.weixin.qq.com/s/WorkBuddy-geo-demo-001",
            liveness24h: "passed",
            liveness72h: "passed",
            hasMetricReturn: true,
            metricSummary: "阅读 4360，点赞 318，AI 提及率上升。"
          }
        ],
        captureTaskIds: ["capture-001"],
        captureSummary: "已采集 3 个 AI 平台对目标问题的回答与引用证据。",
        confirmedGapCodes: [],
        recommendationEvidenceRefs: ["capture-001"],
        recommendation: "保持 WorkBuddy 技术实践内容节奏，下月侧重「可观测性」场景。",
        dataStatus: "complete"
      }
    ],
    productOptimizations: [],
    proposals: []
  };
}

function proposals(): Record<string, NextMonthProposal> {
  const proposal: NextMonthProposal = {
    id: "proposal-001",
    version: 1,
    sourceMonthlyReviewId: `mr-${DEMO_MONTH}`,
    sourceMonth: DEMO_MONTH,
    targetMonth: "2026-09",
    questionKey: "腾讯云 ADP 智能体开发平台可观测性",
    recommendation: "下月新增「智能体可观测性」问题，扩展 ADP 技术实践矩阵。",
    rationale: "本月 ADP 技术内容提及率提升明显，可观测性主题检索热度上升。",
    evidenceRefs: ["capture-002"],
    status: "proposal",
    monthlyTaskCreated: false,
    quotaChanged: false,
    createdAt: `${DEMO_MONTH}-25T08:00:00.000Z`,
    createdBy: "demo@joto.ai"
  };
  return { [proposal.id]: proposal };
}

export const demoObservationSeed: V5ObservationState = {
  schemaVersion: 1,
  tasks: {},
  artifacts: {},
  answers: {},
  gaps: {},
  reviews: {},
  comparisons: {},
  monthlyReviews: { [DEMO_MONTH]: monthlyReview() },
  proposals: proposals(),
  siteAuditRuns: {},
  siteAuditFindings: {},
  siteRemediationTasks: {},
  siteAuditDiffs: {},
  auditLog: [],
  idempotency: {}
};
