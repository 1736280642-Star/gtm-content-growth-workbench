import { NextResponse } from "next/server";
import { mediaLibraryErrorResponse, readMediaLibraryPayload } from "@/lib/v5/media-library-api";
import { archiveMediaLibraryAsset, updateMediaLibraryAsset } from "@/lib/v5/media-library-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await readMediaLibraryPayload(request);
    const data = await updateMediaLibraryAsset(id, {
      expectedVersion: Number(payload.expectedVersion),
      auditReason: typeof payload.auditReason === "string" ? payload.auditReason : "",
      productId: typeof payload.productId === "string" ? payload.productId : "",
      description: typeof payload.description === "string" ? payload.description : ""
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return mediaLibraryErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await readMediaLibraryPayload(request);
    const data = await archiveMediaLibraryAsset(id, {
      expectedVersion: Number(payload.expectedVersion),
      auditReason: typeof payload.auditReason === "string" ? payload.auditReason : ""
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return mediaLibraryErrorResponse(error);
  }
}

