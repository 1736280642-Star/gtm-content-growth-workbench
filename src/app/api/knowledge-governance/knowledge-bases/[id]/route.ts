import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getV5KnowledgeBaseRegistry } from "@/lib/v5/knowledge-governance-material-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await getV5KnowledgeBaseRegistry(params.id));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
