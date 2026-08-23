import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import {
  buildHostedReviewToken,
  type HostedReviewRequestRecord
} from "./hosted-review-repository";
import {
  getV5GovernancePool,
  parseV5Json,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import { buildHostedPreferenceToken } from "./hosted-link-signing";
import { deliverHostedTransactionalEmail, hostedEmailDeliveryReady } from "./hosted-email-client";

export type HostedNotificationEvent =
  | "order_received"
  | "strategy_review_required"
  | "sample_review_required"
  | "daily_batch_closed"
  | "daily_batch_delta"
  | "action_required"
  | "monthly_completed";

interface OutboxRecord {
  id: string;
  orderId: string;
  reviewRequestId?: string;
  eventType: HostedNotificationEvent;
  recipientEmail: string;
  payload: Record<string, unknown>;
  status: string;
  attemptCount: number;
  rowVersion: number;
}

function mapOutbox(row: RowDataPacket): OutboxRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    reviewRequestId: row.review_request_id ? String(row.review_request_id) : undefined,
    eventType: String(row.event_type) as HostedNotificationEvent,
    recipientEmail: String(row.recipient_email),
    payload: parseV5Json(row.payload_json, {}),
    status: String(row.status),
    attemptCount: Number(row.attempt_count || 0),
    rowVersion: Number(row.row_version || 1)
  };
}

export async function enqueueHostedNotification(input: {
  orderId: string;
  reviewRequestId?: string;
  eventType: HostedNotificationEvent;
  recipientEmail: string;
  payload?: Record<string, unknown>;
  dedupeKey: string;
  availableAt?: Date;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [existingRows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_notification_outbox WHERE dedupe_key = ? LIMIT 1 FOR UPDATE", [input.dedupeKey]);
    if (existingRows[0]) return { outbox: mapOutbox(existingRows[0]), replayed: true };
    const id = `hosted-notification-${randomUUID()}`;
    await connection.query(
      `INSERT INTO hosted_notification_outbox
       (id, order_id, review_request_id, event_type, recipient_email, template_version,
        payload_json, dedupe_key, status, attempt_count, available_at)
       VALUES (?, ?, ?, ?, ?, 'v1', ?, ?, 'pending', 0, ?)`,
      [id, input.orderId, input.reviewRequestId || null, input.eventType, input.recipientEmail.toLocaleLowerCase(),
        stringifyV5Json(input.payload || {}), input.dedupeKey, input.availableAt || new Date()]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: "hosted-notification-orchestrator",
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: "根据托管业务事件创建去重通知",
      eventType: "hosted_notification_enqueued",
      objectType: "hosted_notification_outbox",
      objectId: id,
      afterSummary: { orderId: input.orderId, eventType: input.eventType, status: "pending" },
      correlationId: input.orderId
    });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_notification_outbox WHERE id = ?", [id]);
    return { outbox: mapOutbox(rows[0]), replayed: false };
  });
}

function publicBaseUrl() {
  const configured = process.env.HOSTED_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new V5GovernanceRepositoryError("hosted_public_url_missing", "托管邮件缺少公开访问地址。", 503);
  return "http://127.0.0.1:3027";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] || character);
}

function withPreferenceFooter(outbox: OutboxRecord, rendered: { subject: string; text: string; html: string }) {
  const token = buildHostedPreferenceToken(outbox.orderId);
  const preferenceUrl = `${publicBaseUrl()}/hosted/preferences/${encodeURIComponent(token)}`;
  return {
    ...rendered,
    text: `${rendered.text}\n\n通知偏好与每日结果退订：${preferenceUrl}`,
    html: `${rendered.html}<hr><p style="color:#66736d;font-size:12px">你可以<a href="${escapeHtml(preferenceUrl)}">修改通知偏好或退订每日结果</a>。必须处理的行动邮件不会关闭。</p>`
  };
}

