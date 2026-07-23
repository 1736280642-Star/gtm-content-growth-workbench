import { callAiProvider, type AiProviderKey } from "@/lib/ai-provider";
import type {
  ArticleTypeFitLevel,
  ArticleTypeProfileDraftInput,
  ArticleTypeProfileVersion,
  ArticleTypeSupplementSuggestion,
  QuestionTypeSuggestion
} from "./article-type-contracts";

const PROMPT_VERSION = "v5-article-type-semantic-v1";

export interface ArticleTypeSemanticProviderResult<T> {
  status: "success" | "partial" | "pending_config" | "failed";
  provider?: string;
  model?: string;
  data?: T;
  message: string;
}

export interface ArticleTypeSemanticProvider {
  supplementProfile(input: {
    profile: ArticleTypeProfileDraftInput;
    activeProfiles: ArticleTypeProfileVersion[];
  }): Promise<ArticleTypeSemanticProviderResult<{
    suggestions: ArticleTypeSupplementSuggestion[];
    overlaps: Array<{ profileVersionId: string; name: string; reason: string }>;
    missingInformation: string[];
  }>>;
  matchQuestions(input: {
    questions: Array<{ questionVersionId: string; question: string; productId?: string }>;
    activeProfiles: ArticleTypeProfileVersion[];
  }): Promise<ArticleTypeSemanticProviderResult<{ suggestions: Omit<QuestionTypeSuggestion, "suggestionId" | "selectionStatus" | "selectionSource">[] }>>;
}

export { PROMPT_VERSION as ARTICLE_TYPE_PROMPT_VERSION };

function resolveProvider(): AiProviderKey {
  const value = process.env.ARTICLE_TYPE_AI_PROVIDER?.trim().toLowerCase();
  return value === "deepseek" || value === "doubao" ? value : "qwen";
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  if (!candidate.trim()) throw new Error("模型未返回 JSON 对象。");
  return JSON.parse(candidate) as Record<string, unknown>;
}

function toStringArray(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit);
}

function providerFailure<T>(result: Awaited<ReturnType<typeof callAiProvider>>): ArticleTypeSemanticProviderResult<T> {
  if (result.status === "pending_config") {
    return {
      status: "pending_config",
      provider: result.provider,
      message: "AI Provider 尚未配置。你可以继续手动填写，或由管理员完成模型配置后重试。"
    };
  }
  return {
    status: "failed",
    provider: result.provider,
    model: result.model,
    message: result.errorMessage || "AI 补充失败，请保留当前输入并重试。"
  };
}

function buildSupplementPrompt(profile: ArticleTypeProfileDraftInput, activeProfiles: ArticleTypeProfileVersion[]) {
  return JSON.stringify({
    task: "基于用户预填内容补充内容类型配置。不得覆盖用户字段，不得补造产品能力、案例、数据、价格、承诺或证据。",
    promptVersion: PROMPT_VERSION,
    profile,
    existingTypes: activeProfiles.map((item) => ({ id: item.profileVersionId, name: item.name, semanticDescription: item.semanticDescription })),
    output: {
      suggestions: [{ field: "targetAudience", value: ["示例"], reason: "为什么建议" }],
      overlaps: [{ profileVersionId: "id", name: "名称", reason: "潜在重叠原因" }],
      missingInformation: ["仍需用户补充的信息"]
    }
  });
}

function normalizeSupplementPayload(value: Record<string, unknown>): {
  suggestions: ArticleTypeSupplementSuggestion[];
  overlaps: Array<{ profileVersionId: string; name: string; reason: string }>;
  missingInformation: string[];
} {
  const allowedFields = new Set([
    "semanticDescription", "suitableQuestionDescription", "unsuitableQuestionDescription", "targetAudience", "contentGoal",
    "structureModules", "requiredSections", "cta", "lengthRange", "styleTraits", "caseUsage", "evidencePreferences", "channelHints", "exampleQuestions"
  ]);
  const suggestions = (Array.isArray(value.suggestions) ? value.suggestions : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const field = String(record.field || "");
    if (!allowedFields.has(field) || !record.value) return [];
    const normalizedValue = Array.isArray(record.value)
      ? toStringArray(record.value)
      : typeof record.value === "object"
        ? record.value as { min: number; max: number; unit: "字" }
        : String(record.value).trim();
    return [{ field: field as ArticleTypeSupplementSuggestion["field"], value: normalizedValue, reason: String(record.reason || "AI 补充建议"), source: "ai_suggested" as const }];
  }).slice(0, 16);
  const overlaps = (Array.isArray(value.overlaps) ? value.overlaps : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (!record.profileVersionId || !record.name) return [];
    return [{ profileVersionId: String(record.profileVersionId), name: String(record.name), reason: String(record.reason || "语义可能重叠") }];
  }).slice(0, 5);
  return { suggestions, overlaps, missingInformation: toStringArray(value.missingInformation, 8) };
}

