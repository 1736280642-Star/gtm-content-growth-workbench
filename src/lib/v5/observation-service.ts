import { randomUUID } from "node:crypto";
import type {
  CaptureComparison,
  CaptureConditionDifference,
  CaptureEnvironmentStatus,
  CaptureFailureDetail,
  CapturedAnswer,
  CreateCaptureTasksRequest,
  CreateComparisonRequest,
  FrontendCaptureArtifactManifest,
  FrontendCaptureTask,
  FrontendCaptureTaskStatus,
  FrontendCaptureWorkspace,
  ObservationGap,
  ObservationGapCode,
  ObservationGapDestination,
  ObservationReview,
  ReviewObservationRequest,
  V5MutationActor,
  V5MutationContext
} from "./observation-contracts";
import {
  appendObservationAudit,
  getIdempotentResponse,
  hashObservationPayload,
  persistImmutableCaptureArtifact,
  readV5ObservationState,
  setIdempotentResponse,
  updateV5ObservationState
} from "./observation-repository";
import { readObservationReferenceSnapshot } from "./observation-reference-adapter";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SUPPORTED_PLATFORMS = new Set(["chatgpt"]);
const HUMAN_WRITE_ROLES = new Set(["content_growth", "workbench_operator", "knowledge_manager", "developer_admin"]);
const TRANSIENT_TASK_STATES = new Set<FrontendCaptureTaskStatus>([
  "draft",
  "environment_checking",
  "queued",
  "waiting_for_browser",
  "submitting_prompt",
  "streaming",
  "stabilizing",
  "capturing"
]);

export const OBSERVATION_GAP_DEFINITIONS: Record<
  ObservationGapCode,
  { title: string; question: string; destinations: ObservationGapDestination[] }
> = {
  answer_coverage_gap: {
    title: "重要内容未覆盖",
    question: "AI 回答是否缺少用户需要且已有证据支持的重要内容？",
    destinations: ["blog_candidate"]
  },
  citation_gap: {
    title: "缺少自有引用",
    question: "回答提到主体或能力，但是否缺少官方或自有页面引用？",
    destinations: ["blog_candidate", "site_audit"]
  },
  evidence_gap: {
    title: "公开证据不足",
    question: "希望表达的能力是否缺少公开 Source 或已验证 Claim？",
    destinations: ["knowledge_issue"]
  },
  relationship_gap: {
    title: "关系证据不足",
    question: "合作、实施或归属关系是否缺少清晰证据？",
    destinations: ["knowledge_issue"]
  },
  freshness_gap: {
    title: "证据版本待确认",
    question: "引用或知识证据是否过期或版本不一致？",
    destinations: ["knowledge_issue"]
  },
  entity_gap: {
    title: "目标主体未覆盖",
    question: "目标主体是否未进入回答或被错误归属？",
    destinations: ["blog_candidate"]
  },
  observation_uncertain: {
    title: "观察结果不确定",
    question: "页面结构、回答解析或证据映射是否不够可靠？",
    destinations: ["manual_review"]
  }
};

export class ObservationServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[],
    public readonly recoveryAction?: string
  ) {
    super(message);
    this.name = "ObservationServiceError";
  }
}

function assertText(value: unknown, label: string, maxLength = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ObservationServiceError(400, "MISSING_FIELD", `请填写${label}。`);
  if (text.length > maxLength) throw new ObservationServiceError(422, "FIELD_TOO_LONG", `${label}不能超过 ${maxLength} 个字符。`);
  return text;
}

export function assertObservationMutationContext(input: V5MutationContext, runnerAllowed = false) {
  const actor = input?.actor;
  if (!actor || !assertActorRole(actor, runnerAllowed)) {
    throw new ObservationServiceError(403, "MUTATION_FORBIDDEN", "当前角色无权执行此操作，请切换到内容增长、工作台运营或开发管理员。");
  }
  assertText(actor.actorId, "操作人", 120);
  assertText(input.reason, "操作原因", 500);
  const idempotencyKey = assertText(input.idempotencyKey, "幂等键", 200);
  if (idempotencyKey.length < 8) throw new ObservationServiceError(400, "INVALID_IDEMPOTENCY_KEY", "幂等键至少需要 8 个字符。");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new ObservationServiceError(400, "INVALID_EXPECTED_VERSION", "expectedVersion 必须是大于等于 0 的整数。");
  }
}

