import { batchGenerateDrafts } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST() {
  const result = await batchGenerateDrafts();

  return NextResponse.json(result);
}
