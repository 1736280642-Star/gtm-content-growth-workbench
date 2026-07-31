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
          return {
            contentId: String(item.matrix_item_id),
            questionKey: versionById.get(String(item.question_version_id || ""))?.questionId || String(item.question_version_id || "unlinked"),
            title: String(item.title), channel: String(item.channel),
            publishedAt: item.published_at instanceof Date ? item.published_at.toISOString() : String(item.published_at),
            metricSummary: Object.keys(metrics).length ? Object.entries(metrics).map(([key, value]) => `${key}: ${value}`).join("；") : undefined
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
