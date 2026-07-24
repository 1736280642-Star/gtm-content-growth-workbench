import type { V5WriteEnvelope } from "./knowledge-governance-service";
import {
  appendV5FoundationAudit,
  createV5FoundationId,
  hashV5FoundationPayload,
  mutateV5FoundationState,
  readV5FoundationSnapshot,
  type V5FoundationState
} from "./foundation-repository";
import {
  assertV5ExpectedVersion,
  assertV5FoundationEnvelope,
  assertV5FoundationText,
  V5FoundationServiceError
} from "./foundation-service";
import type {
  V5MonthlyQuestionLock,
  V5QuestionConflictType,
  V5QuestionDecisionException,
  V5QuestionSignalInput,
  V5QuestionStatus,
  V5QuestionVersion,
  V5QuestionView,
  V5SemanticKeyword
} from "./question-contracts";

export const V5_QUESTION_ALGORITHM_VERSION = "question-normalizer.v1.0.0";
export const V5_QUESTION_BOUNDARY_VERSION = "question-boundary.v1.0.0";
export const V5_KEYWORD_ALGORITHM_VERSION = "semantic-keyword.v1.0.0";
const AVAILABLE_CONFIDENCE = 0.75;
const decisionConflictTypes = new Set<V5QuestionConflictType>(["subject", "relationship", "safety"]);
const questionWriterRoles = ["content_growth", "workbench_operator", "knowledge_manager", "developer_admin"] as const;
const decisionRoles = ["workbench_operator", "knowledge_manager", "developer_admin"] as const;

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/怎么/g, "如何")
    .replace(/怎样/g, "如何")
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’()（）\[\]【】_-]+/g, "")
    .trim();
}

function bigrams(value: string) {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function semanticSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const a = bigrams(left);
  const b = bigrams(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

function currentVersion(state: V5FoundationState, questionId: string) {
  const question = state.questions.find((item) => item.questionId === questionId);
  return question ? state.questionVersions.find((item) => item.questionVersionId === question.currentVersionId) : undefined;
}

function buildQuestionViews(state: V5FoundationState): V5QuestionView[] {
  const keywordById = new Map(state.keywords.map((item) => [item.keywordId, item]));
  return state.questions.flatMap((question) => {
    const version = state.questionVersions.find((item) => item.questionVersionId === question.currentVersionId);
    if (!version) return [];
    return [{
      ...question,
      currentVersion: version,
      keywords: question.keywordIds.flatMap((id) => keywordById.get(id)?.text || []),
      openDecisionCount: state.decisionExceptions.filter((item) => item.questionId === question.questionId && item.status === "open").length
    }];
  });
}

function validateSignal(signal: V5QuestionSignalInput) {
  assertV5FoundationText(signal.text, "问题文本", 300);
  assertV5FoundationText(signal.source, "信号来源", 60);
  assertV5FoundationText(signal.sourceId, "sourceId", 160);
  if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) {
    throw new V5FoundationServiceError("invalid_contract", "confidence 必须在 0 到 1 之间。", 400);
  }
}

function mergeSourceSummary(previous: Record<string, number>, source: string) {
  return { ...previous, [source]: (previous[source] || 0) + 1 };
}

function deriveKeywords(signal: V5QuestionSignalInput) {
  const matched = signal.text.match(/腾讯云\s*ADP\s*服务商|ADP\s*实施(?:交付)?|企业知识(?:管理|检索)|WorkBuddy/gi) || [];
  return Array.from(new Set([...(signal.keywords || []), signal.product || "", ...(signal.entities || []), ...matched]
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 32)));
}

