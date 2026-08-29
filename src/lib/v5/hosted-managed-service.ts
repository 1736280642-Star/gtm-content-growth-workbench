import { V5GovernanceServiceError } from "./knowledge-governance-service";
import { getProductGeoStrategyPackView } from "./product-strategy-pack-service";
import { readProductSampleArticles } from "./product-sample-article-service";
import { getActiveProduct } from "./product-registry-service";
import type {
  CreateHostedPromotionOrderInput,
  HostedPromotionOrderRecord,
  HostedOrderStatus
} from "./hosted-managed-contracts";
import { compileHostedOrderNextAction } from "./hosted-managed-contracts";
import {
  createHostedPromotionOrderRecord,
  readHostedPromotionOrderRecord,
  updateHostedPromotionOrderStatus
} from "./hosted-managed-repository";
import { ensureHostedReviewForOrder } from "./hosted-review-service";
import { listHostedChannelOptions } from "./hosted-channel-service";
import { enqueueHostedNotification } from "./hosted-notification-service";
import { getV5GovernancePool } from "./knowledge-governance-repository";
import type { RowDataPacket } from "mysql2/promise";
import { getMonthlyReview } from "./monthly-review-service";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertCreateInput(input: CreateHostedPromotionOrderInput) {
  if (!input.productId.trim() || input.productId.length > 64) throw new V5GovernanceServiceError("invalid_contract", "产品标识无效。", 400);
  if (!emailPattern.test(input.contactEmail) || input.contactEmail.length > 320) throw new V5GovernanceServiceError("invalid_contract", "请填写有效的通知邮箱。", 400);
  if (!input.channels.length || input.channels.length > 8) throw new V5GovernanceServiceError("invalid_contract", "请选择 1-8 个推广渠道。", 400);
  const uniqueChannels = new Set(input.channels.map((item) => item.channel));
  if (uniqueChannels.size !== input.channels.length || input.channels.some((item) => !/^[a-z0-9_]{2,64}$/.test(item.channel))) {
    throw new V5GovernanceServiceError("invalid_contract", "推广渠道包含重复或无效标识。", 400);
  }
  if (input.channels.some((item) => item.dailyCap !== undefined && (!Number.isInteger(item.dailyCap) || item.dailyCap < 1 || item.dailyCap > 100))) {
    throw new V5GovernanceServiceError("invalid_contract", "渠道每日上限必须是 1-100 的整数。", 400);
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new V5GovernanceServiceError("invalid_contract", "托管提交标识无效。", 400);
  }
}

export async function createHostedPromotionOrder(input: CreateHostedPromotionOrderInput) {
  assertCreateInput(input);
  await getActiveProduct(input.productId);
  const stored = await createHostedPromotionOrderRecord(input);
  return { ...stored, nextAction: compileHostedOrderNextAction(stored.order) };
}

function mappedStatus(strategyStatus?: string, samples?: Awaited<ReturnType<typeof readProductSampleArticles>>): {
  status: HostedOrderStatus;
  currentActionType?: string;
} {
  if (strategyStatus === "pending_strategy_review") {
    return { status: "pending_strategy_review", currentActionType: "review_strategy" };
  }
  if (strategyStatus === "rejected") return { status: "preparing" };
  if (strategyStatus === "strategy_approved" || strategyStatus === "pending_sample_review") {
    const hasReviewableDraft = Boolean(samples?.items.some((item) => item.draft?.copyAllowed && item.reviewStatus !== "approved"));
    return hasReviewableDraft
      ? { status: "pending_sample_review", currentActionType: "review_sample" }
      : { status: "preparing" };
  }
  if (strategyStatus === "production_ready" || strategyStatus === "active") return { status: "running" };
  return { status: "preparing" };
}

function canAutomaticallyReconcile(order: Awaited<ReturnType<typeof readHostedPromotionOrderRecord>>) {
  if (!order || order.status !== "action_required") return true;
  return order.lastError?.code === "hosted_channel_authorization_required"
    || order.lastError?.code === "hosted_channel_unavailable";
}

async function applyChannelReadiness(
  order: NonNullable<Awaited<ReturnType<typeof readHostedPromotionOrderRecord>>>,
  mapped: { status: HostedOrderStatus; currentActionType?: string }
) {
  if (mapped.status !== "running") return { ...mapped, lastError: undefined };
  const options = await listHostedChannelOptions(order.productId);
  const selected = order.channels
    .map((preference) => options.find((option) => option.channel === preference.channel))
    .filter((option): option is NonNullable<typeof option> => Boolean(option));
  const unavailable = selected.filter((option) => option.authorizationStatus === "unavailable" || option.capability === "unsupported");
  if (unavailable.length) {
    return {
      status: "action_required" as const,
      currentActionType: "resolve_channel",
      lastError: {
        code: "hosted_channel_unavailable",
        message: `所选渠道 ${unavailable.map((item) => item.channel).join("、")} 尚未具备托管发布条件，请更换渠道或等待运营配置。`
      }
    };
  }
  const authorizationRequired = selected.filter((option) => option.authorizationStatus === "required");
  if (authorizationRequired.length) {
    return {
      status: "action_required" as const,
      currentActionType: "resolve_channel",
      lastError: {
        code: "hosted_channel_authorization_required",
        message: `所选渠道 ${authorizationRequired.map((item) => item.channel).join("、")} 尚未确认发布账号。完成一次渠道连接后，系统会自动继续。`
      }
    };
  }
  return { ...mapped, lastError: undefined };
}

