import { exportPublishRecords } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST() {
  const result = exportPublishRecords();

  return NextResponse.json({
    status: "success",
    format: "csv",
    ...result,
    message: "发布清单已导出为 CSV，并记录导出时间。"
  });
}
