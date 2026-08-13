import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  CreateGeoResearchProjectInput,
  GeoBlueprintVersion,
  GeoResearchEvidence,
  GeoResearchFinding,
  GeoResearchProject,
  GeoResearchRun,
  GeoResearchRunWorkspace,
  GeoResearchTask,
  GeoResearchTaskStatus,
  GeoResearchTaskType,
  GeoResearchWorkspace
} from "./geo-research-contracts";
import type { GeoResearchProviderResult } from "./geo-research-provider";
import { evaluateGeoSourceSnapshotQuality, type GeoSnapshotSourceMetadata } from "./geo-source-quality";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  parseV5Json,
  readV5Idempotency,
  stringifyV5Json,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "./knowledge-governance-repository";

const RESEARCH_TASK_GRAPH: Array<{
  type: GeoResearchTaskType;
  dependencies: GeoResearchTaskType[];
}> = [
  { type: "context_validation", dependencies: [] },
  { type: "research_planning", dependencies: ["context_validation"] },
  { type: "live_question_discovery", dependencies: ["research_planning"] },
  { type: "live_competitor_discovery", dependencies: ["research_planning"] },
  { type: "frontend_baseline", dependencies: ["live_question_discovery"] },
  {
    type: "evidence_alignment",
    dependencies: ["live_question_discovery", "live_competitor_discovery", "frontend_baseline"]
  },
  { type: "blueprint_synthesis", dependencies: ["evidence_alignment"] }
];

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown) {
  return value ? iso(value) : undefined;
}

const GEO_SOURCE_QUALITY_QUERY = `SELECT ssi.source_id, ssi.source_revision_id,
          sa.title, sa.canonical_url, sa.file_name, sa.document_type, sa.authority_level,
          sa.visibility, sa.lifecycle_status, sa.status, sa.safety_status
   FROM source_snapshot_item ssi
   LEFT JOIN source_asset sa ON sa.id = ssi.source_id
   WHERE ssi.source_snapshot_id = ?`;

function mapSnapshotSourceMetadata(rows: RowDataPacket[]): GeoSnapshotSourceMetadata[] {
  return rows.map((row) => ({
    sourceId: String(row.source_id),
    sourceRevisionId: String(row.source_revision_id),
    title: row.title ? String(row.title) : undefined,
    canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
    fileName: row.file_name ? String(row.file_name) : undefined,
    documentType: row.document_type ? String(row.document_type) : "",
    authorityLevel: row.authority_level ? String(row.authority_level) : "",
    visibility: row.visibility ? String(row.visibility) : "",
    lifecycleStatus: row.lifecycle_status ? String(row.lifecycle_status) : "",
    status: row.status ? String(row.status) : "",
    safetyStatus: row.safety_status ? String(row.safety_status) : ""
  }));
}

function mapProject(row: RowDataPacket): GeoResearchProject {
  return {
    projectId: String(row.id),
    productId: String(row.product_id),
    status: String(row.status) as GeoResearchProject["status"],
    researchMarkets: parseV5Json<string[]>(row.research_markets, []),
    languages: parseV5Json<string[]>(row.languages, []),
    targetChannels: parseV5Json<string[]>(row.target_channels, []),
    expressionFocus: String(row.expression_focus),
    forbiddenFocus: parseV5Json<string[]>(row.forbidden_focus, []),
    currentApprovedBlueprintVersionId: row.current_approved_blueprint_version_id
      ? String(row.current_approved_blueprint_version_id)
      : undefined,
    rowVersion: Number(row.row_version),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapRun(row: RowDataPacket): GeoResearchRun {
  return {
    runId: String(row.id),
    projectId: String(row.project_id),
    productId: String(row.product_id),
    runVersion: Number(row.run_version),
    triggerType: String(row.trigger_type) as GeoResearchRun["triggerType"],
    inputSourceSnapshotHash: String(row.input_source_snapshot_hash),
    plan: parseV5Json<Record<string, unknown>>(row.plan_json, {}),
    planSchemaVersion: String(row.plan_schema_version),
    status: String(row.status) as GeoResearchRun["status"],
    liveSearchRequired: true,
    liveSearchVerified: Boolean(row.live_search_verified),
    rowVersion: Number(row.row_version),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapTask(row: RowDataPacket): GeoResearchTask {
  return {
    taskId: String(row.id),
    runId: String(row.run_id),
    taskType: String(row.task_type) as GeoResearchTaskType,
    dependencyIds: parseV5Json<string[]>(row.dependency_ids, []),
    provider: row.provider ? String(row.provider) : undefined,
    providerModel: row.provider_model ? String(row.provider_model) : undefined,
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    request: parseV5Json<Record<string, unknown>>(row.request_json, {}),
    outputSummary: parseV5Json<Record<string, unknown>>(row.output_summary, {}),
    responseArtifactId: row.response_artifact_id ? String(row.response_artifact_id) : undefined,
    status: String(row.status) as GeoResearchTaskStatus,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : undefined,
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    idempotencyKey: String(row.idempotency_key),
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureMessage: row.failure_message ? String(row.failure_message) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapBlueprint(row: RowDataPacket): GeoBlueprintVersion {
  return {
    blueprintVersionId: String(row.id),
    projectId: String(row.project_id),
    runId: String(row.run_id),
    versionNumber: Number(row.version_number),
    status: String(row.status) as GeoBlueprintVersion["status"],
    questionStrategy: parseV5Json<Record<string, unknown>>(row.question_strategy, {}),
    competitorLandscape: parseV5Json<Record<string, unknown>>(row.competitor_landscape, {}),
    citationStrategy: parseV5Json<Record<string, unknown>>(row.citation_strategy, {}),
    contentTypeStrategy: parseV5Json<Record<string, unknown>>(row.content_type_strategy, {}),
    evidenceRequirements: parseV5Json<Record<string, unknown>>(row.evidence_requirements, {}),
    rulePackageDraftRef: row.rule_package_draft_ref ? String(row.rule_package_draft_ref) : undefined,
    monthlyStrategyInput: parseV5Json<Record<string, unknown>>(row.monthly_strategy_input, {}),
    retestBaseline: parseV5Json<Record<string, unknown>>(row.retest_baseline, {}),
    researchSnapshotHash: String(row.research_snapshot_hash),
    rowVersion: Number(row.row_version),
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    approvedAt: optionalIso(row.approved_at),
    immutableAt: optionalIso(row.immutable_at),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at)
  };
}

function mapEvidence(row: RowDataPacket): GeoResearchEvidence {
  return {
    evidenceId: String(row.id),
    runId: String(row.run_id),
    evidenceType: String(row.evidence_type) as GeoResearchEvidence["evidenceType"],
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    sourceTitle: row.source_title ? String(row.source_title) : undefined,
    publisher: row.publisher ? String(row.publisher) : undefined,
    queryText: row.query_text ? String(row.query_text) : undefined,
    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : undefined,
    contentLocator: parseV5Json<Record<string, unknown>>(row.content_locator, {}),
    capturedAt: iso(row.captured_at),
    verificationStatus: String(row.verification_status) as GeoResearchEvidence["verificationStatus"],
    visibility: String(row.visibility) as GeoResearchEvidence["visibility"],
    artifactId: row.artifact_id ? String(row.artifact_id) : undefined
  };
}

function mapFinding(row: RowDataPacket): GeoResearchFinding {
  return {
    findingId: String(row.id),
    runId: String(row.run_id),
    findingType: String(row.finding_type) as GeoResearchFinding["findingType"],
    title: String(row.title),
    summary: String(row.summary),
    evidenceIds: parseV5Json<string[]>(row.evidence_ids, []),
    confidence: Number(row.confidence),
    reviewStatus: String(row.review_status) as GeoResearchFinding["reviewStatus"],
    analyzerVersion: String(row.analyzer_version),
    createdAt: iso(row.created_at)
  };
}

async function readProjectForUpdate(connection: PoolConnection, productId: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM geo_research_project WHERE product_id = ? LIMIT 1 FOR UPDATE",
    [productId]
  );
  return rows[0];
}

export async function createGeoResearchProjectRecord(input: {
  project: CreateGeoResearchProjectInput;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload(input.project);
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        projectId: replay.resourceId,
        rowVersion: Number((replay.responseSummary as { rowVersion?: number }).rowVersion || 1)
      };
    }

    const [productRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM product_entity
       WHERE id = ? AND status = 'active' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [input.project.productId]
    );
    if (!productRows[0]) {
      throw new V5GovernanceRepositoryError(
        "product_not_confirmed",
        "产品实体不存在或尚未完成人工确认。",
        409,
        "请先在产品中心新增并确认产品。"
      );
    }
    const existing = await readProjectForUpdate(connection, input.project.productId);
    if (existing) {
      throw new V5GovernanceRepositoryError(
        "research_project_already_exists",
        "该产品已经存在 GEO 调研项目。",
        409,
        `请继续使用调研项目 ${String(existing.id)}。`
      );
    }

    const projectId = `geo-project-${randomUUID()}`;
    await connection.query(
      `INSERT INTO geo_research_project
        (id, product_id, status, research_markets, languages, target_channels, expression_focus,
         forbidden_focus, row_version, created_by)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, 1, ?)`,
      [
        projectId,
        input.project.productId,
        stringifyV5Json(input.project.researchMarkets || ["CN"]),
        stringifyV5Json(input.project.languages || ["zh-CN"]),
        stringifyV5Json(input.project.targetChannels || ["wechat", "official_website"]),
        input.project.expressionFocus,
        stringifyV5Json(input.project.forbiddenFocus || []),
        input.actor.actorId
      ]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_project_created",
      objectType: "geo_research_project",
      objectId: projectId,
      afterSummary: {
        productId: input.project.productId,
        status: "draft",
        rowVersion: 1
      },
      correlationId: projectId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_geo_research_project",
      requestHash,
      resourceType: "geo_research_project",
      resourceId: projectId,
      responseStatus: "created",
      responseSummary: { projectId, rowVersion: 1 }
    });
    return { replayed: false, projectId, rowVersion: 1 };
  });
}

