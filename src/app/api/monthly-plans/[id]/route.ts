import { readRequestPayload } from "@/lib/api-utils";
import { patchMonthlyPlan } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const payload = await readRequestPayload(request);
  const result = patchMonthlyPlan(params.id, payload);

  return NextResponse.json({
    status: "success",
    ...result,
    message: "月度计划已保存到本地持久化状态。"
  });
}
