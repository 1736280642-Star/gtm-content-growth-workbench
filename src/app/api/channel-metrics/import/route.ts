import { readRequestPayload } from "@/lib/api-utils";
import { readChannelMetricTablesFromFormData } from "@/lib/channel-metrics-file";
import { importChannelMetricsForPublishRecords } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const payload = contentType.includes("multipart/form-data")
    ? { tables: await readChannelMetricTablesFromFormData(await request.formData()) }
    : await readRequestPayload(request);
  const result = importChannelMetricsForPublishRecords(payload);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
