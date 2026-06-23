import { NextResponse } from "next/server";
import { runAllConfigDiagnostics, runConfigDiagnostic } from "@/lib/config-diagnostics";
import { readRequestPayload } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runAllConfigDiagnostics();
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);

  if (typeof payload.key === "string" && payload.key.trim()) {
    const result = await runConfigDiagnostic(payload.key.trim());
    return NextResponse.json(result);
  }

  const result = await runAllConfigDiagnostics();
  return NextResponse.json(result);
}
