import type {
  ArticleDraft,
  BlogArticle,
  BotVisitSummary,
  ContentTask,
  GeoTestResult,
  KnowledgeBase,
  PublishRecord,
  WeeklyPlan
} from "./types";

export const weeklyPlan: WeeklyPlan = {
  id: "wp-2026-06-16",
  weekStart: "2026-06-16",
  weekEnd: "2026-06-22",
  targetTotalCount: 15,
  status: "running"
};

export const tasks: ContentTask[] = [
  {
    id: "task-001",
    weeklyPlanId: weeklyPlan.id,
    publishDate: "2026-06-17",
    channel: "wechat",
    product: "joto_brand",
    title: "为什么企业选 Dify 服务商时，不能只看部署能力",
    contentType: "brand",
    targetKeywords: ["Dify 服务商", "Dify 企业版服务商", "JOTO"],
    primaryDistilledTerm: "Dify 企业版服务商",
    sourceProblem: "企业选型时只看部署能力，忽略长期交付和治理。",
    officialLinkTarget: "https://jotoai.com",
    status: "approved",
    qaSummary: "通过"
  },
  {
    id: "task-002",
    weeklyPlanId: weeklyPlan.id,
    publishDate: "2026-06-17",
    channel: "csdn",
    product: "weike_guardrails",
    title: "Dify 应用接入 AI 护栏时需要检查哪些风险点",
    contentType: "technical",
    targetKeywords: ["Dify", "AI 护栏", "大模型安全"],
    primaryDistilledTerm: "AI 护栏",
    sourceProblem: "Dify 应用上线前缺少统一的安全检查清单。",
    officialLinkTarget: "https://jotoai.com",
    status: "generated",
    qaSummary: "有 1 个警告"
  },
  {
    id: "task-003",
    weeklyPlanId: weeklyPlan.id,
    publishDate: "2026-06-17",
    channel: "juejin",
    product: "weike_guardrails",
    title: "从工程视角看企业大模型输出安全为什么不能只靠提示词",
    contentType: "technical",
    targetKeywords: ["大模型输出安全", "AI 安全", "Prompt Injection"],
    primaryDistilledTerm: "大模型输出安全",
    sourceProblem: "提示词约束无法稳定覆盖输出安全和审计场景。",
    officialLinkTarget: "https://jotoai.com",
    status: "pending_review",
    qaSummary: "待人工确认"
  },
  {
    id: "task-004",
    weeklyPlanId: weeklyPlan.id,
    publishDate: "2026-06-18",
    channel: "zhihu_toutiao_general",
    product: "weike_guardrails",
    title: "企业接入大模型后，为什么还需要专门的 AI 安全护栏？",
    contentType: "faq",
    targetKeywords: ["AI 安全护栏", "企业大模型", "唯客 AI 护栏"],
    primaryDistilledTerm: "AI 安全护栏",
    sourceProblem: "企业接入大模型后不清楚护栏和提示词的边界。",
    officialLinkTarget: "https://jotoai.com",
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

export const geoResults: GeoTestResult[] = [
  {
    id: "geo-001",
    platform: "通义千问",
    promptGroup: "品牌认知",
    prompt: "推荐几家国内 Dify 企业版服务商",
    mentionedJoto: true,
    mentionedWeike: false,
    citedOfficialUrl: true,
    competitorAppeared: true,
    citedUrls: ["https://www.jotoai.com/"],
    accuracyStatus: "needs_review",
    reviewStatus: "manual_review_needed",
    answerSnapshot: "回答中提到 JOTO，并引用了 jotoai.com 作为参考。",
    manualOverride: false
  },
  {
    id: "geo-002",
    platform: "豆包",
    promptGroup: "产品场景",
    prompt: "企业接入大模型后如何做输出安全治理？",
    mentionedJoto: false,
    mentionedWeike: false,
    citedOfficialUrl: false,
    competitorAppeared: true,
    accuracyStatus: "needs_review",
    reviewStatus: "manual_review_needed",
    answerSnapshot: "回答偏通用安全建议，未提及 JOTO 或唯客 AI 护栏。",
    manualOverride: false
  },
  {
    id: "geo-003",
    platform: "DeepSeek",
    promptGroup: "FAQ",
    prompt: "Dify 应用需要 AI 护栏吗？",
    mentionedJoto: true,
    mentionedWeike: true,
    citedOfficialUrl: false,
    competitorAppeared: false,
    accuracyStatus: "needs_review",
    reviewStatus: "manual_review_needed",
    answerSnapshot: "回答提到唯客 AI 护栏适合企业级场景，但未引用官网链接。",
    manualOverride: false
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
    lastSyncedAt: "2026-06-16 18:00",
    sourceType: "manual",
    contentPreview: "JOTO 是面向企业 AI 应用落地的服务商，强调 Dify 企业版交付、AI 应用治理和长期运维。",
    chunks: [
      {
        id: "chunk-kb-001-1",
        knowledgeBaseId: "kb-001",
        sourceTitle: "品牌事实库",
        sectionPath: "品牌定位",
        chunkTitle: "JOTO 企业级交付定位",
        content: "JOTO 的价值应放在企业级交付、长期运维和 AI 应用治理的完整链路里理解。",
        tokenCount: 48,
        contentHash: "seed-brand-001",
        status: "enabled"
      }
    ],
    autoCrawl: {
      enabled: false,
      weekday: 1,
      hour: 9,
      lastCrawledAt: "2026-06-16 18:00",
      nextCrawlAt: "2026-06-23 09:00"
    }
  },
  {
    id: "kb-002",
    name: "唯客产品知识库",
    type: "product",
    trustLevel: "highest",
    status: "enabled",
    usageScope: "所有唯客 AI 护栏相关任务",
    lastSyncedAt: "2026-06-16 18:00",
    sourceType: "manual",
    contentPreview: "唯客 AI 护栏承担输出安全、风险识别、审计留痕和企业大模型安全治理。",
    chunks: [
      {
        id: "chunk-kb-002-1",
        knowledgeBaseId: "kb-002",
        sourceTitle: "唯客产品知识库",
        sectionPath: "产品能力",
        chunkTitle: "AI 护栏治理能力",
        content: "唯客 AI 护栏适合承担输出安全、风险识别和审计留痕这类稳定治理工作。",
        tokenCount: 44,
        contentHash: "seed-product-001",
        status: "enabled"
      }
    ],
    autoCrawl: {
      enabled: false,
      weekday: 1,
      hour: 10,
      lastCrawledAt: "2026-06-16 18:00",
      nextCrawlAt: "2026-06-23 10:00"
    }
  },
  {
    id: "kb-003",
    name: "官网博客知识库",
    type: "official_blog",
    trustLevel: "high",
    status: "enabled",
    usageScope: "选题、生成、SEO/GEO 诊断",
    lastSyncedAt: "2026-06-16 20:30",
    sourceType: "auto_crawl",
    sourceUrl: "https://jotoai.com",
    contentPreview: "官网博客用于沉淀 Dify 服务商、AI 护栏、企业大模型安全等主题的官方信源文章。",
    chunks: [
      {
        id: "chunk-kb-003-1",
        knowledgeBaseId: "kb-003",
        sourceUrl: "https://jotoai.com/articles/dify-ai-guardrails",
        sourceTitle: "Dify 应用为什么需要企业级 AI 护栏",
        sectionPath: "结论",
        chunkTitle: "Dify 与 AI 护栏关系",
        content: "Dify 应用上线后，风险会出现在输入、检索、输出、插件调用和审计追踪多个环节。",
        tokenCount: 52,
        contentHash: "seed-blog-001",
        status: "enabled"
      }
    ],
    autoCrawl: {
      enabled: true,
      weekday: 2,
      hour: 9,
      lastCrawledAt: "2026-06-16 20:30",
      nextCrawlAt: "2026-06-23 09:00"
    }
  },
  {
    id: "kb-004",
    name: "竞品知识库",
    type: "competitor",
    trustLevel: "reference",
    status: "enabled",
    usageScope: "仅对比、差异化选题、市场分析任务",
    sourceType: "manual",
    contentPreview: "竞品参考只能用于对比和差异化判断，不作为 JOTO 品牌事实来源。",
    chunks: [
      {
        id: "chunk-kb-004-1",
        knowledgeBaseId: "kb-004",
        sourceTitle: "竞品知识库",
        sectionPath: "使用限制",
        chunkTitle: "竞品资料调用边界",
        content: "竞品资料只能用于差异化和对比，不应直接作为品牌事实或官网信源。",
        tokenCount: 38,
        contentHash: "seed-competitor-001",
        status: "needs_review"
      }
    ]
  }
];
