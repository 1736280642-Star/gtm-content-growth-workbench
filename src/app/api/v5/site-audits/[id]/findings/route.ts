import type { V5MutationContext } from "@/lib/v5/observation-contracts";
import type { SiteAuditFinding } from "@/lib/v5/site-audit-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { getSiteAuditWorkspace, ingestSiteAuditFindings } from "@/lib/v5/site-audit-service";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const workspace = await getSiteAuditWorkspace();
    return observationOk(workspace.findings.filter((item) => item.runId === params.id));
  } catch (error) {
    return observationError(error, "SITE_AUDIT_FINDINGS_READ_FAILED", "官网审计问题读取失败，请稍后重试。");
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await readObservationPayload(request);
    return observationOk(
      await ingestSiteAuditFindings(
        params.id,
        payload.findings as Omit<SiteAuditFinding, "id" | "runId" | "version" | "firstSeenAt" | "lastSeenAt">[],
        payload.context as V5MutationContext
      ),
      201
    );
  } catch (error) {
    return observationError(error, "SITE_AUDIT_FINDINGS_INGEST_FAILED", "官网审计结果保存失败，请检查 Runner 输出。");
  }
}
