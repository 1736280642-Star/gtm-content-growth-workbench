import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [jobRepository, indexBuildService, infrastructureModule, ragRepository] = await Promise.all([
  import("../src/lib/v5/rag/job-repository.ts"),
  import("../src/lib/v5/rag/index-build-service.ts"),
  import("../src/lib/v5/rag/infrastructure.ts"),
  import("../src/lib/v5/rag/rag-repository.ts")
]);
const { leaseNextRagJob, finishRagJob } = jobRepository;
const { runRagIndexBuild } = indexBuildService;
const { getRagInfrastructureStatus, RagInfrastructureError } = infrastructureModule;
const { readRagIndexSnapshotRecord, transitionRagIndexSnapshotRecord } = ragRepository;

const workerId = `rag-index-worker-${process.pid}-${randomUUID()}`;
const configuredLeaseSeconds = Number(process.env.RAG_JOB_LEASE_SECONDS);
const leaseSeconds = Number.isInteger(configuredLeaseSeconds) && configuredLeaseSeconds > 0
  ? Math.min(configuredLeaseSeconds, 3600)
  : 300;
let leasedJob;
try {
  const infrastructure = getRagInfrastructureStatus();
  if (infrastructure.mysql.status !== "ready") {
    throw new RagInfrastructureError("pending_config", "RAG MySQL 尚未完整配置。", infrastructure.mysql.missingConfig);
  }
  const job = await leaseNextRagJob(workerId, leaseSeconds, ["index_build"]);
  leasedJob = job;
  if (!job) {
    console.log(JSON.stringify({ status: "idle", workerId }));
  } else if (job.jobType !== "index_build" || !job.indexSnapshotId) {
    await finishRagJob({ jobId: job.jobId, workerId, status: "failed", failureCode: "unsupported_job", failureMessage: `不支持 ${job.jobType} 或缺少 indexSnapshotId。` });
    console.error(JSON.stringify({ status: "failed", jobId: job.jobId, code: "unsupported_job" }));
    process.exitCode = 1;
  } else {
    const result = await runRagIndexBuild(job.indexSnapshotId);
    await finishRagJob({ jobId: job.jobId, workerId, status: "awaiting_validation" });
    console.log(JSON.stringify({ status: "awaiting_validation", jobId: job.jobId, result }));
  }
} catch (error) {
  const pending = error instanceof RagInfrastructureError || error?.code === "pending_config";
  const failureCode = pending ? "pending_config" : "index_worker_failed";
  const failureMessage = pending ? "RAG 索引构建依赖尚未完整配置。" : "RAG 索引构建失败，请查看受限服务端日志。";
  if (leasedJob) {
    if (pending && leasedJob.indexSnapshotId) {
      const snapshot = await readRagIndexSnapshotRecord(leasedJob.indexSnapshotId).catch(() => undefined);
      if (snapshot?.status === "building") {
        await transitionRagIndexSnapshotRecord({
          id: snapshot.indexSnapshotId,
          from: "building",
          to: "pending_config",
          actor: { actorId: workerId, actorRole: "rag_worker", actorType: "system", auditReason: "索引构建依赖缺失，等待配置后恢复。" },
          action: "configuration_missing"
        }).catch(() => undefined);
      }
    }
    await finishRagJob({ jobId: leasedJob.jobId, workerId, status: pending ? "pending_config" : "failed", failureCode, failureMessage }).catch(() => undefined);
  }
  const details = error instanceof RagInfrastructureError ? error.missingConfig : undefined;
  console.error(JSON.stringify({ status: pending ? "pending_config" : "failed", code: failureCode, ...(details ? { details } : {}) }));
  process.exitCode = pending ? 2 : 1;
}
