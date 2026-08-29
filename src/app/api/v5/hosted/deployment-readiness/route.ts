import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readHostedEmailSenderStatus } from "@/lib/v5/hosted-email-sender-service";
import {
  evaluateHostedDeploymentReadiness,
  type HostedDeploymentFeature,
  type HostedDeploymentMode
} from "@/lib/v5/hosted-deployment-readiness";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<HostedDeploymentMode>(["docker", "server"]);
const FEATURES = new Set<HostedDeploymentFeature>(["email", "geo", "wechat", "browser_publish", "metrics", "capture"]);

function requireDeploymentToken(submitted: string) {
  const expected = process.env.HOSTED_EMAIL_SETUP_TOKEN?.trim();
  if (!expected) {
    throw new V5GovernanceServiceError(
      "HOSTED_DEPLOYMENT_CHECK_NOT_CONFIGURED",
      "部署检查尚未启用。先配置 HOSTED_EMAIL_SETUP_TOKEN 并重新部署。",
      503,
      "由部署人员配置部署级 Setup Token 后重启 Web。"
    );
  }
  const left = Buffer.from(submitted.trim());
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new V5GovernanceServiceError(
      "HOSTED_DEPLOYMENT_TOKEN_INVALID",
      "部署级 Setup Token 不正确。请核对后重试。",
      403,
      "使用部署环境中配置的 HOSTED_EMAIL_SETUP_TOKEN 重试。"
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { mode?: string; features?: string[]; setupToken?: string };
    requireDeploymentToken(String(body.setupToken || ""));
    const mode = String(body.mode || "docker") as HostedDeploymentMode;
    if (!MODES.has(mode)) {
      throw new V5GovernanceServiceError(
        "HOSTED_DEPLOYMENT_MODE_INVALID",
        "不支持的部署方式。",
        400,
        "请选择本地 Docker 或服务器部署。"
      );
    }
    const features = [...new Set(Array.isArray(body.features) ? body.features : [])]
      .filter((feature): feature is HostedDeploymentFeature => FEATURES.has(feature as HostedDeploymentFeature));
    const readiness = evaluateHostedDeploymentReadiness({ mode, features });
    let sender: { configured: boolean; provider?: string; senderHint?: string } | undefined;
    if (features.includes("email")) {
      try {
        sender = await readHostedEmailSenderStatus();
      } catch {
        sender = { configured: false };
      }
    }
    return NextResponse.json(
      { ok: true, ...readiness, sender },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
