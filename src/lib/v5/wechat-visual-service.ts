import { createHash, randomUUID } from "node:crypto";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import type { ContentDraftArtifact, FreeProductionBatch } from "./free-production-contracts";
import { getFreeProductionBatch, FreeProductionServiceError, saveFreeProductionCover } from "./free-production-service";
import {
  CC2IMAGE_BASELINE_COMMIT,
  WECHAT_VISUAL_PLAN_VERSION,
  WECHAT_VISUAL_PROMPT_VERSION,
  type WechatVisualCandidateRecord,
  type WechatVisualPlanRecord,
  type WechatVisualPlanView,
  type WechatVisualWorkspace
} from "./wechat-visual-contracts";
import { generateWechatVisualImage, getWechatVisualImageProviderStatus, type WechatVisualImageResult } from "./wechat-visual-image-provider";
import { readWechatVisualCandidate, readWechatVisualState, updateWechatVisualState, writeWechatVisualCandidate } from "./wechat-visual-repository";
import { buildWechatCoverPrompt, deriveWechatVisualAnchors, recommendWechatVisualRoutes } from "./wechat-visual-style-registry";

function hash(value: unknown) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function hashWechatVisualSource(artifact: ContentDraftArtifact) {
  return hash({
    title: artifact.selectedTitle,
    summary: artifact.summary,
    sections: artifact.sections.map((section) => ({ sectionKey: section.sectionKey, heading: section.heading, markdown: section.markdown }))
  });
}

function currentArtifact(batch: FreeProductionBatch) {
  return batch.draftArtifacts.find((artifact) => artifact.id === batch.currentDraftArtifactId);
}

function assertVisualContext(batch: FreeProductionBatch, artifactId?: string, requireEditable = true) {
  if (batch.channelConfig.channel !== "wechat_official_account") {
    throw new FreeProductionServiceError(409, "WECHAT_VISUAL_NOT_APPLICABLE", "当前正文不是微信公众号渠道，不能生成公众号封面。", "返回公众号内容生产并选择微信公众号表达类型。");
  }
  if (requireEditable && ["publishing", "draft_created", "published", "cancelled"].includes(batch.status)) {
    throw new FreeProductionServiceError(409, "WECHAT_VISUAL_LOCKED", "当前正文已进入发布或结束状态，不能生成或更换封面。", "复制为新正文后再生成视觉方案。");
  }
  const artifact = currentArtifact(batch);
  if (!artifact || !artifact.wechatPresentation || (artifactId && artifact.id !== artifactId)) {
    throw new FreeProductionServiceError(422, "WECHAT_VISUAL_ARTIFACT_INVALID", "只能为当前公众号正文版本生成封面。", "刷新页面并在最新正文中重新操作。");
  }
  return artifact;
}

function assertMutation(input: { expectedVersion: number; auditReason: string }, idempotencyKey: string | null) {
  if (!Number.isInteger(input.expectedVersion)) throw new FreeProductionServiceError(400, "INVALID_EXPECTED_VERSION", "expectedVersion 必须是整数。", "刷新页面读取最新版本后重试。");
  const auditReason = String(input.auditReason || "").trim();
  if (!auditReason || auditReason.length > 200) throw new FreeProductionServiceError(422, "WECHAT_VISUAL_AUDIT_REASON_INVALID", "请填写 200 个字符以内的操作原因。", "刷新页面后重试。");
  const key = idempotencyKey?.trim() || "";
  if (key.length < 8 || key.length > 200) throw new FreeProductionServiceError(400, "WECHAT_VISUAL_IDEMPOTENCY_KEY_INVALID", "视觉方案写请求缺少有效幂等键。", "刷新页面后重新提交。");
  return { auditReason, key };
}

function assertBatchVersion(batch: FreeProductionBatch, expectedVersion: number) {
  if (batch.version !== expectedVersion) throw new FreeProductionServiceError(409, "FREE_PRODUCTION_VERSION_CONFLICT", "正文版本已变化。", "刷新页面后基于最新正文重新生成视觉方案。");
}

