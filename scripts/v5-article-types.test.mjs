import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "v5-article-types-"));
const workbenchStatePath = join(temporaryDirectory, "workbench-state.json");
const articleTypeStatePath = join(temporaryDirectory, "v5-article-types.json");
process.env.WORKBENCH_STATE_PATH = workbenchStatePath;
process.env.V5_ARTICLE_TYPE_STATE_PATH = articleTypeStatePath;

const { createInitialWorkbenchState } = await import("../src/lib/workbench-store.ts");
const workbenchState = createInitialWorkbenchState();
workbenchState.workspaceSetting.currentRole = "workbench_operator";
await writeFile(workbenchStatePath, JSON.stringify(workbenchState), "utf8");

const service = await import("../src/lib/v5/article-type-service.ts");

test.after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function draftInput(overrides = {}) {
  return {
    name: "避坑指南",
    semanticDescription: "帮助企业识别 AI 项目实施中的风险和常见错误。",
    suitableQuestionDescription: "适合实施风险、配置误区和验收盲点类问题。",
    targetAudience: ["企业 AI 项目负责人"],
    contentGoal: "识别风险并给出预防行动。",
    structureModules: ["问题背景", "常见误区", "正确做法", "检查清单"],
    cta: "评估当前实施方案中的风险点。",
    lengthRange: { min: 1800, max: 2500, unit: "字" },
    styleTraits: ["专业", "克制", "具体"],
    evidencePreferences: ["实施文档", "限制说明"],
    ...overrides
  };
}

