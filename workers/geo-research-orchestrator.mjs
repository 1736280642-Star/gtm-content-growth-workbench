import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [{ runAutomaticGeoResearchOrchestration }, { getV5GovernancePool }, { reconcilePromotedProductAutomation }] = await Promise.all([
  import("../src/lib/v5/geo-research-service.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts"),
  import("../src/lib/v5/product-automation-service.ts")
]);

const actor = {
  actorId: `geo-research-policy-${process.pid}-${randomUUID()}`,
  actorRole: "geo_research_policy",
  actorType: "scheduler",
  auditReason: "Automatically create and refresh source-grounded GEO research after product binding."
};
const productIds = String(process.env.GEO_RESEARCH_PRODUCT_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

try {
  const result = await runAutomaticGeoResearchOrchestration({ actor, productIds });
  const automation = await reconcilePromotedProductAutomation({ actor });
  console.log(JSON.stringify({ status: "completed", ...result, automation }));
} catch (error) {
  const pendingConfig = ["pending_config", "V5_GOVERNANCE_PENDING_CONFIG"].includes(error?.code);
  console.error(JSON.stringify({ status: pendingConfig ? "pending_config" : "failed", code: error?.code || "geo_research_orchestration_failed", message: error instanceof Error ? error.message : "GEO research orchestration failed." }));
  process.exitCode = pendingConfig ? 2 : 1;
} finally {
  try {
    await getV5GovernancePool().end();
  } catch {
    // Database configuration may intentionally be absent in local setup.
  }
}
