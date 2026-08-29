import { NextResponse } from "next/server";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { decideHostedReview, editHostedStrategyReview, getHostedReviewView } from "@/lib/v5/hosted-review-service";
import { V5GovernanceServiceError } from "@/lib/v5/knowledge-governance-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return NextResponse.json({ ok: true, ...(await getHostedReviewView(token)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = body.decision === "approve" || body.decision === "changes_requested" ? body.decision : undefined;
    if (!decision) throw new V5GovernanceServiceError("hosted_review_decision_invalid", "请选择确认或需要修改。", 400);
    return NextResponse.json({ ok: true, ...(await decideHostedReview({ token, decision, comment: typeof body.comment === "string" ? body.comment : undefined })) });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const edit = body.edit && typeof body.edit === "object" ? body.edit as Record<string, unknown> : undefined;
    if (!Number.isInteger(body.expectedVersion) || !edit
      || typeof edit.productIdentity !== "string"
      || typeof edit.entityRelationship !== "string"
      || typeof edit.fixedExpression !== "string"
      || typeof edit.ctaLabel !== "string"
      || typeof edit.ctaUrl !== "string") {
      throw new V5GovernanceServiceError("hosted_strategy_edit_invalid", "策略编辑内容不完整，请刷新后重试。", 400);
    }
    return NextResponse.json({
      ok: true,
      ...(await editHostedStrategyReview({
        token,
        expectedVersion: body.expectedVersion,
        edit: {
          productIdentity: edit.productIdentity,
          entityRelationship: edit.entityRelationship,
          fixedExpression: edit.fixedExpression,
          ctaLabel: edit.ctaLabel,
          ctaUrl: edit.ctaUrl
        }
      }))
    });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