export async function readGeoResearchProjectByProduct(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM geo_research_project WHERE product_id = ? LIMIT 1",
    [productId]
  );
  return rows[0] ? mapProject(rows[0]) : undefined;
}

export async function updateGeoResearchProjectRecord(input: {
  productId: string;
  expectedVersion: number;
  expressionFocus: string;
  forbiddenFocus: string[];
  researchMarkets: string[];
  languages: string[];
  targetChannels: string[];
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    expectedVersion: input.expectedVersion,
    expressionFocus: input.expressionFocus,
    forbiddenFocus: input.forbiddenFocus,
    researchMarkets: input.researchMarkets,
    languages: input.languages,
    targetChannels: input.targetChannels
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        projectId: replay.resourceId,
        rowVersion: Number((replay.responseSummary as { rowVersion?: number }).rowVersion)
      };
    }
    const row = await readProjectForUpdate(connection, input.productId);
    if (!row) {
      throw new V5GovernanceRepositoryError("research_project_not_found", "GEO 调研项目不存在。", 404);
    }
    if (Number(row.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `调研项目当前版本为 ${Number(row.row_version)}。`,
        409,
        "刷新页面后重新编辑研究边界。"
      );
    }
    const [activeRunRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM geo_research_run
       WHERE project_id = ? AND status IN ('planned','queued','running','awaiting_frontend','synthesizing','pending_review')
       LIMIT 1 FOR UPDATE`,
      [String(row.id)]
    );
    if (activeRunRows[0]) {
      throw new V5GovernanceRepositoryError(
        "research_run_in_progress",
        "当前运行尚未结束，不能修改研究边界。",
        409,
        "等待运行完成；如果蓝图正在审核，请先退回修改。"
      );
    }
    const [updateResult] = await connection.query(
      `UPDATE geo_research_project
       SET expression_focus = ?, forbidden_focus = ?, research_markets = ?, languages = ?,
           target_channels = ?, status = 'ready', row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [
        input.expressionFocus,
        stringifyV5Json(input.forbiddenFocus),
        stringifyV5Json(input.researchMarkets),
        stringifyV5Json(input.languages),
        stringifyV5Json(input.targetChannels),
        String(row.id),
        input.expectedVersion
      ]
    );
    if (Number((updateResult as { affectedRows?: number }).affectedRows || 0) !== 1) {
      throw new V5GovernanceRepositoryError("version_conflict", "研究边界保存时发生版本冲突。", 409);
    }
    const nextVersion = input.expectedVersion + 1;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_project_boundary_updated",
      objectType: "geo_research_project",
      objectId: String(row.id),
      beforeSummary: {
        status: String(row.status),
        rowVersion: input.expectedVersion
      },
      afterSummary: {
        status: "ready",
        rowVersion: nextVersion,
        researchMarkets: input.researchMarkets,
        languages: input.languages,
        targetChannels: input.targetChannels
      },
      correlationId: String(row.id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "update_geo_research_project_boundary",
      requestHash,
      resourceType: "geo_research_project",
      resourceId: String(row.id),
      responseStatus: "updated",
      responseSummary: { projectId: String(row.id), rowVersion: nextVersion }
    });
    return { replayed: false, projectId: String(row.id), rowVersion: nextVersion };
  });
}

export async function readGeoResearchWorkspace(productId: string): Promise<GeoResearchWorkspace | undefined> {
  const project = await readGeoResearchProjectByProduct(productId);
  if (!project) return undefined;

  const [runRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM geo_research_run WHERE project_id = ? ORDER BY run_version DESC",
    [project.projectId]
  );
  const runs = runRows.map(mapRun);
  const latestRun = runs[0];
  let latestTasks: GeoResearchTask[] = [];
  let latestEvidence: GeoResearchEvidence[] = [];
  let latestFindings: GeoResearchFinding[] = [];
  if (latestRun) {
    const [[taskRows], [evidenceRows], [findingRows]] = await Promise.all([
      getV5GovernancePool().query<RowDataPacket[]>(
        "SELECT * FROM geo_research_task WHERE run_id = ? ORDER BY created_at, id",
        [latestRun.runId]
      ),
      getV5GovernancePool().query<RowDataPacket[]>(
        "SELECT * FROM geo_research_evidence WHERE run_id = ? ORDER BY captured_at DESC, id LIMIT 500",
        [latestRun.runId]
      ),
      getV5GovernancePool().query<RowDataPacket[]>(
        "SELECT * FROM geo_research_finding WHERE run_id = ? ORDER BY finding_type, confidence DESC, created_at",
        [latestRun.runId]
      )
    ]);
    latestTasks = taskRows.map(mapTask);
    latestEvidence = evidenceRows.map(mapEvidence);
    latestFindings = findingRows.map(mapFinding);
  }
  let currentBlueprint: GeoBlueprintVersion | undefined;
  if (project.currentApprovedBlueprintVersionId) {
    const [blueprintRows] = await getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_blueprint_version WHERE id = ? LIMIT 1",
      [project.currentApprovedBlueprintVersionId]
    );
    currentBlueprint = blueprintRows[0] ? mapBlueprint(blueprintRows[0]) : undefined;
  } else {
    const [blueprintRows] = await getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_blueprint_version WHERE project_id = ? ORDER BY version_number DESC LIMIT 1",
      [project.projectId]
    );
    currentBlueprint = blueprintRows[0] ? mapBlueprint(blueprintRows[0]) : undefined;
  }
  return { project, runs, latestRun, latestTasks, latestEvidence, latestFindings, currentBlueprint };
}