function assertActorRole(actor: V5MutationActor, runnerAllowed: boolean) {
  if (runnerAllowed && actor.actorRole === "capture_runner" && actor.actorType === "runner") return true;
  return actor.actorType === "human" && HUMAN_WRITE_ROLES.has(actor.actorRole);
}

function hasSensitiveKeys(value: unknown, path: string[] = []): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => hasSensitiveKeys(item, [...path, String(index)]));
  const forbidden = /^(?:cookies?|cookieheaders?|passwords?|passwd|authorization|localstorage|sessionstorage|autofill|requestheaders?|(?:access|refresh|auth|oauth|api|bearer|id|csrf|private|secret|session)?tokens?)$/;
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    forbidden.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
      ? [[...path, key].join(".")]
      : hasSensitiveKeys(item, [...path, key])
  );
}

function splitStatements(answerText: string) {
  let cursor = 0;
  return answerText
    .split(/(?<=[。！？!?])\s*/)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((text) => {
      const startOffset = answerText.indexOf(text, cursor);
      cursor = Math.max(startOffset + text.length, cursor);
      return {
        id: `statement-${randomUUID()}`,
        text,
        startOffset: Math.max(0, startOffset),
        endOffset: Math.max(0, startOffset) + text.length,
        citationIds: []
      };
    });
}

function buildStatusHistory(task: FrontendCaptureTask, status: FrontendCaptureTaskStatus, note: string) {
  const now = new Date().toISOString();
  return { ...task, status, updatedAt: now, statusHistory: [...task.statusHistory, { status, at: now, note }] };
}

