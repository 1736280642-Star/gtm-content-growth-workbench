import { reconcilePromotedProductAutomation } from "../src/lib/v5/product-automation-service.ts";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository.ts";

try {
  const result = await reconcilePromotedProductAutomation({
    actor: {
      actorId: "product-automation-operator",
      actorRole: "product_automation",
      actorType: "system",
      auditReason: "Compile reviewable product GEO strategy packs from completed research synthesis."
    }
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await getV5GovernancePool().end();
}
