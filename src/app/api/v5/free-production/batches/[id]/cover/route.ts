import { NextResponse } from "next/server";
import { freeProductionErrorResponse, readFreeProductionMutation, readFreeProductionPayload } from "@/lib/v5/free-production-api";
import { readFreeProductionCover, saveFreeProductionCover } from "@/lib/v5/free-production-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const purpose = new URL(request.url).searchParams.get("purpose");
    if (purpose === "publish") {
      const token = process.env.WECHATSYNC_BRIDGE_TOKEN?.trim();
      if (!token) return NextResponse.json({ ok: false, error: { code: "BRIDGE_TOKEN_MISSING", message: "发布素材读取令牌尚未配置。" } }, { status: 503 });
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "发布素材读取未授权。" } }, { status: 401 });
      }
    }
    const cover = await readFreeProductionCover(routeParams.id);
    return new Response(new Uint8Array(cover.data), {
      headers: {
        "content-type": cover.mimeType,
        "content-length": String(cover.data.length),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(cover.fileName)}`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) { return freeProductionErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readFreeProductionPayload(request);
    const file = payload.file && typeof payload.file === "object" ? payload.file as { fileName?: unknown; mimeType?: unknown; dataBase64?: unknown } : {};
    const data = await saveFreeProductionCover(routeParams.id, {
      ...readFreeProductionMutation(payload),
      file: {
        fileName: typeof file.fileName === "string" ? file.fileName : "",
        mimeType: typeof file.mimeType === "string" ? file.mimeType : "",
        dataBase64: typeof file.dataBase64 === "string" ? file.dataBase64 : ""
      }
    }, request.headers.get("x-idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (error) { return freeProductionErrorResponse(error); }
}
