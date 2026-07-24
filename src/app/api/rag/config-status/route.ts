import { NextResponse } from "next/server";
import { getRagInfrastructureStatus } from "@/lib/v5/rag/infrastructure";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ ok: true, data: getRagInfrastructureStatus() }); }