async function readReview(reviewRequestId: string): Promise<HostedReviewRequestRecord> {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT review.*, order_row.contact_email, product.display_name AS product_name
     FROM hosted_review_request review
     JOIN hosted_promotion_order order_row ON order_row.id = review.order_id
     JOIN product_entity product ON product.id = review.product_id
     WHERE review.id = ? LIMIT 1`,
    [reviewRequestId]
  );
  if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_review_not_found", "邮件对应的审核请求不存在。", 404);
  const row = rows[0];
  return {
    reviewRequestId: String(row.id), orderId: String(row.order_id), productId: String(row.product_id),
    productName: String(row.product_name), contactEmail: String(row.contact_email), gateType: String(row.gate_type) as HostedReviewRequestRecord["gateType"],
    targetId: String(row.target_id), status: String(row.status) as HostedReviewRequestRecord["status"],
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : new Date(String(row.expires_at)).toISOString(),
    actedAt: row.acted_at ? new Date(String(row.acted_at)).toISOString() : undefined,
    actedBy: row.acted_by ? String(row.acted_by) : undefined, decision: row.decision ? String(row.decision) : undefined,
    comment: row.comment ? String(row.comment) : undefined,
    rowVersion: Number(row.row_version || 1),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(String(row.created_at)).toISOString()
  };
}

async function renderNotification(outbox: OutboxRecord) {
  if (outbox.eventType === "strategy_review_required" || outbox.eventType === "sample_review_required") {
    if (!outbox.reviewRequestId) throw new V5GovernanceRepositoryError("hosted_review_reference_missing", "审核通知缺少审核请求。", 500);
    const review = await readReview(outbox.reviewRequestId);
    const token = buildHostedReviewToken(review.reviewRequestId, review.expiresAt);
    const actionUrl = `${publicBaseUrl()}/hosted/review/${encodeURIComponent(token)}`;
    const isStrategy = review.gateType === "strategy";
    const subject = `【需要你确认】${review.productName} 的${isStrategy ? " GEO 推广策略" : "代表样文"}已准备好`;
    const action = isStrategy ? "确认推广方向" : "确认样文并开始托管";
    const text = `${review.productName} 的${isStrategy ? " GEO 推广策略" : "代表样文"}已经准备好。\n\n${action}：${actionUrl}\n\n链接在 ${new Date(review.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 前有效。`;
    const html = `<p>${escapeHtml(review.productName)} 的${isStrategy ? " GEO 推广策略" : "代表样文"}已经准备好。</p><p><a href="${escapeHtml(actionUrl)}">${action}</a></p><p>链接在 ${new Date(review.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 前有效。</p>`;
    return withPreferenceFooter(outbox, { subject, text, html });
  }
  const productName = String(outbox.payload.productName || "你的产品");
  if (outbox.eventType === "order_received") {
    const actionPath = typeof outbox.payload.actionPath === "string" && outbox.payload.actionPath.startsWith("/hosted/")
      ? outbox.payload.actionPath
      : undefined;
    const actionUrl = actionPath ? `${publicBaseUrl()}${actionPath}` : undefined;
    return withPreferenceFooter(outbox, {
      subject: `已接收：${productName} 的 GEO 托管任务`,
      text: `系统已经接手 ${productName} 的资料处理和 GEO 调研。策略准备好后，会再发送一封需要你确认的邮件。${actionUrl ? `\n\n查看当前状态：${actionUrl}` : ""}`,
      html: `<p>系统已经接手 <strong>${escapeHtml(productName)}</strong> 的资料处理和 GEO 调研。</p><p>策略准备好后，会再发送一封需要你确认的邮件。</p>${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">查看当前状态</a></p>` : ""}`
    });
  }
  if (outbox.eventType === "daily_batch_closed" || outbox.eventType === "daily_batch_delta") {
    const summary = String(outbox.payload.summary || "当日发布批次已经关闭。" );
    const results = Array.isArray(outbox.payload.results) ? outbox.payload.results as Array<Record<string, unknown>> : [];
    const statusLabels: Record<string, string> = {
      published: "已公开",
      platform_review: "平台审核中",
      failed: "未完成",
      deferred: "已顺延"
    };
    const channelNames: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };
    const lines = results.map((item) => {
      const status = String(item.status || "deferred");
      const url = typeof item.publicUrl === "string" && /^https?:\/\//i.test(item.publicUrl) ? item.publicUrl : undefined;
      const channel = String(item.channel || "");
      return `- ${String(item.title || "未命名内容")}｜${channelNames[channel] || "未知渠道"}｜${statusLabels[status] || "待处理"}${url ? `｜${url}` : ""}`;
    });
    const htmlRows = results.map((item) => {
      const status = String(item.status || "deferred");
      const channel = String(item.channel || "");
      const url = typeof item.publicUrl === "string" && /^https?:\/\//i.test(item.publicUrl) ? item.publicUrl : undefined;
      return `<li><strong>${escapeHtml(item.title || "未命名内容")}</strong> · ${escapeHtml(channelNames[channel] || "未知渠道")} · ${escapeHtml(statusLabels[status] || "待处理")}${url ? ` · <a href="${escapeHtml(url)}">查看公开文章</a>` : ""}</li>`;
    }).join("");
    return withPreferenceFooter(outbox, {
      subject: String(outbox.payload.subject || `${productName} 今日发布结果`),
      text: `${summary}\n\n${lines.join("\n")}`,
      html: `<p>${escapeHtml(summary)}</p><ul>${htmlRows}</ul>`
    });
  }
  const actionPath = typeof outbox.payload.actionPath === "string" && outbox.payload.actionPath.startsWith("/hosted/")
    ? outbox.payload.actionPath
    : undefined;
  const actionUrl = actionPath ? `${publicBaseUrl()}${actionPath}` : undefined;
  const subject = String(outbox.payload.subject || `${productName} 的托管状态更新`);
  const summary = String(outbox.payload.summary || "托管状态已经更新，请进入工作台查看。" );
  return withPreferenceFooter(outbox, {
    subject,
    text: `${summary}${actionUrl ? `\n\n立即处理：${actionUrl}` : ""}`,
    html: `<p>${escapeHtml(summary)}</p>${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">${outbox.eventType === "monthly_completed" ? "查看本月结果" : "立即处理"}</a></p>` : ""}`
  });
}

async function finalizeNotificationDelivery(input: {
  outbox: OutboxRecord;
  status: "sent" | "retry" | "blocked";
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryMinutes?: number;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_notification_outbox WHERE id = ? LIMIT 1 FOR UPDATE", [input.outbox.id]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_notification_not_found", "通知任务不存在。", 404);
    const current = mapOutbox(rows[0]);
    if (current.status !== "sending") return current;
    if (input.status === "sent") {
      await connection.query(
        `UPDATE hosted_notification_outbox SET status = 'sent', sent_at = NOW(), provider_message_id = ?,
         last_error_code = NULL, last_error_message = NULL, row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND status = 'sending'`,
        [input.providerMessageId || "accepted", current.id, current.rowVersion]
      );
    } else {
      await connection.query(
        `UPDATE hosted_notification_outbox SET status = ?, last_error_code = ?, last_error_message = ?,
         available_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND status = 'sending'`,
        [input.status, input.errorCode || "hosted_email_delivery_failed", input.errorMessage || "邮件投递失败。",
          input.retryMinutes || 1, current.id, current.rowVersion]
      );
    }
    await writeV5GovernanceAudit(connection, {
      actorId: "hosted-notification-worker",
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: input.status === "sent" ? "邮件供应商已接受托管通知" : "邮件投递失败并按策略记录重试状态",
      eventType: `hosted_notification_${input.status}`,
      objectType: "hosted_notification_outbox",
      objectId: current.id,
      beforeSummary: { status: "sending", attemptCount: current.attemptCount, rowVersion: current.rowVersion },
      afterSummary: { status: input.status, errorCode: input.errorCode, rowVersion: current.rowVersion + 1 },
      correlationId: current.orderId
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>("SELECT * FROM hosted_notification_outbox WHERE id = ? LIMIT 1", [current.id]);
    return mapOutbox(updatedRows[0]);
  });
}

export async function dispatchHostedNotifications(limit = 20) {
  if (!await hostedEmailDeliveryReady()) {
    return { processed: 0, results: [] as Array<{ id: string; status: string }>, pendingConfig: true };
  }
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT * FROM hosted_notification_outbox
     WHERE (status IN ('pending', 'retry') AND available_at <= NOW())
        OR (status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
     ORDER BY available_at, created_at LIMIT ?`,
    [Math.max(1, Math.min(100, limit))]
  );
  const results: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    const outbox = mapOutbox(row);
    const [claim] = await getV5GovernancePool().query<import("mysql2/promise").ResultSetHeader>(
      `UPDATE hosted_notification_outbox SET status = 'sending', attempt_count = attempt_count + 1, row_version = row_version + 1
       WHERE id = ? AND (status IN ('pending', 'retry') OR (status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)))`,
      [outbox.id]
    );
    if (claim.affectedRows !== 1) continue;
    try {
      const rendered = await renderNotification(outbox);
      const providerMessageId = await deliverHostedTransactionalEmail({ to: outbox.recipientEmail, ...rendered, idempotencyKey: outbox.id });
      await finalizeNotificationDelivery({ outbox, status: "sent", providerMessageId });
      results.push({ id: outbox.id, status: "sent" });
    } catch (error) {
      const code = error instanceof V5GovernanceRepositoryError ? error.code : "hosted_email_delivery_failed";
      const message = error instanceof Error ? error.message.slice(0, 500) : "邮件投递失败。";
      const attempts = outbox.attemptCount + 1;
      const terminal = attempts >= 5 || code === "hosted_email_provider_missing";
      const retryMinutes = Math.min(60, 2 ** attempts);
      await finalizeNotificationDelivery({
        outbox,
        status: terminal ? "blocked" : "retry",
        errorCode: code,
        errorMessage: message,
        retryMinutes
      });
      results.push({ id: outbox.id, status: terminal ? "blocked" : "retry" });
    }
  }
  return { processed: results.length, results, pendingConfig: false };
}
