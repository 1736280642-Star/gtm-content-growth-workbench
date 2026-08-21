import { createHmac, timingSafeEqual } from "node:crypto";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export function hostedLinkSigningSecret() {
  const configured = process.env.HOSTED_REVIEW_LINK_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new V5GovernanceRepositoryError(
      "hosted_review_secret_missing",
      "托管行动链接尚未配置签名密钥。",
      503,
      "配置 HOSTED_REVIEW_LINK_SECRET 后重试。"
    );
  }
  return "local-development-only-hosted-review-link-secret";
}

function sign(payload: string, scope: string) {
  return createHmac("sha256", hostedLinkSigningSecret()).update(`${scope}:${payload}`).digest("base64url");
}

export function buildHostedPreferenceToken(orderId: string) {
  const payload = Buffer.from(JSON.stringify({ id: orderId, scope: "preferences" })).toString("base64url");
  return `${payload}.${sign(payload, "preferences")}`;
}

export function verifyHostedPreferenceToken(token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new V5GovernanceRepositoryError("hosted_preference_token_invalid", "通知偏好链接无效。", 404);
  const expected = Buffer.from(sign(payload, "preferences"), "base64url");
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); } catch { throw new V5GovernanceRepositoryError("hosted_preference_token_invalid", "通知偏好链接无效。", 404); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new V5GovernanceRepositoryError("hosted_preference_token_invalid", "通知偏好链接无效。", 404);
  }
  let parsed: { id?: unknown; scope?: unknown };
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new V5GovernanceRepositoryError("hosted_preference_token_invalid", "通知偏好链接无效。", 404); }
  if (parsed.scope !== "preferences" || typeof parsed.id !== "string" || !parsed.id) {
    throw new V5GovernanceRepositoryError("hosted_preference_token_invalid", "通知偏好链接无效。", 404);
  }
  return { orderId: parsed.id };
}
