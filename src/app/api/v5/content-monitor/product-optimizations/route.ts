import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationOk } from "@/lib/v5/observation-api";
import { getProductGeoOptimizationWorkspace } from "@/lib/v5/product-geo-optimization-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const productIds = new URL(request.url).searchParams.getAll("productId").map((item) => item.trim()).filter(Boolean);
    return observationOk(await getProductGeoOptimizationWorkspace(productIds.length ? productIds : undefined));
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
