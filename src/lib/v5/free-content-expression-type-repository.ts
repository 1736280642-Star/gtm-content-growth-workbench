import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AudienceLensKey,
  FreeContentExpressionType,
  FreeContentExpressionTypeVersion,
  FreeExpressionPresetKey,
  FreeProductionAuditEvent,
  FreeProductionSourceMode,
  RequiredExpressionInput,
  TitleStrategyKey,
  VisualSuggestionMode
} from "./free-production-contracts";

export interface FreeContentExpressionTypeState {
  schemaVersion: 1;
  types: Record<string, FreeContentExpressionType>;
  versions: Record<string, FreeContentExpressionTypeVersion>;
  audits: FreeProductionAuditEvent[];
  idempotency: Record<string, { requestHash: string; response: unknown; createdAt: string }>;
}

interface PresetSeed {
  presetKey: FreeExpressionPresetKey;
  name: string;
  description: string;
  scenario: string;
  contentGoal: string;
  defaultAudience: string;
  sourceMode: FreeProductionSourceMode;
  productId: string;
  knowledgeSnapshotIds: string[];
  channelBinding: FreeContentExpressionTypeVersion["channelBinding"];
  visualSuggestionMode: VisualSuggestionMode;
  structureModules: string[];
  optionalStructureModules: string[];
  requiredInputSchema: RequiredExpressionInput[];
  recommendedLength: { min: number; max: number };
  allowedTitleStrategyKeys: TitleStrategyKey[];
  defaultTitleStrategyKey: TitleStrategyKey;
  audienceLensPolicy: AudienceLensKey;
  promotionStrength: FreeContentExpressionTypeVersion["promotionConfig"]["strength"];
  firstProductMentionRule: string;
  defaultExpressionFocus: string[];
  additionalWritingRequirements: string;
}

interface PresetSeedFile {
  sourceRuleDocumentId: string;
  sourceRuleVersion: string;
  brandBaseline: Record<string, unknown>;
  presets: PresetSeed[];
}