function targetAudience(batch: FreeProductionBatch) {
  const currentSnapshot = batch.inputSnapshots.find((snapshot) => snapshot.id === batch.generationInputSnapshotId);
  return currentSnapshot?.freeContentExpressionPresetSnapshot.defaultAudience || "推进企业 AI 落地的业务、产品和技术负责人";
}

function toView(plan: WechatVisualPlanRecord, statusOverride?: WechatVisualPlanRecord["status"]): WechatVisualPlanView {
  return {
    ...plan,
    status: statusOverride || plan.status,
    candidates: plan.candidates.map(({ prompt: _prompt, storageKey: _storageKey, contentHash: _contentHash, ...candidate }) => ({
      ...candidate,
      contentUrl: candidate.status === "ready" || candidate.status === "selected"
        ? `/api/v5/free-production/batches/${encodeURIComponent(plan.batchId)}/visual-candidates/${encodeURIComponent(candidate.candidateId)}/content?v=${plan.version}`
        : undefined
    }))
  };
}

export async function getWechatVisualWorkspace(batchId: string): Promise<WechatVisualWorkspace> {
  const batch = await getFreeProductionBatch(batchId);
  const artifact = assertVisualContext(batch, undefined, false);
  const provider = getWechatVisualImageProviderStatus();
  const state = await readWechatVisualState();
  const planId = state.currentPlanByBatch[batchId];
  const plan = planId ? state.plans[planId] : undefined;
  const stale = Boolean(plan && (plan.artifactId !== artifact.id || plan.sourceContentHash !== hashWechatVisualSource(artifact)));
  return {
    applicable: true,
    plan: plan ? toView(plan, stale ? "stale" : undefined) : undefined,
    provider
  };
}

type ImageGenerator = (input: { prompt: string; idempotencyKey: string }) => Promise<WechatVisualImageResult>;