async function isMonthlyExecutionComplete(order: NonNullable<Awaited<ReturnType<typeof readHostedPromotionOrderRecord>>>) {
  if (!order.currentMonthlyPlanId || order.status !== "running") return false;
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT plan.status,
            SUM(CASE WHEN item.id IS NOT NULL AND item.status NOT IN ('published', 'cancelled') THEN 1 ELSE 0 END) AS remaining
     FROM monthly_plan plan
     LEFT JOIN content_matrix_item item
       ON item.monthly_plan_id = plan.id AND item.product_id = ?
     WHERE plan.id = ?
     GROUP BY plan.id, plan.status`,
    [order.productId, order.currentMonthlyPlanId]
  );
  return Boolean(rows[0]
    && ["review_ready", "completed"].includes(String(rows[0].status))
    && Number(rows[0].remaining || 0) === 0);
}

function uniqueStrings(values: Array<string | undefined>, limit = 4) {
  return [...new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))].slice(0, limit);
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? undefined : `${Math.round(value * 100)}%`;
}

export async function buildHostedMonthlyCompletionSummary(order: HostedPromotionOrderRecord) {
  const fallback = {
    month: "本轮次",
    metrics: { plannedContent: 0, publishedContent: 0, stablePublishedContent: 0, successfulCaptureCount: 0 },
    conclusions: ["本轮计划内的发布任务已经全部收口。"],
    problems: [] as string[],
    recommendations: [] as Array<{ title: string; rationale?: string }>,
    dataStatus: "partial"
  };
  if (!order.currentMonthlyPlanId) return fallback;
  let rows: RowDataPacket[];
  try {
    [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT plan.plan_month,
              COUNT(item.id) AS planned_content,
              SUM(CASE WHEN result.status = 'published' AND result.public_url IS NOT NULL
                        AND result.first_public_observed_at IS NOT NULL THEN 1 ELSE 0 END) AS published_content,
              SUM(CASE WHEN item.status = 'cancelled' THEN 1 ELSE 0 END) AS deferred_content
       FROM monthly_plan plan
       LEFT JOIN content_matrix_item item ON item.monthly_plan_id = plan.id AND item.product_id = ?
       LEFT JOIN content_publish_result result ON result.matrix_item_id = item.id
       WHERE plan.id = ?
       GROUP BY plan.id, plan.plan_month`,
      [order.productId, order.currentMonthlyPlanId]
    );
  } catch {
    return fallback;
  }
  if (!rows[0]) return fallback;
  const month = String(rows[0].plan_month);
  const plannedContent = Number(rows[0].planned_content || 0);
  const publishedContent = Number(rows[0].published_content || 0);
  const deferredContent = Number(rows[0].deferred_content || 0);
  const publicationConclusion = `本轮计划 ${plannedContent} 篇，已获得 ${publishedContent} 个通过初次可访问检查的公开结果${deferredContent ? `，${deferredContent} 篇取消或顺延` : ""}。`;
  const baseSummary = {
    month,
    metrics: { plannedContent, publishedContent, stablePublishedContent: 0, successfulCaptureCount: 0 },
    conclusions: [publicationConclusion],
    problems: [] as string[],
    recommendations: [] as Array<{ title: string; rationale?: string }>,
    dataStatus: "partial"
  };
  try {
    const review = await getMonthlyReview(month);
    const optimization = review.productOptimizations.find((item) => item.productId === order.productId);
    const signals = optimization?.signals;
    const mentionRate = percent(signals?.targetMentionRate);
    const citationRate = percent(signals?.ownedCitationRate);
    const relationshipRate = percent(signals?.relationshipAccuracyRate);
    const conclusions = uniqueStrings([
      publicationConclusion,
      signals ? `${signals.successfulCaptureCount}/${signals.captureTaskCount} 次 AI 前台测试成功完成。` : undefined,
      mentionRate ? `AI 前台测试中的目标实体提及率为 ${mentionRate}${citationRate ? `，自有来源引用率为 ${citationRate}` : ""}。` : undefined,
      relationshipRate ? `产品关系表达准确率为 ${relationshipRate}。` : undefined
    ]);
    const problems = uniqueStrings(optimization?.gaps.map((item) => item.reason) || []);
    const recommendations = optimization?.actions.slice(0, 4).map((item) => ({ title: item.title, rationale: item.rationale }))
      || [];
    return {
      month,
      metrics: {
        plannedContent,
        publishedContent,
        stablePublishedContent: signals?.stablePublishedContentCount ?? 0,
        successfulCaptureCount: signals?.successfulCaptureCount ?? 0
      },
      conclusions: conclusions.length ? conclusions : fallback.conclusions,
      problems,
      recommendations,
      dataStatus: review.source === "pending_config" || !optimization || optimization.status === "collecting" ? "partial" : "complete"
    };
  } catch {
    return baseSummary;
  }
}

