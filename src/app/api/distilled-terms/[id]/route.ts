import { readRequestPayload } from "@/lib/api-utils";
import { archiveDistilledTerm, deleteDistilledTerm } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const action = typeof payload.action === "string" ? payload.action : "archive";

  if (action !== "archive") {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "不支持的蒸馏词操作。"
      },
      { status: 400 }
    );
  }

  const result = archiveDistilledTerm(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

export function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = deleteDistilledTerm(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
