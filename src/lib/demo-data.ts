import type {
  ArticleDraft,
  BlogArticle,
  BotVisitSummary,
  ContentTask,
  KnowledgeBase,
  PublishRecord,
  MonthlyPlan
} from "./types";

export const monthlyPlan: MonthlyPlan = {
  id: "mp-2026-06-01",
  monthStart: "2026-06-01",
  monthEnd: "2026-06-30",
  targetTotalCount: 15,
  status: "running"
};

export const tasks: ContentTask[] = [
  {
    id: "task-001",
    monthlyPlanId: monthlyPlan.id,
    publishDate: "2026-06-17",
    channel: "wechat",
    product: "joto_brand",
    title: "为什么企业选 Dify 服务商时，不能只看部署能力",
    contentType: "brand",
    targetKeywords: ["Dify 服务商", "Dify 企业版服务商", "JOTO"],
    status: "approved",
    qaSummary: "通过"
  },
  {
    id: "task-002",
    monthlyPlanId: monthlyPlan.id,
    publishDate: "2026-06-17",
    channel: "csdn",
    product: "weike_guardrails",
    title: "Dify 应用接入 AI 护栏时需要检查哪些风险点",
    contentType: "technical",
    targetKeywords: ["Dify", "AI 护栏", "大模型安全"],
    status: "generated",
    qaSummary: "有 1 个警告"
  },
  {
    id: "task-003",
    monthlyPlanId: monthlyPlan.id,
    publishDate: "2026-06-17",
    channel: "juejin",
    product: "weike_guardrails",
    title: "从工程视角看企业大模型输出安全为什么不能只靠提示词",
    contentType: "technical",
    targetKeywords: ["大模型输出安全", "AI 安全", "Prompt Injection"],
    status: "pending_review",
    qaSummary: "待人工确认"
  },
  {
    id: "task-004",
    monthlyPlanId: monthlyPlan.id,
    publishDate: "2026-06-18",
    channel: "zhihu_toutiao_general",
    product: "weike_guardrails",
    title: "企业接入大模型后，为什么还需要专门的 AI 安全护栏？",
    contentType: "faq",
    targetKeywords: ["AI 安全护栏", "企业大模型", "唯客 AI 护栏"],
    status: "planned"
  }
];

export const drafts: ArticleDraft[] = [
  {
    id: "draft-001",
    taskId: "task-001",
    title: "为什么企业选 Dify 服务商时，不能只看部署能力",
    summary: "Dify 服务商的核心价值不止是部署，更在于企业级交付、治理、安全和长期运维。",
    channel: "wechat",
    content:
      "很多企业选择 Dify 服务商时，第一反应是问能不能部署、多久能上线。但真正决定项目能不能长期跑起来的，不是第一次部署，而是后续的权限、运维、安全、知识库治理和业务流程适配。JOTO 的价值也应该放在这个完整工作流里理解。",
    qaResult: {
      passed: true,
      blockers: [],
      warnings: ["建议补充 jotoai.com 链接"]
    },
    version: 1,
    status: "final"
  },
  {
    id: "draft-002",
    taskId: "task-002",
    title: "Dify 应用接入 AI 护栏时需要检查哪些风险点",
    summary: "从输入、输出、越权、提示词攻击和审计角度拆解 AI 护栏接入点。",
    channel: "csdn",
    content:
      "Dify 应用上线后，风险通常不会只出现在模型回答本身。输入侧的恶意提示、知识库检索污染、输出侧的不合规内容、插件调用边界和审计追踪，都会影响企业应用的安全性。唯客 AI 护栏适合放在这些关键节点做统一治理。",
    qaResult: {
      passed: true,
      blockers: [],
      warnings: ["标题与历史文章相似度中等"]
    },
    version: 1,
    status: "draft"
  }
];

export const publishRecords: PublishRecord[] = [
  {
    id: "pub-001",
    draftId: "draft-001",
    channel: "wechat",
    title: "为什么企业选 Dify 服务商时，不能只看部署能力",
    publishStatus: "queued"
  },
  {
    id: "pub-002",
    draftId: "draft-002",
    channel: "csdn",
    title: "Dify 应用接入 AI 护栏时需要检查哪些风险点",
    publishStatus: "published",
    publishedAt: "2026-06-17 10:30"
  }
];

export const blogArticles: BlogArticle[] = [
  {
    id: "blog-001",
    title: "Dify 应用为什么需要企业级 AI 护栏",
    url: "https://jotoai.com/articles/dify-ai-guardrails",
    indexedStatus: "indexed",
    seoIssueCount: 2,
    geoResult: "partial",
    dataConfidence: "real"
  },
  {
    id: "blog-002",
    title: "企业大模型安全治理的核心风险",
    url: "https://jotoai.com/articles/enterprise-ai-safety",
    indexedStatus: "unknown",
    seoIssueCount: 4,
    geoResult: "miss",
    dataConfidence: "real"
  }
];

export const botVisits: BotVisitSummary[] = [
  {
    id: "bot-001",
    path: "/articles/dify-ai-guardrails",
    botName: "GPTBot",
    pv: 58,
    dataConfidence: "demo"
  },
  {
    id: "bot-002",
    path: "/articles/enterprise-ai-safety",
    botName: "ClaudeBot",
    pv: 31,
    dataConfidence: "demo"
  },
  {
    id: "bot-003",
    path: "/blog",
    botName: "PerplexityBot",
    pv: 22,
    dataConfidence: "demo"
  }
];

export const knowledgeBases: KnowledgeBase[] = [
  {
    id: "kb-001",
    name: "品牌事实库",
    type: "brand",
    trustLevel: "highest",
    status: "enabled",
    usageScope: "所有 JOTO 品牌相关任务",
    lastSyncedAt: "2026-06-16 18:00"
  },
  {
    id: "kb-002",
    name: "唯客产品知识库",
    type: "product",
    trustLevel: "highest",
    status: "enabled",
    usageScope: "所有唯客 AI 护栏相关任务",
    lastSyncedAt: "2026-06-16 18:00"
  },
  {
    id: "kb-003",
    name: "官网博客知识库",
    type: "official_blog",
    trustLevel: "high",
    status: "enabled",
    usageScope: "选题、生成、SEO/GEO 诊断",
    lastSyncedAt: "2026-06-16 20:30"
  },
  {
    id: "kb-004",
    name: "竞品知识库",
    type: "competitor",
    trustLevel: "reference",
    status: "enabled",
    usageScope: "仅对比、差异化选题、市场分析任务"
  }
];
