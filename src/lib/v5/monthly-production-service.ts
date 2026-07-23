import type { ProductionDraftSummary, ProductionTaskStatus } from "./monthly-workspace-contracts";

export type AutomatedCheckResult =
  | { status: "passed"; basisSummary: string[] }
  | { status: "fixable"; reasons: string[] }
  | { status: "critical_fact_missing"; reason: string; knowledgeTodoId: string };

export interface ProductionEngine {
  generate(): Promise<{ title: string; markdown: string }>;
  check(draft: { title: string; markdown: string }): Promise<AutomatedCheckResult>;
  repair(draft: { title: string; markdown: string }, reasons: string[]): Promise<{ title: string; markdown: string }>;
}

export interface AutomatedProductionResult {
  status: ProductionTaskStatus;
  recoveryAttemptCount: number;
  automaticRepairCount: number;
  lastUsableDraft?: ProductionDraftSummary;
  currentDraft?: ProductionDraftSummary;
  knowledgeTodoId?: string;
  auditTrail: Array<{ event: string; attempt: number; detail?: string }>;
}

async function withTechnicalRecovery<T>(
  operation: () => Promise<T>,
  auditTrail: AutomatedProductionResult["auditTrail"],
  event: string
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return { value: await operation(), retryCount: attempt - 1 };
    } catch (error) {
      lastError = error;
      auditTrail.push({ event: `${event}_technical_failure`, attempt, detail: error instanceof Error ? error.message : "unknown_failure" });
    }
  }
  throw lastError;
}

export async function runAutomatedProduction(input: {
  engine: ProductionEngine;
  previousUsableDraft?: ProductionDraftSummary;
  now?: () => string;
}): Promise<AutomatedProductionResult> {
  const auditTrail: AutomatedProductionResult["auditTrail"] = [];
  let recoveryAttemptCount = 0;
  let automaticRepairCount = 0;
  let candidate: { title: string; markdown: string };

  try {
    const generated = await withTechnicalRecovery(() => input.engine.generate(), auditTrail, "generation");
    candidate = generated.value;
    recoveryAttemptCount += generated.retryCount;
  } catch {
    return {
      status: "system_recovering",
      recoveryAttemptCount: 3,
      automaticRepairCount,
      lastUsableDraft: input.previousUsableDraft,
      currentDraft: input.previousUsableDraft,
      auditTrail
    };
  }

  for (let repairRound = 0; repairRound <= 2; repairRound += 1) {
    let checked: AutomatedCheckResult;
    try {
      const checkResult = await withTechnicalRecovery(() => input.engine.check(candidate), auditTrail, "check");
      checked = checkResult.value;
      recoveryAttemptCount += checkResult.retryCount;
    } catch {
      return {
        status: "system_recovering",
        recoveryAttemptCount: recoveryAttemptCount + 3,
        automaticRepairCount,
        lastUsableDraft: input.previousUsableDraft,
        currentDraft: input.previousUsableDraft,
        auditTrail
      };
    }

    if (checked.status === "passed") {
      const now = input.now?.() || new Date().toISOString();
      const draft: ProductionDraftSummary = {
        draftId: `draft-${now}-${automaticRepairCount}`,
        title: candidate.title,
        markdown: candidate.markdown,
        status: "available",
        basisSummary: checked.basisSummary,
        updatedAt: now
      };
      auditTrail.push({ event: "draft_available", attempt: repairRound + 1 });
      return {
        status: "available",
        recoveryAttemptCount,
        automaticRepairCount,
        lastUsableDraft: draft,
        currentDraft: draft,
        auditTrail
      };
    }

    if (checked.status === "critical_fact_missing") {
      auditTrail.push({ event: "critical_fact_missing", attempt: repairRound + 1, detail: checked.reason });
      return {
        status: "awaiting_material",
        recoveryAttemptCount,
        automaticRepairCount,
        lastUsableDraft: input.previousUsableDraft,
        currentDraft: input.previousUsableDraft,
        knowledgeTodoId: checked.knowledgeTodoId,
        auditTrail
      };
    }

    if (repairRound === 2) {
      auditTrail.push({ event: "automatic_repair_deferred", attempt: repairRound + 1, detail: checked.reasons.join("；") });
      return {
        status: "system_recovering",
        recoveryAttemptCount,
        automaticRepairCount,
        lastUsableDraft: input.previousUsableDraft,
        currentDraft: input.previousUsableDraft,
        auditTrail
      };
    }

    try {
      const repaired = await withTechnicalRecovery(() => input.engine.repair(candidate, checked.reasons), auditTrail, "repair");
      candidate = repaired.value;
      recoveryAttemptCount += repaired.retryCount;
      automaticRepairCount += 1;
      auditTrail.push({ event: "automatic_repair_completed", attempt: automaticRepairCount });
    } catch {
      return {
        status: "system_recovering",
        recoveryAttemptCount: recoveryAttemptCount + 3,
        automaticRepairCount,
        lastUsableDraft: input.previousUsableDraft,
        currentDraft: input.previousUsableDraft,
        auditTrail
      };
    }
  }

  throw new Error("unreachable_production_state");
}
