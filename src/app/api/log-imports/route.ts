import { readRequestPayload } from "@/lib/api-utils";
import { readLogImportPayloadFromFormData } from "@/lib/log-import-file";
import { importBotLog } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const payload = contentType.includes("multipart/form-data") ? await readLogImportPayloadFromFormData(await request.formData()) : await readRequestPayload(request);
  const result = importBotLog(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
