import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProductKnowledgeProfileOverride,
  buildContentStrategyKnowledgeContext,
  buildProductKnowledgeProfile,
  deriveContentStrategyQuestionClusters
} from "../src/lib/v5/product-knowledge-profile.ts";

function claim(claimId, normalizedClaim, headingPath = []) {
  return {
    claimId,
    normalizedClaim,
    originalQuote: normalizedClaim,
    claimType: "product_fact",
    sourceId: "source-noteflow",
    sourceRevisionId: "revision-noteflow",
    sourceLocator: { headingPath },
    authorityLevel: "A1",
    reviewStatus: "supported",
    conditions: [],
    limitations: []
  };
}

test("approved facts are projected into an evidence-backed product profile", () => {
  const profile = buildProductKnowledgeProfile("Noteflow", [
    claim("positioning", "Built on the same concept as NotebookLM, redesigned for enterprise teams who need private deployment and deeper document support."),
    claim("capability", "Drop in PDFs, Word docs, Excel files, slide decks, and meeting notes — and ask across all of them at once.", ["Capabilities"]),
    claim("sharing", "Every notebook starts private. When ready, share it with teammates immediately.", ["Collaboration"]),
    claim("boundary", "Audio podcast generation — coming soon.", ["Roadmap"]),
    claim("noise", "By clicking Send Message, you agree to our Privacy Policy.")
  ]);

  assert.equal(profile.status, "ready");
  assert.equal(profile.source, "parsed");
  assert.equal(profile.factCount, 5);
  assert.equal(profile.positioning[0].claimId, "positioning");
  assert.ok(profile.audiences.some((item) => item.claimId === "positioning"));
  assert.ok(profile.capabilities.some((item) => item.claimId === "capability"));
  assert.ok(profile.scenarios.some((item) => item.claimId === "capability"));
  assert.ok(profile.boundaries.some((item) => item.claimId === "boundary"));
  assert.ok(!Object.values(profile).flat().some?.((item) => item?.claimId === "noise"));
});

test("human corrections replace every parsed module without erasing the parsed fact count", () => {
  const parsed = buildProductKnowledgeProfile("Noteflow", [
    claim("parsed-positioning", "Noteflow is a document analysis platform for enterprise teams."),
    claim("parsed-capability", "Noteflow supports PDF document search.")
  ]);
  const corrected = applyProductKnowledgeProfileOverride({
    parsed,
    overrideId: "override-1",
    version: 2,
    approvedAt: "2026-08-12T08:00:00.000Z",
    override: {
      positioning: ["人工校正后的核心定位"],
      audiences: ["企业网络运维团队"],
      capabilities: ["跨日志、指标与配置的统一检索"],
      scenarios: ["复杂网络故障排查"],
      boundaries: ["需接入企业基础设施数据"],
      sourceFactCount: parsed.factCount
    }
  });

  assert.equal(corrected.source, "human_corrected");
  assert.equal(corrected.overrideVersion, 2);
  assert.equal(corrected.factCount, parsed.factCount);
  assert.equal(corrected.positioning[0].text, "人工校正后的核心定位");
  assert.equal(corrected.positioning[0].sourceId, "human-corrected-product-profile");
  assert.equal(corrected.boundaries[0].text, "需接入企业基础设施数据");
  assert.notEqual(corrected.positioning[0].text, parsed.positioning[0]?.text);
});

test("an empty approved fact set remains explicitly unresolved", () => {
  const profile = buildProductKnowledgeProfile("Noteflow", []);
  assert.equal(profile.status, "insufficient_facts");
  assert.equal(profile.factCount, 0);
});

test("taxonomy labels and heading-only matches never enter product information", () => {
  const profile = buildProductKnowledgeProfile("Noteflow", [
    claim("collapsed", "Product TeamsLeadershipProject Management", ["Product Teams"]),
    claim("taxonomy", "Sales Marketing Operations", ["Teams"]),
    claim("heading-only", "Internal knowledge workflows for complex organizations", ["Product Teams"]),
    claim("audience-fact", "Noteflow is designed for enterprise product teams that need private document analysis."),
    claim("capability-fact", "Noteflow supports PDF, Word and audio files."),
    claim("scenario-fact", "Sales teams upload product manuals and ask questions directly.")
  ]);

  const projectedIds = Object.values(profile)
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((item) => item.claimId);
  assert.ok(!projectedIds.includes("collapsed"));
  assert.ok(!projectedIds.includes("taxonomy"));
  assert.ok(!projectedIds.includes("heading-only"));
  assert.ok(projectedIds.includes("audience-fact"));
  assert.ok(projectedIds.includes("capability-fact"));
  assert.ok(projectedIds.includes("scenario-fact"));
});

test("question clusters retrieve governed claims beyond the compact product profile", () => {
  const claims = Array.from({ length: 12 }, (_, index) => claim(
    `capability-${index + 1}`,
    index === 10
      ? "腾讯云 ADP 支持实施培训、项目交付与上线后的持续服务。"
      : `腾讯云 ADP 支持企业完成第 ${index + 1} 类智能体能力配置与业务流程管理。`,
    index === 10 ? ["实施交付", "培训与持续服务"] : ["产品能力"]
  ));
  const profile = buildProductKnowledgeProfile("腾讯云 ADP", claims);
  const context = buildContentStrategyKnowledgeContext({
    productId: "adp",
    productName: "腾讯云 ADP",
    profile,
    claims,
    questionClusters: [{
      clusterId: "implementation-delivery",
      label: "实施交付与培训",
      questions: ["腾讯云 ADP 如何实施交付，是否包含培训与持续服务？"]
    }]
  });

  assert.equal(profile.capabilities.length, 8);
  assert.equal(context.sourceFactCount, 12);
  assert.ok(context.retrievedFactCount > 0);
  assert.ok(context.questionClusters[0].facts.some((fact) => fact.claimId === "capability-11"));
  assert.ok(!profile.capabilities.some((fact) => fact.claimId === "capability-11"));
  assert.equal(context.questionClusters[0].facts.find((fact) => fact.claimId === "capability-11")?.sourceId, "source-noteflow");
});

test("live question discovery is converted into reusable content-strategy clusters", () => {
  const clusters = deriveContentStrategyQuestionClusters([{
    taskType: "live_question_discovery",
    outputSummary: {
      questions: [
        { question: "企业如何评估腾讯云 ADP 的实施周期？", module: "实施与交付" },
        { question: "上线后由谁提供培训和支持？", module: "实施与交付" },
        { question: "腾讯云 ADP 如何计费？", module: "价格与采购" }
      ]
    }
  }]);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].label, "实施与交付");
  assert.equal(clusters[0].questions.length, 2);
  assert.equal(clusters[1].label, "价格与采购");
});