export async function generateWechatCoverCandidates(
  batchId: string,
  input: { expectedVersion: number; auditReason: string; artifactId: string },
  idempotencyKey: string | null,
  dependencies: { generateImage?: ImageGenerator } = {}
) {
  const context = assertMutation(input, idempotencyKey);
  const batch = await getFreeProductionBatch(batchId);
  assertBatchVersion(batch, input.expectedVersion);
  const artifact = assertVisualContext(batch, input.artifactId);
  const sourceContentHash = hashWechatVisualSource(artifact);
  const requestHash = hash({ batchId, artifactId: artifact.id, expectedVersion: input.expectedVersion, sourceContentHash });
  const provider = getWechatVisualImageProviderStatus();
  const routes = recommendWechatVisualRoutes(artifact);
  const planId = `wechat-visual-plan-${randomUUID()}`;
  const now = new Date().toISOString();
  const plan: WechatVisualPlanRecord = {
    schemaVersion: WECHAT_VISUAL_PLAN_VERSION,
    planId,
    batchId,
    productId: batch.productId,
    artifactId: artifact.id,
    sourceContentHash,
    articleTitle: artifact.selectedTitle,
    articleSummary: artifact.summary,
    targetAudience: targetAudience(batch),
    coreJudgment: artifact.sections[0]?.markdown.replace(/[#>*_`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || artifact.summary,
    routes,
    anchors: deriveWechatVisualAnchors(artifact),
    candidates: routes.map((route, index): WechatVisualCandidateRecord => {
      const prompt = buildWechatCoverPrompt({ artifact, route, productName: batch.productName, targetAudience: targetAudience(batch) });
      return {
        candidateId: `wechat-visual-candidate-${randomUUID()}`,
        planId,
        role: "cover",
        variantIndex: (index + 1) as 1 | 2 | 3,
        route,
        status: "generating",
        prompt,
        promptHash: hash(prompt),
        createdAt: now,
        updatedAt: now
      };
    }),
    status: "generating",
    promptVersion: WECHAT_VISUAL_PROMPT_VERSION,
    cc2imageCommit: CC2IMAGE_BASELINE_COMMIT,
    providerStatus: provider.status,
    providerMissingConfig: provider.missingConfig,
    createdBy: WORKSPACE_ACTOR.actorId,
    createdAt: now,
    updatedAt: now,
    version: 1
  };

  const reservation = await updateWechatVisualState((state) => {
    const replay = state.idempotency[context.key];
    if (replay) {
      if (replay.requestHash !== requestHash) throw new FreeProductionServiceError(409, "WECHAT_VISUAL_IDEMPOTENCY_CONFLICT", "同一视觉方案操作标识已用于不同请求。", "刷新页面后重新生成。");
      const replayPlan = state.plans[replay.responsePlanId];
      if (!replayPlan) throw new FreeProductionServiceError(409, "WECHAT_VISUAL_REPLAY_MISSING", "历史视觉方案已不可用。", "刷新页面并重新生成。");
      return { replayed: true as const, plan: replayPlan };
    }
    state.plans[planId] = plan;
    state.currentPlanByBatch[batchId] = planId;
    state.idempotency[context.key] = { requestHash, responsePlanId: planId, createdAt: now };
    return { replayed: false as const, plan };
  });
  if (reservation.replayed) return toView(reservation.plan);

  if (provider.status === "pending_config" && !dependencies.generateImage) {
    return updateWechatVisualState((state) => {
      const stored = state.plans[planId];
      stored.status = "pending_config";
      stored.candidates = stored.candidates.map((candidate) => ({ ...candidate, status: "pending_config", errorMessage: `待配置：${provider.missingConfig.join("、")}`, updatedAt: new Date().toISOString() }));
      stored.updatedAt = new Date().toISOString();
      stored.version += 1;
      return toView(stored);
    });
  }

  const generateImage = dependencies.generateImage || generateWechatVisualImage;
  const results = await Promise.all(plan.candidates.map(async (candidate) => {
    const result = await generateImage({ prompt: candidate.prompt, idempotencyKey: `${planId}:${candidate.variantIndex}:${candidate.promptHash}` });
    if (!result.ok || !result.data || !result.mimeType) return { candidateId: candidate.candidateId, result };
    const stored = await writeWechatVisualCandidate(candidate.candidateId, result.data);
    return { candidateId: candidate.candidateId, result, stored };
  }));

  return updateWechatVisualState((state) => {
    const storedPlan = state.plans[planId];
    const resultById = new Map(results.map((item) => [item.candidateId, item]));
    storedPlan.candidates = storedPlan.candidates.map((candidate) => {
      const generated = resultById.get(candidate.candidateId);
      if (!generated) return candidate;
      const updatedAt = new Date().toISOString();
      if (!generated.result.ok || !generated.result.data || !generated.result.mimeType || !generated.stored) {
        return {
          ...candidate,
          status: generated.result.status === "pending_config" ? "pending_config" as const : "failed" as const,
          provider: generated.result.provider,
          model: generated.result.model,
          providerRequestId: generated.result.requestId,
          errorMessage: generated.result.errorMessage || (generated.result.missingConfig?.length ? `待配置：${generated.result.missingConfig.join("、")}` : "候选图片生成失败。"),
          updatedAt
        };
      }
      return {
        ...candidate,
        status: "ready" as const,
        storageKey: generated.stored.storageKey,
        contentHash: generated.stored.contentHash,
        mimeType: generated.result.mimeType,
        byteSize: generated.result.data.length,
        provider: generated.result.provider,
        model: generated.result.model,
        providerRequestId: generated.result.requestId,
        errorMessage: undefined,
        updatedAt
      };
    });
    const readyCount = storedPlan.candidates.filter((candidate) => candidate.status === "ready").length;
    const pendingConfigCount = storedPlan.candidates.filter((candidate) => candidate.status === "pending_config").length;
    storedPlan.status = readyCount === 3 ? "cover_selection" : readyCount > 0 ? "partial" : pendingConfigCount === 3 ? "pending_config" : "failed";
    storedPlan.updatedAt = new Date().toISOString();
    storedPlan.version += 1;
    return toView(storedPlan);
  });
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function selectWechatCoverCandidate(
  batchId: string,
  input: { expectedVersion: number; auditReason: string; artifactId: string; planId: string; candidateId: string },
  idempotencyKey: string | null
) {
  const context = assertMutation(input, idempotencyKey);
  const batch = await getFreeProductionBatch(batchId);
  const artifact = assertVisualContext(batch, input.artifactId);
  const state = await readWechatVisualState();
  const plan = state.plans[input.planId];
  if (!plan || plan.batchId !== batchId || state.currentPlanByBatch[batchId] !== plan.planId) throw new FreeProductionServiceError(404, "WECHAT_VISUAL_PLAN_NOT_FOUND", "当前视觉方案不存在或已经被替换。", "刷新页面后重新选择封面。");
  if (plan.artifactId !== artifact.id || plan.sourceContentHash !== hashWechatVisualSource(artifact)) throw new FreeProductionServiceError(409, "WECHAT_VISUAL_PLAN_STALE", "正文已经变化，当前封面候选已失效。", "基于最新正文重新生成 3 个封面方案。");
  const candidate = plan.candidates.find((item) => item.candidateId === input.candidateId);
  const isReplaySelection = candidate?.status === "selected" && plan.selectedCoverCandidateId === candidate.candidateId && plan.status === "applied";
  if (!candidate || (candidate.status !== "ready" && !isReplaySelection) || !candidate.storageKey || !candidate.contentHash || !candidate.mimeType) throw new FreeProductionServiceError(422, "WECHAT_VISUAL_CANDIDATE_INVALID", "所选封面候选尚不可用。", "等待生成完成或重新生成该组封面。");
  let data: Buffer;
  try {
    data = await readWechatVisualCandidate(candidate.storageKey, candidate.contentHash);
  } catch {
    throw new FreeProductionServiceError(500, "WECHAT_VISUAL_CANDIDATE_UNAVAILABLE", "封面候选文件不可读取或完整性校验失败。", "重新生成该组封面。");
  }
  const savedBatch = await saveFreeProductionCover(batchId, {
    expectedVersion: input.expectedVersion,
    auditReason: context.auditReason,
    file: {
      fileName: `${artifact.selectedTitle.slice(0, 60)}-${candidate.route.routeName}.${extensionFor(candidate.mimeType)}`,
      mimeType: candidate.mimeType,
      dataBase64: data.toString("base64")
    }
  }, `${context.key}:generated-cover`);
  const savedPlan = await updateWechatVisualState((current) => {
    const stored = current.plans[plan.planId];
    if (stored.selectedCoverCandidateId === candidate.candidateId && stored.status === "applied") return toView(stored);
    stored.selectedCoverCandidateId = candidate.candidateId;
    stored.candidates = stored.candidates.map((item) => ({ ...item, status: item.candidateId === candidate.candidateId ? "selected" as const : item.status === "selected" ? "ready" as const : item.status, updatedAt: new Date().toISOString() }));
    stored.status = "applied";
    stored.updatedAt = new Date().toISOString();
    stored.version += 1;
    return toView(stored);
  });
  return { batch: savedBatch, plan: savedPlan };
}

export async function readWechatVisualCandidateContent(batchId: string, candidateId: string) {
  const state = await readWechatVisualState();
  const planId = state.currentPlanByBatch[batchId];
  const plan = planId ? state.plans[planId] : undefined;
  const candidate = plan?.candidates.find((item) => item.candidateId === candidateId);
  if (!plan || !candidate || !["ready", "selected"].includes(candidate.status) || !candidate.storageKey || !candidate.contentHash || !candidate.mimeType) {
    throw new FreeProductionServiceError(404, "WECHAT_VISUAL_CANDIDATE_NOT_FOUND", "封面候选不存在或尚未生成完成。", "刷新视觉方案后重试。");
  }
  try {
    const data = await readWechatVisualCandidate(candidate.storageKey, candidate.contentHash);
    return { data, mimeType: candidate.mimeType, contentHash: candidate.contentHash };
  } catch {
    throw new FreeProductionServiceError(500, "WECHAT_VISUAL_CANDIDATE_UNAVAILABLE", "封面候选文件不可读取或完整性校验失败。", "重新生成该组封面。");
  }
}
