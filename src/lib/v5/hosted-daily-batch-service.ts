import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getWorkspaceSetting } from "../workbench-store";
import {
  attachHostedDailyBatchDigest,
  listHostedDailyPublishBatchRecords,
  readHostedDailyPublishBatchRecord,
  upsertHostedDailyPublishBatchRecord,
  type HostedDailyPublishBatchView,
  type HostedDailyPublishResult
} from "./hosted-daily-batch-repository";
import { enqueueHostedNotification } from "./hosted-notification-service";
import { getV5GovernancePool } from "./knowledge-governance-repository";
import { bindHostedPromotionOrderMonthlyPlan, readHostedPromotionOrderRecord } from "./hosted-managed-repository";
import { V5GovernanceServiceError } from "./knowledge-governance-service";
import { classifyPublishResponsibility, type Responsibility } from "./responsibility";

export type { HostedDailyPublishBatchView, HostedDailyPublishResult } from "./hosted-daily-batch-repository";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : undefined;
}

function normalizeChannel(channel: string) {
  return channel === "zhihu_toutiao_general" ? "zhihu" : channel;
}

function businessClock(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

function configuredSystemCap(channel: string) {
  const key = channel === "zhihu" ? "zhihu_toutiao_general" : channel;
  const value = getWorkspaceSetting().publishPolicyByChannel?.[key as keyof NonNullable<ReturnType<typeof getWorkspaceSetting>["publishPolicyByChannel"]>]?.dailyLimit;
  return Math.max(1, Math.min(50, Number(value) || 2));
}

function batchId(orderId: string, businessDate: string) {
  return `hosted-daily-${createHash("sha256").update(`${orderId}:${businessDate}:1`).digest("hex").slice(0, 40)}`;
}

export function allHostedChannelCapsReached(
  effectiveCaps: Record<string, number>,
  results: HostedDailyPublishResult[]
) {
  const publishedByChannel = new Map<string, number>();
  const plannedByChannel = new Map<string, number>();
  for (const result of results) {
    plannedByChannel.set(result.channel, (plannedByChannel.get(result.channel) || 0) + 1);
    if (result.status === "published") {
      publishedByChannel.set(result.channel, (publishedByChannel.get(result.channel) || 0) + 1);
    }
  }
  const channelsWithTasks = Object.entries(effectiveCaps).filter(([channel]) => (plannedByChannel.get(channel) || 0) > 0);
  return channelsWithTasks.length > 0 && channelsWithTasks
    .every(([channel, cap]) => (publishedByChannel.get(channel) || 0) >= Math.min(cap, plannedByChannel.get(channel) || 0));
}

function resultStatus(row: RowDataPacket): HostedDailyPublishResult["status"] {
  const publishStatus = String(row.publish_status || "");
  const itemStatus = String(row.item_status || "");
  if (publishStatus === "published" && row.public_url && row.first_public_observed_at) return "published";
  if (["failed", "manual_takeover"].includes(publishStatus) || ["publish_failed", "intercepted", "cancelled"].includes(itemStatus)) return "failed";
  if (publishStatus === "published" || ["publishing", "scheduled"].includes(itemStatus)) return "platform_review";
  return "deferred";
}

function persistedResponsibility(value: unknown): Responsibility | undefined {
  return ["system", "external", "user"].includes(String(value)) ? String(value) as Responsibility : undefined;
}

function hostedSafeMessage(value: unknown, fallback: string) {
  const compact = String(value || "")
    .replace(/\r?\n\s*at\s+[^\n]+/gi, "")
    .replace(/\b(token|api[_ -]?key|secret|password|cookie|authorization)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[已隐藏]")
    .replace(/\s+/g, " ")
    .trim();
  return (compact || fallback).slice(0, 300);
}

export function resolveHostedDailyResultGuidance(input: {
  status: HostedDailyPublishResult["status"];
  publishStatus?: string;
  responsibility?: Responsibility;
  userActionRequired?: boolean;
  nextAutomaticAction?: string;
  nextAttemptAt?: string;
  attemptCount?: number;
}) {
  if (input.status === "published") {
    return { responsibility: "system" as const, userActionRequired: false };
  }
  if (input.userActionRequired === true || input.responsibility === "user") {
    return {
      responsibility: "user" as const,
      userActionRequired: true,
      nextAction: "请打开托管结果查看原因并完成当前处理。",
      attemptCount: input.attemptCount || 0
    };
  }
  if (input.status === "platform_review") {
    return {
      responsibility: "external" as const,
      userActionRequired: false,
      nextAction: "等待平台审核；系统会在公开 URL 出现后自动补发结果。"
    };
  }
  const classified = classifyPublishResponsibility(
    input.publishStatus === "manual_takeover" ? "manual_takeover_required" : input.publishStatus || input.status,
    input.attemptCount || 0
  );
  const responsibility = input.responsibility || classified.responsibility;
  const userActionRequired = classified.userActionRequired;
  if (userActionRequired) {
    return {
      responsibility: "user" as const,
      userActionRequired: true,
      nextAction: "请打开托管结果查看原因并完成当前处理。",
      attemptCount: input.attemptCount || 0
    };
  }
  if (responsibility === "external") {
    return {
      responsibility,
      userActionRequired: false,
      nextAction: "正在等待平台结果，系统会继续跟踪。",
      nextAttemptAt: input.nextAttemptAt,
      attemptCount: input.attemptCount || 0
    };
  }
  return {
    responsibility: "system" as const,
    userActionRequired: false,
    nextAction: input.nextAutomaticAction || classified.nextAutomaticAction || "系统将自动重试或顺延，无需你操作。",
    nextAttemptAt: input.nextAttemptAt,
    attemptCount: input.attemptCount || 0
  };
}

async function findMonthlyPlanId(productId: string, month: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT plan.id FROM monthly_plan plan
     JOIN content_matrix_item item ON item.monthly_plan_id = plan.id
     WHERE plan.plan_month = ? AND item.product_id = ?
     ORDER BY plan.updated_at DESC LIMIT 1`,
    [month, productId]
  );
  return rows[0]?.id ? String(rows[0].id) : undefined;
}

export async function reconcileHostedDailyPublishBatch(orderId: string, requestedDate?: string) {
  let order = await readHostedPromotionOrderRecord(orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  const clock = businessClock(order.timezone);
  const businessDate = requestedDate || clock.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new V5GovernanceServiceError("hosted_business_date_invalid", "业务日期无效。", 400);
  const monthlyPlanId = order.currentMonthlyPlanId || await findMonthlyPlanId(order.productId, businessDate.slice(0, 7));
  if (!monthlyPlanId) return undefined;
  if (monthlyPlanId !== order.currentMonthlyPlanId) {
    order = await bindHostedPromotionOrderMonthlyPlan({
      orderId,
      monthlyPlanId,
      expectedVersion: order.rowVersion,
      actorId: "hosted-daily-batch-reconciler"
    });
  }
  const selectedChannels = new Set(order.channels.map((item) => item.channel));
  const effectiveCaps = Object.fromEntries(order.channels.map((item) => {
    const systemCap = configuredSystemCap(item.channel);
    const userCap = order.dailyCaps[item.channel];
    return [item.channel, userCap ? Math.min(systemCap, userCap) : systemCap];
  }));
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT item.id AS task_id, item.title, item.channel, item.status AS item_status,
            item.responsibility, item.user_action_required, item.next_automatic_action,
            item.next_attempt_at, item.attempt_count,
            result.status AS publish_status, result.public_url, result.published_at,
            result.failure_reason, result.first_public_observed_at
     FROM content_matrix_item item
     LEFT JOIN content_publish_result result ON result.matrix_item_id = item.id
     WHERE item.monthly_plan_id = ? AND item.product_id = ? AND item.publish_date = ?
       AND item.status NOT IN ('archived')
     ORDER BY item.publish_time, item.id`,
    [monthlyPlanId, order.productId, businessDate]
  );
  const selectedRows = rows.filter((row) => selectedChannels.has(normalizeChannel(String(row.channel))));
  if (!selectedRows.length) return undefined;
  const results = selectedRows.map<HostedDailyPublishResult>((row) => {
    const status = resultStatus(row);
    const guidance = resolveHostedDailyResultGuidance({
      status,
      publishStatus: String(row.publish_status || row.item_status || ""),
      responsibility: persistedResponsibility(row.responsibility),
      userActionRequired: Boolean(row.user_action_required),
      nextAutomaticAction: row.next_automatic_action ? hostedSafeMessage(row.next_automatic_action, "系统将自动重试或顺延，无需你操作。") : undefined,
      nextAttemptAt: iso(row.next_attempt_at),
      attemptCount: Number(row.attempt_count || 0)
    });
    return {
      taskId: String(row.task_id),
      title: String(row.title),
      channel: normalizeChannel(String(row.channel)),
      status,
      publicUrl: status === "published" ? String(row.public_url) : undefined,
      publishedAt: status === "published" ? iso(row.published_at) : undefined,
      failureReason: status === "failed" ? hostedSafeMessage(row.failure_reason, "发布未完成。") : undefined,
      ...guidance
    };
  });
  const publishedCount = results.filter((item) => item.status === "published").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const pendingCount = results.length - publishedCount - failedCount;
  const capReached = allHostedChannelCapsReached(effectiveCaps, results);
  const allSettled = pendingCount === 0;
  const cutoffHour = Math.max(0, Math.min(23, Number(process.env.HOSTED_DAILY_DIGEST_CUTOFF_HOUR) || 20));
  const cutoffReached = businessDate < clock.date || (businessDate === clock.date && clock.hour >= cutoffHour);
  const shouldClose = capReached || allSettled || cutoffReached;
  const id = batchId(orderId, businessDate);
  const previous = await readHostedDailyPublishBatchRecord(id);
  const batch = await upsertHostedDailyPublishBatchRecord({
    batchId: id,
    orderId,
    monthlyPlanId,
    businessDate,
    timezone: order.timezone,
    effectiveCaps,
    results,
    plannedCount: results.length,
    publishedCount,
    pendingCount,
    failedCount,
    shouldClose,
    actorId: "hosted-daily-batch-reconciler"
  });
  if (batch.status === "closed" && !batch.digestOutboxId && order.notificationPreferences.dailyDigest) {
    const summary = `今日计划 ${batch.plannedCount} 篇，已发布 ${batch.publishedCount} 篇，${batch.pendingCount} 篇审核或顺延，${batch.failedCount} 篇未完成。`;
    const userActionRequired = results.some((item) => item.userActionRequired);
    const accountActionRequired = results.some((item) => item.userActionRequired && /授权|登录|验证|账号|auth/i.test(`${item.failureReason || ""} ${item.nextAction || ""}`));
    const notification = await enqueueHostedNotification({
      orderId,
      eventType: "daily_batch_closed",
      recipientEmail: order.contactEmail,
      dedupeKey: `daily_batch_closed:${id}`,
      payload: {
        productName: order.productName,
        businessDate,
        subject: `${userActionRequired ? "【需要你处理】" : ""}${order.productName} 今日发布结果`,
        summary,
        results,
        ...(userActionRequired ? {
          actionPath: accountActionRequired
            ? `/hosted/settings?orderId=${encodeURIComponent(order.orderId)}`
            : `/hosted/email?orderId=${encodeURIComponent(order.orderId)}`,
          actionLabel: accountActionRequired ? "处理账号连接" : "查看并处理"
        } : {})
      }
    });
    await attachHostedDailyBatchDigest({ batchId: id, outboxId: notification.outbox.id, actorId: "hosted-daily-batch-reconciler" });
  }
  if (order.notificationPreferences.dailyDigest && previous?.status === "closed" && batch.publishedCount > previous.publishedCount) {
    const previousPublicIds = new Set(previous.results.filter((item) => item.publicUrl).map((item) => item.taskId));
    const newResults = results.filter((item) => item.publicUrl && !previousPublicIds.has(item.taskId));
    if (newResults.length) {
      await enqueueHostedNotification({
        orderId,
        eventType: "daily_batch_delta",
        recipientEmail: order.contactEmail,
        dedupeKey: `daily_batch_delta:${id}:${batch.publishedCount}`,
        payload: {
          productName: order.productName,
          businessDate,
          subject: `${order.productName} 新增 ${newResults.length} 个公开 URL`,
          summary: `平台审核完成，新增 ${newResults.length} 个公开 URL。`,
          results: newResults
        }
      });
    }
  }
  return batch;
}

export async function reconcileHostedDailyPublishBatches(limit = 100) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id FROM hosted_promotion_order WHERE status = 'running' ORDER BY updated_at LIMIT ?`,
    [Math.max(1, Math.min(200, limit))]
  );
  const results: Array<{ orderId: string; batchId?: string; status: string; errorCode?: string }> = [];
  for (const row of rows) {
    try {
      const batch = await reconcileHostedDailyPublishBatch(String(row.id));
      results.push({ orderId: String(row.id), batchId: batch?.batchId, status: batch?.status || "no_tasks" });
    } catch (error) {
      results.push({ orderId: String(row.id), status: "failed", errorCode: error instanceof Error ? error.message : "hosted_daily_batch_failed" });
    }
  }
  return { processed: results.length, results };
}

export async function listHostedDailyPublishBatches(orderId: string, limit = 31) {
  const order = await readHostedPromotionOrderRecord(orderId);
  if (!order) throw new V5GovernanceServiceError("hosted_order_not_found", "托管任务不存在。", 404);
  return listHostedDailyPublishBatchRecords(orderId, limit);
}
