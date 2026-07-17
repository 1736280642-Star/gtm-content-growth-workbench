import { startKnowledgeAutoImport } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const result = startKnowledgeAutoImport(params.id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === "pending_input" ? 400 : 404 });
}
