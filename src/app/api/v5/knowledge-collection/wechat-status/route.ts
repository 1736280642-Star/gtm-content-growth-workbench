import { NextResponse } from "next/server";
import { listKnowledgeCollectionWorkspace } from "@/lib/v5/knowledge-collection-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = listKnowledgeCollectionWorkspace().data.sources.filter((item) => item.sourceType === "wechat_account");
  const latestCollectedAt = sources
    .map((item) => item.lastCollectedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
  const baseUrlConfigured = Boolean(process.env.WECHAT_COLLECTION_BASE_URL?.trim());
  const apiKeyConfigured = Boolean(process.env.WECHAT_COLLECTION_API_KEY?.trim());

  return NextResponse.json({
    ok: true,
    data: {
      configured: baseUrlConfigured && apiKeyConfigured,
      baseUrlConfigured,
      apiKeyConfigured,
      sourceCount: sources.length,
      enabledSourceCount: sources.filter((item) => item.enabled).length,
      failedSourceCount: sources.filter((item) => item.lastStatus === "failed").length,
      latestCollectedAt
    }
  });
}
