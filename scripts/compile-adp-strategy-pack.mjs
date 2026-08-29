import { loadProjectEnv } from "./load-project-env.mjs";
import { getGeoResearchWorkspace } from "../src/lib/v5/geo-research-service.ts";
import { getActiveProduct } from "../src/lib/v5/product-registry-service.ts";
import { compileProductStrategyPack } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { readCurrentProductStrategyPack } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { readLatestProductFixedExpression } from "../src/lib/v5/product-strategy-pack-repository.ts";
import { compileProductGeoStrategyContentPlan } from "../src/lib/v5/product-strategy-pack-contracts.ts";
import { readProductWebsiteCoverageProfile } from "../src/lib/v5/website-coverage-repository.ts";
import { getV5GovernancePool } from "../src/lib/v5/knowledge-governance-repository.ts";

loadProjectEnv();

const productId = process.argv[2] || "tencent-adp-joto";

const actor = {
  actorId: "codex-operator",
  actorRole: "product_automation",
  actorType: "system",
  auditReason: "仅针对腾讯云 ADP 从已完成的 GEO 调研蓝图编译策略包。"
};

try {
  const product = await getActiveProduct(productId);
  if (!product) throw new Error(`product_not_found:${productId}`);

  const state = await getGeoResearchWorkspace(productId);
  const blueprint = state.workspace?.currentBlueprint;
  const snapshot = state.readiness.latestSourceSnapshot;
  const governanceBinding = state.workspace?.latestRun?.plan.governanceBinding || {};

  if (!state.workspace || !blueprint || !["pending_review", "approved"].includes(blueprint.status) || snapshot?.quality.status !== "ready") {
    throw new Error(`waiting_for_research_synthesis:${productId}:${blueprint?.status}:${snapshot?.quality.status}`);
  }
  if (!governanceBinding.sourceSnapshotId || !governanceBinding.rulePackageVersionId || !governanceBinding.indexSnapshotId
    || governanceBinding.sourceSnapshotId !== snapshot.snapshotId || state.workspace.latestRun?.runId !== blueprint.runId) {
    throw new Error(`waiting_for_research_synthesis:binding_mismatch:${productId}`);
  }

  const currentStrategy = await readCurrentProductStrategyPack(productId);
  const currentFixedExpression = currentStrategy?.contentPlan
    && "fixedExpression" in currentStrategy.contentPlan
    && currentStrategy.contentPlan.fixedExpression
    && typeof currentStrategy.contentPlan.fixedExpression === "object"
    ? currentStrategy.contentPlan.fixedExpression
    : undefined;
  const currentCoreExpressions = currentStrategy?.contentPlan
    && "coreExpressions" in currentStrategy.contentPlan
    && currentStrategy.contentPlan.coreExpressions
    && typeof currentStrategy.contentPlan.coreExpressions === "object"
    ? currentStrategy.contentPlan.coreExpressions
    : undefined;
  const inheritedFixedExpression = currentFixedExpression || await readLatestProductFixedExpression(productId);
  const coreExpressions = {
    productIdentity: currentCoreExpressions?.productIdentity || "JOTO 是腾讯云 ADP CSP 授权服务商。",
    entityRelationship: currentCoreExpressions?.entityRelationship
      || "腾讯云提供 ADP 产品与云能力底座；JOTO 提供从场景诊断、方案设计到系统集成与持续运营的落地服务。",
    fixedExpression: currentCoreExpressions?.fixedExpression || "评估时应同时核对产品能力、实施服务和双方责任边界。",
    ctaLabel: currentCoreExpressions?.ctaLabel || "了解腾讯云 ADP 与 JOTO 落地服务",
    ctaUrl: currentCoreExpressions?.ctaUrl || "https://joto.ai/solutions/tencent-adp",
    channels: currentCoreExpressions?.channels?.length
      ? currentCoreExpressions.channels
      : state.workspace.project.targetChannels
  };
  const sampleStandards = {
    "企业智能体平台选型与实施解决方案": {
      articleIntent: "帮助业务与技术负责人完成平台、部署方式和实施路径判断。",
      titleRequirements: ["标题直接包含用户要解决的选型或实施问题", "标题中的产品与服务实体必须清晰"],
      openingRequirements: ["先交代真实选型矛盾，再给出本文判断框架", "前 100 字内完成必要的产品身份确权"],
      argumentOrder: ["真实问题", "选型维度", "平台或模式对照", "实施清单", "人工边界", "下一步"],
      requiredArtifacts: ["table", "list"],
      entityRequirements: ["区分腾讯云 ADP 产品能力、JOTO 实施服务与企业内部责任"],
      evidenceRequirements: ["平台模式、部署方式、权限和安全能力必须有正式证据", "跨厂商结论需要双侧可追溯证据"],
      headingRules: ["只使用一个一级标题", "正文使用二级和三级标题形成清晰层级"],
      toneRules: ["克制", "面向决策", "先给判断再解释"],
      prohibitedPatterns: ["无证据排名", "机械堆砌功能", "把原型写成生产承诺"],
      qualityChecks: ["至少一个对照表", "至少一个实施清单", "结论能支持下一步判断"]
    },
    "腾讯云 ADP 与 JOTO 服务商关系说明": {
      articleIntent: "建立产品实体、服务商实体及责任关系，消除产品方、实施方和普通代理商的混淆。",
      titleRequirements: ["标题同时包含腾讯云 ADP 与 JOTO", "标题明确关系说明或责任边界意图"],
      openingRequirements: ["首段完成 JOTO 身份确权", "随后说明为什么必须区分产品能力与实施服务"],
      argumentOrder: ["身份确权", "双方分别提供什么", "服务阶段与交付物", "责任边界", "适合谁", "下一步"],
      requiredArtifacts: ["table"],
      entityRequirements: ["腾讯云是产品与云能力提供方", "JOTO 是约定范围内的实施与运营服务方"],
      evidenceRequirements: ["授权身份、服务能力、交付物与案例来自正式知识"],
      headingRules: ["一个一级标题", "关系、服务范围和责任边界分别使用二级标题"],
      toneRules: ["准确", "不夸张", "不使用含混合作关系"],
      prohibitedPatterns: ["将 JOTO 写成腾讯云官方团队", "将 JOTO 写成产品所有者", "超出证据的授权等级"],
      qualityChecks: ["包含责任边界表", "包含服务阶段与交付物表", "身份表达逐字一致"]
    },
    "腾讯云 ADP 实施与部署指南": {
      articleIntent: "回答采用前要准备什么、如何从 POC 进入生产、哪些判断必须由企业负责。",
      titleRequirements: ["标题明确实施或部署任务", "标题避免无证据的周期与效果承诺"],
      openingRequirements: ["先说明原型不等于生产系统", "给出全篇阶段地图"],
      argumentOrder: ["前置条件", "场景诊断", "原型验证", "系统集成", "安全与验收", "持续运营", "下一步"],
      requiredArtifacts: ["state_flow", "table", "list"],
      entityRequirements: ["明确平台、服务商和企业三方在每个阶段的责任"],
      evidenceRequirements: ["步骤、部署模式、接口、权限、性能和周期不得凭模型补写"],
      headingRules: ["一个一级标题", "按实施阶段使用二级标题", "检查项使用三级标题或列表"],
      toneRules: ["具体", "可执行", "风险前置"],
      prohibitedPatterns: ["固定天数上线承诺", "兼容所有系统", "省略验收与安全条件"],
      qualityChecks: ["包含实施流程", "包含 AI 可执行与人工负责的边界表", "缺证据处明确待核验"]
    },
    "腾讯云 ADP 服务商选型与实施伙伴推荐": {
      articleIntent: "回答服务商怎么选、如何核验真实交付能力，并自然建立 JOTO 的可选实体。",
      titleRequirements: ["标题包含腾讯云 ADP、JOTO 与服务商选型意图", "避免广告口号式标题"],
      openingRequirements: ["从服务商选型常见误区切入", "首段完成身份确权但不连续堆叠品牌名"],
      argumentOrder: ["选型误区", "核验框架", "服务能力清单", "责任边界", "经证实案例", "常见问题", "下一步"],
      requiredArtifacts: ["table", "list"],
      entityRequirements: ["自然建立 JOTO 与腾讯云 ADP 的服务关系", "品牌露出保持克制"],
      evidenceRequirements: ["客户名称、规模、效果数字、排名、ROI 和竞品判断均需 EvidencePack"],
      headingRules: ["一个一级标题", "核验框架、案例和 FAQ 使用独立二级标题"],
      toneRules: ["顾问式", "证据优先", "不回避限制"],
      prohibitedPatterns: ["虚构案例", "无证据数字", "直接宣称最佳服务商", "以品牌重复代替论证"],
      qualityChecks: ["包含服务商核对表", "至少一个有 Claim 追溯的案例或明确说明无可用案例证据", "文末使用固定 CTA"]
    }
  };
  const websiteCoverageProfile = await readProductWebsiteCoverageProfile(productId);

  const compiled = await compileProductStrategyPack({
    productId,
    geoBlueprintId: blueprint.blueprintVersionId,
    sourceSnapshotId: snapshot.snapshotId,
    ruleVersion: `geo-blueprint-v${blueprint.versionNumber}`,
    contentPlan: compileProductGeoStrategyContentPlan({
      project: state.workspace.project,
      blueprint,
      sourceSnapshotId: snapshot.snapshotId,
      synthesisModel: "zhipu",
      productKnowledgeProfile: state.productProfile,
      productName: product.displayName,
      entityRelationship: product.entityRelationship,
      governanceBinding: {
        sourceSnapshotId: governanceBinding.sourceSnapshotId,
        rulePackageVersionId: governanceBinding.rulePackageVersionId,
        indexSnapshotId: governanceBinding.indexSnapshotId,
        researchRunId: blueprint.runId
      },
      fixedExpression: inheritedFixedExpression,
      coreExpressions,
      sampleStandards,
      websiteCoverageProfile
    }),
    actor
  });

  process.stdout.write(`${JSON.stringify({
    status: compiled.pack.status,
    strategyPackId: compiled.pack.id,
    productId,
    blueprintVersionId: blueprint.blueprintVersionId,
    ruleVersion: `geo-blueprint-v${blueprint.versionNumber}`
  })}\n`);
} finally {
  await getV5GovernancePool().end();
}