function resolveStatePath() {
  return path.resolve(process.cwd(), process.env.V5_FREE_CONTENT_TYPE_STATE_PATH?.trim() || "data/v5-free-content-expression-types.json");
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function createSeedState(): Promise<FreeContentExpressionTypeState> {
  const raw = await readFile(path.resolve(process.cwd(), "data/v5-free-expression-presets.json"), "utf8");
  const seed = JSON.parse(raw) as PresetSeedFile;
  const now = "2026-07-27T00:00:00.000Z";
  const sourceRuleDigest = digest({ brandBaseline: seed.brandBaseline, presets: seed.presets });
  const types: Record<string, FreeContentExpressionType> = {};
  const versions: Record<string, FreeContentExpressionTypeVersion> = {};
  for (const preset of seed.presets) {
    const typeId = `free-type-${preset.presetKey}`;
    const versionId = `${typeId}-v1`;
    const partial = {
      freeContentExpressionTypeVersionId: versionId,
      typeId,
      version: 1,
      presetKey: preset.presetKey,
      name: preset.name,
      description: preset.description,
      scenario: preset.scenario,
      contentGoal: preset.contentGoal,
      defaultAudience: preset.defaultAudience,
      sourceMode: preset.sourceMode,
      productId: preset.productId,
      productRuleResolutionPolicy: "active_product_rule" as const,
      knowledgeSelectionPolicy: "all_product_ready_snapshots" as const,
      knowledgeSnapshotIds: preset.knowledgeSnapshotIds,
      applicableChannels: [preset.channelBinding.channel],
      channelBinding: preset.channelBinding,
      publishPolicy: "automatic_after_confirmation" as const,
      visualSuggestionMode: preset.visualSuggestionMode,
      structureModules: preset.structureModules,
      optionalStructureModules: preset.optionalStructureModules,
      requiredInputSchema: preset.requiredInputSchema,
      recommendedLength: preset.recommendedLength,
      allowedTitleStrategyKeys: preset.allowedTitleStrategyKeys,
      defaultTitleStrategyKey: preset.defaultTitleStrategyKey,
      audienceLensPolicy: preset.audienceLensPolicy,
      expressionConfig: {
        tone: "专业、官方、清晰、克制",
        narrativePerspective: "从真实业务现场和读者任务出发",
        professionalDepth: "业务判断与实施边界并重",
        terminologyDensity: "中等",
        allowFirstPerson: false,
        allowIndustryJudgement: true,
        casePreference: "只使用已授权、可公开且可追溯的案例",
        sentenceLengthRange: [15, 35] as [number, number],
        paragraphSentenceRange: [1, 3] as [number, number]
      },
      promotionConfig: {
        strength: preset.promotionStrength,
        firstProductMentionRule: preset.firstProductMentionRule,
        suggestedProductMentionCount: 3,
        requireCoreCapability: true,
        allowCompetitorComparison: false,
        defaultCtaType: preset.channelBinding.ctaType
      },
      evidenceRequirements: {
        requireKnowledgeBase: true,
        minimumEvidenceCount: 1,
        preferredEvidenceTypes: ["产品事实", "工作流证据", "能力边界"],
        requireSourceForData: true,
        insufficientEvidenceAction: "safe_draft" as const,
        allowGeneralKnowledge: false
      },
      qualityGateConfig: {
        requireHumanAiBoundary: true,
        maximumRepairCount: 1 as const,
        productMentionMinimumRatio: preset.presetKey === "industry_insight" ? 0.2 : undefined
      },
      outputContractVersion: "content-draft-artifact.v1" as const,
      sourceRuleDocumentId: seed.sourceRuleDocumentId,
      sourceRuleVersion: seed.sourceRuleVersion,
      sourceRuleDigest,
      systemManaged: true,
      defaultExpressionFocus: preset.defaultExpressionFocus,
      positiveExamples: [],
      negativeExamples: [],
      additionalWritingRequirements: preset.additionalWritingRequirements,
      status: "active" as const,
      createdBy: "system_preset",
      createdAt: now,
      activatedAt: now
    };
    const version = { ...partial, snapshotHash: digest(partial) } satisfies FreeContentExpressionTypeVersion;
    versions[versionId] = version;
    types[typeId] = { typeId, presetKey: preset.presetKey, status: "active", currentVersionId: versionId, activeVersionId: versionId, version: 1, usageCount: 0, createdBy: "system_preset", createdAt: now, updatedBy: "system_preset", updatedAt: now };
  }
  return { schemaVersion: 1, types, versions, audits: [], idempotency: {} };
}

async function normalizeState(value: Partial<FreeContentExpressionTypeState>) {
  const seed = await createSeedState();
  const sourceModeByPreset: Record<FreeExpressionPresetKey, FreeProductionSourceMode> = {
    product_release: "knowledge",
    scenario_solution: "knowledge",
    strategic_partnership: "facts",
    event_recap: "facts_with_meeting_text",
    industry_insight: "knowledge"
  };
  const storedVersions = value.versions && typeof value.versions === "object" ? value.versions : seed.versions;
  const versions = Object.fromEntries(Object.entries(storedVersions).map(([id, version]) => [id, {
    ...version,
    sourceMode: version.sourceMode || sourceModeByPreset[version.presetKey],
    productId: "",
    knowledgeSnapshotIds: [],
    knowledgeSelectionPolicy: "selected_product_snapshots"
  }])) as Record<string, FreeContentExpressionTypeVersion>;
  return {
    schemaVersion: 1 as const,
    types: value.types && typeof value.types === "object" ? value.types : seed.types,
    versions,
    audits: Array.isArray(value.audits) ? value.audits : [],
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {}
  };
}

export async function readFreeContentExpressionTypeState() {
  try { return await normalizeState(JSON.parse(await readFile(resolveStatePath(), "utf8")) as Partial<FreeContentExpressionTypeState>); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return createSeedState(); throw error; }
}

async function writeState(state: FreeContentExpressionTypeState) {
  const statePath = resolveStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

let writeQueue: Promise<void> = Promise.resolve();
export function updateFreeContentExpressionTypeState<T>(mutator: (state: FreeContentExpressionTypeState) => T | Promise<T>) {
  const operation = writeQueue.then(async () => { const state = await readFreeContentExpressionTypeState(); const result = await mutator(state); await writeState(state); return result; });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function readFreeExpressionBrandBaseline() {
  const raw = await readFile(path.resolve(process.cwd(), "data/v5-free-expression-presets.json"), "utf8");
  const seed = JSON.parse(raw) as PresetSeedFile;
  return { ...seed.brandBaseline, sourceRuleDocumentId: seed.sourceRuleDocumentId, sourceRuleVersion: seed.sourceRuleVersion, sourceRuleDigest: digest({ brandBaseline: seed.brandBaseline, presets: seed.presets }) };
}
