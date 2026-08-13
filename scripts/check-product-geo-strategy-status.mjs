import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const query = String(process.argv.find((value) => value.startsWith("--product="))?.slice("--product=".length) || "").trim().toLowerCase();
if (!query) {
  process.stdout.write(`${JSON.stringify({ ok: false, status: "invalid_input", message: "使用 --product=<产品名称> 指定产品。" })}\n`);
  process.exitCode = 1;
} else {
  const { getV5GovernancePool } = await import("../src/lib/v5/knowledge-governance-repository.ts");
  const pool = getV5GovernancePool();
  try {
    const [rows] = await pool.query(
      `SELECT product.id AS productId,
              product.display_name AS displayName,
              product.is_promoting AS isPromoting,
              product.strategy_pack_id AS currentStrategyPackId,
              latest.id AS latestStrategyPackId,
              latest.status AS latestStrategyStatus,
              latest.strategy_version AS latestStrategyVersion,
              latest.contract_version AS latestContractVersion,
              project.status AS researchProjectStatus,
              (SELECT research_run.status
               FROM geo_research_run research_run
               WHERE research_run.product_id = product.id
               ORDER BY research_run.run_version DESC LIMIT 1) AS latestResearchRunStatus,
              (SELECT synthesis.status
               FROM geo_blueprint_version synthesis
               WHERE synthesis.project_id = project.id
               ORDER BY synthesis.version_number DESC LIMIT 1) AS researchSynthesisStatus,
              (SELECT snapshot.id
               FROM source_snapshot snapshot
               WHERE snapshot.product_id = product.id
               ORDER BY snapshot.created_at DESC LIMIT 1) AS sourceSnapshotId,
              (SELECT JSON_LENGTH(snapshot.source_ids)
               FROM source_snapshot snapshot
               WHERE snapshot.product_id = product.id
               ORDER BY snapshot.created_at DESC LIMIT 1) AS sourceCount,
              (SELECT JSON_LENGTH(snapshot.approved_claim_ids)
               FROM source_snapshot snapshot
               WHERE snapshot.product_id = product.id
               ORDER BY snapshot.created_at DESC LIMIT 1) AS approvedClaimCount
       FROM product_entity product
       LEFT JOIN geo_research_project project ON project.product_id = product.id
       LEFT JOIN product_strategy_packs latest
         ON latest.product_id = product.id
        AND latest.strategy_version = (
          SELECT MAX(candidate.strategy_version)
          FROM product_strategy_packs candidate
          WHERE candidate.product_id = product.id
        )
       WHERE LOWER(product.display_name) LIKE ? OR LOWER(product.canonical_name) LIKE ?
       ORDER BY product.display_name`,
      [`%${query}%`, `%${query}%`]
    );
    process.stdout.write(`${JSON.stringify({ ok: true, status: rows.length ? "found" : "not_found", products: rows }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}
