import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";
import { getActiveProduct, getProductWorkflowSummary, updateProduct } from "@/lib/v5/product-registry-service";
import { readProductMaterialSummary } from "@/lib/v5/product-material-summary";
import { readProductKnowledgeProfile } from "@/lib/v5/product-knowledge-profile";
import { NextResponse } from "next/server";
import type { ProductKnowledgeProfileOverrideInput } from "@/lib/v5/product-registry-contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const product = await getActiveProduct(routeParams.productId);
    const [productProfile, workflowSummary, materialSummary] = await Promise.all([
      readProductKnowledgeProfile(product.productId, product.displayName),
      getProductWorkflowSummary(routeParams.productId),
      readProductMaterialSummary(routeParams.productId)
    ]);
    return NextResponse.json({ ok: true, product, productProfile, workflowSummary, materialSummary });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const routeParams = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const trustedActor = readTrustedServerActor("product_owner");
    if (process.env.NODE_ENV === "production" && !trustedActor) {
      throw new V5GovernanceServiceError(
        "authorization_not_configured",
        "当前生产环境未配置可信产品负责人身份，系统已阻止修改。",
        503,
        "配置工作台可信服务端身份后重试。"
      );
    }
    const actor = trustedActor || {
      actorId: request.headers.get("x-workbench-actor-id")?.trim() || "local-workbench-user",
      actorRole: "product_owner",
      actorType: "human" as const,
      auditReason: typeof body.auditReason === "string" && body.auditReason.trim()
        ? body.auditReason.trim()
        : "用户在产品详情页修改产品信息"
    };
    const result = await updateProduct({
      productId: routeParams.productId,
      product: {
        canonicalName: typeof body.canonicalName === "string" ? body.canonicalName : "",
        displayName: typeof body.displayName === "string" ? body.displayName : "",
        brandName: typeof body.brandName === "string" ? body.brandName : undefined,
        officialEntity: typeof body.officialEntity === "string" ? body.officialEntity : undefined,
        officialUrl: typeof body.officialUrl === "string" ? body.officialUrl : undefined,
        productCategory: typeof body.productCategory === "string" ? body.productCategory : undefined,
        entityRelationship: typeof body.entityRelationship === "string" ? body.entityRelationship : undefined,
        aliases: Array.isArray(body.aliases) ? body.aliases.filter((item: unknown): item is string => typeof item === "string") : [],
        knowledgeProfile: body.knowledgeProfile && typeof body.knowledgeProfile === "object"
          ? {
              positioning: Array.isArray(body.knowledgeProfile.positioning) ? body.knowledgeProfile.positioning : [],
              audiences: Array.isArray(body.knowledgeProfile.audiences) ? body.knowledgeProfile.audiences : [],
              capabilities: Array.isArray(body.knowledgeProfile.capabilities) ? body.knowledgeProfile.capabilities : [],
              scenarios: Array.isArray(body.knowledgeProfile.scenarios) ? body.knowledgeProfile.scenarios : [],
              boundaries: Array.isArray(body.knowledgeProfile.boundaries) ? body.knowledgeProfile.boundaries : [],
              sourceFactCount: Number(body.knowledgeProfile.sourceFactCount || 0)
            } satisfies ProductKnowledgeProfileOverrideInput
          : undefined
      },
      expectedVersion: Number(body.expectedVersion),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      actor
    });
    return NextResponse.json({ ok: true, product: result.product, replayed: result.replayed, message: "产品信息已保存。" });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