test("custom article type lifecycle, semantic matching and version freeze", async (t) => {
  let customProfile;
  let frozenVersionId;

  await t.test("creates an idempotent custom type and activates v1", async () => {
    const request = { expectedVersion: 0, auditReason: "创建测试内容类型", input: draftInput() };
    customProfile = await service.createArticleTypeProfile(request, "article-type-create-0001");
    const replay = await service.createArticleTypeProfile(request, "article-type-create-0001");
    assert.equal(replay.profileId, customProfile.profileId);
    assert.equal(customProfile.currentVersion.fieldSources.name, "user_input");
    assert.equal(customProfile.currentVersion.fieldSources.lengthRange, "user_input");

    customProfile = await service.activateArticleTypeProfile(customProfile.profileId, {
      expectedVersion: customProfile.revision,
      profileVersionId: customProfile.currentVersion.profileVersionId,
      auditReason: "发布测试内容类型 v1"
    }, "article-type-activate-0001");
    frozenVersionId = customProfile.activeVersion.profileVersionId;
    assert.equal(customProfile.status, "active");
    assert.equal(customProfile.activeVersion.version, 1);
  });

  await t.test("returns AI suggestions separately without overwriting user input", async () => {
    const input = draftInput({ targetAudience: [] });
    const provider = {
      async supplementProfile({ profile }) {
        assert.equal(profile.name, input.name);
        return {
          status: "success",
          provider: "mock",
          data: {
            suggestions: [{ field: "targetAudience", value: ["技术负责人"], reason: "补充读者", source: "ai_suggested" }],
            overlaps: [],
            missingInformation: []
          },
          message: "已生成待确认建议。"
        };
      },
      async matchQuestions() { throw new Error("unused"); }
    };
    const result = await service.supplementArticleTypeDraft({
      expectedVersion: 0,
      auditReason: "测试 AI 仅返回建议",
      input
    }, "article-type-supplement-0001", provider);
    assert.deepEqual(input.targetAudience, []);
    assert.deepEqual(result.suggestions[0].value, ["技术负责人"]);
    assert.equal(result.suggestions[0].source, "ai_suggested");
  });

  await t.test("keeps a manual path when the provider is pending_config", async () => {
    const questionVersionId = workbenchState.distilledTerms[0].id;
    const provider = {
      async supplementProfile() { throw new Error("unused"); },
      async matchQuestions() {
        return { status: "pending_config", provider: "openai", message: "Provider 尚未配置。" };
      }
    };
    const run = await service.runQuestionTypeMatch("2099-01", {
      expectedVersion: 0,
      questionVersionIds: [questionVersionId],
      auditReason: "测试 Provider 缺失人工路径"
    }, "article-type-match-pending-0001", provider);
    assert.equal(run.status, "pending_config");
    const confirmed = await service.confirmQuestionTypeMatch("2099-01", {
      expectedVersion: run.revision,
      matchRunId: run.matchRunId,
      selections: [{ questionVersionId, articleTypeProfileVersionId: frozenVersionId, selectionStatus: "manual_added" }],
      auditReason: "人工加入内容类型"
    }, "article-type-confirm-pending-0001");
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.suggestions[0].question, workbenchState.distilledTerms[0].term);
    assert.equal(confirmed.suggestions[0].selectionSource, "user_selected");
  });

  await t.test("supports multi-label accept, reject and manual add decisions", async () => {
    const activeVersions = await service.getActiveArticleTypeVersions();
    const [first, second, third] = activeVersions.slice(0, 3);
    const questionVersionId = workbenchState.distilledTerms[0].id;
    const question = workbenchState.distilledTerms[0].term;
    const provider = {
      async supplementProfile() { throw new Error("unused"); },
      async matchQuestions() {
        return {
          status: "success",
          provider: "mock",
          model: "semantic-test",
          data: { suggestions: [
            { questionVersionId, question, articleTypeProfileVersionId: first.profileVersionId, articleTypeName: first.name, fitLevel: "high", semanticScore: 0.94, reason: "适合比较决策。", matchedFacets: ["决策"], missingInformation: [], conflictProfileVersionIds: [] },
            { questionVersionId, question, articleTypeProfileVersionId: second.profileVersionId, articleTypeName: second.name, fitLevel: "medium", semanticScore: 0.76, reason: "也涉及实施判断。", matchedFacets: ["实施"], missingInformation: [], conflictProfileVersionIds: [] }
          ] },
          message: "匹配完成。"
        };
      }
    };
    const run = await service.runQuestionTypeMatch("2099-02", {
      expectedVersion: 0,
      questionVersionIds: [questionVersionId],
      auditReason: "测试多标签匹配"
    }, "article-type-match-multi-0001", provider);
    assert.equal(run.suggestions.length, 2);
    assert.equal(run.suggestions[0].selectionStatus, "accepted");
    assert.equal(run.suggestions[1].selectionStatus, "suggested");

    const confirmed = await service.confirmQuestionTypeMatch("2099-02", {
      expectedVersion: run.revision,
      matchRunId: run.matchRunId,
      selections: [
        { questionVersionId, articleTypeProfileVersionId: first.profileVersionId, selectionStatus: "accepted" },
        { questionVersionId, articleTypeProfileVersionId: second.profileVersionId, selectionStatus: "rejected" },
        { questionVersionId, articleTypeProfileVersionId: third.profileVersionId, selectionStatus: "manual_added" }
      ],
      auditReason: "确认多标签组合"
    }, "article-type-confirm-multi-0001");
    assert.equal(confirmed.suggestions.find((item) => item.articleTypeProfileVersionId === first.profileVersionId).selectionStatus, "accepted");
    assert.equal(confirmed.suggestions.find((item) => item.articleTypeProfileVersionId === second.profileVersionId).selectionStatus, "rejected");
    assert.equal(confirmed.suggestions.find((item) => item.articleTypeProfileVersionId === third.profileVersionId).selectionSource, "user_selected");
  });

  await t.test("creating and activating v2 does not mutate the frozen v1 snapshot", async () => {
    const frozenBefore = (await service.getArticleTypeVersionsByIds([frozenVersionId]))[0];
    const v2Draft = await service.patchArticleTypeProfile(customProfile.profileId, {
      expectedVersion: customProfile.revision,
      action: "new_version",
      auditReason: "创建测试内容类型 v2",
      input: draftInput({ contentGoal: "识别风险、解释后果并给出预防行动。" })
    }, "article-type-patch-0002");
    assert.equal(v2Draft.activeVersion.profileVersionId, frozenVersionId);
    assert.notEqual(v2Draft.currentVersion.profileVersionId, frozenVersionId);

    const activated = await service.activateArticleTypeProfile(customProfile.profileId, {
      expectedVersion: v2Draft.revision,
      profileVersionId: v2Draft.currentVersion.profileVersionId,
      auditReason: "发布测试内容类型 v2"
    }, "article-type-activate-0002");
    const frozenAfter = (await service.getArticleTypeVersionsByIds([frozenVersionId]))[0];
    assert.equal(activated.activeVersion.version, 2);
    assert.equal(frozenAfter.promptConstraintSnapshot, frozenBefore.promptConstraintSnapshot);
    assert.equal(frozenAfter.promptConstraintSnapshotHash, frozenBefore.promptConstraintSnapshotHash);
  });
});

test("semantic matching cannot bypass Evidence Gate", async () => {
  const [panel, policy] = await Promise.all([
    readFile("src/components/MonthlyPlanConfigPanel.tsx", "utf8"),
    readFile("src/lib/v5/monthly-strategy-policy.ts", "utf8")
  ]);
  assert.match(panel, /Evidence Gate 独立校验事实与公开范围/);
  assert.match(policy, /evidencePackSourceSnapshotHash/);
  assert.match(policy, /criticalFactMissing/);
});
