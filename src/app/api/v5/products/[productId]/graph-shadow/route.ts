import { NextResponse } from "next/server";
import { readTrustedServerActor, v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { readLatestProductGeoGraphWorkflow, readProductGeoGraphNodeEvents } from "@/lib/v5/graph/product-geo-workflow-repository";
import { reconcileProductGeoDomainShadowWorkflow, startProductGeoDomainShadowWorkflow } from "@/lib/v5/graph/product-geo-workflow-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  try {
    const run = await readLatestProductGeoGraphWorkflow(productId);
    const nodeEvents = run ? await readProductGeoGraphNodeEvents(run.id) : [];
    return NextResponse.json({ ok: true, data: run ? { run, nodeEvents } : null }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  try {
    const actor = readTrustedServerActor("developer_admin");
    if (!actor) return NextResponse.json({ ok: false, error: { code: "authorization_not_configured", message: "未配置可信工作台身份。" } }, { status: 503 });
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    if (!idempotencyKey) return NextResponse.json({ ok: false, error: { code: "idempotency_key_required", message: "缺少 x-idempotency-key。" } }, { status: 400 });
    const run = await startProductGeoDomainShadowWorkflow({
      productId,
      researchPolicyVersion: "geo-research.v2+domain-shadow.v3",
      idempotencyKey,
      actor: { ...actor, auditReason: "以正式业务数据运行只读 Graph Shadow 对比，不写入人工审批" }
    });
    return NextResponse.json({ ok: true, data: run }, { status: 201 });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  try {
    if (!readTrustedServerActor("developer_admin")) {
      return NextResponse.json({ ok: false, error: { code: "authorization_not_configured", message: "未配置可信工作台身份。" } }, { status: 503 });
    }
    return NextResponse.json({ ok: true, data: await reconcileProductGeoDomainShadowWorkflow(productId) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