function upsertKeyword(state: V5FoundationState, input: {
  text: string;
  questionId: string;
  entities: string[];
  sourceId: string;
  confidence: number;
  now: string;
}) {
  const normalizedText = normalizeText(input.text);
  let keyword = state.keywords.find((item) => item.normalizedText === normalizedText);
  if (keyword) {
    if (keyword.status !== "excluded") keyword.status = input.confidence >= AVAILABLE_CONFIDENCE ? "effective" : "observing";
    keyword.relatedQuestionIds = Array.from(new Set([...keyword.relatedQuestionIds, input.questionId]));
    keyword.relatedEntities = Array.from(new Set([...keyword.relatedEntities, ...input.entities]));
    keyword.recallScore = Math.max(keyword.recallScore, input.confidence);
    keyword.trace = {
      source: "automatic_signal_ingestion",
      sourceIds: Array.from(new Set([...keyword.trace.sourceIds, input.sourceId])),
      algorithmVersion: V5_KEYWORD_ALGORITHM_VERSION,
      confidence: keyword.recallScore,
      recordedAt: input.now
    };
    keyword.rowVersion += 1;
    keyword.updatedAt = input.now;
    return keyword;
  }
  keyword = {
    keywordId: createV5FoundationId("keyword"),
    text: input.text,
    normalizedText,
    status: input.confidence >= AVAILABLE_CONFIDENCE ? "effective" : "observing",
    relatedQuestionIds: [input.questionId],
    relatedEntities: input.entities,
    recallScore: input.confidence,
    trace: {
      source: "automatic_signal_ingestion",
      sourceIds: [input.sourceId],
      algorithmVersion: V5_KEYWORD_ALGORITHM_VERSION,
      confidence: input.confidence,
      recordedAt: input.now
    },
    rowVersion: 1,
    updatedAt: input.now
  };
  state.keywords.push(keyword);
  return keyword;
}

function createDecisionException(
  state: V5FoundationState,
  input: { questionId: string; versionId: string; conflict: V5QuestionConflictType; signal: V5QuestionSignalInput; now: string }
) {
  if (!decisionConflictTypes.has(input.conflict)) return;
  const existing = state.decisionExceptions.find(
    (item) => item.questionId === input.questionId && item.type === input.conflict && item.status === "open"
  );
  if (existing) return;
  const labels: Record<"subject" | "relationship" | "safety", string> = {
    subject: "主体或产品归属需要确认",
    relationship: "合作关系或公开边界需要确认",
    safety: "敏感或禁止表达无法自动改写"
  };
  const suggestion = input.conflict === "safety"
    ? "改写为不包含夸大、敏感或禁止承诺的中性问题。"
    : "采用明确主体、关系和服务范围的中性问题表述。";
  state.decisionExceptions.push({
    exceptionId: createV5FoundationId("decision"),
    questionId: input.questionId,
    questionVersionId: input.versionId,
    type: input.conflict,
    title: labels[input.conflict],
    explanation: `问题“${input.signal.text}”存在${labels[input.conflict]}。`,
    suggestion,
    status: "open",
    trace: {
      source: input.signal.source,
      sourceIds: [input.signal.sourceId],
      algorithmVersion: V5_QUESTION_BOUNDARY_VERSION,
      confidence: input.signal.confidence,
      recordedAt: input.now
    },
    rowVersion: 1,
    createdAt: input.now
  });
}

