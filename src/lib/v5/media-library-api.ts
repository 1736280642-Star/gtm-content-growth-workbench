import { NextResponse } from "next/server";
import { MediaLibraryServiceError } from "./media-library-service";

export async function readMediaLibraryPayload(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid body");
    return payload as Record<string, unknown>;
  } catch {
    throw new MediaLibraryServiceError(400, "MEDIA_INVALID_REQUEST_BODY", "请求正文必须是 JSON 对象。", "刷新页面后重新提交。");
  }
}

export function mediaLibraryErrorResponse(error: unknown) {
  if (error instanceof MediaLibraryServiceError) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, nextAction: error.nextAction, details: error.details } }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: { code: "MEDIA_LIBRARY_INTERNAL_ERROR", message: "素材图库发生未知错误。", nextAction: "刷新后重试；若仍失败，请查看服务端日志。" } }, { status: 500 });
}

