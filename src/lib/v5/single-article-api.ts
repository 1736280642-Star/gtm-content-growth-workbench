import { NextResponse } from "next/server";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import type { SingleArticleActor } from "./single-article-contracts";
import { SingleArticleProductionError } from "./single-article-production-service";

export function getSingleArticleActor(): SingleArticleActor {
  const enabled = process.env.V5_SINGLE_ARTICLE_WRITES_ENABLED === "true";
  if (process.env.NODE_ENV === "production" && !enabled) {
    throw new SingleArticleProductionError(503, "authorization_not_configured", "正式单篇写接口尚未启用可信服务端身份。", "配置服务端身份与 V5_SINGLE_ARTICLE_WRITES_ENABLED 后重试。");
  }
  const actorId = String(process.env.V5_SINGLE_ARTICLE_ACTOR_ID || (process.env.NODE_ENV === "production" ? "" : "local-single-article-operator")).trim();
  const rawRole = String(process.env.V5_SINGLE_ARTICLE_ACTOR_ROLE || (process.env.NODE_ENV === "production" ? "" : "developer_admin")).trim();
  const actorRole = rawRole === "workbench_operator" || rawRole === "developer_admin" ? rawRole : undefined;
  if (!actorId || !actorRole) {
    throw new SingleArticleProductionError(503, "actor_not_configured", "正式单篇操作缺少可信操作者或允许角色。", "配置 V5_SINGLE_ARTICLE_ACTOR_ID 与 workbench_operator/developer_admin 角色。");
  }
  return { actorId, actorRole, actorType: "human", auditReason: "User requested one formal Pharaoh Command article from the batch generation center" };
}

export function singleArticleErrorResponse(error: unknown) {
  if (error instanceof SingleArticleProductionError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details } }, { status: error.status });
  }
  if (error instanceof V5GovernanceRepositoryError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction } }, { status: error.httpStatus });
  }
  return NextResponse.json({ ok: false, error: { code: "single_article_internal_error", message: "正式单篇请求处理失败。", nextAction: "根据关联 ID 查看服务端日志后重试。" } }, { status: 500 });
}