function ingestOne(state: V5FoundationState, signal: V5QuestionSignalInput, now: string) {
  validateSignal(signal);
  const normalizedText = normalizeText(signal.text);
  const candidates = state.questions.map((question) => ({ question, version: currentVersion(state, question.questionId) }))
    .filter((item): item is { question: V5FoundationState["questions"][number]; version: V5QuestionVersion } => Boolean(item.version));
  const matched = candidates
    .map((item) => ({ ...item, similarity: semanticSimilarity(normalizedText, item.version.normalizedText) }))
    .filter((item) => item.similarity >= 0.78)
    .sort((left, right) => right.similarity - left.similarity)[0];
  const boundaryConflicts = (signal.conflicts || []).filter((item) => decisionConflictTypes.has(item));
  const nextStatus: V5QuestionStatus = boundaryConflicts.length
    ? "decision_required"
    : signal.confidence >= AVAILABLE_CONFIDENCE ? "available" : "observing";
  let questionId: string;
  let version: V5QuestionVersion;

  if (matched) {
    questionId = matched.question.questionId;
    const semanticChanged = matched.version.normalizedText !== normalizedText
      || matched.version.product !== signal.product
      || matched.version.relationship !== signal.relationship
      || JSON.stringify(matched.version.entities) !== JSON.stringify(signal.entities || matched.version.entities);
    if (semanticChanged) {
      version = {
        questionVersionId: createV5FoundationId("question-version"),
        questionId,
        versionNumber: Math.max(...state.questionVersions.filter((item) => item.questionId === questionId).map((item) => item.versionNumber)) + 1,
        text: signal.text.trim(),
        normalizedText,
        product: signal.product || matched.version.product,
        entities: signal.entities || matched.version.entities,
        relationship: signal.relationship || matched.version.relationship,
        audience: signal.audience || matched.version.audience,
        suggestedArticleTypes: signal.suggestedArticleTypes || matched.version.suggestedArticleTypes,
        sourceSummary: mergeSourceSummary(matched.version.sourceSummary, signal.source),
        trace: { source: signal.source, sourceIds: [signal.sourceId], algorithmVersion: V5_QUESTION_ALGORITHM_VERSION, confidence: signal.confidence, recordedAt: now },
        createdAt: now
      };
      state.questionVersions.push(version);
      matched.question.currentVersionId = version.questionVersionId;
    } else {
      version = matched.version;
      version.sourceSummary = mergeSourceSummary(version.sourceSummary, signal.source);
      version.trace = {
        source: "automatic_signal_ingestion",
        sourceIds: Array.from(new Set([...version.trace.sourceIds, signal.sourceId])),
        algorithmVersion: V5_QUESTION_ALGORITHM_VERSION,
        confidence: Math.max(version.trace.confidence, signal.confidence),
        recordedAt: now
      };
    }
    matched.question.status = nextStatus;
    matched.question.evidenceGap = matched.question.evidenceGap || Boolean(signal.evidenceGap);
    matched.question.confidence = Math.max(matched.question.confidence, signal.confidence);
    matched.question.rowVersion += 1;
    matched.question.updatedAt = now;
  } else {
    questionId = createV5FoundationId("question");
    version = {
      questionVersionId: createV5FoundationId("question-version"),
      questionId,
      versionNumber: 1,
      text: signal.text.trim(),
      normalizedText,
      product: signal.product,
      entities: signal.entities || [],
      relationship: signal.relationship,
      audience: signal.audience,
      suggestedArticleTypes: signal.suggestedArticleTypes || ["问题解答"],
      sourceSummary: { [signal.source]: 1 },
      trace: { source: signal.source, sourceIds: [signal.sourceId], algorithmVersion: V5_QUESTION_ALGORITHM_VERSION, confidence: signal.confidence, recordedAt: now },
      createdAt: now
    };
    state.questionVersions.push(version);
    state.questions.push({
      questionId,
      currentVersionId: version.questionVersionId,
      status: nextStatus,
      keywordIds: [],
      evidenceGap: Boolean(signal.evidenceGap),
      confidence: signal.confidence,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now
    });
  }

  const question = state.questions.find((item) => item.questionId === questionId)!;
  const keywordIds = deriveKeywords(signal).map((text) => upsertKeyword(state, {
    text,
    questionId,
    entities: signal.entities || [],
    sourceId: signal.sourceId,
    confidence: signal.confidence,
    now
  }).keywordId);
  question.keywordIds = Array.from(new Set([...question.keywordIds, ...keywordIds]));
  for (const conflict of boundaryConflicts) createDecisionException(state, { questionId, versionId: version.questionVersionId, conflict, signal, now });
  return questionId;
}

export function listV5Questions() {
  const state = readV5FoundationSnapshot();
  return {
    ok: true as const,
    status: "success" as const,
    data: {
      questions: buildQuestionViews(state),
      keywords: state.keywords,
      decisionExceptions: state.decisionExceptions.filter((item) => item.status === "open"),
      coverage: state.contentCoverage,
      monthlyQuestionLocks: state.monthlyQuestionLocks,
      stateVersion: state.version
    }
  };
}

