import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ObservationReferenceSnapshot } from "./observation-contracts";
import { readV5FoundationSnapshot } from "./foundation-repository";
import { hasV5GovernanceDatabaseConfig, parseV5Json } from "./knowledge-governance-repository";
import { readFormalObservationRows } from "./monthly-execution-repository";

function normalizeReference(value: Partial<ObservationReferenceSnapshot>, fixture: boolean): ObservationReferenceSnapshot {
  return {
    source: fixture ? "fixture" : "formal_adapter",
    questions: Array.isArray(value.questions) ? value.questions : [],
    monthlyPlans: Array.isArray(value.monthlyPlans) ? value.monthlyPlans : [],
    publishedContent: Array.isArray(value.publishedContent) ? value.publishedContent : []
  };
}

function toIso(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function resolveFormalPublishLivenessStatus(firstObservedAt: string | undefined, lastVerifiedAt: string | undefined, removedAt: string | undefined, hours: number) {
  if (!firstObservedAt) return "pending" as const;
  const first = Date.parse(firstObservedAt);
  const observationEnd = Date.parse(removedAt || lastVerifiedAt || "");
  if (!Number.isFinite(first) || !Number.isFinite(observationEnd)) return "pending" as const;
  const reached = observationEnd - first >= hours * 60 * 60 * 1000;
  if (removedAt) return reached ? "passed" as const : "failed" as const;
  return reached ? "passed" as const : "pending" as const;
}

function livenessText(value: "pending" | "passed" | "failed") {
  return value === "passed" ? "通过" : value === "failed" ? "失败" : "待观察";
}

export async function readObservationReferenceSnapshot(): Promise<ObservationReferenceSnapshot> {
  const configuredPath = process.env.V5_OBSERVATION_REFERENCE_PATH?.trim();
  if (!configuredPath) {
    if (!hasV5GovernanceDatabaseConfig()) return {
      source: "pending_config", questions: [], monthlyPlans: [], publishedContent: [],
      message: "正式 MonthlyReview 聚合需要 MySQL 配置。"
    };
    try {
      const foundation = readV5FoundationSnapshot();
      const rows = await readFormalObservationRows();
      const versionById = new Map(foundation.questionVersions.map((item) => [item.questionVersionId, item]));
      const questions = foundation.questionVersions.map((item) => ({
        questionVersionId: item.questionVersionId,
        questionKey: item.questionId,
        text: item.text,
        targetEntity: item.product,
        sourceSnapshotHash: item.trace?.sourceIds?.join(":")
      }));
      return {
        source: "formal_adapter",
        questions,
        monthlyPlans: rows.plans.map((plan) => {
          const questionVersionIds = parseV5Json<string[]>(plan.question_version_ids, []);
          const config = parseV5Json<{ targetDeliverableCount?: number }>(plan.workspace_config, {});
          return {
            monthlyPlanId: String(plan.id), month: String(plan.plan_month),
            questionKeys: questionVersionIds.map((id) => versionById.get(id)?.questionId || id),
            plannedContentCount: Number(config.targetDeliverableCount || 0)
          };
        }),
        publishedContent: rows.published.map((item) => {
          const metrics = parseV5Json<Record<string, number | string>>(item.metrics, {});
          const firstPublicObservedAt = toIso(item.first_public_observed_at);
          const lastVerifiedAt = toIso(item.last_verified_at);
          const removedAt = toIso(item.removed_at);
          const liveness24h = resolveFormalPublishLivenessStatus(firstPublicObservedAt, lastVerifiedAt, removedAt, 24);
          const liveness72h = resolveFormalPublishLivenessStatus(firstPublicObservedAt, lastVerifiedAt, removedAt, 72);
          const metricParts = Object.entries(metrics).map(([key, value]) => `${key}: ${value}`);
          metricParts.push(`24h存活: ${livenessText(liveness24h)}`, `72h存活: ${livenessText(liveness72h)}`);
          return {
            contentId: String(item.matrix_item_id),
            questionKey: versionById.get(String(item.question_version_id || ""))?.questionId || String(item.question_version_id || "unlinked"),
            title: String(item.title), channel: String(item.channel),
            publishedAt: item.published_at instanceof Date ? item.published_at.toISOString() : String(item.published_at),
            publicUrl: item.public_url ? String(item.public_url) : undefined,
            publishScheduleId: item.publish_schedule_id ? String(item.publish_schedule_id) : undefined,
            liveness24h,
            liveness72h,
            removedAt,
            hasMetricReturn: Object.keys(metrics).length > 0,
            metricSummary: metricParts.join("；")
          };
        }),
        message: rows.plans.length ? undefined : "正式 MonthlyPlan 尚未创建。"
      };
    } catch (error) {
      return { source: "pending_config", questions: [], monthlyPlans: [], publishedContent: [], message: error instanceof Error ? `正式月度聚合失败：${error.message}` : "正式月度聚合失败。" };
    }
  }

  const referencePath = path.resolve(process.cwd(), configuredPath);
  try {
    const value = JSON.parse(await readFile(referencePath, "utf8")) as Partial<ObservationReferenceSnapshot>;
    const fixture = referencePath.includes(`${path.sep}scripts${path.sep}fixtures${path.sep}`);
    return normalizeReference(value, fixture);
  } catch (error) {
    return {
      source: "pending_config",
      questions: [],
      monthlyPlans: [],
      publishedContent: [],
      message: error instanceof Error ? `上游只读适配器加载失败：${error.message}` : "上游只读适配器加载失败。"
    };
  }
}
