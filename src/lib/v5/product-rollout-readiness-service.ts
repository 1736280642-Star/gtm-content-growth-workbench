import type { RowDataPacket } from "mysql2/promise";
import type { ChannelKey, DirectPublishPlatformKey } from "../types";
import { checkFormalPublishAuth } from "../formal-publish-client";
import { getWorkspaceSetting } from "../workbench-store";
import { getPublishingChannelReadiness } from "./free-production-service";
import {
  getV5GovernancePool,
  hashV5GovernancePayload,
  readV5ReadinessContext,
  readV5Idempotency,
  V5GovernanceRepositoryError,
  withV5GovernanceTransaction,
  writeV5GovernanceAudit,
  writeV5Idempotency,
  type V5GovernanceActor
} from "./knowledge-governance-repository";

const platformChannel: Record<DirectPublishPlatformKey, ChannelKey> = {
  wechat: "wechat",
  csdn: "csdn",
  juejin: "juejin",
  zhihu: "zhihu_toutiao_general"
};

const platformReadinessChannel: Partial<Record<DirectPublishPlatformKey, string>> = {
  wechat: "wechat_official_account",
  zhihu: "zhihu"
};

/**
 * Prefer the operator's explicit default account. When a platform exposes
 * exactly one connected account, offer that connector identity directly so
 * the product owner can confirm it without duplicating the label in Settings.
 * Live authentication remains a separate gate.
 */
export function resolvePublishAccountCandidate(platform: DirectPublishPlatformKey) {
  const channel = platformChannel[platform];
  const explicit = getWorkspaceSetting().publishAccountByChannel?.[channel]?.trim();
  if (explicit) return explicit;
  const readinessChannel = platformReadinessChannel[platform];
  if (!readinessChannel) return undefined;
  const readiness = getPublishingChannelReadiness().find((item) => item.channel === readinessChannel);
  if (!readiness?.connected || readiness.accounts.length !== 1) return undefined;
  return readiness.accounts[0]?.id.trim() || undefined;
}

function resolvePublishAccountCandidateLabel(platform: DirectPublishPlatformKey, candidateId?: string) {
  if (!candidateId) return undefined;
  const readinessChannel = platformReadinessChannel[platform];
  const account = readinessChannel
    ? getPublishingChannelReadiness()
        .find((item) => item.channel === readinessChannel)
        ?.accounts.find((item) => item.id.trim() === candidateId)
    : undefined;
  return account?.name.trim() || candidateId;
}

export interface ProductRolloutGate {
  key: "strategy" | "calibration" | "production_inputs" | "account" | "auth";
  status: "passed" | "blocked";
  detail: string;
  nextAction?: string;
}

export interface ProductRolloutReadiness {
  productId: string;
  platform: DirectPublishPlatformKey;
  strategyPackId?: string;
  calibrationVersionId?: string;
  configuredAccountCandidate?: string;
  configuredAccountCandidateLabel?: string;
  confirmedAccount?: string;
  accountBindingVersion?: number;
  productionInputSummary?: {
    rulePackageReady: boolean;
    knowledgeBaseReadyCount: number;
    evidenceReadyArticleTypeCount: number;
  };
  canEnterBatchGeneration: boolean;
  canScheduleRealPublish: boolean;
  gates: ProductRolloutGate[];
}

export class ProductRolloutReadinessError extends Error {
  constructor(public readonly code: string, message: string, public readonly nextAction: string) {
    super(message);
    this.name = "ProductRolloutReadinessError";
  }
}

