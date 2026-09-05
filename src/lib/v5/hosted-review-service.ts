import { hashV5GovernancePayload } from "./knowledge-governance-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import {
  completeHostedReviewRequestRecord,
  ensureHostedReviewRequestRecord,
  readHostedReviewRequestByToken,
  type HostedReviewRequestRecord
} from "./hosted-review-repository";
import { enqueueHostedNotification } from "./hosted-notification-service";
import type { HostedPromotionOrderRecord } from "./hosted-managed-contracts";
import { readHostedPromotionOrderRecord, updateHostedPromotionOrderStatus } from "./hosted-managed-repository";
import { decideProductGeoStrategyPack, editPendingProductGeoStrategyPack, getProductGeoStrategyPackView } from "./product-strategy-pack-service";
import type { ProductStrategyHumanEditInput } from "./product-strategy-pack-contracts";
import {
  enqueueProductSampleArticle,
  enqueueProductSampleRevision,
  readProductSampleArticleDetail,
  readProductSampleArticles
} from "./product-sample-article-service";
import { decideSampleArticle } from "./sample-calibration-repository";
import { getSingleArticleActor } from "./single-article-api";
import { getGeoResearchWorkspace, startGeoResearchRun, updateGeoResearchProject } from "./geo-research-service";
import { sampleResultContent, strategyResultContent } from "./hosted-history-projection";

function humanActorId(email: string) {
  return `hosted-user-${hashV5GovernancePayload(email.toLocaleLowerCase()).slice(0, 24)}`;
}

