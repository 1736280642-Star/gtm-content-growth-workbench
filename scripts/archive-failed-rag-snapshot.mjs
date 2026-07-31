import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const snapshotId = process.argv.find((arg) => arg.startsWith("--snapshot-id="))?.slice("--snapshot-id=".length);
const confirmed = process.argv.includes("--confirm");
const failedEvaluationConfirmed = process.argv.includes("--failed-evaluation");

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (!snapshotId || !confirmed) {
  emit({ ok: false, status: "confirmation_required", required: ["--snapshot-id=<id>", "--confirm"] });
  process.exitCode = 1;
} else {
  const [{ readRagIndexSnapshotRecord, transitionRagIndexSnapshotRecord }, { readRagJobsForSnapshot, cancelRagJob }, { HttpRagOpenSearchAdapter }, { getV5GovernancePool }] = await Promise.all([
    import("../src/lib/v5/rag/rag-repository.ts"),
    import("../src/lib/v5/rag/job-repository.ts"),
    import("../src/lib/v5/rag/opensearch-adapter.ts"),
    import("../src/lib/v5/knowledge-governance-repository.ts")
  ]);
  const actor = {
    actorId: "codex-rag-maintenance",
    actorRole: "knowledge_governance_maintainer",
    actorType: "agent",
    auditReason: `归档零文档失败 RAG 快照 ${snapshotId}，停止其失败任务，避免旧规则版本继续重试。`
  };
  try {
    const snapshot = await readRagIndexSnapshotRecord(snapshotId);
    if (!snapshot) throw new Error("IndexSnapshot 不存在。");
    if (!["building", "pending_config", "validating"].includes(snapshot.status)) throw new Error(`只允许归档未完成快照，当前状态为 ${snapshot.status}。`);
    const failedEvaluation = snapshot.documentCount > 0 && snapshot.validationSummary?.passed === false;
    if (snapshot.documentCount !== 0 && !(failedEvaluationConfirmed && failedEvaluation)) {
      throw new Error("非空快照仅在评测明确失败且传入 --failed-evaluation 时允许归档。");
    }
    const jobs = await readRagJobsForSnapshot(snapshotId);
    const cancellableJobs = jobs.filter((job) => ["queued", "pending_config", "partial_failed", "failed"].includes(job.status));
    const adapter = new HttpRagOpenSearchAdapter();
    try {
      await adapter.deleteIndex(snapshot.indexName);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("OpenSearch 404")) throw error;
    }
    for (const job of cancellableJobs) {
      await cancelRagJob({ jobId: job.jobId, expectedStatus: job.status, actor, reasonCode: "snapshot_archived_after_failed_build" });
    }
    await transitionRagIndexSnapshotRecord({ id: snapshotId, from: snapshot.status, to: "archived", actor, action: "archive_failed_build" });
    emit({ ok: true, status: "archived", snapshotId, cancelledJobIds: cancellableJobs.map((job) => job.jobId), deletedIndexName: snapshot.indexName });
  } catch (error) {
    emit({ ok: false, status: "failed", message: error instanceof Error ? error.message : "Failed to archive RAG snapshot." });
    process.exitCode = 1;
  } finally {
    await getV5GovernancePool().end();
  }
}
