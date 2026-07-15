import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { getV5GovernanceRun } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await getV5GovernanceRun(params.id));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