export function evaluateProductRolloutReadiness(input: {
  productId: string;
  platform: DirectPublishPlatformKey;
  strategyPackId?: string;
  strategyStatus?: string;
  calibrationVersionId?: string;
  productionInputs: {
    ok: boolean;
    detail: string;
    nextAction?: string;
  };
  accountCandidateAvailable?: boolean;
  accountConfigured: boolean;
  auth: { ok: boolean; message: string; nextAction?: string };
}): ProductRolloutReadiness {
  const strategyReady = input.strategyStatus === "production_ready";
  const calibrationReady = Boolean(input.calibrationVersionId);
  const productionInputsReady = input.productionInputs.ok;
  const canEnterBatchGeneration = strategyReady && calibrationReady && productionInputsReady;
  const gates: ProductRolloutGate[] = [
    {
      key: "strategy",
      status: strategyReady ? "passed" : "blocked",
      detail: strategyReady ? "产品 GEO 策略已通过样稿验收。" : "产品尚未达到 production_ready。",
      nextAction: strategyReady ? undefined : "先确认产品 GEO 策略并验收一篇示例正文。"
    },
    {
      key: "calibration",
      status: calibrationReady ? "passed" : "blocked",
      detail: calibrationReady ? "已冻结 active 样稿表达校准版本。" : "缺少 active 样稿表达校准版本。",
      nextAction: calibrationReady ? undefined : "在正文预览页完成真人样稿确认。"
    },
    {
      key: "production_inputs",
      status: productionInputsReady ? "passed" : "blocked",
      detail: input.productionInputs.detail,
      nextAction: productionInputsReady ? undefined : input.productionInputs.nextAction
    },
    {
      key: "account",
      status: input.accountConfigured ? "passed" : "blocked",
      detail: input.accountConfigured
        ? "已确认当前产品使用的发布账号。"
        : input.accountCandidateAvailable
          ? "已识别唯一连接账号，等待产品负责人确认。"
          : "尚未识别可唯一确认的发布账号。",
      nextAction: input.accountConfigured
        ? undefined
        : input.accountCandidateAvailable
          ? "在当前产品页点击“确认用于当前产品”。"
          : "连接平台账号；如存在多个账号，请先在设置页指定默认账号。"
    },
    {
      key: "auth",
      status: input.auth.ok ? "passed" : "blocked",
      detail: input.auth.message,
      nextAction: input.auth.ok ? undefined : input.auth.nextAction
    }
  ];
  return {
    productId: input.productId,
    platform: input.platform,
    strategyPackId: input.strategyPackId,
    calibrationVersionId: input.calibrationVersionId,
    canEnterBatchGeneration,
    canScheduleRealPublish: canEnterBatchGeneration && input.accountConfigured && input.auth.ok,
    gates
  };
}