export async function readLatestGeoSourceSnapshot(productId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT id, snapshot_hash, source_ids, source_revision_ids, approved_claim_ids, created_at
     FROM source_snapshot WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  const row = rows[0];
  if (!row) return undefined;
  const sourceIds = parseV5Json<unknown[]>(row.source_ids, []);
  const sourceRevisionIds = parseV5Json<unknown[]>(row.source_revision_ids, []);
  const [sourceRows] = await getV5GovernancePool().query<RowDataPacket[]>(GEO_SOURCE_QUALITY_QUERY, [String(row.id)]);
  return {
    snapshotId: String(row.id),
    snapshotHash: String(row.snapshot_hash),
    sourceCount: sourceIds.length,
    revisionCount: sourceRevisionIds.length,
    approvedClaimCount: parseV5Json<unknown[]>(row.approved_claim_ids, []).length,
    createdAt: iso(row.created_at),
    quality: evaluateGeoSourceSnapshotQuality({
      declaredSourceCount: sourceIds.length,
      declaredRevisionCount: sourceRevisionIds.length,
      sources: mapSnapshotSourceMetadata(sourceRows)
    })
  };
}

export async function readGeoResearchRunWorkspace(input: {
  productId: string;
  runId: string;
}): Promise<GeoResearchRunWorkspace | undefined> {
  const [runRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    "SELECT * FROM geo_research_run WHERE id = ? AND product_id = ? LIMIT 1",
    [input.runId, input.productId]
  );
  if (!runRows[0]) return undefined;
  const [[taskRows], [evidenceRows], [findingRows], [blueprintRows]] = await Promise.all([
    getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE run_id = ? ORDER BY created_at, id",
      [input.runId]
    ),
    getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_research_evidence WHERE run_id = ? ORDER BY captured_at DESC, id LIMIT 1000",
      [input.runId]
    ),
    getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_research_finding WHERE run_id = ? ORDER BY finding_type, confidence DESC, created_at",
      [input.runId]
    ),
    getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT * FROM geo_blueprint_version WHERE run_id = ? LIMIT 1",
      [input.runId]
    )
  ]);
  return {
    run: mapRun(runRows[0]),
    tasks: taskRows.map(mapTask),
    evidence: evidenceRows.map(mapEvidence),
    findings: findingRows.map(mapFinding),
    blueprint: blueprintRows[0] ? mapBlueprint(blueprintRows[0]) : undefined
  };
}

export async function readGeoResearchTaskExecutionContext(taskId: string) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT t.*, r.product_id, r.project_id, r.input_source_snapshot_hash,
            p.canonical_name, p.display_name, p.brand_name, p.official_entity, p.official_url,
            p.product_category, p.aliases,
            rp.expression_focus, rp.forbidden_focus, rp.research_markets, rp.languages, rp.target_channels
     FROM geo_research_task t
     JOIN geo_research_run r ON r.id = t.run_id
     JOIN product_entity p ON p.id = r.product_id
     JOIN geo_research_project rp ON rp.id = r.project_id
     WHERE t.id = ? LIMIT 1`,
    [taskId]
  );
  const row = rows[0];
  if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "调研任务不存在。", 404);
  const [previousRows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT task_type, output_summary FROM geo_research_task
     WHERE run_id = ? AND status = 'completed' ORDER BY created_at, id`,
    [String(row.run_id)]
  );
  return {
    task: mapTask(row),
    product: {
      productId: String(row.product_id),
      canonicalName: String(row.canonical_name),
      displayName: String(row.display_name),
      brandName: row.brand_name ? String(row.brand_name) : undefined,
      officialEntity: row.official_entity ? String(row.official_entity) : undefined,
      officialUrl: row.official_url ? String(row.official_url) : undefined,
      productCategory: row.product_category ? String(row.product_category) : undefined,
      aliases: parseV5Json<string[]>(row.aliases, [])
    },
    project: {
      expressionFocus: String(row.expression_focus),
      forbiddenFocus: parseV5Json<string[]>(row.forbidden_focus, []),
      researchMarkets: parseV5Json<string[]>(row.research_markets, []),
      languages: parseV5Json<string[]>(row.languages, []),
      targetChannels: parseV5Json<string[]>(row.target_channels, [])
    },
    sourceSnapshotHash: String(row.input_source_snapshot_hash),
    previousOutputs: previousRows.map((previous) => ({
      taskType: String(previous.task_type) as GeoResearchTaskType,
      outputSummary: parseV5Json<Record<string, unknown>>(previous.output_summary, {})
    }))
  };
}

