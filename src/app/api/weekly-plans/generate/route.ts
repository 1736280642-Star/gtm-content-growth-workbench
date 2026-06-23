import { readRequestPayload } from "@/lib/api-utils";
import { generateWeeklyPlan } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const result = generateWeeklyPlan(payload);

  return NextResponse.json({
    status: "success",
    ...result,
    message: "周计划已写入本地持久化状态；后续可接入知识库、历史选题、渠道规则和博客诊断结果。"
  });
}
