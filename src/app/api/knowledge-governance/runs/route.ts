import { readString } from "@/lib/api-utils";
import { readV5Actor, readV5GovernancePayload, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { createV5GovernanceRun } from "@/lib/v5/knowledge-governance-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readV5GovernancePayload(request);
    const result = await createV5GovernanceRun({
      batchId: readString(payload.batchId) || "",
      productId: readString(payload.productId),
      idempotencyKey: readString(payload.idempotencyKey) || "",
      actor: readV5Actor(payload)
    });
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
