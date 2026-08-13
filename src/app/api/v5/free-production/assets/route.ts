import { NextResponse } from "next/server";
import { mediaLibraryErrorResponse, readMediaLibraryPayload } from "@/lib/v5/media-library-api";
import { createMediaLibraryAsset, listMediaLibraryAssets } from "@/lib/v5/media-library-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const data = await listMediaLibraryAssets({ productId: url.searchParams.get("productId") || undefined, mediaKind: url.searchParams.get("mediaKind") || undefined, query: url.searchParams.get("query") || undefined });
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return mediaLibraryErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readMediaLibraryPayload(request);
    const data = await createMediaLibraryAsset({
      expectedVersion: Number(payload.expectedVersion),
      auditReason: typeof payload.auditReason === "string" ? payload.auditReason : "",
      productId: typeof payload.productId === "string" ? payload.productId : "",
      description: typeof payload.description === "string" ? payload.description : "",
      file: payload.file && typeof payload.file === "object" ? payload.file as { fileName: string; mimeType: string; dataBase64: string } : { fileName: "", mimeType: "", dataBase64: "" }
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    return mediaLibraryErrorResponse(error);
  }
}