async function enqueueHostedStateNotification(order: NonNullable<Awaited<ReturnType<typeof readHostedPromotionOrderRecord>>>) {
  if (order.status === "action_required") {
    await enqueueHostedNotification({
      orderId: order.orderId,
      eventType: "action_required",
      recipientEmail: order.contactEmail,
      payload: {
        productName: order.productName,
        subject: `【需要你处理】${order.productName} 的托管任务暂时停住了`,
        summary: order.lastError?.message || "有一项问题需要你处理，完成后系统会自动继续。",
        actionPath: order.lastError?.code.startsWith("hosted_channel_")
          ? `/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`
          : `/hosted/success?orderId=${encodeURIComponent(order.orderId)}`
      },
      dedupeKey: `hosted-action-required:${order.orderId}:${order.rowVersion}:${order.lastError?.code || "unknown"}`
    });
  }
  if (order.status === "completed" && order.notificationPreferences.monthlyCompleted) {
    const monthlySummary = await buildHostedMonthlyCompletionSummary(order);
    if (monthlySummary.dataStatus !== "complete") return;
    await enqueueHostedNotification({
      orderId: order.orderId,
      eventType: "monthly_completed",
      recipientEmail: order.contactEmail,
      payload: {
        productName: order.productName,
        subject: `${order.productName} 本轮 GEO 托管结果已生成`,
        summary: "本轮计划内的发布任务已经全部收口。你可以直接查看文章链接；系统会继续准备下一轮候选方案。",
        actionPath: `/hosted/email?orderId=${encodeURIComponent(order.orderId)}`,
        monthlySummary
      },
      dedupeKey: `hosted-monthly-completed:${order.orderId}:${order.currentMonthlyPlanId || order.rowVersion}`
    });
  }
}

export async function getHostedPromotionOrder(orderId: string) {
  let order = await readHostedPromotionOrderRecord(orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  if (!["paused", "completed"].includes(order.status) && canAutomaticallyReconcile(order)) {
    const [strategy, samples] = await Promise.all([
      getProductGeoStrategyPackView(order.productId),
      readProductSampleArticles(order.productId)
    ]);
    const mapped = await applyChannelReadiness(order, mappedStatus(strategy.latestStrategyPack?.status, samples));
    const lastErrorChanged = mapped.lastError?.code !== order.lastError?.code || mapped.lastError?.message !== order.lastError?.message;
    if (mapped.status !== order.status || mapped.currentActionType !== order.currentActionType || lastErrorChanged) {
      order = await updateHostedPromotionOrderStatus({
        orderId,
        expectedVersion: order.rowVersion,
        status: mapped.status,
        currentActionType: mapped.currentActionType,
        lastError: mapped.lastError,
        actorId: "hosted-status-reconciler",
        auditReason: "根据正式策略与样文状态同步托管端用户状态"
      });
    }
  }
  if (await isMonthlyExecutionComplete(order)) {
    order = await updateHostedPromotionOrderStatus({
      orderId,
      expectedVersion: order.rowVersion,
      status: "completed",
      actorId: "hosted-monthly-completion-reconciler",
      auditReason: "当月计划进入复盘就绪且产品发布项全部收口，完成托管周期"
    });
  }
  const pendingReview = await ensureHostedReviewForOrder(order);
  await enqueueHostedStateNotification(order);
  return {
    order,
    nextAction: compileHostedOrderNextAction(order),
    pendingReview: pendingReview ? { gateType: pendingReview.gateType, status: pendingReview.status, expiresAt: pendingReview.expiresAt } : undefined
  };
}

export async function reconcileHostedPromotionOrders(limit = 50) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id FROM hosted_promotion_order
     WHERE status NOT IN ('paused', 'completed')
        OR (status = 'completed'
            AND current_monthly_plan_id IS NOT NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(notification_preferences_json, '$.monthlyCompleted')) = 'true'
            AND NOT EXISTS (
              SELECT 1 FROM hosted_notification_outbox notification
              WHERE notification.order_id = hosted_promotion_order.id
                AND notification.event_type = 'monthly_completed'
                AND notification.status <> 'cancelled'
            ))
     ORDER BY updated_at LIMIT ?`,
    [Math.max(1, Math.min(200, limit))]
  );
  const results: Array<{ orderId: string; status: string; errorCode?: string }> = [];
  for (const row of rows) {
    try {
      const result = await getHostedPromotionOrder(String(row.id));
      results.push({ orderId: String(row.id), status: result.order.status });
    } catch (error) {
      results.push({ orderId: String(row.id), status: "failed", errorCode: error instanceof Error ? error.message : "hosted_reconcile_failed" });
    }
  }
  return { processed: results.length, results };
}
