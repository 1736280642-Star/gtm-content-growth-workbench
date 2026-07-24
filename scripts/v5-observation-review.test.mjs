import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeObservationGaps,
  createCaptureComparison,
  createCaptureTasks,
  ingestCaptureArtifact,
  reviewObservationGaps,
  updateCaptureTaskStatus
} from "../src/lib/v5/observation-service.ts";
import { getMonthlyReview, createNextMonthProposal } from "../src/lib/v5/monthly-review-service.ts";
import { createSiteAuditRun, createSiteRemediation, ingestSiteAuditFindings } from "../src/lib/v5/site-audit-service.ts";

const actor = { actorId: "test-operator", actorRole: "workbench_operator", actorType: "human" };
const runner = { actorId: "test-runner", actorRole: "capture_runner", actorType: "runner" };

function context(scope, expectedVersion = 0, runnerActor = false) {
  return { actor: runnerActor ? runner : actor, reason: `${scope} test`, idempotencyKey: `${scope}-${Date.now()}-${Math.random()}`, expectedVersion };
}

function captureManifest(task, answerText, citations = []) {
  return {
    taskId: task.id,
    captureSessionId: task.captureSessionId,
    adapterVersion: "chatgpt-dom@test",
    browserVersion: "test-browser",
    startedAt: "2026-07-23T01:00:00.000Z",
    completedAt: "2026-07-23T01:00:05.000Z",
    answerHtmlSanitized: `<p>${answerText}</p>`,
    answerText,
    citations,
    screenshot: {
      mimeType: "image/png",
      dataBase64: Buffer.from("redacted-screenshot").toString("base64"),
      redactionsApplied: ["account_identity", "conversation_history"],
      viewport: { width: 1280, height: 720 }
    },
    completionSignals: {
      answerNodeDetected: true,
      stopControlDisappeared: true,
      completionMarkerDetected: true,
      stableWindowMs: 2000,
      firstTokenWithinTimeout: true,
      totalTimeoutExceeded: false
    },
    captureWarnings: []
  };
}

