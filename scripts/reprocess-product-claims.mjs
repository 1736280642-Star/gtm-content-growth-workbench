import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = new Set(process.argv.slice(2));
const productArg = process.argv.slice(2).find((value) => value.startsWith("--product="));
const databaseArg = process.argv.slice(2).find((value) => value.startsWith("--database="));
const productId = productArg?.slice("--product=".length).trim();
const targetDatabase = databaseArg?.slice("--database=".length).trim();
const apply = args.has("--apply");

if (!productId || !/^[a-z0-9][a-z0-9-]{1,63}$/i.test(productId)) {
  throw new Error("Usage: node ... scripts/reprocess-product-claims.mjs --product=<productId> [--apply]");
}
if (targetDatabase && !/^[a-z0-9_]{1,64}$/i.test(targetDatabase)) {
  throw new Error("--database must be a valid MySQL database identifier.");
}
if (targetDatabase) process.env.MYSQL_DATABASE = targetDatabase;

const [{ getV5GovernancePool }, { extractManagedClaimsForProduct }] = await Promise.all([
  import("../src/lib/v5/knowledge-governance-repository.ts"),
  import("../src/lib/v5/rag/managed-claim-extraction-service.ts")
]);

const pool = getV5GovernancePool();

function looksLikeTaxonomyNoise(value) {
  const text = String(value || "").trim();
  const labelScanText = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  const labels = labelScanText.match(/\b(?:product(?:\s+teams?)?|teams?|leadership|project\s+management|sales|marketing|operations|security|pricing|features?|solutions?|customers?|resources?|partners?|library|company|about|contact)\b/gi) || [];
  const predicate = /支持|提供|用于|能够|可以|需要|适用|实现|帮助|部署|运行|使用|服务|\b(?:is|are|has|have|support(?:s|ed|ing)?|provid(?:e|es|ed|ing)|use(?:s|d|ing)?|need(?:s|ed|ing)?|design(?:s|ed|ing)?|built|serve(?:s|d|ing)?|upload(?:s|ed|ing)?|share(?:s|d|ing)?|ask(?:s|ed|ing)?)\b/i.test(text);
  return !predicate && (labels.length >= 3 || (/[a-z][A-Z]/.test(text) && labels.length >= 2));
}

async function readSummary() {
  const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
  const [[productRow]] = await pool.query("SELECT id, display_name FROM product_entity WHERE id = ? LIMIT 1", [productId]);
  const [rows] = await pool.query(
    `SELECT id, normalized_claim, review_status, reviewed_by, extractor_version
     FROM product_claim
     WHERE product_id = ?
     ORDER BY id`,
    [productId]
  );
  const counts = rows.reduce((result, row) => {
    const status = String(row.review_status);
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  return {
    database: String(databaseRow?.database_name || "unknown"),
    product: productRow ? { productId: String(productRow.id), productName: String(productRow.display_name) } : undefined,
    counts,
    suspicious: rows.filter((row) => looksLikeTaxonomyNoise(row.normalized_claim)).map((row) => ({
      claimId: String(row.id),
      text: String(row.normalized_claim),
      reviewStatus: String(row.review_status),
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : undefined,
      extractorVersion: String(row.extractor_version)
    }))
  };
}

try {
  const before = await readSummary();
  if (!apply) {
    console.log(JSON.stringify({ mode: "preview", productId, before }, null, 2));
  } else {
    const extraction = await extractManagedClaimsForProduct(productId, {
      actorId: "claim-cleanup-policy-v4",
      actorRole: "knowledge_governance_maintenance",
      actorType: "system",
      auditReason: "Re-evaluate current automatic Claims with taxonomy and fact-shape policy v4."
    });
    const after = await readSummary();
    console.log(JSON.stringify({ mode: "applied", productId, extraction, before, after }, null, 2));
  }
} finally {
  await pool.end();
}