export async function createGeoResearchRunRecord(input: {
  productId: string;
  triggerType: GeoResearchRun["triggerType"];
  expectedProjectVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    triggerType: input.triggerType,
    expectedProjectVersion: input.expectedProjectVersion
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        runId: replay.resourceId,
        projectRowVersion: Number((replay.responseSummary as { projectRowVersion?: number }).projectRowVersion)
      };
    }

    const projectRow = await readProjectForUpdate(connection, input.productId);
    if (!projectRow) {
      throw new V5GovernanceRepositoryError(
        "research_project_not_found",
        "该产品还没有 GEO 调研项目。",
        404,
        "先提交产品表达重点，创建调研项目。"
      );
    }
    const currentProjectVersion = Number(projectRow.row_version);
    if (currentProjectVersion !== input.expectedProjectVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `调研项目当前版本为 ${currentProjectVersion}。`,
        409,
        "刷新页面读取最新版本后重试。"
      );
    }

    const [activeRunRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM geo_research_run
       WHERE project_id = ? AND status IN ('planned','queued','running','awaiting_frontend','synthesizing','pending_review')
       LIMIT 1 FOR UPDATE`,
      [String(projectRow.id)]
    );
    if (activeRunRows[0]) {
      throw new V5GovernanceRepositoryError(
        "research_run_in_progress",
        "当前已有未结束的 GEO 调研运行。",
        409,
        `请先查看运行 ${String(activeRunRows[0].id)}。`
      );
    }

    const [snapshotRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, snapshot_hash, source_ids, source_revision_ids FROM source_snapshot
       WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
      [input.productId]
    );
    const snapshot = snapshotRows[0];
    if (!snapshot) {
      throw new V5GovernanceRepositoryError(
        "research_source_snapshot_missing",
        "尚未形成可追溯的产品资料快照，不能启动联网调研。",
        409,
        "先上传产品资料或绑定知识库，完成资料导入与快照生成。"
      );
    }
    const [sourceRows] = await connection.query<RowDataPacket[]>(GEO_SOURCE_QUALITY_QUERY, [String(snapshot.id)]);
    const sourceQuality = evaluateGeoSourceSnapshotQuality({
      declaredSourceCount: parseV5Json<unknown[]>(snapshot.source_ids, []).length,
      declaredRevisionCount: parseV5Json<unknown[]>(snapshot.source_revision_ids, []).length,
      sources: mapSnapshotSourceMetadata(sourceRows)
    });
    if (sourceQuality.status === "blocked") {
      throw new V5GovernanceRepositoryError(
        "research_source_quality_blocked",
        `当前产品资料快照未通过正式来源检查：${sourceQuality.issues.join("；")}`,
        409,
        "移除测试/占位资料，并补充具有公开原始网址的 A1/A2 正式产品来源后重新生成快照。"
      );
    }

    const [versionRows] = await connection.query<RowDataPacket[]>(
      "SELECT run_version FROM geo_research_run WHERE project_id = ? ORDER BY run_version DESC LIMIT 1 FOR UPDATE",
      [String(projectRow.id)]
    );
    const runVersion = Number(versionRows[0]?.run_version || 0) + 1;
    const runId = `geo-run-${randomUUID()}`;
    const plan = {
      objective: "produce_auditable_geo_blueprint",
      sourceSnapshotId: String(snapshot.id),
      requiredStages: RESEARCH_TASK_GRAPH.map((item) => item.type),
      gates: {
        liveSearchEvidenceRequired: true,
        frontendBaselineRequired: true,
        humanApprovalRequired: true
      }
    };
    await connection.query(
      `INSERT INTO geo_research_run
        (id, project_id, product_id, run_version, trigger_type, input_source_snapshot_hash, plan_json,
         plan_schema_version, status, live_search_required, live_search_verified, row_version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'geo-research-plan-v1', 'queued', TRUE, FALSE, 1, ?)`,
      [
        runId,
        String(projectRow.id),
        input.productId,
        runVersion,
        input.triggerType,
        String(snapshot.snapshot_hash),
        stringifyV5Json(plan),
        input.actor.actorId
      ]
    );

    const taskIds = new Map<GeoResearchTaskType, string>();
    for (const node of RESEARCH_TASK_GRAPH) taskIds.set(node.type, `geo-task-${randomUUID()}`);
    for (const node of RESEARCH_TASK_GRAPH) {
      const dependencyIds = node.dependencies.map((dependency) => taskIds.get(dependency) as string);
      await connection.query(
        `INSERT INTO geo_research_task
          (id, run_id, task_type, dependency_ids, request_json, output_summary, status, attempt,
           max_attempts, available_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, JSON_OBJECT(), ?, 0, 3, NOW(), ?)`,
        [
          taskIds.get(node.type),
          runId,
          node.type,
          stringifyV5Json(dependencyIds),
          stringifyV5Json({
            productId: input.productId,
            projectId: String(projectRow.id),
            sourceSnapshotId: String(snapshot.id),
            sourceSnapshotHash: String(snapshot.snapshot_hash)
          }),
          dependencyIds.length === 0 ? "queued" : "blocked",
          `${runId}:${node.type}`
        ]
      );
    }

    const [updateResult] = await connection.query(
      `UPDATE geo_research_project
       SET status = 'researching', row_version = row_version + 1
       WHERE id = ? AND row_version = ?`,
      [String(projectRow.id), input.expectedProjectVersion]
    );
    const affectedRows = Number((updateResult as { affectedRows?: number }).affectedRows || 0);
    if (affectedRows !== 1) {
      throw new V5GovernanceRepositoryError("version_conflict", "调研项目在启动期间被其他操作更新。", 409);
    }

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_run_created",
      objectType: "geo_research_run",
      objectId: runId,
      afterSummary: {
        productId: input.productId,
        projectId: String(projectRow.id),
        runVersion,
        taskCount: RESEARCH_TASK_GRAPH.length,
        liveSearchRequired: true,
        sourceSnapshotHash: String(snapshot.snapshot_hash)
      },
      correlationId: runId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "create_geo_research_run",
      requestHash,
      resourceType: "geo_research_run",
      resourceId: runId,
      responseStatus: "queued",
      responseSummary: {
        runId,
        runVersion,
        projectRowVersion: currentProjectVersion + 1
      }
    });
    return {
      replayed: false,
      runId,
      runVersion,
      projectRowVersion: currentProjectVersion + 1
    };
  });
}

export async function leaseNextGeoResearchTask(input: {
  workerId: string;
  leaseSeconds?: number;
  taskTypes?: GeoResearchTaskType[];
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const taskTypeClause = input.taskTypes?.length
      ? `AND task_type IN (${input.taskTypes.map(() => "?").join(",")})`
      : "";
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM geo_research_task
       WHERE (
         (status IN ('queued','pending_config') AND available_at <= NOW())
         OR (status = 'running' AND lease_expires_at < NOW())
       )
         ${taskTypeClause}
       ORDER BY available_at, created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      input.taskTypes || []
    );
    if (!rows[0]) return undefined;
    const taskId = String(rows[0].id);
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'running', attempt = attempt + 1, lease_owner = ?,
           lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [input.workerId, input.leaseSeconds || 300, taskId]
    );
    await connection.query(
      `UPDATE geo_research_run r
       JOIN geo_research_task t ON t.run_id = r.id
       SET r.status = 'running', r.started_at = COALESCE(r.started_at, NOW()), r.row_version = r.row_version + 1
       WHERE t.id = ? AND r.status IN ('queued','blocked')`,
      [taskId]
    );
    const [leasedRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE id = ? LIMIT 1",
      [taskId]
    );
    return mapTask(leasedRows[0]);
  });
}

async function unlockSatisfiedTasks(connection: PoolConnection, runId: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id, dependency_ids FROM geo_research_task WHERE run_id = ? AND status = 'blocked' FOR UPDATE",
    [runId]
  );
  for (const row of rows) {
    const dependencies = parseV5Json<string[]>(row.dependency_ids, []);
    if (!dependencies.length) continue;
    const [completedRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS completed_count FROM geo_research_task
       WHERE run_id = ? AND status = 'completed' AND id IN (${dependencies.map(() => "?").join(",")})`,
      [runId, ...dependencies]
    );
    if (Number(completedRows[0]?.completed_count || 0) === dependencies.length) {
      await connection.query(
        "UPDATE geo_research_task SET status = 'queued', available_at = NOW() WHERE id = ? AND status = 'blocked'",
        [String(row.id)]
      );
    }
  }
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sourceUrls(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item))
    : [];
}

function findingTitle(item: Record<string, unknown>, fallback: string) {
  for (const field of ["text", "name", "title", "question", "type"]) {
    if (typeof item[field] === "string" && item[field].trim()) return item[field].trim().slice(0, 500);
  }
  return fallback;
}

function findingSummary(item: Record<string, unknown>) {
  for (const field of ["summary", "reason", "intent", "answerSummary", "description"]) {
    if (typeof item[field] === "string" && item[field].trim()) return item[field].trim();
  }
  return JSON.stringify(item).slice(0, 4000);
}

