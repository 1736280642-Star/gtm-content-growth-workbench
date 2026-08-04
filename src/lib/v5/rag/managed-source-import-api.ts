import { V5GovernanceServiceError } from "../knowledge-governance-service";
import type { V5GovernanceActor } from "../knowledge-governance-repository";
import { readTrustedServerActor } from "../knowledge-governance-api";

export function readManagedSourceImportActor(request: Request): V5GovernanceActor {
  if (process.env.NODE_ENV === "production") {
    const actor = readTrustedServerActor("knowledge_manager");
    if (actor) return { ...actor, auditReason: "用户通过工作台托管知识入口导入资料" };
    throw new V5GovernanceServiceError("authorization_not_configured", "托管知识导入尚未配置工作台可信身份。", 503, "完成 Docker 服务端身份配置后重启 Web。");
  }
  const actorId = request.headers.get("x-workbench-actor-id")?.trim() || "local-workbench-user";
  return {
    actorId: actorId.slice(0, 128),
    actorRole: "knowledge_manager",
    actorType: "human",
    auditReason: "用户通过 V5 工作台托管知识入口导入资料。"
  };
}