export async function getProductRolloutReadiness(productId: string, platform: DirectPublishPlatformKey) {
  const pool = getV5GovernancePool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.strategy_pack_id, sp.status AS strategy_status, ec.id AS calibration_version_id
     FROM product_entity p
     LEFT JOIN product_strategy_packs sp ON sp.id = p.strategy_pack_id
     LEFT JOIN expression_calibration_version ec ON ec.product_id = p.id AND ec.status = 'active'
     WHERE p.id = ?
     ORDER BY ec.version_number DESC
     LIMIT 1`,
    [productId]
  );
  const row = rows[0];
  const strategyPackId = row?.strategy_pack_id ? String(row.strategy_pack_id) : undefined;
  const readinessContext = await readV5ReadinessContext(productId);
  const readyKnowledgeBases = (readinessContext.knowledgeBases || []).filter((item) => item.status === "ready");
  const [articleTypeRows] = strategyPackId
    ? await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS ready_count
         FROM product_strategy_article_type_versions
         WHERE strategy_pack_id = ? AND status IN ('active', 'frozen')
           AND JSON_UNQUOTE(JSON_EXTRACT(definition_json, '$.evidenceReadiness')) = 'ready'`,
        [strategyPackId]
      )
    : [[] as RowDataPacket[]];
  const evidenceReadyArticleTypeCount = Number(articleTypeRows[0]?.ready_count || 0);
  const rulePackageReady = Boolean(
    readinessContext.rulePackageVersionId
    && readinessContext.rulePackageStatus === "active"
    && readinessContext.sourceSnapshotHash
  );
  const productionInputsReady = rulePackageReady
    && readyKnowledgeBases.length > 0
    && evidenceReadyArticleTypeCount > 0;
  const productionInputs = productionInputsReady
    ? {
        ok: true,
        detail: `正式规则包、${readyKnowledgeBases.length} 个知识库快照和 ${evidenceReadyArticleTypeCount} 种证据就绪文章类型均可用。`
      }
    : {
        ok: false,
        detail: "正式生产输入尚未齐备。",
        nextAction: strategyPackId
          ? "补齐生产就绪规则包、知识库快照或证据充分的文章类型后重新检查。"
          : "确认产品 GEO 策略后，系统将自动冻结文章类型并重新检查生产输入。"
      };
  const channel = platformChannel[platform];
  const configuredAccountCandidate = resolvePublishAccountCandidate(platform);
  const configuredAccountCandidateLabel = resolvePublishAccountCandidateLabel(platform, configuredAccountCandidate);
  const [bindingRows] = await pool.query<RowDataPacket[]>(
    `SELECT account_label, row_version FROM product_publish_account_binding
     WHERE product_id = ? AND platform = ? AND status = 'confirmed' LIMIT 1`,
    [productId, platform]
  );
  const confirmedAccount = bindingRows[0]?.account_label ? String(bindingRows[0].account_label) : undefined;
  const accountConfigured = Boolean(configuredAccountCandidate && confirmedAccount === configuredAccountCandidate);
  const auth = await checkFormalPublishAuth(platform);
  return {
    ...evaluateProductRolloutReadiness({
    productId,
    platform,
    strategyPackId,
    strategyStatus: row?.strategy_status ? String(row.strategy_status) : undefined,
    calibrationVersionId: row?.calibration_version_id ? String(row.calibration_version_id) : undefined,
    productionInputs,
    accountCandidateAvailable: Boolean(configuredAccountCandidate),
    accountConfigured,
    auth
    }),
    configuredAccountCandidate,
    configuredAccountCandidateLabel,
    confirmedAccount,
    accountBindingVersion: bindingRows[0] ? Number(bindingRows[0].row_version) : undefined,
    productionInputSummary: {
      rulePackageReady,
      knowledgeBaseReadyCount: readyKnowledgeBases.length,
      evidenceReadyArticleTypeCount
    }
  };
}

export async function confirmProductPublishAccountBinding(input: {
  productId: string;
  platform: DirectPublishPlatformKey;
  accountLabel: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: V5GovernanceActor;
}) {
  const channel = platformChannel[input.platform];
  const configuredAccount = resolvePublishAccountCandidate(input.platform);
  if (!configuredAccount || configuredAccount !== input.accountLabel.trim()) {
    throw new V5GovernanceRepositoryError(
      "publish_account_candidate_changed",
      "当前唯一可用发布账号与待确认账号不一致。",
      409,
      "刷新页面重新确认；如平台连接了多个账号，请先在设置页指定默认账号。系统不会绑定历史账号或未知账号。"
    );
  }
  if (!input.idempotencyKey.trim()) {
    throw new V5GovernanceRepositoryError("idempotency_key_required", "确认发布账号需要 idempotencyKey。", 400, "刷新页面后重试。");
  }
  return withV5GovernanceTransaction(async (connection) => {
    const requestHash = hashV5GovernancePayload({
      productId: input.productId,
      platform: input.platform,
      accountLabel: configuredAccount,
      expectedVersion: input.expectedVersion
    });
    const replay = await readV5Idempotency(connection, input.idempotencyKey, requestHash);
    if (replay) return replay.responseSummary as { accountLabel: string; rowVersion: number };
    const [productRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM product_entity WHERE id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [input.productId]
    );
    if (!productRows[0]) {
      throw new V5GovernanceRepositoryError("product_not_found", "产品不存在或未启用。", 404, "返回产品列表重新选择。");
    }
    const [bindingRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, account_label, row_version FROM product_publish_account_binding WHERE product_id = ? AND platform = ? LIMIT 1 FOR UPDATE",
      [input.productId, input.platform]
    );
    const existing = bindingRows[0];
    const currentVersion = existing ? Number(existing.row_version) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new V5GovernanceRepositoryError(
        "publish_account_binding_version_conflict",
        "发布账号绑定已被其他操作更新。",
        409,
        "刷新后重新确认，避免覆盖他人的账号选择。"
      );
    }
    const bindingId = existing?.id
      ? String(existing.id)
      : `publish-account-${hashV5GovernancePayload({ productId: input.productId, platform: input.platform }).slice(0, 44)}`;
    const nextVersion = currentVersion + 1;
    await connection.query(
      `INSERT INTO product_publish_account_binding
       (id, product_id, platform, channel, account_label, status, confirmed_by, confirmed_at, row_version)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE channel = VALUES(channel), account_label = VALUES(account_label),
         status = 'confirmed', confirmed_by = VALUES(confirmed_by), confirmed_at = NOW(), row_version = VALUES(row_version)`,
      [bindingId, input.productId, input.platform, channel, configuredAccount, input.actor.actorId, nextVersion]
    );
    await writeV5GovernanceAudit(connection, {
      ...input.actor,
      eventType: "product_publish_account_confirmed",
      objectType: "product_publish_account_binding",
      objectId: bindingId,
      beforeSummary: existing ? { accountLabel: String(existing.account_label), rowVersion: currentVersion } : undefined,
      afterSummary: { productId: input.productId, platform: input.platform, accountLabel: configuredAccount, rowVersion: nextVersion },
      correlationId: bindingId
    });
    const response = { accountLabel: configuredAccount, rowVersion: nextVersion };
    await writeV5Idempotency(connection, {
      idempotencyKey: input.idempotencyKey,
      operationType: "confirm_product_publish_account",
      requestHash,
      resourceType: "product_publish_account_binding",
      resourceId: bindingId,
      responseStatus: "confirmed",
      responseSummary: response
    });
    return response;
  });
}

