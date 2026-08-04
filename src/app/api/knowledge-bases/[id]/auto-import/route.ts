import { startKnowledgeAutoImport } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  const result = startKnowledgeAutoImport(routeParams.id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 400 : 404 });
}