async function updateOrderState(
  orderId: string,
  status: HostedPromotionOrderRecord["status"],
  currentActionType?: string,
  lastError?: { code: string; message: string },
  workflowBinding?: { strategyPackId?: string; sampleTaskId?: string; sampleOperationId?: string }
) {
  const order = await readHostedPromotionOrderRecord(orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  if (order.status === status && order.currentActionType === currentActionType && order.lastError?.code === lastError?.code) return order;
  return updateHostedPromotionOrderStatus({
    orderId,
    expectedVersion: order.rowVersion,
    status,
    currentActionType,
    lastError,
    workflowBinding,
    actorId: "hosted-review-orchestrator",
    auditReason: "根据用户审核结果推进托管状态"
  });
}

export async function enqueueHostedReviewNotification(review: HostedReviewRequestRecord, dedupeSuffix?: string) {
  const eventType = review.gateType === "strategy" ? "strategy_review_required" : "sample_review_required";
  return enqueueHostedNotification({
    orderId: review.orderId,
    reviewRequestId: review.reviewRequestId,
    eventType,
    recipientEmail: review.contactEmail,
    dedupeKey: `${eventType}:${review.reviewRequestId}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`,
    payload: { productName: review.productName }
  });
}

export async function ensureHostedReviewForOrder(order: HostedPromotionOrderRecord) {
  if (order.status === "pending_strategy_review") {
    const view = await getProductGeoStrategyPackView(order.productId);
    const strategy = view.latestStrategyPack;
    if (!strategy || strategy.status !== "pending_strategy_review") return undefined;
    const ensured = await ensureHostedReviewRequestRecord({
      orderId: order.orderId,
      productId: order.productId,
      gateType: "strategy",
      targetId: strategy.id,
      resultContent: strategyResultContent({ sourceId: strategy.id, sourceVersion: `策略 V${strategy.strategyVersion} · 修订 ${strategy.rowVersion}`, summary: strategySummary(order, strategy.contentPlan as Record<string, unknown> | null), materials: order.materialSummary }),
      actorId: "hosted-review-orchestrator"
    });
    await enqueueHostedReviewNotification(ensured.review);
    return ensured.review;
  }
  if (order.status === "pending_sample_review") {
    const samples = await readProductSampleArticles(order.productId);
    const item = samples?.items.find((candidate) => candidate.draft?.copyAllowed && candidate.reviewStatus !== "approved");
    if (!item?.draft?.draftVersionId || !item.taskId) return undefined;
    const detail = await readProductSampleArticleDetail(order.productId, item.taskId);
    const version = detail?.versions.find(candidate => candidate.draftVersionId === item.draft?.draftVersionId);
    if (!detail || !version) return undefined;
    const ensured = await ensureHostedReviewRequestRecord({
      orderId: order.orderId,
      productId: order.productId,
      gateType: "sample",
      targetId: item.draft.draftVersionId,
      resultContent: sampleResultContent({ sourceId: version.draftVersionId, sourceVersion: version.draftVersionId, title: version.title, markdown: version.markdown, articleTypeName: detail.articleTypeName, channel: "wechat" }),
      actorId: "hosted-review-orchestrator"
    });
    await enqueueHostedReviewNotification(ensured.review);
    return ensured.review;
  }
  return undefined;
}

function strategySummary(order: HostedPromotionOrderRecord, plan: Record<string, unknown> | null) {
  const positioning = plan?.productPositioning && typeof plan.productPositioning === "object"
    ? plan.productPositioning as Record<string, unknown>
    : {};
  const expression = plan?.expressionDirection && typeof plan.expressionDirection === "object"
    ? plan.expressionDirection as Record<string, unknown>
    : {};
  const core = plan?.coreExpressions && typeof plan.coreExpressions === "object"
    ? plan.coreExpressions as Record<string, unknown>
    : {};
  const legacyFixed = plan?.fixedExpression && typeof plan.fixedExpression === "object"
    ? plan.fixedExpression as Record<string, unknown>
    : {};
  const portfolio = Array.isArray(plan?.articleTypePortfolio) ? plan.articleTypePortfolio as Array<Record<string, unknown>> : [];
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  const legacyExpression = String(legacyFixed.text || "").trim();
  const legacyParts = legacyExpression.split(/[；\n]/).map((item) => item.trim()).filter(Boolean);
  return {
    coreExpressions: {
      productIdentity: String(core.productIdentity || legacyParts[0] || legacyExpression || order.productName),
      entityRelationship: String(core.entityRelationship || legacyParts.slice(1).join("；") || legacyExpression),
      fixedExpression: String(core.fixedExpression || ""),
      ctaLabel: String(core.ctaLabel || ""),
      ctaUrl: String(core.ctaUrl || "")
    },
    automaticStrategy: {
      targetAudience: strings(positioning.targetAudience).slice(0, 4),
      promotionPurpose: String(positioning.promotionPurpose || "帮助目标用户理解产品适用场景与采用方式。"),
      keyMessages: strings(expression.keyMessages).slice(0, 4),
      channels: order.channels.map((item) => item.channel),
      articleDirections: portfolio.slice(0, 6).map((item) => ({
        portfolioItemId: String(item.portfolioItemId || ""),
        name: String(item.name || "内容方向"),
        direction: String(item.definition || item.contentGoal || item.recommendationReason || "覆盖目标用户的真实问题。")
      })),
      prohibitedClaims: strings(positioning.prohibitedClaims).slice(0, 5)
    }
  };
}

export async function getHostedReviewView(token: string) {
  const review = await readHostedReviewRequestByToken(token);
  const order = await readHostedPromotionOrderRecord(review.orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "审核对应的托管任务不存在。", 404);
  if (review.gateType === "strategy") {
    const view = await getProductGeoStrategyPackView(review.productId);
    const strategy = view.latestStrategyPack;
    if (!strategy || strategy.id !== review.targetId) throw new V5GovernanceServiceError("hosted_review_target_changed", "策略已经更新，这个审核链接不再适用。", 409);
    return {
      review: { gateType: review.gateType, status: review.status, expiresAt: review.expiresAt, decision: review.decision, comment: review.comment },
      order: { orderId: order.orderId, productName: order.productName },
      strategy: {
        strategyVersion: strategy.strategyVersion,
        rowVersion: strategy.rowVersion,
        summary: strategySummary(order, strategy.contentPlan as Record<string, unknown> | null)
      }
    };
  }
  const samples = await readProductSampleArticles(review.productId);
  const item = samples?.items.find((candidate) => candidate.draft?.draftVersionId === review.targetId);
  if (!item?.taskId) throw new V5GovernanceServiceError("hosted_review_target_changed", "样文已经更新，这个审核链接不再适用。", 409);
  const detail = await readProductSampleArticleDetail(review.productId, item.taskId);
  const version = detail?.versions.find((candidate) => candidate.draftVersionId === review.targetId);
  if (!detail || !version) throw new V5GovernanceServiceError("hosted_sample_not_found", "没有找到待确认样文。", 404);
  return {
    review: { gateType: review.gateType, status: review.status, expiresAt: review.expiresAt, decision: review.decision, comment: review.comment },
    order: { orderId: order.orderId, productName: order.productName },
    sample: {
      title: version.title,
      markdown: version.markdown,
      copyAllowed: version.copyAllowed,
      articleTypeName: detail.articleTypeName,
      channel: "wechat"
    }
  };
}

export async function editHostedStrategyReview(input: {
  token: string;
  expectedVersion: number;
  edit: ProductStrategyHumanEditInput;
}) {
  const review = await readHostedReviewRequestByToken(input.token);
  if (review.status !== "pending" || review.gateType !== "strategy") {
    throw new V5GovernanceServiceError("hosted_strategy_edit_not_available", "只有待确认的策略邮件可以直接编辑。", 409);
  }
  const order = await readHostedPromotionOrderRecord(review.orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "审核对应的托管任务不存在。", 404);
  const view = await getProductGeoStrategyPackView(review.productId);
  const strategy = view.latestStrategyPack;
  if (!strategy || strategy.id !== review.targetId || strategy.status !== "pending_strategy_review") {
    throw new V5GovernanceServiceError("hosted_review_target_changed", "策略已经更新，请使用最新邮件链接。", 409);
  }
  const editHash = hashV5GovernancePayload(input.edit);
  const result = await editPendingProductGeoStrategyPack({
    productId: review.productId,
    strategyPackId: strategy.id,
    expectedVersion: input.expectedVersion,
    idempotencyKey: `hosted-strategy-edit:${review.reviewRequestId}:${input.expectedVersion}:${editHash.slice(0, 16)}`.slice(0, 128),
    edit: input.edit,
    actor: {
      actorId: humanActorId(review.contactEmail),
      actorRole: "product_owner",
      actorType: "human",
      auditReason: "用户在托管策略审核页面直接修改策略文字"
    }
  });
  return {
    strategy: {
      strategyVersion: result.pack.strategyVersion,
      rowVersion: result.pack.rowVersion,
      summary: strategySummary(order, result.pack.contentPlan as Record<string, unknown> | null)
    },
    replayed: result.replayed
  };
}

export async function decideHostedReview(input: { token: string; decision: "approve" | "changes_requested"; comment?: string }) {
  const normalizedComment = input.comment?.trim();
  if (normalizedComment && normalizedComment.length > 1000) {
    throw new V5GovernanceServiceError("hosted_review_comment_too_long", "修改意见最多 1000 个字符。", 400);
  }
  const review = await readHostedReviewRequestByToken(input.token);
  if (review.status === "acted") {
    if (review.decision !== input.decision) throw new V5GovernanceServiceError("hosted_review_already_acted", "这项审核已经完成。", 409);
    return { review, replayed: true };
  }
  if (input.decision === "changes_requested" && !normalizedComment) {
    throw new V5GovernanceServiceError("hosted_review_comment_required", "请写下希望修改的地方。", 422);
  }
  const order = await readHostedPromotionOrderRecord(review.orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  const actorId = humanActorId(review.contactEmail);
  const idempotencyKey = `hosted-review-action:${review.reviewRequestId}:${input.decision}`.slice(0, 128);

  if (review.gateType === "strategy") {
    const view = await getProductGeoStrategyPackView(review.productId);
    const strategy = view.latestStrategyPack;
    if (!strategy || strategy.id !== review.targetId) throw new V5GovernanceServiceError("hosted_review_target_changed", "策略已经更新，请使用最新邮件链接。", 409);
    const approved = input.decision === "approve";
    const resultContent = strategyResultContent({ sourceId: strategy.id, sourceVersion: `策略 V${strategy.strategyVersion} · 修订 ${strategy.rowVersion}`, summary: strategySummary(order, strategy.contentPlan as Record<string, unknown> | null) });
    const result = await decideProductGeoStrategyPack({
      productId: review.productId,
      strategyPackId: strategy.id,
      decision: approved ? "approve" : "reject",
      expectedVersion: strategy.rowVersion,
      idempotencyKey,
      actor: {
        actorId,
        actorRole: "product_owner",
        actorType: "human",
        auditReason: approved ? "用户通过托管邮件确认 GEO 策略" : `用户通过托管邮件要求修改 GEO 策略：${normalizedComment}`
      }
    });
    let transitionError: { code: string; message: string } | undefined;
    let sampleBinding: { strategyPackId: string; sampleTaskId: string; sampleOperationId: string } | undefined;
    if (approved) {
      try {
        const queuedSample = await enqueueProductSampleArticle({
          productId: review.productId,
          strategyPackId: result.strategyPackId,
          idempotencyKey: `hosted-sample:${review.reviewRequestId}`,
          actor: { ...getSingleArticleActor(), auditReason: "用户确认 GEO 托管策略后生成一篇代表样文" }
        });
        sampleBinding = {
          strategyPackId: result.strategyPackId,
          sampleTaskId: queuedSample.taskId,
          sampleOperationId: queuedSample.operation.operationId
        };
      } catch (error) {
        transitionError = { code: "hosted_sample_queue_failed", message: error instanceof Error ? error.message : "策略已确认，但样文暂时无法生成。" };
      }
    } else {
      try {
        const research = await getGeoResearchWorkspace(review.productId);
        if (!research.workspace) throw new V5GovernanceServiceError("research_project_not_found", "没有找到可继续修订的 GEO 调研项目。", 409);
        const comment = normalizedComment || "请重新整理策略。";
        const expressionFocus = `${research.workspace.project.expressionFocus}\n\n本次人工修订要求：${comment}`.slice(0, 4000);
        const revisionActor = {
          actorId: "hosted-review-orchestrator",
          actorRole: "workbench_operator",
          actorType: "system" as const,
          auditReason: "根据用户在托管审核中的修改意见重新发起 GEO 调研"
        };
        const updated = await updateGeoResearchProject({
          productId: review.productId,
          expectedProjectVersion: research.workspace.project.rowVersion,
          expressionFocus,
          forbiddenFocus: research.workspace.project.forbiddenFocus,
          researchMarkets: research.workspace.project.researchMarkets,
          languages: research.workspace.project.languages,
          targetChannels: research.workspace.project.targetChannels,
          idempotencyKey: `hosted-strategy-revision-project:${review.reviewRequestId}`.slice(0, 128),
          actor: revisionActor
        });
        await startGeoResearchRun({
          productId: review.productId,
          triggerType: "manual_refresh",
          expectedProjectVersion: updated.workspace.project.rowVersion,
          idempotencyKey: `hosted-strategy-revision-run:${review.reviewRequestId}`.slice(0, 128),
          actor: revisionActor
        });
      } catch (error) {
        transitionError = {
          code: "hosted_strategy_revision_queue_failed",
          message: error instanceof Error ? error.message : "修改意见已保存，但重新调研暂时无法启动。"
        };
      }
    }
    const completed = await completeHostedReviewRequestRecord({ reviewRequestId: review.reviewRequestId, decision: input.decision, comment: normalizedComment, actedBy: actorId, resultContent });
    await updateOrderState(
      review.orderId,
      transitionError ? "action_required" : approved ? "generating_sample" : "preparing",
      transitionError ? undefined : approved ? "generate_sample" : undefined,
      transitionError,
      sampleBinding
    );
    return {
      review: completed.review,
      strategy: result,
      sampleQueued: approved && !transitionError,
      strategyRevisionQueued: !approved && !transitionError,
      replayed: completed.replayed
    };
  }

  const samples = await readProductSampleArticles(review.productId);
  const item = samples?.items.find((candidate) => candidate.draft?.draftVersionId === review.targetId);
  if (!item?.taskId) throw new V5GovernanceServiceError("hosted_review_target_changed", "样文已经更新，请使用最新邮件链接。", 409);
  const singleArticleActor = getSingleArticleActor();
  const detail = await readProductSampleArticleDetail(review.productId, item.taskId);
  const version = detail?.versions.find(candidate => candidate.draftVersionId === review.targetId);
  if (!detail || !version) throw new V5GovernanceServiceError("hosted_sample_not_found", "没有找到本次确认的样文版本，请刷新后重试。", 404);
  const resultContent = sampleResultContent({ sourceId: review.targetId, sourceVersion: review.targetId, title: version.title, markdown: version.markdown, articleTypeName: detail.articleTypeName, channel: "wechat" });
  const feedback = await decideSampleArticle({
    draftVersionId: review.targetId,
    idempotencyKey,
    feedback: input.decision === "approve" ? { decision: "approved" } : { decision: "changes_requested", revisionInstruction: normalizedComment },
    actor: { ...singleArticleActor, actorId, actorType: "human", auditReason: input.decision === "approve" ? "用户通过托管邮件确认代表样文" : "用户通过托管邮件提交样文修改要求" }
  });
  if (input.decision === "changes_requested" && feedback.taskId) {
    await enqueueProductSampleRevision({ taskId: feedback.taskId, feedbackId: feedback.feedbackId, actor: { ...singleArticleActor, auditReason: "根据托管用户的一条修改意见生成新样文" } });
  }
  const completed = await completeHostedReviewRequestRecord({ reviewRequestId: review.reviewRequestId, decision: input.decision, comment: normalizedComment, actedBy: actorId, resultContent });
  await updateOrderState(review.orderId, input.decision === "approve" ? "running" : "preparing");
  return { review: completed.review, sample: feedback, productionReady: input.decision === "approve", replayed: completed.replayed };
}
