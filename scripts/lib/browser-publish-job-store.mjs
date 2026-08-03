import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed", "risk_blocked"]);

function nowIso() {
  return new Date().toISOString();
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      platformLocks: parsed.platformLocks && typeof parsed.platformLocks === "object" ? parsed.platformLocks : {}
    };
  } catch {
    return { jobs: [], platformLocks: {} };
  }
}

function writeState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function publicJob(job, includePayload = false) {
  const result = {
    id: job.id,
    platform: job.platform,
    status: job.status,
    idempotencyKey: job.idempotencyKey,
    leaseOwner: job.leaseOwner,
    leaseExpiresAt: job.leaseExpiresAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result
  };
  if (includePayload) result.payload = job.payload;
  return result;
}

export function createBrowserPublishJobStore(filePath, options = {}) {
  const leaseMs = Math.max(5_000, Number(options.leaseMs || 120_000));

  function releaseExpiredLocks(state, nowMs) {
    for (const [platform, lock] of Object.entries(state.platformLocks)) {
      if (Date.parse(lock.leaseExpiresAt || "") <= nowMs) delete state.platformLocks[platform];
    }
    for (const job of state.jobs) {
      if (job.status === "running" && Date.parse(job.leaseExpiresAt || "") <= nowMs) {
        job.status = "queued";
        job.leaseOwner = undefined;
        job.leaseExpiresAt = undefined;
        job.updatedAt = new Date(nowMs).toISOString();
      }
    }
  }

  return {
    enqueue(input) {
      const state = readState(filePath);
      const existing = state.jobs.find((job) => job.idempotencyKey === input.idempotencyKey);
      if (existing) return { created: false, job: publicJob(existing) };

      const createdAt = nowIso();
      const job = {
        id: randomUUID(),
        platform: input.platform,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        payload: input.payload,
        createdAt,
        updatedAt: createdAt
      };
      state.jobs.push(job);
      writeState(filePath, state);
      return { created: true, job: publicJob(job) };
    },

    claim(workerId, supportedPlatforms = []) {
      const state = readState(filePath);
      const nowMs = Date.now();
      releaseExpiredLocks(state, nowMs);
      const supported = new Set(supportedPlatforms);
      const job = state.jobs.find(
        (candidate) =>
          candidate.status === "queued" &&
          (!supported.size || supported.has(candidate.platform)) &&
          !state.platformLocks[candidate.platform]
      );
      if (!job) {
        writeState(filePath, state);
        return undefined;
      }

      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      job.status = "running";
      job.leaseOwner = workerId;
      job.leaseExpiresAt = leaseExpiresAt;
      job.startedAt ||= new Date(nowMs).toISOString();
      job.updatedAt = new Date(nowMs).toISOString();
      state.platformLocks[job.platform] = { jobId: job.id, workerId, leaseExpiresAt };
      writeState(filePath, state);
      return publicJob(job, true);
    },

    heartbeat(jobId, workerId) {
      const state = readState(filePath);
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.status !== "running" || job.leaseOwner !== workerId) return false;
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      job.leaseExpiresAt = leaseExpiresAt;
      job.updatedAt = nowIso();
      state.platformLocks[job.platform] = { jobId, workerId, leaseExpiresAt };
      writeState(filePath, state);
      return true;
    },

    complete(jobId, workerId, result) {
      const state = readState(filePath);
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.status !== "running" || job.leaseOwner !== workerId) return undefined;
      const status =
        result?.failureCode === "risk_blocked" || result?.failureCode === "manual_takeover_required"
          ? "risk_blocked"
          : result?.ok
            ? "completed"
            : "failed";
      job.status = status;
      job.result = result;
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      job.leaseExpiresAt = undefined;
      delete state.platformLocks[job.platform];
      writeState(filePath, state);
      return publicJob(job);
    },

    getById(id) {
      const job = readState(filePath).jobs.find((candidate) => candidate.id === id);
      return job ? publicJob(job) : undefined;
    },

    getByIdempotencyKey(idempotencyKey) {
      const job = readState(filePath).jobs.find((candidate) => candidate.idempotencyKey === idempotencyKey);
      return job ? publicJob(job) : undefined;
    },

    list() {
      return readState(filePath).jobs.map((job) => publicJob(job));
    },

    isTerminal(status) {
      return TERMINAL_STATUSES.has(status);
    }
  };
}
