import { parseKnowledgeDocumentsFromFormData } from "@/lib/knowledge-document-parser";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        ok: false,
        status: "pending_input",
        message: "请使用 multipart/form-data 上传文档。"
      },
      { status: 400 }
    );
  }

  const result = await parseKnowledgeDocumentsFromFormData(await request.formData());

  if (!result.documents.length) {
    return NextResponse.json(
      {
        ok: false,
        status: "pending_input",
        message: "请至少上传一份文档。"
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.failedCount ? "partial_success" : "success",
    message: result.failedCount ? `已解析 ${result.documents.length - result.failedCount} 份文档，${result.failedCount} 份失败。` : `已解析 ${result.documents.length} 份文档。`,
    data: result
  });
}
