import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getGeoResearchWorkspace } from "@/lib/v5/geo-research-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const result = await getGeoResearchWorkspace(routeParams.productId);
    const findingCounts = Object.fromEntries(result.workspace
      ? [...result.workspace.latestFindings.reduce((counts, finding) => {
          counts.set(finding.findingType, (counts.get(finding.findingType) || 0) + 1);
          return counts;
        }, new Map<string, number>()).entries()]
      : []);
    const workspace = result.workspace ? {
      ...result.workspace,
      runs: result.workspace.runs.map((run) => ({
        ...run,
        plan: {}
      })),
      latestTasks: result.workspace.latestTasks.map((task) => ({
        ...task,
        request: {},
        outputSummary: {}
      })),
      latestEvidence: [],
      latestFindings: [],
      summary: {
        publicSourceCount: result.workspace.latestEvidence.filter((evidence) => Boolean(evidence.sourceUrl)).length,
        findingCount: result.workspace.latestFindings.length,
        findingCounts
      },
      currentBlueprint: result.workspace.currentBlueprint ? {
        blueprintVersionId: result.workspace.currentBlueprint.blueprintVersionId,
        status: result.workspace.currentBlueprint.status
      } : undefined
    } : undefined;
    return NextResponse.json({
      ok: true,
      product: result.product,
      readiness: result.readiness,
      workspace
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
