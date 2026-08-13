import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const productQuery = String(
  process.argv.find((value) => value.startsWith("--product="))?.slice("--product=".length) || ""
).trim().toLowerCase();

if (!productQuery) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: "invalid_input",
    message: "Use --product=<product name or id>."
  })}\n`);
  process.exitCode = 1;
} else {
  const { getV5GovernancePool } = await import("../src/lib/v5/knowledge-governance-repository.ts");
  const { readLatestGeoSourceSnapshot } = await import("../src/lib/v5/geo-research-repository.ts");
  const pool = getV5GovernancePool();
  try {
    const [products] = await pool.query(
      `SELECT id AS productId, display_name AS displayName, is_promoting AS isPromoting
       FROM product_entity
       WHERE LOWER(id) = ? OR LOWER(display_name) LIKE ? OR LOWER(canonical_name) LIKE ?
       ORDER BY CASE WHEN LOWER(id) = ? THEN 0 ELSE 1 END, display_name
       LIMIT 2`,
      [productQuery, `%${productQuery}%`, `%${productQuery}%`, productQuery]
    );
    if (products.length !== 1) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        status: products.length ? "ambiguous" : "not_found",
        products
      }, null, 2)}\n`);
      process.exitCode = 1;
    } else {
      const product = products[0];
      const [runs] = await pool.query(
        `SELECT id AS runId, run_version AS runVersion, status, live_search_verified AS liveSearchVerified,
                failure_code AS failureCode, created_at AS createdAt, updated_at AS updatedAt
         FROM geo_research_run
         WHERE product_id = ?
         ORDER BY run_version DESC LIMIT 1`,
        [product.productId]
      );
      const run = runs[0] || null;
      const [tasks] = run
        ? await pool.query(
            `SELECT task_type AS taskType, status, attempt, max_attempts AS maxAttempts,
                    provider, provider_model AS providerModel, failure_code AS failureCode
             FROM geo_research_task WHERE run_id = ? ORDER BY created_at, id`,
            [run.runId]
          )
        : [[]];
      const [counts] = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM source_snapshot s WHERE s.product_id = ?) AS sourceSnapshotCount,
          (SELECT COUNT(*) FROM geo_research_artifact a JOIN geo_research_run r ON r.id = a.run_id WHERE r.product_id = ?) AS artifactCount,
          (SELECT COUNT(*) FROM geo_research_evidence e JOIN geo_research_run r ON r.id = e.run_id WHERE r.product_id = ?) AS evidenceCount,
          (SELECT COUNT(*) FROM geo_research_finding f JOIN geo_research_run r ON r.id = f.run_id WHERE r.product_id = ?) AS findingCount,
          (SELECT COUNT(*) FROM geo_blueprint_version b JOIN geo_research_project p ON p.id = b.project_id WHERE p.product_id = ?) AS blueprintCount,
          (SELECT COUNT(*) FROM product_strategy_packs s WHERE s.product_id = ?) AS strategyPackCount,
          (SELECT COUNT(*) FROM production_contract_snapshot c WHERE c.product_id = ? AND c.production_mode = 'sample') AS sampleContractCount,
          (SELECT COUNT(*) FROM sample_article_feedback f WHERE f.product_id = ?) AS sampleFeedbackCount,
          (SELECT COUNT(*) FROM expression_calibration_version c WHERE c.product_id = ? AND c.status = 'active') AS activeCalibrationCount,
          (SELECT COUNT(*) FROM production_contract_snapshot c WHERE c.product_id = ? AND c.production_mode = 'batch') AS batchContractCount`,
        Array(10).fill(product.productId)
      );
      const [sourceSnapshots] = await pool.query(
        `SELECT id AS snapshotId, snapshot_hash AS snapshotHash,
                JSON_LENGTH(source_ids) AS sourceCount,
                JSON_LENGTH(source_revision_ids) AS revisionCount,
                JSON_LENGTH(approved_claim_ids) AS approvedClaimCount,
                created_at AS createdAt
         FROM source_snapshot
         WHERE product_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [product.productId]
      );
      const [snapshotSources] = sourceSnapshots[0]
        ? await pool.query(
            `SELECT sa.id AS sourceId, sa.title, sa.canonical_url AS canonicalUrl,
                    sa.document_type AS documentType, sa.authority_level AS authorityLevel,
                    sa.visibility
             FROM source_snapshot_item item
             JOIN source_asset sa ON sa.id = item.source_id
             WHERE item.source_snapshot_id = ?
             ORDER BY sa.id`,
            [sourceSnapshots[0].snapshotId]
          )
        : [[]];
      const governedSourceSnapshot = await readLatestGeoSourceSnapshot(String(product.productId));
      const currentTask = tasks.find((task) => task.status === "running")
        || tasks.find((task) => task.status === "pending_config")
        || tasks.find((task) => task.status === "queued")
        || null;
      process.stdout.write(`${JSON.stringify({
        ok: true,
        status: run?.status || "not_started",
        product,
        run,
        currentTask,
        tasks,
        latestSourceSnapshot: sourceSnapshots[0]
          ? { ...sourceSnapshots[0], quality: governedSourceSnapshot?.quality, sources: snapshotSources }
          : null,
        outputs: counts[0]
      }, null, 2)}\n`);
    }
  } finally {
    await pool.end();
  }
}
