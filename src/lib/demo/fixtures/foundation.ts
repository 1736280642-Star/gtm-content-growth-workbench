import type {
  V5ArticleExpressionProfile,
  V5ArticleExpressionProfileVersion
} from "../../v5/article-expression-contracts";
import type {
  V5KnowledgeBaseWorkspace,
  V5KnowledgeMaterialView,
  V5KnowledgeUnderstandingItem
} from "../../v5/knowledge-workspace-contracts";
import type {
  V5QuestionSet,
  V5QuestionVersion,
  V5SemanticKeyword
} from "../../v5/question-contracts";
import type { V5FoundationState } from "../../v5/foundation-repository";
import { DEMO_MONTH } from "../config";

const now = `${DEMO_MONTH}-01T08:00:00.000Z`;

function knowledgeBases(): V5KnowledgeBaseWorkspace[] {
  return [
    {
      knowledgeBaseId: "kb-workbuddy-001",
      name: "WorkBuddy 产品知识库",
      focus: "智能工作台能力、长期交付与治理",
      defaultVisibility: "conditional_public",
      productionStatus: "ready",
      dataSource: "imported",
      sourceSnapshotHash: "src-kb-workbuddy-001",
      sourceSnapshotVersion: 3,
      materialCount: 14,
      openActionCount: 0,
      productionBlockingActionCount: 0,
      rowVersion: 3,
      createdAt: now,
      updatedAt: now
    },
    {
      knowledgeBaseId: "kb-adp-001",
      name: "腾讯云 ADP 知识库",
      focus: "智能体开发平台、企业落地实践",
      defaultVisibility: "conditional_public",
      productionStatus: "ready",
      dataSource: "imported",
      sourceSnapshotHash: "src-kb-adp-001",
      sourceSnapshotVersion: 2,
      materialCount: 11,
      openActionCount: 1,
      productionBlockingActionCount: 0,
      rowVersion: 2,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function materials(): V5KnowledgeMaterialView[] {
  return [
    {
      materialId: "mat-001",
      knowledgeBaseId: "kb-workbuddy-001",
      title: "WorkBuddy 智能工作台产品手册",
      kind: "document",
      status: "ready",
      contentHash: "hash-mat-001",
      importedAt: now,
      updatedAt: now
    },
    {
      materialId: "mat-002",
      knowledgeBaseId: "kb-adp-001",
      title: "腾讯云 ADP 官方能力介绍",
      kind: "url",
      status: "ready",
      canonicalUrl: "https://cloud.tencent.com/product/adp",
      contentHash: "hash-mat-002",
      importedAt: now,
      updatedAt: now
    }
  ];
}

function understanding(): V5KnowledgeUnderstandingItem[] {
  return [
    {
      understandingId: "und-001",
      summary: "WorkBuddy 强调企业级交付、长期运维与治理闭环，而非单点工具能力。",
      evidenceExcerpt: "WorkBuddy 的价值应放在企业级交付与长期治理的完整链路里理解。",
      materialId: "mat-001",
      materialTitle: "WorkBuddy 智能工作台产品手册",
      sourceOwner: "JOTO",
      visibility: "conditional_public",
      trace: { source: "material_parse", sourceIds: ["mat-001"], algorithmVersion: "v1", confidence: 0.96, recordedAt: now }
    },
    {
      understandingId: "und-002",
      summary: "腾讯云 ADP 提供智能体开发、编排与企业级可观测性能力。",
      evidenceExcerpt: "ADP 覆盖智能体开发、工作流编排与可观测性。",
      materialId: "mat-002",
      materialTitle: "腾讯云 ADP 官方能力介绍",
      sourceOwner: "腾讯云",
      visibility: "public",
      trace: { source: "url_parse", sourceIds: ["mat-002"], algorithmVersion: "v1", confidence: 0.94, recordedAt: now }
    }
  ];
}

function questions(): V5QuestionSet[] {
  return [
    {
      questionId: "q-001",
      currentVersionId: "qv-001",
      status: "available",
      keywordIds: ["kw-001"],
      evidenceGap: false,
      knowledgeReadiness: { hasProductExpressionRulePackage: true, hasFactSourceMapping: true },
      conflictAssessment: { hasConflict: false, categories: [], conflictingQuestionIds: [] },
      rowVersion: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      questionId: "q-002",
      currentVersionId: "qv-002",
      status: "available",
      keywordIds: ["kw-002"],
      evidenceGap: false,
      knowledgeReadiness: { hasProductExpressionRulePackage: true, hasFactSourceMapping: true },
      conflictAssessment: { hasConflict: false, categories: [], conflictingQuestionIds: [] },
      rowVersion: 1,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function questionVersions(): V5QuestionVersion[] {
  return [
    {
      questionVersionId: "qv-001",
      questionId: "q-001",
      versionNumber: 1,
      text: "企业做智能工作台时如何评估长期交付与治理能力？",
      normalizedText: "企业做智能工作台时如何评估长期交付与治理能力",
      product: "WorkBuddy",
      entities: ["WorkBuddy", "智能工作台"],
      suggestedArticleTypes: ["技术实践型"],
      sourceSummary: { geo_research: 6, site_search: 4 },
      trace: { source: "geo_research", sourceIds: ["run-001"], algorithmVersion: "v1", confidence: 0.92, recordedAt: now },
      createdAt: now
    },
    {
      questionVersionId: "qv-002",
      questionId: "q-002",
      versionNumber: 1,
      text: "腾讯云 ADP 智能体开发平台在企业落地时有哪些关键实践？",
      normalizedText: "腾讯云 adp 智能体开发平台在企业落地时有哪些关键实践",
      product: "腾讯云 ADP",
      entities: ["腾讯云 ADP", "智能体开发平台"],
      suggestedArticleTypes: ["避坑指南型"],
      sourceSummary: { geo_research: 8, sales_question: 3 },
      trace: { source: "geo_research", sourceIds: ["run-002"], algorithmVersion: "v1", confidence: 0.9, recordedAt: now },
      createdAt: now
    }
  ];
}

function keywords(): V5SemanticKeyword[] {
  return [
    {
      keywordId: "kw-001",
      text: "WorkBuddy 智能工作台",
      normalizedText: "workbuddy 智能工作台",
      status: "effective",
      relatedQuestionIds: ["q-001"],
      relatedEntities: ["WorkBuddy"],
      recallScore: 0.91,
      trace: { source: "keyword_extraction", sourceIds: ["qv-001"], algorithmVersion: "v1", confidence: 0.93, recordedAt: now },
      rowVersion: 1,
      updatedAt: now
    },
    {
      keywordId: "kw-002",
      text: "腾讯云 ADP 智能体开发平台",
      normalizedText: "腾讯云 adp 智能体开发平台",
      status: "effective",
      relatedQuestionIds: ["q-002"],
      relatedEntities: ["腾讯云 ADP"],
      recallScore: 0.89,
      trace: { source: "keyword_extraction", sourceIds: ["qv-002"], algorithmVersion: "v1", confidence: 0.9, recordedAt: now },
      rowVersion: 1,
      updatedAt: now
    }
  ];
}

function articleExpressionProfiles(): V5ArticleExpressionProfile[] {
  return [
    {
      profileId: "aep-001",
      name: "WorkBuddy 品牌表达",
      applicableArticleTypes: ["技术实践型"],
      applicableChannels: ["wechat", "csdn", "juejin", "zhihu"],
      currentVersionId: "aepv-001",
      defaultProfile: true,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function articleExpressionProfileVersions(): V5ArticleExpressionProfileVersion[] {
  return [
    {
      profileVersionId: "aepv-001",
      profileId: "aep-001",
      versionNumber: 1,
      status: "active",
      targetAudience: "企业 IT 决策者与工程负责人",
      writingFocus: "围绕企业级交付、长期治理与可归因增长展开",
      structureModules: [
        { moduleId: "m1", label: "背景与选型问题", guidance: "先点出真实选型痛点", required: true },
        { moduleId: "m2", label: "能力拆解", guidance: "按工程实践拆解能力", required: true }
      ],
      forbiddenStyles: ["过度营销", "无证据承诺"],
      minLength: 1200,
      maxLength: 2600,
      cta: "了解 WorkBuddy 的企业级交付方案",
      systemRuleFallbackFields: ["structure", "cta"],
      systemRuleVersion: "v1",
      evidenceWarning: false,
      createdAt: now,
      createdBy: "demo@joto.ai"
    }
  ];
}

export const demoFoundationSeed: V5FoundationState = {
  schemaVersion: 1,
  version: 1,
  questions: questions(),
  questionVersions: questionVersions(),
  keywords: keywords(),
  decisionExceptions: [],
  monthlyQuestionLocks: [],
  contentCoverage: [],
  knowledgeBases: knowledgeBases(),
  knowledgeMaterials: materials(),
  knowledgeUnderstanding: understanding(),
  knowledgeActionItems: [],
  knowledgeCollectionSources: [],
  knowledgeCollectionRuns: [],
  knowledgeCollectionSnapshots: [],
  articleExpressionProfiles: articleExpressionProfiles(),
  articleExpressionProfileVersions: articleExpressionProfileVersions(),
  audits: [],
  idempotency: []
};
