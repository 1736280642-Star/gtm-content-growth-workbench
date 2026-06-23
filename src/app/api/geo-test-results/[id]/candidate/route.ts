import { addGeoResultToCandidatePool } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const result = addGeoResultToCandidatePool(params.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
