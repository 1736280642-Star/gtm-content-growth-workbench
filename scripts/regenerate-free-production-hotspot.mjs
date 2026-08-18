import process from "node:process";
import { getFreeProductionBatch, integrateFreeProductionHotspot } from "../src/lib/v5/free-production-service.ts";

const batchId = String(process.argv[2] || "").trim();
const requestedMode = process.argv[3] === "integrate" ? "integrate" : "replace";
if (!batchId) {
  console.error("Usage: node scripts/regenerate-free-production-hotspot.mjs <batch-id> [replace|integrate]");
  process.exit(1);
}

try {
  const batch = await getFreeProductionBatch(batchId);
  const artifact = batch.draftArtifacts.find((item) => item.id === batch.currentDraftArtifactId);
  if (!artifact) throw new Error("current_artifact_not_found");
  const result = await integrateFreeProductionHotspot(batchId, {
    expectedVersion: batch.version,
    auditReason: "根据原始来源证据重新生成热点开篇",
    artifactId: artifact.id,
    mode: requestedMode
  }, `hotspot-regenerate-${Date.now()}`);
  const nextArtifact = result.draftArtifacts.find((item) => item.id === result.currentDraftArtifactId);
  console.log(JSON.stringify({
    ok: true,
    batchId: result.id,
    version: result.version,
    artifactId: nextArtifact?.id,
    title: nextArtifact?.selectedTitle,
    hotspotId: nextArtifact?.hotspotIntegration?.hotspotId,
    sourceTitle: nextArtifact?.hotspotIntegration?.sourceTitle,
    sourceProvider: nextArtifact?.hotspotIntegration?.sourceProvider,
    sourceEvidenceIds: nextArtifact?.hotspotIntegration?.sourceEvidenceIds
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error && typeof error === "object" && "code" in error ? error.code : "hotspot_regeneration_failed",
    message: error instanceof Error ? error.message : String(error),
    nextAction: error && typeof error === "object" && "nextAction" in error ? error.nextAction : undefined,
    details: error && typeof error === "object" && "details" in error ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
