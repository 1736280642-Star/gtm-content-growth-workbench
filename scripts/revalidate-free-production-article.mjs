import process from "node:process";
import { editFreeProductionArticle, getFreeProductionBatch } from "../src/lib/v5/free-production-service.ts";

const batchId = String(process.argv[2] || "").trim();
if (!batchId) {
  console.error("Usage: node scripts/revalidate-free-production-article.mjs <batch-id>");
  process.exit(1);
}

try {
  const batch = await getFreeProductionBatch(batchId);
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  if (!artifact) throw new Error("current_artifact_not_found");
  const result = await editFreeProductionArticle(batchId, {
    expectedVersion: batch.version,
    auditReason: "使用当前中文成稿规则重新校验已修订文章",
    artifactId: artifact.id,
    title: artifact.selectedTitle,
    summary: artifact.summary,
    articleBody: artifact.articleBody
  }, `article-revalidate-${Date.now()}`);
  const nextArtifact = result.draftArtifacts.find((item) => item.id === result.currentDraftArtifactId);
  console.log(JSON.stringify({
    ok: true,
    batchId: result.id,
    version: result.version,
    status: result.status,
    artifactId: nextArtifact?.id,
    artifactVersion: nextArtifact?.version,
    deterministicIssues: nextArtifact?.editorCheck.deterministicResults,
    advisoryIssues: nextArtifact?.editorCheck.advisoryResults,
    layoutPassed: nextArtifact?.wechatPresentation?.validation.passed
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error && typeof error === "object" && "code" in error ? error.code : "article_revalidation_failed",
    message: error instanceof Error ? error.message : String(error),
    nextAction: error && typeof error === "object" && "nextAction" in error ? error.nextAction : undefined
  }, null, 2));
  process.exit(1);
}
