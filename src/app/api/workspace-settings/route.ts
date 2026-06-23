import { readRequestPayload } from "@/lib/api-utils";
import { getWorkspaceSetting, saveWorkspaceSetting } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    status: "success",
    data: {
      workspaceSetting: getWorkspaceSetting()
    }
  });
}

export async function PATCH(request: Request) {
  const payload = await readRequestPayload(request);
  const result = saveWorkspaceSetting(payload);

  return NextResponse.json(result);
}
