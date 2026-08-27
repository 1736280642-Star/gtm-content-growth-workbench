import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import {
  linkWorkspaceProduct,
  requireHostedIdentity,
  requireHostedRole
} from "@/lib/v5/hosted-identity-service";
import { getActiveProduct } from "@/lib/v5/product-registry-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const identity = await requireHostedIdentity(request);
    requireHostedRole(identity, ["workspace_admin", "product_owner"]);
    const { productId } = await params;
    const product = await getActiveProduct(productId);
    const result = await linkWorkspaceProduct({
      workspaceId: identity.workspaceId,
      productId: product.productId,
      userId: identity.userId,
      actorRole: identity.role
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
