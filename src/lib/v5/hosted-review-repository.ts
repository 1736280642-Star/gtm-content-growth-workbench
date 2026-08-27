import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getV5GovernancePool,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit
} from "./knowledge-governance-repository";
import { hostedLinkSigningSecret } from "./hosted-link-signing";

export type HostedReviewGate = "strategy" | "sample";
export type HostedReviewStatus = "pending" | "acted" | "expired" | "cancelled";

export interface HostedReviewRequestRecord {
  reviewRequestId: string;
  orderId: string;
  productId: string;
  productName: string;
  contactEmail: string;
  gateType: HostedReviewGate;
  targetId: string;
  status: HostedReviewStatus;
  expiresAt: string;
  actedAt?: string;
  actedBy?: string;
  decision?: string;
  comment?: string;
  rowVersion: number;
  createdAt: string;
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : "";
}

function mapReview(row: RowDataPacket): HostedReviewRequestRecord {
  return {
    reviewRequestId: String(row.id),
    orderId: String(row.order_id),
    productId: String(row.product_id),
    productName: String(row.product_name || row.display_name || row.product_id),
    contactEmail: String(row.contact_email),
    gateType: String(row.gate_type) as HostedReviewGate,
    targetId: String(row.target_id),
    status: String(row.status) as HostedReviewStatus,
    expiresAt: iso(row.expires_at),
    actedAt: row.acted_at ? iso(row.acted_at) : undefined,
    actedBy: row.acted_by ? String(row.acted_by) : undefined,
    decision: row.decision ? String(row.decision) : undefined,
    comment: row.comment ? String(row.comment) : undefined,
    rowVersion: Number(row.row_version || 1),
    createdAt: iso(row.created_at)
  };
}

const reviewSelect = `SELECT review.*, order_row.contact_email, product.display_name AS product_name
  FROM hosted_review_request review
  JOIN hosted_promotion_order order_row ON order_row.id = review.order_id
  JOIN product_entity product ON product.id = review.product_id`;

function tokenPayload(reviewRequestId: string, expiresAt: string) {
  return Buffer.from(JSON.stringify({ id: reviewRequestId, exp: Math.floor(new Date(expiresAt).getTime() / 1000) })).toString("base64url");
}

export function buildHostedReviewToken(reviewRequestId: string, expiresAt: string) {
  const payload = tokenPayload(reviewRequestId, expiresAt);
  const signature = createHmac("sha256", hostedLinkSigningSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function buildHostedReviewExpiry(expiresInHours = 72, now = Date.now()) {
  return new Date(now + expiresInHours * 60 * 60 * 1000);
}

export function hashHostedReviewToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function verifyTokenSignature(token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效。", 404);
  const expected = createHmac("sha256", hostedLinkSigningSecret()).update(payload).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); } catch { throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效。", 404); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效。", 404);
  }
  let parsed: { id?: unknown; exp?: unknown };
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效。", 404); }
  const reviewRequestId = typeof parsed.id === "string" ? parsed.id : "";
  const expiresAt = Number(parsed.exp || 0);
  if (!reviewRequestId || !Number.isFinite(expiresAt)) throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效。", 404);
  return { reviewRequestId, expiresAt };
}

