import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { listKnowledgeCollectionWorkspace } from "@/lib/v5/knowledge-collection-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const result = listKnowledgeCollectionWorkspace();
    return NextResponse.json({
      ok: true,
      status: "success",
      data: {
        snapshots: result.data.todaySnapshots,
        latestRuns: result.data.latestRuns,
        stateVersion: result.data.stateVersion
      }
    });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
