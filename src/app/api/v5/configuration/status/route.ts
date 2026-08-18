import { getV5ConfigurationStatus } from "@/lib/v5/article-expression-service";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { NextResponse } from "next/server";
import { getContentMetricsConfigurationStatus } from "@/lib/content-metrics-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = getV5ConfigurationStatus();
    const metricsItems = await getContentMetricsConfigurationStatus();
    return NextResponse.json({ ...result, data: { items: [...result.data.items, ...metricsItems] } });
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