export async function ensureHostedReviewRequestRecord(input: {
  orderId: string;
  productId: string;
  gateType: HostedReviewGate;
  targetId: string;
  actorId: string;
  expiresInHours?: number;
}) {
  const baseKey = `hosted-review:${createHash("sha256").update(`${input.orderId}:${input.gateType}:${input.targetId}`).digest("hex").slice(0, 64)}`;
  return withV5GovernanceTransaction(async (connection) => {
    const [targetRows] = await connection.query<RowDataPacket[]>(
      `${reviewSelect} WHERE review.order_id = ? AND review.gate_type = ? AND review.target_id = ?
       ORDER BY review.created_at DESC LIMIT 1 FOR UPDATE`,
      [input.orderId, input.gateType, input.targetId]
    );
    if (targetRows[0] && String(targetRows[0].status) === "acted") return { review: mapReview(targetRows[0]), created: false };
    if (targetRows[0] && String(targetRows[0].status) === "pending" && new Date(String(targetRows[0].expires_at)).getTime() > Date.now()) {
      return { review: mapReview(targetRows[0]), created: false };
    }
    if (targetRows[0] && String(targetRows[0].status) === "pending") {
      const expiredReview = mapReview(targetRows[0]);
      await connection.query(
        "UPDATE hosted_review_request SET status = 'expired', row_version = row_version + 1 WHERE id = ? AND row_version = ?",
        [expiredReview.reviewRequestId, expiredReview.rowVersion]
      );
      await writeV5GovernanceAudit(connection, {
        actorId: input.actorId,
        actorRole: "workbench_operator",
        actorType: "system",
        auditReason: "审核链接到期后续签新的单次链接",
        eventType: "hosted_review_request_expired",
        objectType: "hosted_review_request",
        objectId: expiredReview.reviewRequestId,
        beforeSummary: { status: "pending", rowVersion: expiredReview.rowVersion },
        afterSummary: { status: "expired", rowVersion: expiredReview.rowVersion + 1 },
        correlationId: input.productId
      });
      targetRows[0].status = "expired";
    }
    const renewalBucket = targetRows[0] ? `:${Math.floor(Date.now() / 3_600_000)}` : "";
    const idempotencyKey = `${baseKey}${renewalBucket}`;
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `${reviewSelect} WHERE review.idempotency_key = ? LIMIT 1 FOR UPDATE`,
      [idempotencyKey]
    );
    if (existingRows[0]) return { review: mapReview(existingRows[0]), created: false };
    const reviewRequestId = `hosted-review-${randomUUID()}`;
    const expiresAtDate = buildHostedReviewExpiry(input.expiresInHours || 72);
    const expiresAt = expiresAtDate.toISOString();
    const tokenHash = hashHostedReviewToken(buildHostedReviewToken(reviewRequestId, expiresAt));
    await connection.query(
      `INSERT INTO hosted_review_request
       (id, order_id, product_id, gate_type, target_id, token_hash, status, expires_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [reviewRequestId, input.orderId, input.productId, input.gateType, input.targetId, tokenHash, expiresAtDate, idempotencyKey]
    );
    await writeV5GovernanceAudit(connection, {
      actorId: input.actorId,
      actorRole: "workbench_operator",
      actorType: "system",
      auditReason: `正式${input.gateType === "strategy" ? "策略" : "样文"}状态进入人工确认门禁`,
      eventType: "hosted_review_request_created",
      objectType: "hosted_review_request",
      objectId: reviewRequestId,
      afterSummary: { orderId: input.orderId, gateType: input.gateType, targetId: input.targetId, expiresAt },
      correlationId: input.productId
    });
    const [createdRows] = await connection.query<RowDataPacket[]>(`${reviewSelect} WHERE review.id = ? LIMIT 1`, [reviewRequestId]);
    return { review: mapReview(createdRows[0]), created: true };
  });
}

export async function readHostedReviewRequestByToken(token: string) {
  const verified = verifyTokenSignature(token);
  const result = await withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `${reviewSelect} WHERE review.id = ? AND review.token_hash = ? LIMIT 1 FOR UPDATE`,
      [verified.reviewRequestId, hashHostedReviewToken(token)]
    );
    const review = rows[0] ? mapReview(rows[0]) : undefined;
    if (!review) throw new V5GovernanceRepositoryError("hosted_review_token_invalid", "审核链接无效或已经撤销。", 404);
    const expired = verified.expiresAt * 1000 < Date.now() || new Date(review.expiresAt).getTime() < Date.now();
    if (expired && review.status === "pending") {
      await connection.query(
        "UPDATE hosted_review_request SET status = 'expired', row_version = row_version + 1 WHERE id = ? AND row_version = ? AND status = 'pending'",
        [review.reviewRequestId, review.rowVersion]
      );
      await writeV5GovernanceAudit(connection, {
        actorId: "hosted-review-link-verifier",
        actorRole: "workbench_operator",
        actorType: "system",
        auditReason: "用户打开了已经到期的托管审核链接",
        eventType: "hosted_review_request_expired",
        objectType: "hosted_review_request",
        objectId: review.reviewRequestId,
        beforeSummary: { status: "pending", rowVersion: review.rowVersion },
        afterSummary: { status: "expired", rowVersion: review.rowVersion + 1 },
        correlationId: review.productId
      });
    }
    if (expired) return { review, expired: true };
    const [orderRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, product_id, contact_email_verified_at, row_version FROM hosted_promotion_order WHERE id = ? LIMIT 1 FOR UPDATE",
      [review.orderId]
    );
    if (orderRows[0] && !orderRows[0].contact_email_verified_at) {
      const rowVersion = Number(orderRows[0].row_version || 1);
      await connection.query(
        "UPDATE hosted_promotion_order SET contact_email_verified_at = NOW(), row_version = row_version + 1 WHERE id = ? AND row_version = ?",
        [review.orderId, rowVersion]
      );
      await writeV5GovernanceAudit(connection, {
        actorId: `hosted-email-${hashHostedReviewToken(review.contactEmail).slice(0, 24)}`,
        actorRole: "product_owner",
        actorType: "human",
        auditReason: "用户首次打开邮箱中的有效托管审核链接",
        eventType: "hosted_contact_email_verified",
        objectType: "hosted_promotion_order",
        objectId: review.orderId,
        beforeSummary: { contactEmailVerified: false, rowVersion },
        afterSummary: { contactEmailVerified: true, rowVersion: rowVersion + 1 },
        correlationId: review.productId
      });
    }
    return { review, expired: false };
  });
  if (result.expired) {
    throw new V5GovernanceRepositoryError("hosted_review_token_expired", "审核链接已经过期。", 410, "回到托管状态页重新发送确认邮件。");
  }
  return result.review;
}

export async function completeHostedReviewRequestRecord(input: {
  reviewRequestId: string;
  decision: string;
  comment?: string;
  actedBy: string;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(`${reviewSelect} WHERE review.id = ? LIMIT 1 FOR UPDATE`, [input.reviewRequestId]);
    if (!rows[0]) throw new V5GovernanceRepositoryError("hosted_review_not_found", "审核请求不存在。", 404);
    const current = mapReview(rows[0]);
    if (current.status === "acted") {
      if (current.decision !== input.decision || (current.comment || "") !== (input.comment || "")) {
        throw new V5GovernanceRepositoryError("hosted_review_already_acted", "这项审核已经完成，不能提交不同决定。", 409);
      }
      return { review: current, replayed: true };
    }
    if (current.status !== "pending") throw new V5GovernanceRepositoryError("hosted_review_not_pending", "这项审核已经失效。", 409);
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE hosted_review_request SET status = 'acted', acted_at = NOW(), acted_by = ?, decision = ?, comment = ?,
       row_version = row_version + 1 WHERE id = ? AND row_version = ?`,
      [input.actedBy, input.decision, input.comment?.trim() || null, input.reviewRequestId, current.rowVersion]
    );
    if (result.affectedRows !== 1) throw new V5GovernanceRepositoryError("hosted_review_version_conflict", "审核状态已经变化，请刷新后重试。", 409);
    await writeV5GovernanceAudit(connection, {
      actorId: input.actedBy,
      actorRole: "product_owner",
      actorType: "human",
      auditReason: `用户通过邮件行动链接完成${current.gateType === "strategy" ? "策略" : "样文"}确认`,
      eventType: "hosted_review_request_acted",
      objectType: "hosted_review_request",
      objectId: input.reviewRequestId,
      beforeSummary: { status: current.status },
      afterSummary: { status: "acted", decision: input.decision, hasComment: Boolean(input.comment?.trim()), rowVersion: current.rowVersion + 1 },
      correlationId: current.productId
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(`${reviewSelect} WHERE review.id = ? LIMIT 1`, [input.reviewRequestId]);
    return { review: mapReview(updatedRows[0]), replayed: false };
  });
}