function buildMatchPrompt(
  questions: Array<{ questionVersionId: string; question: string; productId?: string }>,
  activeProfiles: ArticleTypeProfileVersion[]
) {
  return JSON.stringify({
    task: "为每个目标问题推荐多个适合共同覆盖的内容类型。不要使用关键词映射，不要进行生产准入或证据审批。每个问题最多 5 个候选。",
    promptVersion: PROMPT_VERSION,
    questions,
    contentTypes: activeProfiles.map((item) => ({
      profileVersionId: item.profileVersionId,
      name: item.name,
      semanticDescription: item.semanticDescription,
      suitableQuestionDescription: item.suitableQuestionDescription,
      targetAudience: item.targetAudience,
      contentGoal: item.contentGoal,
      structureModules: item.structureModules
    })),
    output: {
      suggestions: [{
        questionVersionId: "问题版本", question: "问题", articleTypeProfileVersionId: "类型版本", articleTypeName: "类型名称",
        fitLevel: "high|medium|possible", semanticScore: 0.9, reason: "推荐理由", matchedFacets: ["问题要素"],
        missingInformation: ["缺少信息"], conflictProfileVersionIds: []
      }]
    }
  });
}

function normalizeMatchPayload(
  value: Record<string, unknown>,
  questions: Array<{ questionVersionId: string; question: string }>,
  profiles: ArticleTypeProfileVersion[]
): Array<Omit<QuestionTypeSuggestion, "suggestionId" | "selectionStatus" | "selectionSource">> {
  const questionById = new Map(questions.map((item) => [item.questionVersionId, item]));
  const profileById = new Map(profiles.map((item) => [item.profileVersionId, item]));
  const perQuestionCount = new Map<string, number>();
  return (Array.isArray(value.suggestions) ? value.suggestions : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const question = questionById.get(String(record.questionVersionId || ""));
    const profile = profileById.get(String(record.articleTypeProfileVersionId || ""));
    if (!question || !profile) return [];
    const count = perQuestionCount.get(question.questionVersionId) || 0;
    if (count >= 5) return [];
    perQuestionCount.set(question.questionVersionId, count + 1);
    const score = Math.max(0, Math.min(1, Number(record.semanticScore || 0)));
    const fitLevel: ArticleTypeFitLevel = record.fitLevel === "high" || record.fitLevel === "medium" ? record.fitLevel : "possible";
    return [{
      questionVersionId: question.questionVersionId,
      question: question.question,
      articleTypeProfileVersionId: profile.profileVersionId,
      articleTypeName: profile.name,
      fitLevel,
      semanticScore: score,
      reason: String(record.reason || "AI 根据问题目标与内容类型语义给出建议。"),
      matchedFacets: toStringArray(record.matchedFacets, 8),
      missingInformation: toStringArray(record.missingInformation, 8),
      conflictProfileVersionIds: toStringArray(record.conflictProfileVersionIds, 5)
    }];
  });
}

export function createArticleTypeSemanticProvider(): ArticleTypeSemanticProvider {
  return {
    async supplementProfile({ profile, activeProfiles }) {
      const provider = resolveProvider();
      const result = await callAiProvider({
        provider,
        temperature: 0.2,
        systemPrompt: "你是内容类型配置助手。只返回严格 JSON；保留用户定义权，不编造事实。",
        userPrompt: buildSupplementPrompt(profile, activeProfiles)
      });
      if (!result.ok || !result.content) return providerFailure(result);
      try {
        return { status: "success", provider, model: result.model, data: normalizeSupplementPayload(parseJsonObject(result.content)), message: "已补充内容，请确认后发布。" };
      } catch (error) {
        return { status: "failed", provider, model: result.model, message: `AI 返回格式不正确：${error instanceof Error ? error.message : "请重试"}` };
      }
    },

    async matchQuestions({ questions, activeProfiles }) {
      const provider = resolveProvider();
      const result = await callAiProvider({
        provider,
        temperature: 0.1,
        systemPrompt: "你是内容策略语义匹配服务。只返回严格 JSON；语义匹配与 Evidence Gate 相互独立。",
        userPrompt: buildMatchPrompt(questions, activeProfiles)
      });
      if (!result.ok || !result.content) return providerFailure(result);
      try {
        return { status: "success", provider, model: result.model, data: { suggestions: normalizeMatchPayload(parseJsonObject(result.content), questions, activeProfiles) }, message: "内容类型组合建议已生成，请人工确认。" };
      } catch (error) {
        return { status: "failed", provider, model: result.model, message: `AI 匹配结果格式不正确：${error instanceof Error ? error.message : "请重试"}` };
      }
    }
  };
}