async function fetchRunnerStatus(): Promise<Partial<CaptureEnvironmentStatus> | undefined> {
  const endpoint = process.env.V5_CAPTURE_RUNNER_URL?.trim() || "http://127.0.0.1:17321";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${endpoint}/status`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return undefined;
    return (await response.json()) as Partial<CaptureEnvironmentStatus>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCaptureEnvironmentStatus(): Promise<CaptureEnvironmentStatus> {
  const endpoint = process.env.V5_CAPTURE_RUNNER_URL?.trim() || "http://127.0.0.1:17321";
  const runner = await fetchRunnerStatus();
  if (runner?.runner?.status === "ready") {
    return {
      checkedAt: new Date().toISOString(),
      source: "local_runner",
      extension: runner.extension || {
        status: "disconnected",
        privacy: { cookieUpload: false, passwordUpload: false, tokenUpload: false, taskPageOnly: true }
      },
      runner: {
        status: "ready",
        endpoint,
        queueDepth: runner.runner.queueDepth || 0,
        recoveryAction: runner.runner.recoveryAction || "无需处理"
      },
      adapters: runner.adapters || [
        { platform: "chatgpt", status: "pending_config", message: "浏览器伴侣尚未上报适配器状态。", recoveryAction: "打开 ChatGPT 页面并刷新浏览器伴侣状态。" }
      ]
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    source: "pending_config",
    extension: {
      status: "pending_config",
      privacy: { cookieUpload: false, passwordUpload: false, tokenUpload: false, taskPageOnly: true }
    },
    runner: {
      status: "offline",
      endpoint,
      queueDepth: 0,
      recoveryAction: "运行 npm.cmd run capture-runner:start，再刷新采集环境。"
    },
    adapters: [
      { platform: "chatgpt", status: "pending_config", message: "等待 Runner 与浏览器伴侣连接。", recoveryAction: "启动 Runner 并加载 Chrome 浏览器伴侣。" },
      { platform: "yuanbao", status: "unsupported", message: "当前版本尚未支持元宝适配器。", recoveryAction: "等待适配器通过可靠性验证。" },
      { platform: "doubao", status: "unsupported", message: "当前版本尚未支持豆包适配器。", recoveryAction: "等待适配器通过可靠性验证。" },
      { platform: "kimi", status: "unsupported", message: "当前版本尚未支持 Kimi 适配器。", recoveryAction: "等待适配器通过可靠性验证。" }
    ]
  };
}

export async function getFrontendCaptureWorkspace(): Promise<FrontendCaptureWorkspace> {
  const [state, reference, environment] = await Promise.all([
    readV5ObservationState(),
    readObservationReferenceSnapshot(),
    getCaptureEnvironmentStatus()
  ]);
  const tasks = Object.values(state.tasks).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const answers = Object.values(state.answers).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    source: tasks.length || answers.length ? "persisted" : "empty",
    reference,
    tasks,
    artifacts: Object.values(state.artifacts),
    answers,
    gaps: Object.values(state.gaps),
    reviews: Object.values(state.reviews),
    comparisons: Object.values(state.comparisons).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    environment
  };
}

export async function createCaptureTasks(input: CreateCaptureTasksRequest): Promise<FrontendCaptureTask[]> {
  assertObservationMutationContext(input);
  if (input.executionMode !== "immediate_once") {
    throw new ObservationServiceError(422, "SCHEDULED_CAPTURE_NOT_ALLOWED", "P0 只允许立即执行一次，不支持周期或固定日期采集计划。");
  }
  if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
    throw new ObservationServiceError(422, "PLATFORM_REQUIRED", "请至少选择一个已支持的 AI 平台。");
  }
  const platforms = Array.from(new Set(input.platforms));
  const unsupported = platforms.filter((platform) => !SUPPORTED_PLATFORMS.has(platform));
  if (unsupported.length) {
    throw new ObservationServiceError(422, "ADAPTER_UNSUPPORTED", `${unsupported.join("、")} 适配器尚未达到可靠性标准。`, undefined, "请选择 ChatGPT，或等待对应适配器完成验证。");
  }
  if (input.condition?.conversationMode !== "new_conversation" || input.condition?.personalizationMode !== "off") {
    throw new ObservationServiceError(422, "UNCONTROLLED_CAPTURE_CONDITION", "P0 仅支持新会话且关闭个性化的可比采集条件。");
  }
  const reference = await readObservationReferenceSnapshot();
  const questionReference = input.questionVersionId
    ? reference.questions.find((item) => item.questionVersionId === input.questionVersionId)
    : undefined;
  const temporaryQuestion = !questionReference;
  const questionText = questionReference?.text || assertText(input.temporaryQuestionText, "临时测试问题", 500);
  const questionKey = questionReference?.questionKey || `temporary:${hashObservationPayload(questionText).slice(0, 16)}`;
  const environment = await getCaptureEnvironmentStatus();
  const runnerReady = environment.runner.status === "ready";
  const requestHash = hashObservationPayload({ ...input, actor: undefined });

  return updateV5ObservationState((state) => {
    try {
      const existing = getIdempotentResponse<FrontendCaptureTask[]>(state, "capture-task-create", input.idempotencyKey, requestHash);
      if (existing) return existing;
    } catch {
      throw new ObservationServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同的采集任务请求，请刷新后重试。");
    }
    const now = new Date().toISOString();
    const tasks = platforms.map((platform) => {
      const id = `capture-task-${randomUUID()}`;
      const status: FrontendCaptureTaskStatus = runnerReady ? "queued" : "waiting_for_browser";
      const task: FrontendCaptureTask = {
        id,
        captureSessionId: `capture-session-${randomUUID()}`,
        version: 1,
        questionKey,
        questionVersionId: questionReference?.questionVersionId,
        questionText,
        temporaryQuestion,
        platform,
        condition: input.condition,
        status,
        statusHistory: [
          { status: "draft", at: now, note: "已建立单次采集任务。" },
          { status: "environment_checking", at: now, note: "已检查本地采集环境。" },
          { status, at: now, note: runnerReady ? "任务已进入 Runner 队列。" : "Runner 离线，等待浏览器环境就绪。" }
        ],
        manualIntervention: false,
        createdAt: now,
        createdBy: input.actor.actorId,
        updatedAt: now,
        updatedBy: input.actor.actorId
      };
      state.tasks[id] = task;
      appendObservationAudit(state, {
        event: "capture_task_created",
        objectType: "FrontendCaptureTask",
        objectId: id,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        reason: input.reason,
        sourceIds: questionReference ? [questionReference.questionVersionId] : [],
        beforeVersion: 0,
        afterVersion: 1
      });
      return task;
    });
    setIdempotentResponse(state, "capture-task-create", input.idempotencyKey, requestHash, tasks);
    return tasks;
  });
}

export async function cancelCaptureTask(taskId: string, input: V5MutationContext) {
  assertObservationMutationContext(input);
  return updateV5ObservationState((state) => {
    const task = state.tasks[taskId];
    if (!task) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "采集任务不存在或已删除。");
    if (task.version !== input.expectedVersion) throw new ObservationServiceError(409, "TASK_VERSION_CONFLICT", "任务已更新，请刷新后再取消。");
    if (!TRANSIENT_TASK_STATES.has(task.status)) throw new ObservationServiceError(409, "TASK_NOT_CANCELLABLE", "只有尚未完成的采集任务可以取消。");
    const updated = { ...buildStatusHistory(task, "cancelled", input.reason), version: task.version + 1, updatedBy: input.actor.actorId };
    state.tasks[taskId] = updated;
    appendObservationAudit(state, {
      event: "capture_task_cancelled",
      objectType: "FrontendCaptureTask",
      objectId: taskId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [],
      beforeVersion: task.version,
      afterVersion: updated.version
    });
    return updated;
  });
}

export async function retryCaptureTask(taskId: string, input: V5MutationContext) {
  assertObservationMutationContext(input);
  return updateV5ObservationState((state) => {
    const task = state.tasks[taskId];
    if (!task) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "采集任务不存在或已删除。");
    if (task.version !== input.expectedVersion) throw new ObservationServiceError(409, "TASK_VERSION_CONFLICT", "任务已更新，请刷新后再重试。");
    if (!task.failure && task.status !== "waiting_for_browser") throw new ObservationServiceError(409, "TASK_NOT_RETRYABLE", "当前任务状态不需要重试。");
    const updated = {
      ...buildStatusHistory(task, "environment_checking", "重试前重新检查环境。"),
      version: task.version + 1,
      failure: undefined,
      updatedBy: input.actor.actorId
    };
    state.tasks[taskId] = updated;
    appendObservationAudit(state, {
      event: "capture_task_retried",
      objectType: "FrontendCaptureTask",
      objectId: taskId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [],
      beforeVersion: task.version,
      afterVersion: updated.version
    });
    return updated;
  });
}

const ALLOWED_STATUS_TRANSITIONS: Partial<Record<FrontendCaptureTaskStatus, FrontendCaptureTaskStatus[]>> = {
  draft: ["environment_checking", "cancelled"],
  environment_checking: ["queued", "waiting_for_browser", "needs_login", "adapter_mismatch", "capture_failed", "cancelled"],
  queued: ["waiting_for_browser", "submitting_prompt", "interrupted", "timed_out", "cancelled"],
  waiting_for_browser: ["environment_checking", "submitting_prompt", "needs_login", "adapter_mismatch", "interrupted", "timed_out", "cancelled"],
  submitting_prompt: ["streaming", "needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"],
  streaming: ["stabilizing", "interrupted", "timed_out", "capture_failed"],
  stabilizing: ["capturing", "interrupted", "timed_out", "capture_failed"],
  capturing: ["completed", "interrupted", "timed_out", "capture_failed"]
};

export async function updateCaptureTaskStatus(taskId: string, input: V5MutationContext & {
  status: FrontendCaptureTaskStatus;
  note: string;
  failure?: CaptureFailureDetail;
  adapterVersion?: string;
  browserVersion?: string;
  manualIntervention?: boolean;
}) {
  assertObservationMutationContext(input, true);
  return updateV5ObservationState((state) => {
    const task = state.tasks[taskId];
    if (!task) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "采集任务不存在或已删除。");
    if (task.version !== input.expectedVersion) throw new ObservationServiceError(409, "TASK_VERSION_CONFLICT", "任务已更新，请刷新 Runner 队列后重试。");
    if (!(ALLOWED_STATUS_TRANSITIONS[task.status] || []).includes(input.status)) {
      throw new ObservationServiceError(409, "INVALID_TASK_TRANSITION", `任务不能从 ${task.status} 进入 ${input.status}。`);
    }
    const failureStatus = ["needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"].includes(input.status);
    if (failureStatus && (!input.failure || input.failure.status !== input.status || !input.failure.recoveryAction.trim())) {
      throw new ObservationServiceError(422, "ACTIONABLE_FAILURE_REQUIRED", "失败状态必须包含失败阶段、已保留数据、是否可继续和可执行恢复动作。");
    }
    const updated = {
      ...buildStatusHistory(task, input.status, input.note),
      version: task.version + 1,
      failure: failureStatus ? input.failure : undefined,
      adapterVersion: input.adapterVersion || task.adapterVersion,
      browserVersion: input.browserVersion || task.browserVersion,
      manualIntervention: task.manualIntervention || input.manualIntervention === true,
      updatedBy: input.actor.actorId
    };
    state.tasks[taskId] = updated;
    appendObservationAudit(state, {
      event: failureStatus ? "capture_task_failed" : "capture_task_status_changed",
      objectType: "FrontendCaptureTask",
      objectId: taskId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [],
      beforeVersion: task.version,
      afterVersion: updated.version
    });
    return updated;
  });
}

export async function ingestCaptureArtifact(taskId: string, manifest: FrontendCaptureArtifactManifest, input: V5MutationContext) {
  assertObservationMutationContext(input, true);
  const sensitiveKeys = hasSensitiveKeys(manifest);
  if (sensitiveKeys.length) {
    throw new ObservationServiceError(422, "SENSITIVE_CAPTURE_FIELD", "采集包包含禁止上传的敏感字段。", sensitiveKeys, "在浏览器伴侣中移除 Cookie、密码、Token、浏览器存储或私有请求头后重试。");
  }
  if (manifest.taskId !== taskId) throw new ObservationServiceError(422, "TASK_ID_MISMATCH", "采集包 taskId 与请求路径不一致。");
  if (!manifest.answerText?.trim()) throw new ObservationServiceError(422, "EMPTY_CAPTURE_ANSWER", "采集结果没有可见回答正文。");
  const signals = manifest.completionSignals;
  if (signals.totalTimeoutExceeded) {
    throw new ObservationServiceError(422, "CAPTURE_TIMED_OUT", "采集已超过总任务超时，不能保存为完成结果。", undefined, "确认网络和页面状态后重新执行一次采集。");
  }
  if (!signals.answerNodeDetected || signals.stableWindowMs < 1500 || (!signals.stopControlDisappeared && !signals.completionMarkerDetected)) {
    throw new ObservationServiceError(422, "CAPTURE_NOT_STABLE", "流式回答尚未满足停止信号与文本稳定窗口，不能保存为完成结果。", undefined, "等待停止按钮消失或完成标记出现，并保持至少 1.5 秒文本稳定后重试捕获。");
  }
  const stateBefore = await readV5ObservationState();
  const taskBefore = stateBefore.tasks[taskId];
  if (!taskBefore) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "采集任务不存在或已删除。");
  if (taskBefore.captureSessionId !== manifest.captureSessionId) {
    throw new ObservationServiceError(409, "CAPTURE_SESSION_MISMATCH", "采集会话与任务不一致，已拒绝非目标标签页数据。");
  }
  if (taskBefore.version !== input.expectedVersion) throw new ObservationServiceError(409, "TASK_VERSION_CONFLICT", "任务已更新，请刷新 Runner 队列后重试。");

  const artifact = await persistImmutableCaptureArtifact({
    taskId,
    captureSessionId: manifest.captureSessionId,
    adapterVersion: manifest.adapterVersion,
    browserVersion: manifest.browserVersion,
    manifest,
    screenshotBase64: manifest.screenshot.dataBase64,
    screenshotMimeType: manifest.screenshot.mimeType
  });
  const reference = await readObservationReferenceSnapshot();
  const questionReference = reference.questions.find((item) => item.questionKey === taskBefore.questionKey);

  return updateV5ObservationState((state) => {
    const task = state.tasks[taskId];
    if (!task || task.version !== input.expectedVersion) throw new ObservationServiceError(409, "TASK_VERSION_CONFLICT", "任务已更新，请刷新后重试。");
    const existingArtifact = state.artifacts[artifact.id];
    if (existingArtifact) return { task, artifact: existingArtifact, answer: state.answers[task.answerId || ""] };
    const now = new Date().toISOString();
    const citations = manifest.citations.map((citation) => ({ ...citation, id: `citation-${randomUUID()}` }));
    const statements = splitStatements(manifest.answerText);
    const answer: CapturedAnswer = {
      id: `captured-answer-${randomUUID()}`,
      taskId,
      artifactId: artifact.id,
      questionKey: task.questionKey,
      questionText: task.questionText,
      platform: task.platform,
      answerText: manifest.answerText,
      citations,
      targetEntity: questionReference?.targetEntity,
      targetEntityMentioned: Boolean(questionReference?.targetEntity && manifest.answerText.includes(questionReference.targetEntity)),
      parseVersions: [
        {
          version: 1,
          parserVersion: "observation-parser@1",
          statements,
          evidenceMatches: statements.map((statement) => ({
            id: `evidence-match-${randomUUID()}`,
            statementId: statement.id,
            sourceSnapshotHash: questionReference?.sourceSnapshotHash,
            claimIds: [],
            chunkIds: [],
            sourceIds: [],
            status: "pending_config",
            explanation: "正式知识 Snapshot 适配器待接入，当前不编造 Claim 关联。"
          })),
          createdAt: now
        }
      ],
      gapAnalysisVersions: [],
      reviewVersion: 0,
      createdAt: now
    };
    const completed = {
      ...buildStatusHistory(task, "completed", "原始采集包已校验并保存。"),
      version: task.version + 1,
      adapterVersion: manifest.adapterVersion,
      browserVersion: manifest.browserVersion,
      artifactId: artifact.id,
      answerId: answer.id,
      updatedBy: input.actor.actorId
    };
    state.artifacts[artifact.id] = artifact;
    state.answers[answer.id] = answer;
    state.tasks[taskId] = completed;
    appendObservationAudit(state, {
      event: "capture_artifact_ingested",
      objectType: "FrontendCaptureArtifact",
      objectId: artifact.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [taskId, artifact.sha256],
      beforeVersion: 0,
      afterVersion: 1
    });
    return { task: completed, artifact, answer };
  });
}

export async function getCaptureArtifact(taskId: string) {
  const state = await readV5ObservationState();
  const task = state.tasks[taskId];
  if (!task) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "采集任务不存在或已删除。");
  const artifact = task.artifactId ? state.artifacts[task.artifactId] : undefined;
  if (!artifact) throw new ObservationServiceError(404, "CAPTURE_ARTIFACT_NOT_FOUND", "该任务尚未生成原始采集包。");
  return { task, artifact, answer: task.answerId ? state.answers[task.answerId] : undefined };
}

export async function analyzeObservationGaps(answerId: string, input: V5MutationContext) {
  assertObservationMutationContext(input);
  return updateV5ObservationState((state) => {
    const answer = state.answers[answerId];
    if (!answer) throw new ObservationServiceError(404, "CAPTURE_ANSWER_NOT_FOUND", "采集回答不存在。");
    if (answer.reviewVersion !== input.expectedVersion) throw new ObservationServiceError(409, "ANSWER_VERSION_CONFLICT", "回答分析已更新，请刷新后重试。");
    const latestParse = answer.parseVersions.at(-1);
    const codes = new Set<ObservationGapCode>();
    if (answer.targetEntity && !answer.targetEntityMentioned) codes.add("entity_gap");
    if (answer.targetEntityMentioned && !answer.citations.some((item) => item.sourceType === "owned")) codes.add("citation_gap");
    if (latestParse?.evidenceMatches.some((item) => item.status === "pending_config")) codes.add("observation_uncertain");
    if (!answer.citations.length) codes.add("citation_gap");
    const analysisVersion = answer.gapAnalysisVersions.length + 1;
    const gaps = Array.from(codes).map((code) => {
      const definition = OBSERVATION_GAP_DEFINITIONS[code];
      const gap: ObservationGap = {
        id: `observation-gap-${randomUUID()}`,
        answerId,
        code,
        title: definition.title,
        explanation: definition.question,
        evidenceLocation: code === "entity_gap" ? "回答正文与目标实体匹配" : code === "citation_gap" ? "回答引用列表" : "证据映射结果",
        confidence: code === "observation_uncertain" ? 0.6 : 0.82,
        suggestedDestinations: definition.destinations,
        status: "candidate",
        analysisVersion,
        createdAt: new Date().toISOString()
      };
      state.gaps[gap.id] = gap;
      return gap;
    });
    answer.gapAnalysisVersions.push({
      version: analysisVersion,
      analyzerVersion: "observation-gap-analyzer@1",
      gapIds: gaps.map((item) => item.id),
      sourceSnapshotHash: latestParse?.evidenceMatches.find((item) => item.sourceSnapshotHash)?.sourceSnapshotHash,
      createdAt: new Date().toISOString()
    });
    answer.reviewVersion += 1;
    appendObservationAudit(state, {
      event: "observation_gaps_analyzed",
      objectType: "CapturedAnswer",
      objectId: answerId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [answer.artifactId],
      beforeVersion: input.expectedVersion,
      afterVersion: answer.reviewVersion
    });
    return { answer, gaps };
  });
}

function downstreamTarget(destination: ObservationGapDestination): ObservationReview["downstream"][number]["target"] {
  if (destination === "blog_candidate") return "blog_candidate_adapter";
  if (destination === "knowledge_issue") return "knowledge_issue_adapter";
  if (destination === "site_audit") return "site_audit_adapter";
  return "manual_review";
}

export async function reviewObservationGaps(answerId: string, input: ReviewObservationRequest) {
  assertObservationMutationContext(input);
  return updateV5ObservationState((state) => {
    const answer = state.answers[answerId];
    if (!answer) throw new ObservationServiceError(404, "CAPTURE_ANSWER_NOT_FOUND", "采集回答不存在。");
    if (answer.reviewVersion !== input.expectedVersion) throw new ObservationServiceError(409, "ANSWER_VERSION_CONFLICT", "回答复核已更新，请刷新后重试。");
    const gaps = input.selectedGapIds.map((id) => state.gaps[id]).filter((gap): gap is ObservationGap => Boolean(gap && gap.answerId === answerId));
    if (!gaps.length) throw new ObservationServiceError(422, "GAP_SELECTION_REQUIRED", "请至少选择一个属于当前回答的候选缺口。");
    const allowedDestinations = new Set(gaps.flatMap((gap) => gap.suggestedDestinations));
    if (input.destinations.some((destination) => !allowedDestinations.has(destination))) {
      throw new ObservationServiceError(422, "INVALID_GAP_DESTINATION", "所选去向与候选缺口类型不匹配。");
    }
    const version = answer.reviewVersion + 1;
    const review: ObservationReview = {
      id: `observation-review-${randomUUID()}`,
      answerId,
      version,
      selectedGapIds: gaps.map((gap) => gap.id),
      decision: input.decision,
      destinations: Array.from(new Set(input.destinations)),
      note: input.note.trim(),
      downstream:
        input.decision === "confirmed"
          ? Array.from(new Set(input.destinations)).map((destination) => ({
              target: downstreamTarget(destination),
              status: destination === "manual_review" ? "accepted" : "pending_config"
            }))
          : [],
      monthlyTaskCreated: false,
      sourceSnapshotHash: answer.parseVersions.at(-1)?.evidenceMatches.find((item) => item.sourceSnapshotHash)?.sourceSnapshotHash,
      createdAt: new Date().toISOString(),
      createdBy: input.actor.actorId
    };
    for (const gap of gaps) gap.status = input.decision === "confirmed" ? "confirmed" : "rejected";
    answer.reviewVersion = version;
    state.reviews[review.id] = review;
    appendObservationAudit(state, {
      event: "observation_gaps_reviewed",
      objectType: "ObservationReview",
      objectId: review.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [answer.artifactId, ...review.selectedGapIds],
      beforeVersion: input.expectedVersion,
      afterVersion: version
    });
    return review;
  });
}

function getConditionDifferences(baseline: FrontendCaptureTask, comparison: FrontendCaptureTask): CaptureConditionDifference[] {
  const fields: Array<keyof FrontendCaptureTask["condition"]> = ["locale", "region", "conversationMode", "personalizationMode", "modelLabel"];
  const differences: CaptureConditionDifference[] = fields.flatMap((field) =>
    baseline.condition[field] === comparison.condition[field]
      ? []
      : [{ field, baselineValue: baseline.condition[field], comparisonValue: comparison.condition[field] }]
  );
  if (baseline.platform !== comparison.platform) differences.push({ field: "platform", baselineValue: baseline.platform, comparisonValue: comparison.platform });
  if ((baseline.adapterVersion || "") !== (comparison.adapterVersion || "")) {
    differences.push({ field: "adapterVersion", baselineValue: baseline.adapterVersion || "未记录", comparisonValue: comparison.adapterVersion || "未记录" });
  }
  return differences;
}

function getSemanticChanges(baseline: string, comparison: string) {
  const left = new Set(baseline.split(/(?<=[。！？!?])\s*/).map((item) => item.trim()).filter(Boolean));
  const right = new Set(comparison.split(/(?<=[。！？!?])\s*/).map((item) => item.trim()).filter(Boolean));
  return [
    ...Array.from(left).filter((item) => !right.has(item)).map((text) => ({ type: "removed" as const, text })),
    ...Array.from(right).filter((item) => !left.has(item)).map((text) => ({ type: "added" as const, text })),
    ...Array.from(left).filter((item) => right.has(item)).map((text) => ({ type: "unchanged" as const, text }))
  ].slice(0, 30);
}

export async function createCaptureComparison(input: CreateComparisonRequest): Promise<CaptureComparison> {
  assertObservationMutationContext(input);
  if (input.baselineTaskId === input.comparisonTaskId) throw new ObservationServiceError(422, "DISTINCT_TASKS_REQUIRED", "请选择两次不同的历史任务。");
  const requestHash = hashObservationPayload({ ...input, actor: undefined });
  return updateV5ObservationState((state) => {
    try {
      const existing = getIdempotentResponse<CaptureComparison>(state, "capture-comparison", input.idempotencyKey, requestHash);
      if (existing) return existing;
    } catch {
      throw new ObservationServiceError(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于不同的任务对比请求，请重新生成。");
    }
    const baseline = state.tasks[input.baselineTaskId];
    const comparison = state.tasks[input.comparisonTaskId];
    if (!baseline || !comparison) throw new ObservationServiceError(404, "CAPTURE_TASK_NOT_FOUND", "所选历史任务不存在。");
    if (baseline.questionKey !== comparison.questionKey) throw new ObservationServiceError(422, "QUESTION_MISMATCH", "只能比较同一问题下的两次历史任务。");
    const baselineAnswer = baseline.answerId ? state.answers[baseline.answerId] : undefined;
    const comparisonAnswer = comparison.answerId ? state.answers[comparison.answerId] : undefined;
    if (!baselineAnswer || !comparisonAnswer) throw new ObservationServiceError(422, "COMPLETED_TASKS_REQUIRED", "只有已完成且保存回答的任务可以比较。");
    const conditionDifferences = getConditionDifferences(baseline, comparison);
    const baselineDomains = new Set(baselineAnswer.citations.map((item) => new URL(item.url).hostname));
    const comparisonDomains = new Set(comparisonAnswer.citations.map((item) => new URL(item.url).hostname));
    const added = Array.from(comparisonDomains).filter((domain) => !baselineDomains.has(domain)).length;
    const removed = Array.from(baselineDomains).filter((domain) => !comparisonDomains.has(domain)).length;
    const result: CaptureComparison = {
      id: `capture-comparison-${randomUUID()}`,
      questionKey: baseline.questionKey,
      baselineTaskId: baseline.id,
      comparisonTaskId: comparison.id,
      conditionDifferences,
      comparable: true,
      conditionsMatched: conditionDifferences.length === 0,
      trendConclusionAllowed: false,
      warning: conditionDifferences.length
        ? "采集条件不一致；以下结果只表示两个样本的差异，不生成趋势结论。"
        : "以下结果只表示两个采集样本的差异，不代表持续趋势或平台全局变化。",
      metrics: [
        { label: "目标实体是否出现", baseline: baselineAnswer.targetEntityMentioned ? "是" : "否", comparison: comparisonAnswer.targetEntityMentioned ? "是" : "否", change: baselineAnswer.targetEntityMentioned === comparisonAnswer.targetEntityMentioned ? "无变化" : "已变化" },
        { label: "可访问引用", baseline: baselineAnswer.citations.filter((item) => item.verificationStatus === "verified").length, comparison: comparisonAnswer.citations.filter((item) => item.verificationStatus === "verified").length, change: `${comparisonAnswer.citations.length - baselineAnswer.citations.length >= 0 ? "+" : ""}${comparisonAnswer.citations.length - baselineAnswer.citations.length}` },
        { label: "自有引用", baseline: baselineAnswer.citations.filter((item) => item.sourceType === "owned").length, comparison: comparisonAnswer.citations.filter((item) => item.sourceType === "owned").length, change: "样本差异" }
      ],
      semanticChanges: getSemanticChanges(baselineAnswer.answerText, comparisonAnswer.answerText),
      citationChanges: { added, removed, domainOwnerChanges: added + removed },
      createdAt: new Date().toISOString(),
      createdBy: input.actor.actorId
    };
    state.comparisons[result.id] = result;
    setIdempotentResponse(state, "capture-comparison", input.idempotencyKey, requestHash, result);
    appendObservationAudit(state, {
      event: "capture_comparison_created",
      objectType: "CaptureComparison",
      objectId: result.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [baseline.id, comparison.id],
      beforeVersion: 0,
      afterVersion: 1
    });
    return result;
  });
}

export async function getCaptureAnswers(answerId?: string) {
  const state = await readV5ObservationState();
  if (answerId) {
    const answer = state.answers[answerId];
    if (!answer) throw new ObservationServiceError(404, "CAPTURE_ANSWER_NOT_FOUND", "采集回答不存在。");
    return {
      answer,
      artifact: state.artifacts[answer.artifactId],
      gaps: Object.values(state.gaps).filter((item) => item.answerId === answerId),
      reviews: Object.values(state.reviews).filter((item) => item.answerId === answerId)
    };
  }
  return Object.values(state.answers).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function assertMonth(value: string) {
  if (!MONTH_PATTERN.test(value)) throw new ObservationServiceError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM。");
  return value;
}
