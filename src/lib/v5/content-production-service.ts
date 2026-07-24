import type {
  ProductionContractSnapshot,
  ProductionProviderOutput,
  ProductionSiblingDraft,
  ProductionValidationIssue,
  ProductionValidationResult
} from "./content-production-contracts";
import { validateProductionOutput } from "./production-output-validator";

export interface ContentProductionModel {
  generate(contract: ProductionContractSnapshot): Promise<ProductionProviderOutput>;
  repair(
    contract: ProductionContractSnapshot,
    previous: ProductionProviderOutput,
    issues: ProductionValidationIssue[]
  ): Promise<ProductionProviderOutput>;
}
export interface RunContentProductionInput {
  contract: ProductionContractSnapshot;
  model: ContentProductionModel;
  siblingDrafts?: ProductionSiblingDraft[];
}

export interface ContentProductionResult {
  status: "available" | "failed" | "system_recovering";
  output?: ProductionProviderOutput;
  validation?: ProductionValidationResult;
  repairCount: 0 | 1;
  technicalRetryCount: number;
  auditTrail: Array<{ event: string; attempt: number; details?: string[] }>;
}

async function callWithTechnicalRetries<T>(
  operation: () => Promise<T>,
  event: string,
  auditTrail: ContentProductionResult["auditTrail"]
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return { value: await operation(), retryCount: attempt - 1 };
    } catch (error) {
      lastError = error;
      auditTrail.push({ event: `${event}_technical_failure`, attempt, details: [error instanceof Error ? error.message : "unknown_provider_failure"] });
    }
  }
  throw lastError;
}

export async function runContentProduction(input: RunContentProductionInput): Promise<ContentProductionResult> {
  const auditTrail: ContentProductionResult["auditTrail"] = [];
  let technicalRetryCount = 0;
  let initial: ProductionProviderOutput;
  try {
    const generated = await callWithTechnicalRetries(() => input.model.generate(input.contract), "generation", auditTrail);
    initial = generated.value;
    technicalRetryCount += generated.retryCount;
  } catch {
    return { status: "system_recovering", repairCount: 0, technicalRetryCount: 3, auditTrail };
  }

  const firstValidation = validateProductionOutput({ contract: input.contract, output: initial, siblingDrafts: input.siblingDrafts });
  auditTrail.push({ event: firstValidation.passed ? "validation_passed" : "validation_failed", attempt: 1, details: firstValidation.issues.map((item) => item.code) });
  if (firstValidation.passed) {
    return { status: "available", output: initial, validation: firstValidation, repairCount: 0, technicalRetryCount, auditTrail };
  }
  if (firstValidation.issues.some((item) => !item.repairable)) {
    return { status: "failed", output: initial, validation: firstValidation, repairCount: 0, technicalRetryCount, auditTrail };
  }

  let repaired: ProductionProviderOutput;
  try {
    const repair = await callWithTechnicalRetries(
      () => input.model.repair(input.contract, initial, firstValidation.issues),
      "repair",
      auditTrail
    );
    repaired = repair.value;
    technicalRetryCount += repair.retryCount;
  } catch {
    return { status: "system_recovering", output: initial, validation: firstValidation, repairCount: 1, technicalRetryCount: technicalRetryCount + 3, auditTrail };
  }

  const finalValidation = validateProductionOutput({ contract: input.contract, output: repaired, siblingDrafts: input.siblingDrafts });
  auditTrail.push({ event: finalValidation.passed ? "repair_validation_passed" : "repair_validation_failed", attempt: 2, details: finalValidation.issues.map((item) => item.code) });
  return {
    status: finalValidation.passed ? "available" : "failed",
    output: repaired,
    validation: finalValidation,
    repairCount: 1,
    technicalRetryCount,
    auditTrail
  };
}
