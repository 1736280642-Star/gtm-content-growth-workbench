import type { CreateSiteAuditRequest } from "@/lib/v5/site-audit-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createSiteAuditRun, getSiteAuditWorkspace } from "@/lib/v5/site-audit-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return observationOk(await getSiteAuditWorkspace());
  } catch (error) {
    return observationError(error, "SITE_AUDIT_READ_FAILED", "官网审计数据读取失败，请稍后重试。");
  }
}

export async function POST(request: Request) {
  try {
    return observationOk(await createSiteAuditRun((await readObservationPayload(request)) as unknown as CreateSiteAuditRequest), 201);
  } catch (error) {
    return observationError(error, "SITE_AUDIT_CREATE_FAILED", "官网审计批次创建失败，请检查审计范围。");
  }
}
