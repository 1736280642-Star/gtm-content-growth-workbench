import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

test("capture device, lease, evidence, idempotency, and revoke persist in MySQL", async () => {
  const repository = await import("../src/lib/v5/capture-repository.ts");
  const governance = await import("../src/lib/v5/knowledge-governance-repository.ts");
  const responsibility = await import("../src/lib/v5/responsibility.ts");
  assert.equal(responsibility.classifyPublishResponsibility("failed", 2).responsibility, "system");
  assert.equal(responsibility.classifyPublishResponsibility("failed", 3).responsibility, "user");
  assert.equal(responsibility.classifyPublishResponsibility("auth_expired", 0).responsibility, "user");
  const suffix = randomUUID();
  const deviceId = `acceptance-device-${suffix}`;
  const productId = `acceptance-product-${suffix}`;
  const strategyPackId = `acceptance-pack-${suffix}`;
  const idempotencyKey = `acceptance-task-${suffix}`;
  let taskId;
  let evidenceId;
  let compiledStrategyPackId;
  const pool = governance.getV5GovernancePool();
  try {
    await pool.query(
      `INSERT INTO product_entity
       (id, canonical_name, display_name, aliases, status, confirmed_by, confirmed_at, row_version)
       VALUES (?, ?, ?, '[]', 'active', 'acceptance-user', NOW(), 1)`,
      [productId, `Acceptance ${suffix}`, "Acceptance product"]
    );
    const productRepository = await import("../src/lib/v5/product-registry-repository.ts");
    const promoted = await productRepository.updateProductPromotionRecord({
      productId,
      isPromoting: true,
      actor: { actorId: "acceptance-user", actorRole: "product_owner", actorType: "human", auditReason: "Phase 1 integration acceptance" }
    });
    assert.equal(promoted.isPromoting, true);
    await pool.query(
      `INSERT INTO product_strategy_packs
       (id, product_id, geo_blueprint_id, source_snapshot_id, rule_version, status, content_plan_json, compiled_at)
       VALUES (?, ?, 'acceptance-blueprint', 'acceptance-snapshot', '1.0.0', 'draft', '{"items":[]}', NOW())`,
      [strategyPackId, productId]
    );
    const strategyRepository = await import("../src/lib/v5/product-strategy-pack-repository.ts");
    const compiled = await strategyRepository.compileProductStrategyPack({
      productId,
      geoBlueprintId: "acceptance-approved-blueprint",
      sourceSnapshotId: "acceptance-source-snapshot",
      ruleVersion: "geo-blueprint-v1",
      contentPlan: { questions: ["acceptance"], channels: ["wechat"] },
      actor: { actorId: "acceptance-policy", actorRole: "product_automation", actorType: "system", auditReason: "Compile accepted strategy inputs" }
    });
    compiledStrategyPackId = compiled.pack.id;
    assert.equal(compiled.replayed, false);
    const compiledReplay = await strategyRepository.compileProductStrategyPack({
      productId,
      geoBlueprintId: "acceptance-approved-blueprint",
      sourceSnapshotId: "acceptance-source-snapshot",
      ruleVersion: "geo-blueprint-v1",
      contentPlan: { questions: ["acceptance"], channels: ["wechat"] },
      actor: { actorId: "acceptance-policy", actorRole: "product_automation", actorType: "system", auditReason: "Compile accepted strategy inputs" }
    });
    assert.equal(compiledReplay.replayed, true);
    const applied = await strategyRepository.applyProductStrategyPack({
      productId,
      strategyPackId,
      approved: true,
      actor: { actorId: "acceptance-user", actorRole: "product_owner", actorType: "human", auditReason: "Phase 1 integration acceptance" }
    });
    assert.equal(applied.status, "active");

    const pairing = await repository.createCapturePairingCode({ workspaceId: "acceptance-workspace", userId: "acceptance-user", ttlMinutes: 10 });
    assert.equal(typeof pairing.pairingCode, "string");
    const device = await repository.registerCaptureDevice({
      deviceId,
      pairingCode: pairing.pairingCode,
      platforms: ["doubao"]
    });
    assert.equal(device.status, "online");
    await assert.rejects(() => repository.registerCaptureDevice({ deviceId: `${deviceId}-replay`, pairingCode: pairing.pairingCode, platforms: ["doubao"] }), /配对码无效/);

    const created = await repository.createCaptureTask({
      productId,
      question: "Phase 1 acceptance question",
      platform: "doubao",
      idempotencyKey,
      priority: 10
    });
    taskId = created.taskId;
    const replayedTask = await repository.createCaptureTask({
      productId,
      question: "Phase 1 acceptance question",
      platform: "doubao",
      idempotencyKey,
      priority: 10
    });
    assert.equal(replayedTask.taskId, taskId);
    assert.equal(replayedTask.replayed, true);

    const lease = await repository.leaseCaptureTask({ taskId, deviceId, durationMs: 60_000 });
    assert.equal(lease.status, "leased");
    const payload = { answer: "acceptance", citations: ["https://example.com"], gaps: [{ type: "citation_gap", question: "Phase 1 acceptance question", priority: 80 }] };
    const artifactHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const evidence = await repository.uploadCaptureEvidence({
      taskId,
      artifactHash,
      deviceId,
      collectedBy: "acceptance-user",
      payload
    });
    evidenceId = evidence.id;
    assert.equal(evidence.replayed, false);
    const [adjustedPacks] = await pool.query("SELECT content_plan_json FROM product_strategy_packs WHERE id = ?", [strategyPackId]);
    const adjustedPlan = typeof adjustedPacks[0].content_plan_json === "string" ? JSON.parse(adjustedPacks[0].content_plan_json) : adjustedPacks[0].content_plan_json;
    assert.equal(adjustedPlan.executionAdjustments.length, 1);

    const rows = await repository.listCaptureTasks(taskId);
    assert.equal(rows[0].status, "completed");
    await repository.revokeCaptureDevice(deviceId);
    const devices = await repository.listCaptureDevices();
    assert.equal(devices.find((item) => item.deviceId === deviceId)?.status, "revoked");
  } finally {
    if (evidenceId) await pool.query("DELETE FROM capture_evidence WHERE id = ?", [evidenceId]);
    if (taskId) await pool.query("DELETE FROM attribution_chain WHERE source_event_id = ?", [taskId]);
    if (taskId) await pool.query("DELETE FROM capture_tasks WHERE task_id = ?", [taskId]);
    await pool.query("DELETE FROM capture_devices WHERE device_id = ?", [deviceId]);
    await pool.query("DELETE FROM capture_pairing_codes WHERE workspace_id = ?", ["acceptance-workspace"]);
    await pool.query("DELETE FROM governance_audit_event WHERE object_id IN (?, ?, ?)", [productId, strategyPackId, compiledStrategyPackId || ""]);
    await pool.query("DELETE FROM product_strategy_packs WHERE product_id = ?", [productId]);
    await pool.query("DELETE FROM product_entity WHERE id = ?", [productId]);
    await pool.end();
  }
});