function buildProviderFindings(
  taskType: GeoResearchTaskType,
  structured: Record<string, unknown>,
  evidenceIdsByUrl: Map<string, string>,
  allEvidenceIds: string[]
) {
  const specs: Array<{ field: string; findingType: string; fallback: string }> = taskType === "live_question_discovery"
    ? [
        { field: "questions", findingType: "question_opportunity", fallback: "用户问题机会" },
        { field: "contentGaps", findingType: "content_gap", fallback: "内容缺口" }
      ]
    : taskType === "live_competitor_discovery"
      ? [
          { field: "competitors", findingType: "competitor_mention", fallback: "竞品发现" },
          { field: "citationPatterns", findingType: "citation_pattern", fallback: "引用模式" },
          { field: "contentOpportunities", findingType: "content_gap", fallback: "内容机会" }
        ]
      : taskType === "frontend_baseline"
        ? [{ field: "tests", findingType: "citation_pattern", fallback: "AI 前台基线结果" }]
        : taskType === "evidence_alignment"
          ? [
              { field: "priorityGaps", findingType: "evidence_gap", fallback: "优先证据缺口" },
              { field: "recommendedArticleTypes", findingType: "article_type_recommendation", fallback: "推荐文章类型" },
              { field: "retestRequirements", findingType: "retest_requirement", fallback: "复测要求" }
            ]
          : [];
  const findings: Array<{
    findingType: string;
    title: string;
    summary: string;
    evidenceIds: string[];
    confidence: number;
  }> = [];
  for (const spec of specs) {
    const rawItems = Array.isArray(structured[spec.field]) ? structured[spec.field] as unknown[] : [];
    for (const raw of rawItems.slice(0, 100)) {
      const item = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : { text: typeof raw === "string" ? raw : JSON.stringify(raw) };
      const urls = [
        ...sourceUrls(item.sourceUrls),
        ...sourceUrls(item.citedUrls)
      ];
      const evidenceIds = urls.flatMap((url) => evidenceIdsByUrl.get(url) || []);
      if (spec.findingType === "question_opportunity" && evidenceIds.length === 0) continue;
      findings.push({
        findingType: spec.findingType,
        title: findingTitle(item, spec.fallback),
        summary: findingSummary(item),
        evidenceIds: evidenceIds.length ? [...new Set(evidenceIds)] : allEvidenceIds,
        confidence: typeof item.confidence === "number"
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.7
      });
    }
  }
  return findings;
}