export async function assertFormalDraftRolloutReady(productionContractId: string, platform: DirectPublishPlatformKey) {
  const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
    `SELECT pc.product_id, pc.production_mode, pc.expression_calibration_version_id,
            sp.status AS strategy_status, ec.status AS calibration_status
     FROM production_contract_snapshot pc
     JOIN product_strategy_packs sp ON sp.id = pc.product_strategy_pack_id
     LEFT JOIN expression_calibration_version ec ON ec.id = pc.expression_calibration_version_id
     WHERE pc.id = ?
     LIMIT 1`,
    [productionContractId]
  );
  const contract = rows[0];
  if (!contract) {
    throw new ProductRolloutReadinessError("production_contract_not_found", "正文缺少可验证的正式生产合同。", "重新按当前策略和证据包生成正文。" );
  }
  if (String(contract.production_mode) !== "batch") {
    throw new ProductRolloutReadinessError("sample_draft_publish_forbidden", "示例正文只能用于内容质量验收，不能直接进入真实发布。", "确认样稿后，从 production_ready 策略生成批量正式正文。" );
  }
  if (String(contract.strategy_status) !== "production_ready") {
    throw new ProductRolloutReadinessError("product_strategy_not_production_ready", "正文所属产品策略尚未达到 production_ready。", "先完成真人样稿验收。" );
  }
  if (!contract.expression_calibration_version_id || String(contract.calibration_status) !== "active") {
    throw new ProductRolloutReadinessError("contract_calibration_not_active", "正文合同未绑定有效的样稿校准版本。", "使用当前 active 校准版本重新生成批量正文。" );
  }
  const readiness = await getProductRolloutReadiness(String(contract.product_id), platform);
  if (!readiness.canScheduleRealPublish) {
    const blockers = readiness.gates.filter((gate) => gate.status === "blocked");
    throw new ProductRolloutReadinessError(
      "real_publish_readiness_blocked",
      blockers.map((gate) => gate.detail).join(" ") || "真实发布准入未通过。",
      blockers.map((gate) => gate.nextAction).filter(Boolean).join(" ") || "完成账号选择和实时授权后重试。"
    );
  }
  return readiness;
}
