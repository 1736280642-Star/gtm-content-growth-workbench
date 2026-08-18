import process from "node:process";
import { getFreeProductionBatch, regenerateFreeProductionArticle } from "../src/lib/v5/free-production-service.ts";

const batchId = String(process.argv[2] || "").trim();
if (!batchId) {
  console.error("Usage: node scripts/regenerate-free-production-article.mjs <batch-id>");
  process.exit(1);
}

try {
  const batch = await getFreeProductionBatch(batchId);
  const result = await regenerateFreeProductionArticle(batchId, {
    expectedVersion: batch.version,
    auditReason: "按完整主谓宾与自然长短句节奏重新生成全文"
  }, `article-regenerate-${Date.now()}`);
  const artifact = result.draftArtifacts.find((item) => item.id === result.currentDraftArtifactId);
  if (result.status === "generation_failed" || !artifact || artifact.id === batch.currentDraftArtifactId) {
    const failure = new Error(result.failureMessage || "正文模型未生成新的文章版本。");
    failure.code = result.failureCode || "article_regeneration_failed";
    failure.nextAction = result.nextAction;
    throw failure;
  }
  console.log(JSON.stringify({
    ok: true,
    batchId: result.id,
    version: result.version,
    status: result.status,
    artifactId: artifact?.id,
    artifactVersion: artifact?.version,
    previousArtifactId: artifact?.previousArtifactId,
    title: artifact?.selectedTitle,
    hotspotId: artifact?.hotspotIntegration?.hotspotId,
    deterministicIssues: artifact?.editorCheck.deterministicResults,
    advisoryIssues: artifact?.editorCheck.advisoryResults
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error && typeof error === "object" && "code" in error ? error.code : "article_regeneration_failed",
    message: error instanceof Error ? error.message : String(error),
    nextAction: error && typeof error === "object" && "nextAction" in error ? error.nextAction : undefined,
    details: error && typeof error === "object" && "details" in error ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