export async function persistGeoResearchProviderResult(input: {
  taskId: string;
  workerId: string;
  result: GeoResearchProviderResult;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT t.*, r.project_id, r.product_id, r.input_source_snapshot_hash
       FROM geo_research_task t
       JOIN geo_research_run r ON r.id = t.run_id
       WHERE t.id = ? LIMIT 1 FOR UPDATE`,
      [input.taskId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "调研任务不存在。", 404);
    if (String(row.status) !== "running" || String(row.lease_owner || "") !== input.workerId) {
      throw new V5GovernanceRepositoryError("research_task_lease_conflict", "调研任务租约冲突。", 409);
    }

    const runId = String(row.run_id);
    const taskType = String(row.task_type) as GeoResearchTaskType;
    const artifactId = `geo-artifact-${randomUUID()}`;
    await connection.query(
      `INSERT INTO geo_research_artifact
        (id, run_id, task_id, artifact_type, provider, provider_model, payload_json, payload_hash)
       VALUES (?, ?, ?, 'provider_response', ?, ?, ?, ?)`,
      [
        artifactId,
        runId,
        input.taskId,
        input.result.provider,
        input.result.model,
        stringifyV5Json(input.result.rawResponse),
        input.result.payloadHash
      ]
    );

    const evidenceIdsByUrl = new Map<string, string>();
    const allEvidenceIds: string[] = [];
    for (const source of input.result.sources) {
      const evidenceId = `geo-evidence-${randomUUID()}`;
      evidenceIdsByUrl.set(source.url, evidenceId);
      allEvidenceIds.push(evidenceId);
      await connection.query(
        `INSERT INTO geo_research_evidence
          (id, run_id, evidence_type, source_url, source_title, publisher, query_text,
           snapshot_hash, content_locator, captured_at, verification_status, visibility, artifact_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'verified', 'public', ?)`,
        [
          evidenceId,
          runId,
          taskType === "frontend_baseline" ? "visible_citation" : "search_result",
          source.url,
          source.title || null,
          source.publisher || null,
          source.query || null,
          source.snapshotHash || null,
          stringifyV5Json({
            responseId: input.result.responseId,
            taskId: input.taskId,
            taskType,
            providerKeys: source.providerKeys || [],
            sourceType: source.sourceType,
            authority: source.authority,
            publishedAt: source.publishedAt,
            retrievedAt: source.retrievedAt,
            excerpt: source.excerpt,
            providerRunIds: source.providerRunIds || [],
            rawResponseRefs: source.rawResponseRefs || []
          }),
          artifactId
        ]
      );
    }
    if (taskType === "frontend_baseline") {
      const answerEvidenceId = `geo-evidence-${randomUUID()}`;
      allEvidenceIds.push(answerEvidenceId);
      await connection.query(
        `INSERT INTO geo_research_evidence
          (id, run_id, evidence_type, content_locator, captured_at, verification_status, visibility, artifact_id)
         VALUES (?, ?, 'frontend_answer', ?, NOW(), 'verified', 'controlled_internal', ?)`,
        [
          answerEvidenceId,
          runId,
          stringifyV5Json({
            responseId: input.result.responseId,
            taskId: input.taskId,
            citedEvidenceIds: [...evidenceIdsByUrl.values()]
          }),
          artifactId
        ]
      );
    }

    const findings = buildProviderFindings(
      taskType,
      input.result.structured,
      evidenceIdsByUrl,
      allEvidenceIds
    );
    for (const finding of findings) {
      await connection.query(
        `INSERT INTO geo_research_finding
          (id, run_id, finding_type, title, summary, evidence_ids, confidence, review_status, analyzer_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 'geo-multi-search-zhipu-synthesis-v2')`,
        [
          `geo-finding-${randomUUID()}`,
          runId,
          finding.findingType,
          finding.title,
          finding.summary,
          stringifyV5Json(finding.evidenceIds),
          finding.confidence
        ]
      );
    }

    const outputSummary = {
      ...input.result.structured,
      provider: input.result.provider,
      model: input.result.model,
      responseId: input.result.responseId,
      artifactId,
      evidenceIds: allEvidenceIds,
      sourceCount: input.result.sources.length,
      findingCount: findings.length,
      liveSearchVerified: input.result.liveSearchVerified
    };
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'completed', output_summary = ?, response_artifact_id = ?, provider = ?,
           provider_model = ?, tool_name = ?, lease_owner = NULL, lease_expires_at = NULL,
           failure_code = NULL, failure_message = NULL
       WHERE id = ?`,
      [
        stringifyV5Json(outputSummary),
        artifactId,
        input.result.provider,
        input.result.model,
        input.result.toolName,
        input.taskId
      ]
    );
    if (input.result.liveSearchVerified) {
      await connection.query(
        "UPDATE geo_research_run SET live_search_verified = TRUE, row_version = row_version + 1 WHERE id = ?",
        [runId]
      );
    }
    await unlockSatisfiedTasks(connection, runId);

    let blueprintVersionId: string | undefined;
    if (taskType === "blueprint_synthesis") {
      const [liveRows] = await connection.query<RowDataPacket[]>(
        `SELECT task_type, output_summary FROM geo_research_task
         WHERE run_id = ? AND task_type IN ('live_question_discovery','live_competitor_discovery','frontend_baseline')
         FOR UPDATE`,
        [runId]
      );
      const missingLiveEvidence = liveRows.length !== 3 || liveRows.some((liveRow) => (
        parseV5Json<Record<string, unknown>>(liveRow.output_summary, {}).liveSearchVerified !== true
      ));
      if (missingLiveEvidence) {
        throw new V5GovernanceRepositoryError(
          "live_search_gate_failed",
          "蓝图生成前缺少完整的联网问题、竞品或 AI 前台证据。",
          409
        );
      }
      const structured = input.result.structured;
      const requiredBlueprintFields = [
        "questionStrategy",
        "competitorLandscape",
        "citationStrategy",
        "contentTypeStrategy",
        "evidenceRequirements",
        "monthlyStrategyInput",
        "retestBaseline"
      ];
      const missingBlueprintFields = requiredBlueprintFields.filter(
        (field) => Object.keys(asObject(structured[field])).length === 0
      );
      if (missingBlueprintFields.length > 0) {
        throw new V5GovernanceRepositoryError(
          "blueprint_contract_invalid",
          `GEO 蓝图缺少必需结构：${missingBlueprintFields.join(", ")}，不能进入人工评审。`,
          502
        );
      }
      const [versionRows] = await connection.query<RowDataPacket[]>(
        "SELECT version_number FROM geo_blueprint_version WHERE project_id = ? ORDER BY version_number DESC LIMIT 1 FOR UPDATE",
        [String(row.project_id)]
      );
      const versionNumber = Number(versionRows[0]?.version_number || 0) + 1;
      blueprintVersionId = `geo-blueprint-${randomUUID()}`;
      const researchSnapshotHash = createHash("sha256")
        .update(`${String(row.input_source_snapshot_hash)}:${input.result.payloadHash}`)
        .digest("hex");
      await connection.query(
        `INSERT INTO geo_blueprint_version
          (id, project_id, run_id, version_number, status, question_strategy, competitor_landscape,
           citation_strategy, content_type_strategy, evidence_requirements, monthly_strategy_input,
           retest_baseline, research_snapshot_hash, row_version, created_by)
         VALUES (?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          blueprintVersionId,
          String(row.project_id),
          runId,
          versionNumber,
          stringifyV5Json(asObject(structured.questionStrategy)),
          stringifyV5Json(asObject(structured.competitorLandscape)),
          stringifyV5Json(asObject(structured.citationStrategy)),
          stringifyV5Json(asObject(structured.contentTypeStrategy)),
          stringifyV5Json(asObject(structured.evidenceRequirements)),
          stringifyV5Json(asObject(structured.monthlyStrategyInput)),
          stringifyV5Json(asObject(structured.retestBaseline)),
          researchSnapshotHash,
          input.actor.actorId
        ]
      );
      await connection.query(
        `UPDATE geo_research_run
         SET status = 'pending_review', completed_at = NOW(), row_version = row_version + 1
         WHERE id = ?`,
        [runId]
      );
      await connection.query(
        `UPDATE geo_research_project
         SET status = 'blueprint_review', row_version = row_version + 1
         WHERE id = ?`,
        [String(row.project_id)]
      );
    }

    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: blueprintVersionId ? "geo_blueprint_generated_for_review" : "geo_research_task_completed",
      objectType: blueprintVersionId ? "geo_blueprint_version" : "geo_research_task",
      objectId: blueprintVersionId || input.taskId,
      relatedSourceIds: allEvidenceIds,
      afterSummary: {
        runId,
        taskType,
        artifactId,
        sourceCount: input.result.sources.length,
        findingCount: findings.length,
        liveSearchVerified: input.result.liveSearchVerified,
        blueprintStatus: blueprintVersionId ? "pending_review" : undefined
      },
      correlationId: runId
    });
    return {
      taskId: input.taskId,
      runId,
      artifactId,
      evidenceIds: allEvidenceIds,
      findingCount: findings.length,
      blueprintVersionId
    };
  });
}

export async function confirmGeoResearchQuestionFindingsRecord(input: {
  productId: string;
  runId: string;
  findingIds: string[];
  catalogId: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const findingIds = [...new Set(input.findingIds)].sort();
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    runId: input.runId,
    findingIds,
    catalogId: input.catalogId
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return { replayed: true, catalogId: replay.resourceId, confirmedCount: findingIds.length };
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT f.id, f.finding_type, f.review_status
       FROM geo_research_finding f
       JOIN geo_research_run r ON r.id = f.run_id
       WHERE f.run_id = ? AND r.product_id = ? AND f.id IN (?)
       FOR UPDATE`,
      [input.runId, input.productId, findingIds]
    );
    if (rows.length !== findingIds.length || rows.some((row) => String(row.finding_type) !== "question_opportunity")) {
      throw new V5GovernanceRepositoryError(
        "question_catalog_finding_mismatch",
        "待收录项包含不存在或不属于该产品研究运行的问题发现。",
        409,
        "刷新研究运行后重新选择问题。"
      );
    }
    await connection.query(
      `UPDATE geo_research_finding
       SET review_status = 'confirmed'
       WHERE run_id = ? AND id IN (?) AND finding_type = 'question_opportunity'`,
      [input.runId, findingIds]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_question_catalog_imported_to_question_pool",
      objectType: "geo_question_catalog",
      objectId: input.catalogId,
      relatedSourceIds: findingIds,
      afterSummary: { productId: input.productId, runId: input.runId, confirmedCount: findingIds.length },
      correlationId: input.runId
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "confirm_geo_question_catalog",
      requestHash,
      resourceType: "geo_question_catalog",
      resourceId: input.catalogId,
      responseStatus: "confirmed",
      responseSummary: { confirmedCount: findingIds.length }
    });
    return { replayed: false, catalogId: input.catalogId, confirmedCount: findingIds.length };
  });
}

