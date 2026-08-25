import type { GeoResearchSourceSnapshot, GeoResearchWorkspace } from "../../v5/geo-research-contracts";
import type { ProductKnowledgeProfile } from "../../v5/product-knowledge-profile";
import type { ProductRegistryItem } from "../../v5/product-registry-contracts";
import type { ProductWebsiteCoverageProfile } from "../../v5/website-coverage-contracts";
import { DEMO_MONTH } from "../config";

const now = `${DEMO_MONTH}-01T08:00:00.000Z`;

export const demoProducts: Record<string, ProductRegistryItem> = {
  workbuddy: {
    productId: "workbuddy",
    canonicalName: "JOTO WorkBuddy",
    displayName: "JOTO WorkBuddy 智能工作台",
    brandName: "JOTO",
    officialUrl: "https://jotoai.com",
    productCategory: "智能工作台",
    aliases: ["WorkBuddy", "智能工作台"],
    status: "active",
    rowVersion: 2,
    confirmedBy: "demo@joto.ai",
    confirmedAt: now,
    isPromoting: true,
    createdAt: now,
    updatedAt: now
  },
  "tencent-adp": {
    productId: "tencent-adp",
    canonicalName: "腾讯云 ADP",
    displayName: "腾讯云 ADP 智能体开发平台",
    brandName: "腾讯云",
    officialUrl: "https://cloud.tencent.com/product/adp",
    productCategory: "智能体开发平台",
    aliases: ["腾讯云智能体开发平台", "ADP"],
    status: "active",
    rowVersion: 2,
    confirmedBy: "demo@joto.ai",
    confirmedAt: now,
    isPromoting: true,
    createdAt: now,
    updatedAt: now
  }
};

export function demoResearchWorkspace(productId: string): GeoResearchWorkspace {
  const name = productId === "tencent-adp" ? "腾讯云 ADP" : "JOTO WorkBuddy";
  return {
    project: {
      projectId: `grp-${productId}`,
      productId,
      status: "ready_for_monthly_strategy",
      researchMarkets: ["中国大陆"],
      languages: ["zh-CN"],
      targetChannels: ["wechat", "csdn", "juejin", "zhihu"],
      expressionFocus: `基于受治理产品事实，回答目标用户关于 ${name} 真实的选型、采用与落地问题。`,
      forbiddenFocus: ["未经证实的价格、案例、回报、性能和竞品结论"],
      currentApprovedBlueprintVersionId: `bpv-${productId}-1`,
      rowVersion: 2,
      createdBy: "demo@joto.ai",
      createdAt: now,
      updatedAt: `${DEMO_MONTH}-10T08:00:00.000Z`
    },
    runs: [],
    latestTasks: [],
    latestEvidence: [],
    latestFindings: []
  };
}

export function demoSourceSnapshot(): GeoResearchSourceSnapshot {
  return {
    snapshotId: "snap-demo-1",
    snapshotHash: "hash-snap-demo-1",
    sourceCount: 6,
    revisionCount: 8,
    approvedClaimCount: 12,
    createdAt: `${DEMO_MONTH}-05T08:00:00.000Z`,
    quality: {
      status: "ready",
      linkedSourceCount: 6,
      linkedRevisionCount: 8,
      publicCitableSourceCount: 4,
      officialSourceCount: 2,
      testSourceCount: 0,
      issueCodes: [],
      issues: []
    }
  };
}

export function demoProductKnowledgeProfile(): ProductKnowledgeProfile {
  return {
    status: "ready",
    factCount: 5,
    positioning: [{ claimId: "c-pos-1", text: "JOTO 面向企业 AI 落地提供智能工作台能力。", sourceId: "src-1", sourceRevisionId: "rev-1" }],
    audiences: [{ claimId: "c-aud-1", text: "面向企业 IT 决策者与工程负责人。", sourceId: "src-1", sourceRevisionId: "rev-1" }],
    capabilities: [{ claimId: "c-cap-1", text: "覆盖交付、治理、运维与可归因增长闭环。", sourceId: "src-1", sourceRevisionId: "rev-1" }],
    scenarios: [{ claimId: "c-sce-1", text: "智能体选型、落地与长期治理场景。", sourceId: "src-1", sourceRevisionId: "rev-1" }],
    boundaries: [{ claimId: "c-bnd-1", text: "不承诺未经证实的回报与性能结论。", sourceId: "src-1", sourceRevisionId: "rev-1" }],
    source: "parsed"
  };
}

export function demoWebsiteCoverageProfile(productId: string): ProductWebsiteCoverageProfile {
  return {
    id: `wcp-${productId}-1`,
    productId,
    profileVersion: 1,
    knowledgeReadiness: "ready",
    publicGeoReadiness: "ready",
    officialSources: [],
    topicCoverage: [],
    criticalFindingCodes: [],
    evidenceGaps: [],
    profileHash: `hash-wcp-${productId}`,
    generatedAt: `${DEMO_MONTH}-05T08:00:00.000Z`
  };
}
