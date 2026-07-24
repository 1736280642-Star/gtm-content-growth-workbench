import { randomUUID } from "node:crypto";
import type {
  CreateSiteAuditRequest,
  CreateSiteRemediationRequest,
  SiteAuditFinding,
  SiteAuditRun,
  SiteAuditWorkspace,
  SiteRemediationTask
} from "./site-audit-contracts";
import type { V5MutationContext } from "./observation-contracts";
import { appendObservationAudit, hashObservationPayload, readV5ObservationState, updateV5ObservationState } from "./observation-repository";
import { assertObservationMutationContext, ObservationServiceError } from "./observation-service";

function assertPublicHttpUrl(value: string, label: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !url.hostname || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error();
    return url.toString();
  } catch {
    throw new ObservationServiceError(422, "INVALID_SITE_AUDIT_URL", `${label}必须是公开可访问的 HTTP(S) URL。`);
  }
}

export async function getSiteAuditWorkspace(): Promise<SiteAuditWorkspace> {
  const state = await readV5ObservationState();
  const runs = Object.values(state.siteAuditRuns).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    source: runs.length ? "persisted" : "empty",
    runs,
    findings: Object.values(state.siteAuditFindings),
    remediationTasks: Object.values(state.siteRemediationTasks),
    diffs: Object.values(state.siteAuditDiffs),
    score: null
  };
}

export async function createSiteAuditRun(input: CreateSiteAuditRequest): Promise<SiteAuditRun> {
  assertObservationMutationContext(input);
  const scopeUrl = assertPublicHttpUrl(input.scopeUrl, "官网范围");
  const sitemapUrl = input.sitemapUrl ? assertPublicHttpUrl(input.sitemapUrl, "Sitemap") : undefined;
  return updateV5ObservationState((state) => {
    const run: SiteAuditRun = {
      id: `site-audit-run-${randomUUID()}`,
      version: 1,
      scopeUrl,
      sitemapUrl,
      status: "pending_config",
      auditedUrlCount: 0,
      failedUrlCount: 0,
      source: "pending_config",
      failureReason: "官网审计 Runner 尚未配置；当前只保存审计范围，不生成假问题或总分。",
      createdAt: new Date().toISOString(),
      createdBy: input.actor.actorId
    };
    state.siteAuditRuns[run.id] = run;
    appendObservationAudit(state, {
      event: "site_audit_run_created",
      objectType: "SiteAuditRun",
      objectId: run.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [scopeUrl, ...(sitemapUrl ? [sitemapUrl] : [])],
      beforeVersion: 0,
      afterVersion: 1
    });
    return run;
  });
}

export async function ingestSiteAuditFindings(
  runId: string,
  findings: Omit<SiteAuditFinding, "id" | "runId" | "version" | "firstSeenAt" | "lastSeenAt">[],
  input: V5MutationContext
) {
  assertObservationMutationContext(input, true);
  return updateV5ObservationState((state) => {
    const run = state.siteAuditRuns[runId];
    if (!run) throw new ObservationServiceError(404, "SITE_AUDIT_RUN_NOT_FOUND", "官网审计批次不存在。");
    if (run.version !== input.expectedVersion) throw new ObservationServiceError(409, "SITE_AUDIT_VERSION_CONFLICT", "审计批次已更新，请刷新后重试。");
    const now = new Date().toISOString();
    const saved = findings.map((finding) => {
      const item: SiteAuditFinding = {
        ...finding,
        id: `site-audit-finding-${hashObservationPayload({ runId, url: finding.url, code: finding.code }).slice(0, 24)}`,
        runId,
        version: 1,
        firstSeenAt: now,
        lastSeenAt: now
      };
      state.siteAuditFindings[item.id] = item;
      return item;
    });
    state.siteAuditRuns[runId] = {
      ...run,
      version: run.version + 1,
      status: "completed",
      source: "site_audit_runner",
      auditedUrlCount: new Set(saved.map((item) => item.url)).size,
      failureReason: undefined,
      completedAt: now,
      executorVersion: "site-audit-runner@1"
    };
    appendObservationAudit(state, {
      event: "site_audit_findings_ingested",
      objectType: "SiteAuditRun",
      objectId: runId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: saved.map((item) => item.id),
      beforeVersion: run.version,
      afterVersion: run.version + 1
    });
    return { run: state.siteAuditRuns[runId], findings: saved };
  });
}

export async function createSiteRemediation(findingId: string, input: CreateSiteRemediationRequest): Promise<SiteRemediationTask> {
  assertObservationMutationContext(input);
  return updateV5ObservationState((state) => {
    const finding = state.siteAuditFindings[findingId];
    if (!finding) throw new ObservationServiceError(404, "SITE_AUDIT_FINDING_NOT_FOUND", "官网审计问题不存在。");
    if (finding.version !== input.expectedVersion) throw new ObservationServiceError(409, "SITE_AUDIT_FINDING_VERSION_CONFLICT", "审计问题已更新，请刷新后重试。");
    const remediation: SiteRemediationTask = {
      id: `site-remediation-${randomUUID()}`,
      findingId,
      version: 1,
      assignee: input.assignee?.trim() || undefined,
      dueDate: input.dueDate || undefined,
      note: input.note.trim(),
      status: "open",
      createdAt: new Date().toISOString(),
      createdBy: input.actor.actorId
    };
    state.siteRemediationTasks[remediation.id] = remediation;
    state.siteAuditFindings[findingId] = { ...finding, version: finding.version + 1, status: "remediation_created" };
    appendObservationAudit(state, {
      event: "site_remediation_created",
      objectType: "SiteRemediationTask",
      objectId: remediation.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [findingId, finding.url],
      beforeVersion: 0,
      afterVersion: 1
    });
    return remediation;
  });
}

export async function reviewSiteAuditFinding(
  findingId: string,
  input: V5MutationContext & { decision: "resolved" | "ignored"; note: string }
) {
  assertObservationMutationContext(input);
  if (!input.note.trim()) throw new ObservationServiceError(422, "SITE_AUDIT_REVIEW_NOTE_REQUIRED", "请填写复审或忽略说明。");
  return updateV5ObservationState((state) => {
    const finding = state.siteAuditFindings[findingId];
    if (!finding) throw new ObservationServiceError(404, "SITE_AUDIT_FINDING_NOT_FOUND", "官网审计问题不存在。");
    if (finding.version !== input.expectedVersion) throw new ObservationServiceError(409, "SITE_AUDIT_FINDING_VERSION_CONFLICT", "审计问题已更新，请刷新后重试。");
    const updated: SiteAuditFinding = { ...finding, version: finding.version + 1, status: input.decision };
    state.siteAuditFindings[findingId] = updated;
    appendObservationAudit(state, {
      event: "site_audit_finding_reviewed",
      objectType: "SiteAuditFinding",
      objectId: findingId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [finding.url],
      beforeVersion: finding.version,
      afterVersion: updated.version
    });
    return updated;
  });
}
