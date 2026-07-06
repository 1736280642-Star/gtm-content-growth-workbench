import { exportGeoResultBusinessMarkdown } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: { id: string } }) {
  const result = exportGeoResultBusinessMarkdown(params.id);

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