test("V5 observation, review and site audit contracts", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "v5-observation-test-"));
  process.env.V5_OBSERVATION_STATE_PATH = path.join(temporaryRoot, "state.json");
  process.env.V5_CAPTURE_ARTIFACT_ROOT = path.join(temporaryRoot, "artifacts");
  process.env.V5_OBSERVATION_REFERENCE_PATH = path.resolve("scripts/fixtures/v5-observation-reference.json");
  process.env.V5_CAPTURE_RUNNER_URL = "http://127.0.0.1:1";

  await t.test("Manifest V3 adapter is narrow and avoids credential APIs", async () => {
    const manifest = JSON.parse(await readFile(path.resolve("browser-extension/manifest.json"), "utf8"));
    const worker = await readFile(path.resolve("browser-extension/src/service-worker.js"), "utf8");
    const adapter = await readFile(path.resolve("browser-extension/src/adapters/chatgpt.js"), "utf8");
    const localRunner = await readFile(path.resolve("capture-runner/src/server.mjs"), "utf8");
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:17321/*", "https://chatgpt.com/*"]);
    assert.equal(worker.includes("chrome.cookies"), false);
    assert.equal(adapter.includes("localStorage"), false);
    assert.match(adapter, /stableWindowMs/);
    assert.match(adapter, /stopControlDisappeared/);
    assert.match(localRunner, /origin\.startsWith\("chrome-extension:\/\/"\)/);
    assert.match(localRunner, /127\.0\.0\.1/);
    assert.equal(localRunner.includes("(cookie|password|token|"), false);
  });

  const conditionA = { locale: "zh-CN", region: "上海", conversationMode: "new_conversation", personalizationMode: "off", modelLabel: "平台默认" };
  const conditionB = { ...conditionA, region: "北京" };
  const [taskA] = await createCaptureTasks({ questionVersionId: "question-version-adp-001", platforms: ["chatgpt"], condition: conditionA, executionMode: "immediate_once", ...context("create-a") });
  const [taskB] = await createCaptureTasks({ questionVersionId: "question-version-adp-001", platforms: ["chatgpt"], condition: conditionB, executionMode: "immediate_once", ...context("create-b") });
  const [privacyTask] = await createCaptureTasks({ questionVersionId: "question-version-adp-001", platforms: ["chatgpt"], condition: conditionA, executionMode: "immediate_once", ...context("create-privacy") });

  await t.test("Privacy guard rejects credential-shaped capture fields", async () => {
    const unsafe = { ...captureManifest(privacyTask, "test"), cookie: "must-not-pass" };
    await assert.rejects(() => ingestCaptureArtifact(privacyTask.id, unsafe, context("privacy", privacyTask.version, true)), /敏感字段/);
  });

  const resultA = await ingestCaptureArtifact(taskA.id, captureManifest(taskA, "选择服务商需要核对实施经验与知识治理。"), context("artifact-a", taskA.version, true));
  const resultB = await ingestCaptureArtifact(taskB.id, captureManifest(taskB, "选择服务商需要核对实施经验。JOTO 可以提供实施支持。", [{
    label: "JOTO 官网", url: "https://joto.example.com/adp", title: "JOTO ADP 服务", visibleSnippet: "JOTO 可以提供实施支持。", position: 1,
    capturedAt: "2026-07-23T01:00:04.000Z", verificationStatus: "verified", sourceType: "owned"
  }]), context("artifact-b", taskB.version, true));

  await t.test("Immutable artifacts retain SHA-256 and controlled screenshot metadata", () => {
    assert.equal(resultA.artifact.immutable, true);
    assert.equal(resultA.artifact.storageClass, "controlled_local");
    assert.match(resultA.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.match(resultA.artifact.screenshotSha256, /^[a-f0-9]{64}$/);
  });

  await t.test("Same-question captures with different conditions compare without trend claims", async () => {
    const comparison = await createCaptureComparison({ baselineTaskId: taskA.id, comparisonTaskId: taskB.id, ...context("comparison") });
    assert.equal(comparison.comparable, true);
    assert.equal(comparison.conditionsMatched, false);
    assert.equal(comparison.trendConclusionAllowed, false);
    assert.ok(comparison.conditionDifferences.some((item) => item.field === "region"));
    assert.match(comparison.warning, /不生成趋势结论/);
  });

  await t.test("Candidate gaps require human routing and never create monthly tasks", async () => {
    const analyzed = await analyzeObservationGaps(resultA.answer.id, context("gap-analysis", 0));
    const contentGaps = analyzed.gaps.filter((item) => item.suggestedDestinations.includes("blog_candidate"));
    assert.ok(contentGaps.some((item) => item.code === "entity_gap"));
    const review = await reviewObservationGaps(resultA.answer.id, {
      selectedGapIds: contentGaps.map((item) => item.id),
      decision: "confirmed",
      destinations: ["blog_candidate"],
      note: "人工确认进入博客候选池",
      ...context("gap-review", analyzed.answer.reviewVersion)
    });
    assert.equal(review.monthlyTaskCreated, false);
    assert.ok(review.downstream.every((item) => item.target === "blog_candidate_adapter"));
  });

  await t.test("Monthly review joins by question and creates Proposal only", async () => {
    const review = await getMonthlyReview("2026-07");
    const question = review.questions.find((item) => item.questionKey === "question-adp-provider-selection");
    assert.ok(question);
    assert.equal(question.monthlyPlanIds[0], "monthly-plan-fixture-2026-07");
    assert.equal(question.publishedContent.length, 1);
    assert.equal(question.captureTaskIds.length, 3);
    const proposal = await createNextMonthProposal("2026-07", {
      questionReviewId: question.id,
      recommendation: "补充可引用的实施能力页面",
      rationale: "回答未出现目标实体且缺少自有引用",
      ...context("proposal")
    });
    assert.equal(proposal.status, "proposal");
    assert.equal(proposal.monthlyTaskCreated, false);
    assert.equal(proposal.quotaChanged, false);
  });

  await t.test("Site audit keeps separate run, finding and remediation objects", async () => {
    const run = await createSiteAuditRun({ scopeUrl: "https://joto.example.com", sitemapUrl: "https://joto.example.com/sitemap.xml", ...context("site-run") });
    assert.equal(run.status, "pending_config");
    const ingested = await ingestSiteAuditFindings(run.id, [{
      url: "https://joto.example.com/adp", category: "citability", severity: "high", code: "indexable_body_missing",
      title: "页面缺少可索引正文", detectionEvidence: "正文可见文本不足", userImpact: "搜索与 AI 引用系统难以识别服务能力",
      recommendedRemediation: "增加可索引正文并引用已验证 Claim", claimIds: [], publishedContentIds: [], status: "open"
    }], context("site-ingest", run.version, true));
    const finding = ingested.findings[0];
    const remediation = await createSiteRemediation(finding.id, { note: "补充可索引正文", ...context("site-remediation", finding.version) });
    assert.equal(remediation.findingId, finding.id);
    assert.notEqual(run.id, resultA.answer.id);
  });

  await t.test("Failure states require an actionable recovery path", async () => {
    const failureStatuses = ["needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"];
    for (const status of failureStatuses) {
      const [created] = await createCaptureTasks({
        questionVersionId: "question-version-adp-001",
        platforms: ["chatgpt"],
        condition: conditionA,
        executionMode: "immediate_once",
        ...context(`failure-create-${status}`)
      });
      let current = created;
      if (status === "capture_failed") {
        current = await updateCaptureTaskStatus(current.id, {
          status: "environment_checking",
          note: "recheck before capture",
          ...context(`failure-prepare-${status}`, current.version, true)
        });
      }
      const failed = await updateCaptureTaskStatus(current.id, {
        status,
        note: `${status} captured`,
        failure: {
          status,
          stage: current.status,
          reason: `${status} test reason`,
          retainedData: ["task_condition"],
          resumable: status !== "capture_failed",
          recoveryAction: `recover from ${status}`,
          occurredAt: new Date().toISOString()
        },
        ...context(`failure-status-${status}`, current.version, true)
      });
      assert.equal(failed.status, status);
      assert.match(failed.failure.recoveryAction, /recover from/);
    }
  });

  await rm(temporaryRoot, { recursive: true, force: true });
});
