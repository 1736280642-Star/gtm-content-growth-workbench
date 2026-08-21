import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export function hostedPublicBaseUrl() {
  const configured = process.env.HOSTED_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new V5GovernanceRepositoryError("hosted_public_url_missing", "托管邮件缺少公开访问地址。", 503);
  }
  return "http://127.0.0.1:3027";
}

export async function deliverHostedTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}) {
  const endpoint = process.env.HOSTED_EMAIL_DELIVERY_URL?.trim();
  const token = process.env.HOSTED_EMAIL_DELIVERY_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new V5GovernanceRepositoryError(
      "hosted_email_provider_missing",
      "邮件供应商尚未配置。",
      503,
      "配置邮件投递地址和服务端 Token 后重试。"
    );
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-idempotency-key": input.idempotencyKey
    },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new V5GovernanceRepositoryError("hosted_email_delivery_failed", "邮件供应商拒绝了投递请求。", 502);
  }
  return String(payload.messageId || payload.id || "accepted");
}

