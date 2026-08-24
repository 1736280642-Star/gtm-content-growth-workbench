import type { WorkbenchState } from "../../workbench-store";
import type {
  BlogArticle,
  BotVisitSummary,
  DistributionTarget,
  PublishRecord,
  PublishSchedule
} from "../../types";
import { DEMO_MONTH } from "../config";

/**
 * 主工作台状态演示种子（叠加到 createInitialWorkbenchState 之上）。
 * 主题：JOTO WorkBuddy 与腾讯云 ADP 的 GEO 增长，本月已"跑通"——
 * 部分内容已公开、有 URL 回传、存活验证通过并带回渠道度量。
 */
export const demoWorkbenchSeed: Partial<WorkbenchState> = {
  runtime: {
    storage: "memory",
    statePath: "memory://vercel-demo",
    initializedAt: `${DEMO_MONTH}-21T09:00:00.000Z`
  },
  publishRecords: [
    {
      id: "pub-demo-001",
      draftId: "draft-001",
      channel: "wechat",
      title: "为什么企业选 WorkBuddy 智能工作台时，不能只看单点工具能力",
      publishStatus: "published",
      publishedUrl: "https://mp.weixin.qq.com/s/WorkBuddy-geo-demo-001",
      publishedAt: `${DEMO_MONTH}-18 10:30`,
      urlStatus: "stable",
      firstPublicObservedAt: `${DEMO_MONTH}-18T02:40:00.000Z`,
      lastVerifiedAt: `${DEMO_MONTH}-21T08:00:00.000Z`,
      stablePublishedAt: `${DEMO_MONTH}-19T01:00:00.000Z`,
      channelMetrics: { impressions: 12030, views: 4360, likes: 318, favorites: 127, comments: 41, shares: 86, importedAt: `${DEMO_MONTH}-21T08:00:00.000Z` }
    },
    {
      id: "pub-demo-002",
      draftId: "draft-002",
      channel: "csdn",
      title: "腾讯云 ADP 智能体开发平台的 GEO 增长实践与避坑指南",
      publishStatus: "published",
      publishedUrl: "https://blog.csdn.net/joto/article/details/adp-geo-demo-002",
      publishedAt: `${DEMO_MONTH}-19 14:20`,
      urlStatus: "stable",
      firstPublicObservedAt: `${DEMO_MONTH}-19T06:30:00.000Z`,
      lastVerifiedAt: `${DEMO_MONTH}-21T08:00:00.000Z`,
      stablePublishedAt: `${DEMO_MONTH}-20T02:00:00.000Z`,
      channelMetrics: { impressions: 28410, views: 9120, likes: 542, favorites: 233, comments: 68, shares: 51, importedAt: `${DEMO_MONTH}-21T08:00:00.000Z` }
    },
    {
      id: "pub-demo-003",
      draftId: "draft-003",
      channel: "juejin",
      title: "从工程视角看智能体平台的可观测性：WorkBuddy 与腾讯云 ADP 的协同",
      publishStatus: "published",
      publishedUrl: "https://juejin.cn/post/adp-workbuddy-demo-003",
      publishedAt: `${DEMO_MONTH}-20 09:05`,
      urlStatus: "stable",
      firstPublicObservedAt: `${DEMO_MONTH}-20T01:10:00.000Z`,
      lastVerifiedAt: `${DEMO_MONTH}-21T08:00:00.000Z`,
      stablePublishedAt: `${DEMO_MONTH}-20T03:00:00.000Z`,
      channelMetrics: { impressions: 8830, views: 2915, likes: 176, favorites: 84, comments: 22, shares: 19, importedAt: `${DEMO_MONTH}-21T08:00:00.000Z` }
    },
    {
      id: "pub-demo-004",
      draftId: "draft-004",
      channel: "zhihu_toutiao_general",
      title: "企业做 AI 智能体，为什么需要把 GEO 纳入增长闭环？",
      publishStatus: "published",
      publishedUrl: "https://zhuanlan.zhihu.com/p/adp-geo-demo-004",
      publishedAt: `${DEMO_MONTH}-21 07:45`,
      urlStatus: "provisional",
      firstPublicObservedAt: `${DEMO_MONTH}-21T00:05:00.000Z`,
      lastVerifiedAt: `${DEMO_MONTH}-21T08:00:00.000Z`,
      channelMetrics: { impressions: 3200, views: 940, likes: 63, favorites: 21, comments: 9, shares: 7, importedAt: `${DEMO_MONTH}-21T08:00:00.000Z` }
    }
  ],
  publishSchedules: [
    {
      id: "sched-demo-001",
      platform: "wechat",
      status: "stable_published",
      scheduledAt: `${DEMO_MONTH}-18T10:00:00.000Z`,
      draftId: "draft-001",
      publishRecordId: "pub-demo-001",
      contentHash: "demo-hash-wechat-001",
      idempotencyKey: "demo-idem-wechat-001",
      attemptIds: ["attempt-demo-001"],
      latestAttemptId: "attempt-demo-001",
      publishedAt: `${DEMO_MONTH}-18 10:30`,
      publicUrl: "https://mp.weixin.qq.com/s/WorkBuddy-geo-demo-001",
      urlStatus: "stable",
      stablePublishedAt: `${DEMO_MONTH}-19T01:00:00.000Z`,
      verificationCount: 3,
      retryCount: 0,
      createdAt: `${DEMO_MONTH}-17T08:00:00.000Z`,
      updatedAt: `${DEMO_MONTH}-21T08:00:00.000Z`
    },
    {
      id: "sched-demo-002",
      platform: "csdn",
      status: "stable_published",
      scheduledAt: `${DEMO_MONTH}-19T14:00:00.000Z`,
      draftId: "draft-002",
      publishRecordId: "pub-demo-002",
      contentHash: "demo-hash-csdn-002",
      idempotencyKey: "demo-idem-csdn-002",
      attemptIds: ["attempt-demo-002"],
      latestAttemptId: "attempt-demo-002",
      publishedAt: `${DEMO_MONTH}-19 14:20`,
      publicUrl: "https://blog.csdn.net/joto/article/details/adp-geo-demo-002",
      urlStatus: "stable",
      stablePublishedAt: `${DEMO_MONTH}-20T02:00:00.000Z`,
      verificationCount: 2,
      retryCount: 0,
      createdAt: `${DEMO_MONTH}-17T08:10:00.000Z`,
      updatedAt: `${DEMO_MONTH}-21T08:00:00.000Z`
    }
  ],
  distributionTargets: [
    {
      id: "dist-demo-001",
      publishRecordId: "pub-demo-001",
      draftId: "draft-001",
      taskId: "task-001",
      platform: "weixin",
      status: "draft_created",
      draftUrl: "https://mp.weixin.qq.com/s/WorkBuddy-geo-demo-001",
      mode: "mock",
      createdAt: `${DEMO_MONTH}-17T09:00:00.000Z`,
      updatedAt: `${DEMO_MONTH}-18T10:30:00.000Z`
    },
    {
      id: "dist-demo-002",
      publishRecordId: "pub-demo-002",
      draftId: "draft-002",
      taskId: "task-002",
      platform: "csdn",
      status: "draft_created",
      draftUrl: "https://blog.csdn.net/joto/article/details/adp-geo-demo-002",
      mode: "mock",
      createdAt: `${DEMO_MONTH}-17T09:10:00.000Z`,
      updatedAt: `${DEMO_MONTH}-19T14:20:00.000Z`
    },
    {
      id: "dist-demo-003",
      publishRecordId: "pub-demo-003",
      draftId: "draft-003",
      taskId: "task-003",
      platform: "juejin",
      status: "draft_created",
      draftUrl: "https://juejin.cn/post/adp-workbuddy-demo-003",
      mode: "mock",
      createdAt: `${DEMO_MONTH}-17T09:20:00.000Z`,
      updatedAt: `${DEMO_MONTH}-20T09:05:00.000Z`
    }
  ],
  blogArticles: [
    {
      id: "blog-demo-001",
      title: "WorkBuddy 智能工作台如何打通企业 AI 落地的最后一公里",
      url: "https://jotoai.com/articles/workbuddy-last-mile",
      indexedStatus: "indexed",
      seoIssueCount: 1,
      geoResult: "hit",
      dataConfidence: "real"
    },
    {
      id: "blog-demo-002",
      title: "腾讯云 ADP 智能体开发平台的企业级实践",
      url: "https://jotoai.com/articles/tencent-adp-enterprise",
      indexedStatus: "indexed",
      seoIssueCount: 0,
      geoResult: "hit",
      dataConfidence: "real"
    },
    {
      id: "blog-demo-003",
      title: "GEO 增长方法论：从关键词到 AI 可见性",
      url: "https://jotoai.com/articles/geo-growth-method",
      indexedStatus: "unknown",
      seoIssueCount: 3,
      geoResult: "partial",
      dataConfidence: "real"
    }
  ],
  botVisits: [
    { id: "bot-demo-001", path: "/articles/workbuddy-last-mile", botName: "GPTBot", pv: 412, dataConfidence: "demo" },
    { id: "bot-demo-002", path: "/articles/tencent-adp-enterprise", botName: "ClaudeBot", pv: 267, dataConfidence: "demo" },
    { id: "bot-demo-003", path: "/articles/geo-growth-method", botName: "PerplexityBot", pv: 198, dataConfidence: "demo" },
    { id: "bot-demo-004", path: "/articles/workbuddy-last-mile", botName: "BaiduSpider", pv: 156, dataConfidence: "demo" },
    { id: "bot-demo-005", path: "/articles/tencent-adp-enterprise", botName: "Bytespider", pv: 121, dataConfidence: "demo" }
  ],
  pipelineRuns: [
    {
      id: "pipeline-demo-001",
      status: "success",
      startedAt: `${DEMO_MONTH}-21T07:00:00.000Z`,
      finishedAt: `${DEMO_MONTH}-21T07:18:00.000Z`,
      month: DEMO_MONTH,
      steps: [
        { name: "sync_blog", ok: true, status: "success", message: "官网博客同步完成：新增 3 篇、更新 5 篇。", fatal: false },
        { name: "import_log", ok: true, status: "success", message: "导入 1,240 条访问日志，识别 5 类 AI 爬虫。", fatal: false },
        { name: "import_channel_metrics", ok: true, status: "success", message: "回传 4 个渠道的阅读与提及率数据。", fatal: false }
      ]
    }
  ]
};