export async function completeGeoResearchTaskRecord(input: {
  taskId: string;
  workerId: string;
  outputSummary: Record<string, unknown>;
  responseArtifactId?: string;
  provider?: string;
  providerModel?: string;
  toolName?: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.taskId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "调研任务不存在。", 404);
    if (String(row.status) === "completed") return mapTask(row);
    if (String(row.status) !== "running" || String(row.lease_owner || "") !== input.workerId) {
      throw new V5GovernanceRepositoryError(
        "research_task_lease_conflict",
        "调研任务不属于当前 Worker 或租约已经失效。",
        409
      );
    }
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'completed', output_summary = ?, response_artifact_id = ?, provider = ?,
           provider_model = ?, tool_name = ?, lease_owner = NULL, lease_expires_at = NULL,
           failure_code = NULL, failure_message = NULL
       WHERE id = ?`,
      [
        stringifyV5Json(input.outputSummary),
        input.responseArtifactId || null,
        input.provider || null,
        input.providerModel || null,
        input.toolName || null,
        input.taskId
      ]
    );
    await unlockSatisfiedTasks(connection, String(row.run_id));
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_task_completed",
      objectType: "geo_research_task",
      objectId: input.taskId,
      afterSummary: {
        runId: String(row.run_id),
        taskType: String(row.task_type),
        responseArtifactId: input.responseArtifactId
      },
      correlationId: String(row.run_id)
    });
    const [updatedRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE id = ? LIMIT 1",
      [input.taskId]
    );
    return mapTask(updatedRows[0]);
  });
}

export async function markGeoResearchTaskPendingConfig(input: {
  taskId: string;
  workerId: string;
  failureCode: string;
  failureMessage: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.taskId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "调研任务不存在。", 404);
    if (String(row.status) !== "running" || String(row.lease_owner || "") !== input.workerId) {
      throw new V5GovernanceRepositoryError("research_task_lease_conflict", "调研任务租约冲突。", 409);
    }
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'pending_config', failure_code = ?, failure_message = ?,
           lease_owner = NULL, lease_expires_at = NULL, available_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE)
       WHERE id = ?`,
      [input.failureCode, input.failureMessage, input.taskId]
    );
    await connection.query(
      `UPDATE geo_research_run
       SET status = 'blocked', failure_code = ?, failure_message = ?, row_version = row_version + 1
       WHERE id = ?`,
      [input.failureCode, input.failureMessage, String(row.run_id)]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_task_pending_config",
      objectType: "geo_research_task",
      objectId: input.taskId,
      afterSummary: {
        runId: String(row.run_id),
        taskType: String(row.task_type),
        failureCode: input.failureCode
      },
      correlationId: String(row.run_id)
    });
  });
}

