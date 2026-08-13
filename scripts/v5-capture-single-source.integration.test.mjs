import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

test("formal capture lease, evidence conversion, and review persist in MySQL", async () => {
  const repository = await import("../src/lib/v5/capture-repository.ts");
  const governance = await import("../src/lib/v5/knowledge-governance-repository.ts");
  const suffix = randomUUID();
  const deviceId = `capture-device-${suffix}`;
  let taskId;
  let answerId;
  try {
    await repository.registerCaptureDevice({ deviceId, workspaceId: "integration", userId: "integration", platforms: ["qwen"] });
    const created = await repository.createCaptureTask({
      productId: `integration-product-${suffix}`, question: "集成测试问题", questionVersionId: `question-version-${suffix}`,
      platform: "qwen", idempotencyKey: `capture-integration-${suffix}`, priority: 1
    });
    taskId = created.taskId;
    await repository.leaseCaptureTask({ taskId, deviceId, durationMs: 60_000 });
    const payload = {
      contractVersion: "frontend-capture-evidence.v1", answerText: "JOTO 在回答中被提及。",
      citations: [{ label: "官网", url: "https://joto.ai/", title: "JOTO", visibleSnippet: "JOTO", position: 1, capturedAt: new Date().toISOString(), verificationStatus: "verified", sourceType: "official" }],
      gaps: [{ code: "answer_coverage_gap", explanation: "仍需覆盖实施边界。", confidence: 0.8 }],
      targetEntity: "JOTO", targetEntityMentioned: true, adapterVersion: "integration", browserVersion: "integration"
    };
    const artifactHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await repository.uploadCaptureEvidence({ taskId, artifactHash, deviceId, collectedBy: "integration", payload });
    const observations = await repository.listFormalCaptureObservations();
    const observation = observations.find((item) => item.task.id === taskId);
    assert.equal(observation?.answer?.answerText, payload.answerText);
    assert.equal(observation?.answer?.citations.length, 1);
    assert.equal(observation?.gaps[0]?.code, "answer_coverage_gap");
    answerId = observation.answer.id;
    await repository.reviewFormalCaptureGaps(answerId, {
      actor: { actorId: "integration", actorRole: "workspace_user", actorType: "human" }, reason: "integration review",
      idempotencyKey: `review-${suffix}`, expectedVersion: 0, selectedGapIds: [observation.gaps[0].id],
      decision: "confirmed", destinations: ["blog_candidate"], note: "confirmed"
    });
    const reviewed = (await repository.listFormalCaptureObservations({ answerId }))[0];
    assert.equal(reviewed.gaps[0].status, "confirmed");
  } finally {
    const pool = governance.getV5GovernancePool();
    if (answerId) await pool.query("DELETE FROM capture_gap_reviews WHERE answer_id = ?", [answerId]);
    if (taskId) {
      await pool.query("DELETE FROM capture_evidence WHERE task_id = ?", [taskId]);
      await pool.query("DELETE FROM capture_tasks WHERE task_id = ?", [taskId]);
    }
    await pool.query("DELETE FROM capture_devices WHERE device_id = ?", [deviceId]);
    await pool.end();
  }
});
