import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ObservationReferenceSnapshot } from "./observation-contracts";

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
    return {
      source: "pending_config",
      questions: [],
      monthlyPlans: [],
      publishedContent: [],
      message: "正式问题版本、知识快照、MonthlyPlan 与已发布内容适配器待分支一、分支二合并后接入。"
    };
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