export async function failGeoResearchTaskRecord(input: {
  taskId: string;
  workerId: string;
  failureCode: string;
  failureMessage: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM geo_research_task WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.taskId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "调研任务不存在。", 404);
    if (String(row.status) !== "running" || String(row.lease_owner || "") !== input.workerId) {
      throw new V5GovernanceRepositoryError("research_task_lease_conflict", "调研任务租约冲突。", 409);
    }
    const exhausted = Number(row.attempt) >= Number(row.max_attempts);
    await connection.query(
      `UPDATE geo_research_task
       SET status = ?, failure_code = ?, failure_message = ?, lease_owner = NULL, lease_expires_at = NULL,
           available_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [
        exhausted ? "failed" : "queued",
        input.failureCode,
        input.failureMessage,
        Math.min(900, 30 * Math.max(1, Number(row.attempt))),
        input.taskId
      ]
    );
    if (exhausted) {
      await connection.query(
        `UPDATE geo_research_run
         SET status = 'failed', failure_code = ?, failure_message = ?, row_version = row_version + 1
         WHERE id = ?`,
        [input.failureCode, input.failureMessage, String(row.run_id)]
      );
      await connection.query(
        `UPDATE geo_research_project p
         JOIN geo_research_run r ON r.project_id = p.id
         SET p.status = 'blocked', p.row_version = p.row_version + 1
         WHERE r.id = ?`,
        [String(row.run_id)]
      );
    }
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: exhausted ? "geo_research_task_failed" : "geo_research_task_retry_scheduled",
      objectType: "geo_research_task",
      objectId: input.taskId,
      afterSummary: {
        runId: String(row.run_id),
        taskType: String(row.task_type),
        failureCode: input.failureCode,
        attempt: Number(row.attempt),
        maxAttempts: Number(row.max_attempts),
        exhausted
      },
      correlationId: String(row.run_id)
    });
    return { exhausted };
  });
}

export async function retryFailedGeoResearchTaskRecord(input: {
  runId: string;
  productId: string;
  taskType: GeoResearchTaskType;
  additionalAttempts?: number;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT t.*, r.status AS run_status, r.project_id, r.input_source_snapshot_hash,
              (SELECT snapshot_hash FROM source_snapshot WHERE product_id = r.product_id ORDER BY created_at DESC LIMIT 1) AS latest_snapshot_hash
       FROM geo_research_task t
       JOIN geo_research_run r ON r.id = t.run_id
       WHERE t.run_id = ? AND r.product_id = ? AND t.task_type = ?
       LIMIT 1 FOR UPDATE`,
      [input.runId, input.productId, input.taskType]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_task_not_found", "GEO 调研失败任务不存在。", 404);
    if (String(row.status) !== "failed" || String(row.run_status) !== "failed") {
      throw new V5GovernanceRepositoryError("research_task_not_retryable", "只有已失败 run 中的失败任务可以人工授权重试。", 409);
    }
    if (String(row.input_source_snapshot_hash) !== String(row.latest_snapshot_hash || "")) {
      throw new V5GovernanceRepositoryError("research_source_snapshot_stale", "失败 run 绑定的资料快照已过期，请创建新 run。", 409);
    }
    const additionalAttempts = Math.max(1, Math.min(3, Math.floor(input.additionalAttempts || 1)));
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'queued', max_attempts = max_attempts + ?, failure_code = NULL, failure_message = NULL,
           lease_owner = NULL, lease_expires_at = NULL, available_at = NOW()
       WHERE id = ?`,
      [additionalAttempts, String(row.id)]
    );
    await connection.query(
      `UPDATE geo_research_run
       SET status = 'running', failure_code = NULL, failure_message = NULL, completed_at = NULL, row_version = row_version + 1
       WHERE id = ?`,
      [input.runId]
    );
    await connection.query(
      `UPDATE geo_research_project SET status = 'researching', row_version = row_version + 1 WHERE id = ?`,
      [String(row.project_id)]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_task_retry_authorized",
      objectType: "geo_research_task",
      objectId: String(row.id),
      beforeSummary: {
        runStatus: String(row.run_status),
        taskStatus: String(row.status),
        attempt: Number(row.attempt),
        maxAttempts: Number(row.max_attempts),
        failureCode: row.failure_code ? String(row.failure_code) : undefined
      },
      afterSummary: {
        runStatus: "running",
        taskStatus: "queued",
        maxAttempts: Number(row.max_attempts) + additionalAttempts,
        sourceSnapshotHash: String(row.input_source_snapshot_hash)
      },
      correlationId: input.runId
    });
    return {
      runId: input.runId,
      taskId: String(row.id),
      taskType: input.taskType,
      attempt: Number(row.attempt),
      maxAttempts: Number(row.max_attempts) + additionalAttempts
    };
  });
}

export async function cancelStaleGeoResearchRunRecord(input: {
  runId: string;
  productId: string;
  replacementSourceSnapshotHash: string;
  actor: V5GovernanceActor;
}) {
  return withV5GovernanceTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, project_id, status, input_source_snapshot_hash, row_version
       FROM geo_research_run
       WHERE id = ? AND product_id = ?
       LIMIT 1 FOR UPDATE`,
      [input.runId, input.productId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("research_run_not_found", "GEO 调研运行不存在。", 404);
    const status = String(row.status);
    if (["completed", "failed", "cancelled"].includes(status)) {
      return { runId: input.runId, cancelled: false, status, replayed: true };
    }
    if (String(row.input_source_snapshot_hash) === input.replacementSourceSnapshotHash) {
      throw new V5GovernanceRepositoryError(
        "research_run_not_stale",
        "当前 GEO 调研仍绑定最新资料快照，不能作为过期运行取消。",
        409
      );
    }
    await connection.query(
      `UPDATE geo_research_task
       SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
           failure_code = 'source_snapshot_superseded',
           failure_message = '产品资料快照已更新，任务由新运行替代。'
       WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [input.runId]
    );
    await connection.query(
      `UPDATE geo_research_run
       SET status = 'cancelled', completed_at = NOW(),
           failure_code = 'source_snapshot_superseded',
           failure_message = '产品资料快照已更新，运行由新快照上的调研替代。',
           row_version = row_version + 1
       WHERE id = ?`,
      [input.runId]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_research_run_superseded_by_source_snapshot",
      objectType: "geo_research_run",
      objectId: input.runId,
      beforeSummary: {
        status,
        sourceSnapshotHash: String(row.input_source_snapshot_hash),
        rowVersion: Number(row.row_version)
      },
      afterSummary: {
        status: "cancelled",
        replacementSourceSnapshotHash: input.replacementSourceSnapshotHash,
        rowVersion: Number(row.row_version) + 1
      },
      correlationId: input.productId
    });
    return { runId: input.runId, cancelled: true, status: "cancelled", replayed: false };
  });
}

export async function approveGeoBlueprintRecord(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    blueprintVersionId: input.blueprintVersionId,
    expectedVersion: input.expectedVersion
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        blueprintVersionId: replay.resourceId,
        rowVersion: Number((replay.responseSummary as { rowVersion?: number }).rowVersion)
      };
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT b.*, p.product_id, p.row_version AS project_row_version
       FROM geo_blueprint_version b
       JOIN geo_research_project p ON p.id = b.project_id
       WHERE b.id = ? AND p.product_id = ? LIMIT 1 FOR UPDATE`,
      [input.blueprintVersionId, input.productId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("blueprint_not_found", "GEO 蓝图不存在。", 404);
    if (Number(row.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `GEO 蓝图当前版本为 ${Number(row.row_version)}。`,
        409,
        "刷新页面后重新确认。"
      );
    }
    if (String(row.status) !== "pending_review") {
      throw new V5GovernanceRepositoryError(
        "invalid_blueprint_transition",
        `状态为 ${String(row.status)} 的蓝图不能执行批准。`,
        409
      );
    }
    const [updateResult] = await connection.query(
      `UPDATE geo_blueprint_version
       SET status = 'approved', approved_by = ?, approved_at = NOW(), immutable_at = NOW(),
           row_version = row_version + 1
       WHERE id = ? AND row_version = ? AND status = 'pending_review'`,
      [input.actor.actorId, input.blueprintVersionId, input.expectedVersion]
    );
    if (Number((updateResult as { affectedRows?: number }).affectedRows || 0) !== 1) {
      throw new V5GovernanceRepositoryError("version_conflict", "GEO 蓝图在批准期间被其他操作更新。", 409);
    }
    await connection.query(
      `UPDATE geo_research_project
       SET status = 'ready_for_monthly_strategy', current_approved_blueprint_version_id = ?,
           row_version = row_version + 1
       WHERE id = ?`,
      [input.blueprintVersionId, String(row.project_id)]
    );
    await connection.query(
      `UPDATE geo_research_run
       SET status = 'completed', row_version = row_version + 1
       WHERE id = ? AND status = 'pending_review'`,
      [String(row.run_id)]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_blueprint_approved",
      objectType: "geo_blueprint_version",
      objectId: input.blueprintVersionId,
      beforeSummary: { status: "pending_review", rowVersion: input.expectedVersion },
      afterSummary: {
        status: "approved",
        rowVersion: input.expectedVersion + 1,
        projectStatus: "ready_for_monthly_strategy"
      },
      correlationId: String(row.run_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "approve_geo_blueprint",
      requestHash,
      resourceType: "geo_blueprint_version",
      resourceId: input.blueprintVersionId,
      responseStatus: "approved",
      responseSummary: {
        blueprintVersionId: input.blueprintVersionId,
        rowVersion: input.expectedVersion + 1
      }
    });
    return {
      replayed: false,
      blueprintVersionId: input.blueprintVersionId,
      rowVersion: input.expectedVersion + 1
    };
  });
}

export async function requestGeoBlueprintChangesRecord(input: {
  productId: string;
  blueprintVersionId: string;
  expectedVersion: number;
  reviewNote: string;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const requestHash = hashV5GovernancePayload({
    productId: input.productId,
    blueprintVersionId: input.blueprintVersionId,
    expectedVersion: input.expectedVersion,
    reviewNote: input.reviewNote
  });
  return withV5GovernanceTransaction(async (connection) => {
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay?.resourceId) {
      return {
        replayed: true,
        blueprintVersionId: replay.resourceId,
        rowVersion: Number((replay.responseSummary as { rowVersion?: number }).rowVersion)
      };
    }
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT b.*, p.product_id
       FROM geo_blueprint_version b
       JOIN geo_research_project p ON p.id = b.project_id
       WHERE b.id = ? AND p.product_id = ? LIMIT 1 FOR UPDATE`,
      [input.blueprintVersionId, input.productId]
    );
    const row = rows[0];
    if (!row) throw new V5GovernanceRepositoryError("blueprint_not_found", "GEO 蓝图不存在。", 404);
    if (Number(row.row_version) !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "version_conflict",
        `GEO 蓝图当前版本为 ${Number(row.row_version)}。`,
        409,
        "刷新页面后重新提交审核意见。"
      );
    }
    if (String(row.status) !== "pending_review") {
      throw new V5GovernanceRepositoryError(
        "invalid_blueprint_transition",
        `状态为 ${String(row.status)} 的蓝图不能退回修改。`,
        409
      );
    }
    const [updateResult] = await connection.query(
      `UPDATE geo_blueprint_version
       SET status = 'changes_requested', row_version = row_version + 1
       WHERE id = ? AND row_version = ? AND status = 'pending_review'`,
      [input.blueprintVersionId, input.expectedVersion]
    );
    if (Number((updateResult as { affectedRows?: number }).affectedRows || 0) !== 1) {
      throw new V5GovernanceRepositoryError("version_conflict", "GEO 蓝图退回时发生版本冲突。", 409);
    }
    await connection.query(
      "UPDATE geo_research_run SET status = 'completed', row_version = row_version + 1 WHERE id = ?",
      [String(row.run_id)]
    );
    await connection.query(
      "UPDATE geo_research_project SET status = 'ready', row_version = row_version + 1 WHERE id = ?",
      [String(row.project_id)]
    );
    const nextVersion = input.expectedVersion + 1;
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "geo_blueprint_changes_requested",
      objectType: "geo_blueprint_version",
      objectId: input.blueprintVersionId,
      beforeSummary: { status: "pending_review", rowVersion: input.expectedVersion },
      afterSummary: {
        status: "changes_requested",
        rowVersion: nextVersion,
        reviewNote: input.reviewNote
      },
      correlationId: String(row.run_id)
    });
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "request_geo_blueprint_changes",
      requestHash,
      resourceType: "geo_blueprint_version",
      resourceId: input.blueprintVersionId,
      responseStatus: "changes_requested",
      responseSummary: {
        blueprintVersionId: input.blueprintVersionId,
        rowVersion: nextVersion
      }
    });
    return {
      replayed: false,
      blueprintVersionId: input.blueprintVersionId,
      rowVersion: nextVersion
    };
  });
}
