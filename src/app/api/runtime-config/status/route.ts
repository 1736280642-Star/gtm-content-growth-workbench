import { getRuntimeConfigStatus } from "@/lib/runtime-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getRuntimeConfigStatus());
}