export function getV5Question(questionId: string) {
  assertV5FoundationText(questionId, "questionId", 160);
  const state = readV5FoundationSnapshot();
  const question = buildQuestionViews(state).find((item) => item.questionId === questionId);
  if (!question) throw new V5FoundationServiceError("not_found", "问题不存在。", 404);
  return { ok: true as const, status: "success" as const, data: { question, stateVersion: state.version } };
}

export function updateV5Question(input: V5WriteEnvelope & {
  questionId: string;
  text: string;
  product?: string;
  entities?: string[];
  relationship?: string;
  audience?: string;
  suggestedArticleTypes?: string[];
  status?: "available" | "observing";
}) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  assertV5FoundationText(input.text, "问题文本", 300);
  const stored = mutateV5FoundationState({
    operation: "correct_question_understanding",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({
      questionId: input.questionId,
      text: input.text,
      product: input.product,
      entities: input.entities,
      relationship: input.relationship,
      audience: input.audience,
      suggestedArticleTypes: input.suggestedArticleTypes,
      status: input.status
    }),
    mutate(state) {
      const question = state.questions.find((item) => item.questionId === input.questionId);
      if (!question) throw new V5FoundationServiceError("not_found", "问题不存在。", 404);
      assertV5ExpectedVersion(question.rowVersion, input.expectedVersion);
      const previous = currentVersion(state, input.questionId)!;
      const now = new Date().toISOString();
      const version: V5QuestionVersion = {
        ...previous,
        questionVersionId: createV5FoundationId("question-version"),
        versionNumber: previous.versionNumber + 1,
        text: input.text.trim(),
        normalizedText: normalizeText(input.text),
        product: input.product ?? previous.product,
        entities: input.entities ?? previous.entities,
        relationship: input.relationship ?? previous.relationship,
        audience: input.audience ?? previous.audience,
        suggestedArticleTypes: input.suggestedArticleTypes ?? previous.suggestedArticleTypes,
        trace: {
          source: "human_correction",
          sourceIds: [input.actor.actorId],
          algorithmVersion: V5_QUESTION_ALGORITHM_VERSION,
          confidence: 1,
          recordedAt: now
        },
        createdAt: now
      };
      state.questionVersions.push(version);
      question.currentVersionId = version.questionVersionId;
      question.status = input.status || "available";
      question.confidence = 1;
      question.rowVersion += 1;
      question.updatedAt = now;
      appendV5FoundationAudit(state, {
        action: "question_understanding_corrected",
        objectType: "QuestionSet",
        objectId: question.questionId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { questionId: question.questionId, questionVersionId: version.questionVersionId };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "updated", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function ingestV5QuestionSignals(input: V5WriteEnvelope & { signals: V5QuestionSignalInput[] }) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  if (!Array.isArray(input.signals) || input.signals.length < 1 || input.signals.length > 100) {
    throw new V5FoundationServiceError("invalid_contract", "signals 必须包含 1-100 条业务信号。", 400);
  }
  const requestHash = hashV5FoundationPayload(input.signals);
  const stored = mutateV5FoundationState({
    operation: "ingest_question_signals",
    idempotencyKey: input.idempotencyKey,
    requestHash,
    mutate(state) {
      assertV5ExpectedVersion(state.version, input.expectedVersion);
      const now = new Date().toISOString();
      const questionIds = input.signals.map((signal) => ingestOne(state, signal, now));
      appendV5FoundationAudit(state, {
        action: "question_signals_ingested",
        objectType: "QuestionSet",
        objectId: questionIds.join(","),
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { questionIds };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "updated", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function selectV5MonthlyQuestions(input: V5WriteEnvelope & { month: string; questionIds: string[] }) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw new V5FoundationServiceError("invalid_contract", "月份格式必须为 YYYY-MM。", 400);
  }
  if (!Array.isArray(input.questionIds) || input.questionIds.length < 1) {
    throw new V5FoundationServiceError("invalid_contract", "至少选择一个目标问题。", 400);
  }
  const stored = mutateV5FoundationState({
    operation: "lock_monthly_question_versions",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ month: input.month, questionIds: [...input.questionIds].sort() }),
    mutate(state) {
      assertV5ExpectedVersion(state.version, input.expectedVersion);
      const locks: V5MonthlyQuestionLock[] = [];
      const now = new Date().toISOString();
      for (const questionId of input.questionIds) {
        const question = state.questions.find((item) => item.questionId === questionId);
        if (!question) throw new V5FoundationServiceError("not_found", "选择的问题不存在。", 404);
        if (question.status === "decision_required") {
          throw new V5FoundationServiceError("decision_required", "待决策问题不能进入月度计划。", 409, "先解决主体、关系或安全边界冲突。", { questionId });
        }
        const existing = state.monthlyQuestionLocks.find((item) => item.month === input.month && item.questionId === questionId);
        if (existing) {
          locks.push(existing);
          continue;
        }
        const lock = {
          lockId: createV5FoundationId("monthly-question-lock"),
          month: input.month,
          questionId,
          questionVersionId: question.currentVersionId,
          lockedAt: now,
          lockedBy: input.actor.actorId
        };
        state.monthlyQuestionLocks.push(lock);
        locks.push(lock);
      }
      appendV5FoundationAudit(state, {
        action: "monthly_question_versions_locked",
        objectType: "MonthlyPlanQuestion",
        objectId: input.month,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { locks };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "locked", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function resolveV5QuestionDecisions(input: V5WriteEnvelope & {
  resolutions: Array<{ exceptionId: string; action: "adopt_suggestion" | "correct" | "ignore"; correctedText?: string; expectedVersion?: number }>;
}) {
  assertV5FoundationEnvelope(input, [...decisionRoles]);
  if (!input.resolutions.length) throw new V5FoundationServiceError("invalid_contract", "至少选择一条待决策事项。", 400);
  const stored = mutateV5FoundationState({
    operation: "resolve_question_decisions",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload(input.resolutions),
    mutate(state) {
      const now = new Date().toISOString();
      for (const resolution of input.resolutions) {
        const exception = state.decisionExceptions.find((item) => item.exceptionId === resolution.exceptionId);
        if (!exception) throw new V5FoundationServiceError("not_found", "待决策事项不存在。", 404);
        assertV5ExpectedVersion(exception.rowVersion, resolution.expectedVersion ?? input.expectedVersion);
        if (exception.status !== "open") continue;
        const question = state.questions.find((item) => item.questionId === exception.questionId)!;
        const previous = currentVersion(state, question.questionId)!;
        if (resolution.action !== "ignore") {
          const nextText = resolution.action === "correct" ? resolution.correctedText : exception.suggestion;
          assertV5FoundationText(nextText, "纠正后的问题文本", 300);
          const nextVersion: V5QuestionVersion = {
            ...previous,
            questionVersionId: createV5FoundationId("question-version"),
            versionNumber: previous.versionNumber + 1,
            text: nextText!.trim(),
            normalizedText: normalizeText(nextText!),
            trace: { source: "human_decision", sourceIds: [exception.exceptionId], algorithmVersion: V5_QUESTION_BOUNDARY_VERSION, confidence: 1, recordedAt: now },
            createdAt: now
          };
          state.questionVersions.push(nextVersion);
          question.currentVersionId = nextVersion.questionVersionId;
          question.status = "available";
          question.rowVersion += 1;
          question.updatedAt = now;
        } else {
          question.status = "observing";
          question.rowVersion += 1;
          question.updatedAt = now;
        }
        exception.status = resolution.action === "adopt_suggestion" ? "resolved_by_suggestion" : resolution.action === "correct" ? "corrected" : "ignored";
        exception.resolutionReason = input.actor.auditReason;
        exception.resolvedAt = now;
        exception.rowVersion += 1;
      }
      appendV5FoundationAudit(state, {
        action: "question_decisions_resolved",
        objectType: "QuestionDecisionException",
        objectId: input.resolutions.map((item) => item.exceptionId).join(","),
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { resolvedCount: input.resolutions.length };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "resolved", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function excludeV5Keyword(input: V5WriteEnvelope & { keywordId: string; reason: string }) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  assertV5FoundationText(input.reason, "排除原因", 200);
  const stored = mutateV5FoundationState({
    operation: "exclude_semantic_keyword",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ keywordId: input.keywordId, reason: input.reason }),
    mutate(state) {
      const keyword = state.keywords.find((item) => item.keywordId === input.keywordId);
      if (!keyword) throw new V5FoundationServiceError("not_found", "关键词不存在。", 404);
      assertV5ExpectedVersion(keyword.rowVersion, input.expectedVersion);
      keyword.status = "excluded";
      keyword.exclusionReason = input.reason.trim();
      keyword.excludedAt = new Date().toISOString();
      keyword.updatedAt = keyword.excludedAt;
      keyword.rowVersion += 1;
      appendV5FoundationAudit(state, {
        action: "semantic_keyword_excluded",
        objectType: "SemanticKeyword",
        objectId: keyword.keywordId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { keyword };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "excluded", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function correctV5KeywordLink(input: V5WriteEnvelope & { keywordId: string; questionIds: string[]; reason: string }) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  assertV5FoundationText(input.reason, "纠正原因", 200);
  const stored = mutateV5FoundationState({
    operation: "correct_semantic_keyword_link",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ keywordId: input.keywordId, questionIds: [...input.questionIds].sort(), reason: input.reason }),
    mutate(state) {
      const keyword = state.keywords.find((item) => item.keywordId === input.keywordId);
      if (!keyword) throw new V5FoundationServiceError("not_found", "关键词不存在。", 404);
      assertV5ExpectedVersion(keyword.rowVersion, input.expectedVersion);
      if (input.questionIds.some((id) => !state.questions.some((item) => item.questionId === id))) {
        throw new V5FoundationServiceError("invalid_contract", "关联问题包含不存在的记录。", 400);
      }
      keyword.relatedQuestionIds = Array.from(new Set(input.questionIds));
      keyword.rowVersion += 1;
      keyword.updatedAt = new Date().toISOString();
      for (const question of state.questions) {
        question.keywordIds = input.questionIds.includes(question.questionId)
          ? Array.from(new Set([...question.keywordIds, keyword.keywordId]))
          : question.keywordIds.filter((id) => id !== keyword.keywordId);
      }
      appendV5FoundationAudit(state, {
        action: "semantic_keyword_link_corrected",
        objectType: "SemanticKeyword",
        objectId: keyword.keywordId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { keyword };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "corrected", data: { ...stored.data, stateVersion: stored.stateVersion } };
}

export function restoreV5Keyword(input: V5WriteEnvelope & { keywordId: string; reason: string }) {
  assertV5FoundationEnvelope(input, [...questionWriterRoles]);
  assertV5FoundationText(input.reason, "恢复原因", 200);
  const stored = mutateV5FoundationState({
    operation: "restore_semantic_keyword",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashV5FoundationPayload({ keywordId: input.keywordId, reason: input.reason }),
    mutate(state) {
      const keyword = state.keywords.find((item) => item.keywordId === input.keywordId);
      if (!keyword) throw new V5FoundationServiceError("not_found", "关键词不存在。", 404);
      assertV5ExpectedVersion(keyword.rowVersion, input.expectedVersion);
      keyword.status = keyword.recallScore >= AVAILABLE_CONFIDENCE ? "effective" : "observing";
      keyword.exclusionReason = undefined;
      keyword.excludedAt = undefined;
      keyword.rowVersion += 1;
      keyword.updatedAt = new Date().toISOString();
      appendV5FoundationAudit(state, {
        action: "semantic_keyword_restored",
        objectType: "SemanticKeyword",
        objectId: keyword.keywordId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        actorType: input.actor.actorType,
        reason: input.actor.auditReason
      });
      return { keyword };
    }
  });
  return { ok: true as const, status: stored.replayed ? "replayed" : "restored", data: { ...stored.data, stateVersion: stored.stateVersion } };
}
