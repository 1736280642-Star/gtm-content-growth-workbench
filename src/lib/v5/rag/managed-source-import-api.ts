import { V5GovernanceServiceError } from "../knowledge-governance-service";
import type { V5GovernanceActor } from "../knowledge-governance-repository";

export function readManagedSourceImportActor(request: Request): V5GovernanceActor {
  if (process.env.NODE_ENV === "production") {
    throw new V5GovernanceServiceError(
      "authorization_not_configured",
      "生产环境的托管知识导入需要可信服务端用户身份。",
      503,
      "接入 Session/SSO 身份后再启用生产写入。"
    );
  }
  const actorId = request.headers.get("x-workbench-actor-id")?.trim() || "local-workbench-user";
  return {
    actorId: actorId.slice(0, 128),
    actorRole: "knowledge_manager",
    actorType: "human",
    auditReason: "用户通过 V5 工作台托管知识入口导入资料。"
  };
}
