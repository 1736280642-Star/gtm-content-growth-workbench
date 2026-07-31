import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [jobRepository, indexBuildService, infrastructureModule, ragRepository, evaluationModule, ragService, refreshRepository, governanceRepository] = await Promise.all([
  import("../src/lib/v5/rag/job-repository.ts"),
  import("../src/lib/v5/rag/index-build-service.ts"),
  import("../src/lib/v5/rag/infrastructure.ts"),
  import("../src/lib/v5/rag/rag-repository.ts"),
  import("../src/lib/v5/rag/automatic-index-evaluation-service.ts"),
  import("../src/lib/v5/rag/rag-service.ts"),
  import("../src/lib/v5/rag/knowledge-refresh-repository.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);
const { leaseNextRagJob, finishRagJob } = jobRepository;
const { runRagIndexBuild } = indexBuildService;
const { getRagInfrastructureStatus, RagInfrastructureError } = infrastructureModule;
const { readRagIndexSnapshotRecord, transitionRagIndexSnapshotRecord } = ragRepository;
const { evaluateAutomaticRagIndexSnapshot } = evaluationModule;
const { validateRagIndexSnapshot, activateRagIndexSnapshot } = ragService;
const { releaseAutomaticKnowledgeTasksRecord } = refreshRepository;
const { getV5GovernancePool } = governanceRepository;

const workerId = `rag-index-worker-${process.pid}-${randomUUID()}`;
const configuredLeaseSeconds = Number(process.env.RAG_JOB_LEASE_SECONDS);
const leaseSeconds = Number.isInteger(configuredLeaseSeconds) && configuredLeaseSeconds > 0
  ? Math.min(configuredLeaseSeconds, 3600)
  : 300;
let leasedJob;
try {
  const infrastructure = getRagInfrastructureStatus();
  if (infrastructure.status !== "ready") {
    const missingConfig = [
      ...infrastructure.mysql.missingConfig,
      ...infrastructure.opensearch.missingConfig,
      ...infrastructure.embedding.missingConfig
    ];
    throw new RagInfrastructureError("pending_config", "RAG 基础设施尚未完整配置。", missingConfig);
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
    const currentSnapshot = await readRagIndexSnapshotRecord(job.indexSnapshotId);
    if (currentSnapshot?.status === "pending_config") {
      await transitionRagIndexSnapshotRecord({
        id: currentSnapshot.indexSnapshotId,
        from: "pending_config",
        to: "building",
        actor: { actorId: workerId, actorRole: "rag_worker", actorType: "system", auditReason: "Resume automatic index build after infrastructure becomes ready." },
        action: "configuration_restored"
      });
    }
    const result = await runRagIndexBuild(job.indexSnapshotId);
    const evaluationActor = { actorId: workerId, actorRole: "knowledge_production_worker", actorType: "system", auditReason: "Run automatic retrieval replay and activate only after all hard metrics pass." };
    const evaluation = await evaluateAutomaticRagIndexSnapshot(job.indexSnapshotId, evaluationActor);
    await validateRagIndexSnapshot(job.indexSnapshotId, evaluation, evaluationActor);
    if (!evaluation.passed) {
      await finishRagJob({ jobId: job.jobId, workerId, status: "failed", failureCode: "automatic_evaluation_failed", failureMessage: evaluation.blockers.join("; ") });
      console.error(JSON.stringify({ status: "failed", jobId: job.jobId, code: "automatic_evaluation_failed", blockers: evaluation.blockers }));
      process.exitCode = 1;
    } else {
      await activateRagIndexSnapshot(job.indexSnapshotId, evaluationActor);
      const snapshot = await readRagIndexSnapshotRecord(job.indexSnapshotId);
      const manifest = snapshot ? await ragRepository.readRagManifestRecord(snapshot.manifestId) : undefined;
      const release = manifest
        ? await releaseAutomaticKnowledgeTasksRecord({ productId: manifest.productId, rulePackageVersionId: manifest.activeRulePackageVersionId, actor: evaluationActor })
        : { releasedTaskCount: 0 };
      await finishRagJob({ jobId: job.jobId, workerId, status: "completed" });
      console.log(JSON.stringify({ status: "completed", jobId: job.jobId, result, evaluation, release }));
    }
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
} finally {
  await getV5GovernancePool().end();
}
