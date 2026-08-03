import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPublishIdempotencyKey, hashDirectPublishContent } from "../src/lib/publish-idempotency.ts";
import { getPublishAdapter } from "../src/lib/publish-adapters/index.ts";
import { isPublishVerificationDue, resolvePublishVerificationLifecycle } from "../src/lib/publish-lifecycle.ts";
import { preflightPublishContent, rewriteJuejinContentOnce } from "../src/lib/publish-content-preflight.ts";
import { buildPublishReliabilityMetrics, evaluatePublishRolloutReadiness } from "../src/lib/publish-reliability.ts";
import { mergePublishRecordPlatformResult } from "../src/lib/publish-record-platform-results.ts";
import { serializePublishMutation } from "../src/lib/publish-mutation-queue.ts";
import { createPublishIdempotencyLedger } from "./lib/publish-idempotency.mjs";
import { createBrowserPublishJobStore } from "./lib/browser-publish-job-store.mjs";
import { createCsdnGatewayHeaders } from "./lib/csdn-api-gateway.mjs";
import { submitAndPollWechatPublish } from "./lib/wechat-formal-publish.mjs";

test("formal publish idempotency key includes schedule, platform, and content hash", () => {
  const contentHash = hashDirectPublishContent("Title", "Body\r\nline");
  assert.equal(contentHash, hashDirectPublishContent(" Title ", "Body\nline "));
  assert.notEqual(buildPublishIdempotencyKey("schedule-a", "wechat", contentHash), buildPublishIdempotencyKey("schedule-b", "wechat", contentHash));
  assert.notEqual(buildPublishIdempotencyKey("schedule-a", "wechat", contentHash), buildPublishIdempotencyKey("schedule-a", "csdn", contentHash));
});

test("wechat submits once and verifies the public URL", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(String(url));
    if (String(url).includes("freepublish/submit")) {
      return { response: { ok: true, status: 200 }, payload: { publish_id: "publish-1" } };
    }
    return {
      response: { ok: true, status: 200 },
      payload: { publish_status: 0, article_detail: { article_id: "article-1", item: [{ article_url: "https://example.com/article-1" }] } }
    };
  };
  const result = await submitAndPollWechatPublish({ apiBase: "https://api.example.test", accessToken: "redacted", mediaId: "media-1", fetchJson, pollAttempts: 2, pollIntervalMs: 0 });
  assert.equal(result.status, "published_verified");
  assert.equal(result.externalTaskId, "publish-1");
  assert.equal(result.platformArticleId, "article-1");
  assert.equal(calls.filter((url) => url.includes("freepublish/submit")).length, 1);
});

test("wechat pending status never resubmits", async () => {
  let submitCalls = 0;
  let verifyCalls = 0;
  const fetchJson = async (url) => {
    if (String(url).includes("freepublish/submit")) {
      submitCalls += 1;
      return { response: { ok: true, status: 200 }, payload: { publish_id: "publish-pending" } };
    }
    verifyCalls += 1;
    return { response: { ok: true, status: 200 }, payload: { publish_status: 1 } };
  };
  const result = await submitAndPollWechatPublish({ apiBase: "https://api.example.test", accessToken: "redacted", mediaId: "media-1", fetchJson, sleep: async () => {}, pollAttempts: 3, pollIntervalMs: 0 });
  assert.equal(result.status, "pending_verify");
  assert.equal(submitCalls, 1);
  assert.equal(verifyCalls, 3);
});

test("local ledger blocks duplicate publish execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "joto-publish-ledger-"));
  const ledger = createPublishIdempotencyLedger(join(directory, "ledger.json"));
  const first = ledger.begin("key-1", { scheduleId: "schedule-1" });
  const second = ledger.begin("key-1", { scheduleId: "schedule-1" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  ledger.complete("key-1", { ok: true, status: "published_verified" });
  assert.equal(ledger.get("key-1").result.status, "published_verified");
});

test("real adapter sends the idempotent payload through the authenticated local bridge", async () => {
  const previous = {
    enabled: process.env.DIRECT_PUBLISH_ENABLED,
    mock: process.env.DIRECT_PUBLISH_MOCK,
    url: process.env.WECHATSYNC_BRIDGE_URL,
    token: process.env.WECHATSYNC_BRIDGE_TOKEN,
    fetch: globalThis.fetch
  };
  const requests = [];
  process.env.DIRECT_PUBLISH_ENABLED = "true";
  process.env.DIRECT_PUBLISH_MOCK = "false";
  process.env.WECHATSYNC_BRIDGE_URL = "http://127.0.0.1:9528";
  process.env.WECHATSYNC_BRIDGE_TOKEN = "test-token";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    const verifying = String(url).endsWith("/publish/verify");
    return new Response(JSON.stringify({ authenticated: true, ok: true, publishStatus: verifying ? "confirmed" : "submitted", status: verifying ? "published_verified" : String(url).endsWith("/publish") ? "pending_verify" : "ready", platformArticleId: verifying ? "article-1" : undefined, externalTaskId: "task-1", externalDraftId: "draft-1", editorUrl: "https://juejin.cn/editor/drafts/draft-1", nextAction: "verify" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const adapter = getPublishAdapter("wechat");
    const auth = await adapter.checkAuth();
    const contentHash = hashDirectPublishContent("Title", "A sufficiently long body ".repeat(8));
    const payload = {
      scheduleId: "schedule-1",
      contentHash,
      idempotencyKey: buildPublishIdempotencyKey("schedule-1", "wechat", contentHash),
      title: "Title",
      markdown: "A sufficiently long body ".repeat(8),
      scheduledAt: new Date().toISOString(),
      sourceDraftId: "draft-1"
    };
    const result = await adapter.publish(payload);
    const verified = await adapter.verify(result);
    assert.equal(auth.ok, true);
    assert.equal(result.status, "pending_verify");
    assert.equal(verified.status, "published_verified");
    assert.equal(verified.publishStatus, "confirmed");
    assert.equal(verified.platformArticleId, "article-1");
    assert.equal(result.externalDraftId, "draft-1");
    assert.equal(result.editorUrl, "https://juejin.cn/editor/drafts/draft-1");
    assert.equal(requests[0].body.platform, "weixin");
    assert.equal(requests[1].body.idempotencyKey, payload.idempotencyKey);
    assert.equal(requests[2].body.idempotencyKey, payload.idempotencyKey);
    assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer test-token");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({ DIRECT_PUBLISH_ENABLED: previous.enabled, DIRECT_PUBLISH_MOCK: previous.mock, WECHATSYNC_BRIDGE_URL: previous.url, WECHATSYNC_BRIDGE_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("hybrid bridge creates one platform draft and passes its identity to the browser runner", () => {
  const source = readFileSync(new URL("./wechatsync-bridge.mjs", import.meta.url), "utf8");
  const authFunction = source.slice(source.indexOf("async function checkFormalPublishAuth"), source.indexOf("async function syncCsdnArticle"));
  const publishFunction = source.slice(source.indexOf("async function publishFormalArticle"), source.indexOf("async function verifyFormalArticle"));
  assert.match(authFunction, /const draftApiAuth = await checkAuth\(platform\)/);
  assert.doesNotMatch(publishFunction, /if \(platform ===/);
  assert.match(source, /input\.platform === "csdn" \? await syncCsdnArticle\(input\) : await syncJuejinArticle\(input\)/);
  assert.match(source, /externalDraftId: String\(draft\.payload\.externalDraftId\)/);
  assert.match(source, /editorUrl: String\(draft\.payload\.editorUrl\)/);
  assert.match(source, /failureCode: input\.externalDraftId \? "publish_action_unconfirmed" : "adapter_failed"/);
});

test("CSDN requires tags but keeps categories optional", async () => {
  const previousEnabled = process.env.DIRECT_PUBLISH_ENABLED;
  const previousMock = process.env.DIRECT_PUBLISH_MOCK;
  process.env.DIRECT_PUBLISH_ENABLED = "true";
  process.env.DIRECT_PUBLISH_MOCK = "false";
  try {
    const contentHash = hashDirectPublishContent("Title", "A sufficiently long body ".repeat(8));
    const payload = {
      scheduleId: "schedule-csdn",
      contentHash,
      idempotencyKey: buildPublishIdempotencyKey("schedule-csdn", "csdn", contentHash),
      title: "Title",
      markdown: "A sufficiently long body ".repeat(8),
      scheduledAt: new Date().toISOString(),
      sourceDraftId: "draft-1",
      tagIds: ["AI"]
    };
    assert.equal((await getPublishAdapter("csdn").validatePayload(payload)).ok, true);
    assert.equal((await getPublishAdapter("csdn").validatePayload({ ...payload, tagIds: [] })).ok, false);
  } finally {
    if (previousEnabled === undefined) delete process.env.DIRECT_PUBLISH_ENABLED;
    else process.env.DIRECT_PUBLISH_ENABLED = previousEnabled;
    if (previousMock === undefined) delete process.env.DIRECT_PUBLISH_MOCK;
    else process.env.DIRECT_PUBLISH_MOCK = previousMock;
  }
});

test("CSDN gateway signing creates fresh signed headers without storing request signatures", () => {
  const input = {
    method: "POST",
    url: "https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle",
    appKey: "test-app-key",
    signingKey: "test-signing-key",
    accept: "application/json, text/plain, */*",
    contentType: "application/json;charset=UTF-8",
    nonce: "fixed-nonce"
  };
  const first = createCsdnGatewayHeaders(input);
  const second = createCsdnGatewayHeaders(input);
  assert.equal(first["X-Ca-Key"], "test-app-key");
  assert.equal(first["X-Ca-Nonce"], "fixed-nonce");
  assert.equal(first["X-Ca-Signature-Headers"], "x-ca-key,x-ca-nonce");
  assert.equal(first["X-Ca-Signature"], second["X-Ca-Signature"]);
  assert.ok(first["X-Ca-Signature"].length > 20);
});

test("direct publish worker continuously claims due schedules without a page click", () => {
  const worker = readFileSync(new URL("../workers/direct-publish-worker.mjs", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/lib/workbench-store.ts", import.meta.url), "utf8");
  assert.match(worker, /postJson\(baseUrl, "\/api\/direct-publish", \{ limit \}\)/);
  assert.match(worker, /args\.once \? 1/);
  assert.match(store, /verificationStatuses\.includes\(schedule\.status\)/);
  assert.match(store, /isPublishVerificationDue\(schedule, now\)/);
  assert.match(store, /schedule\.status !== "stable_published" \|\| Boolean\(schedule\.nextVerificationAt\)/);
  assert.match(store, /\.sort\(compareDuePublishVerification\)/);
  assert.match(store, /deduplicateObservedPublishVerifications/);
  assert.match(store, /schedule\.status === "scheduled"/);
  assert.match(store, /new Date\(schedule\.scheduledAt\)\.getTime\(\) <= now\.getTime\(\)/);
});

test("MCP long-running publish operations enqueue durable jobs instead of awaiting browser work", () => {
  const mcp = readFileSync(new URL("./publish-mcp-server.mjs", import.meta.url), "utf8");
  const dispatchRoute = readFileSync(
    new URL("../src/app/api/publish-jobs/[id]/dispatch/route.ts", import.meta.url),
    "utf8"
  );
  const reconciliationRoute = readFileSync(
    new URL("../src/app/api/publish-jobs/[id]/reconcile-dispatch/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(mcp, /publish-jobs\/\$\{encodeURIComponent\(jobId\)\}\/dispatch/);
  assert.match(mcp, /publish-jobs\/\$\{encodeURIComponent\(jobId\)\}\/reconcile-dispatch/);
  assert.doesNotMatch(mcp, /publish-jobs\/\$\{encodeURIComponent\(jobId\)\}\/run/);
  assert.match(dispatchRoute, /dispatchPublishJob/);
  assert.match(dispatchRoute, /status: result\.ok \? 202/);
  assert.match(reconciliationRoute, /dispatchPublishJobReconciliation/);
  assert.doesNotMatch(dispatchRoute, /runPublishJob/);
  assert.doesNotMatch(reconciliationRoute, /reconcilePublishJob/);
});

test("due worker probes risk states read-only and blocks new writes on the same platform", () => {
  const implementation = readFileSync(new URL("../src/lib/workbench-store.ts", import.meta.url), "utf8");
  const dueWorker = implementation.slice(implementation.indexOf("export async function runDuePublishSchedules"));
  assert.match(dueWorker, /"risk_blocked"/);
  assert.match(dueWorker, /"auth_expired"/);
  assert.match(dueWorker, /writeBlockedPlatforms/);
  assert.match(dueWorker, /!writeBlockedPlatforms\.has\(schedule\.platform\)/);
  assert.match(dueWorker, /verifyPublishSchedule\(schedule\.id\)/);
  const runJob = implementation.slice(
    implementation.indexOf("export async function runPublishSchedule"),
    implementation.indexOf("export async function verifyPublishSchedule")
  );
  assert.match(runJob, /platformWriteBlocker/);
  assert.match(runJob, /写队列已由风险或认证门禁暂停/);
});

test("publish mutations are serialized across concurrent API requests", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = serializePublishMutation(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = serializePublishMutation(async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("publish record keeps one URL result per platform without overwriting its primary channel", () => {
  const record = {
    id: "record-1",
    draftId: "draft-1",
    channel: "wechat",
    title: "Title",
    publishStatus: "queued"
  };
  const csdnSchedule = {
    ...lifecycleSchedule(),
    id: "schedule-csdn",
    platform: "csdn",
    status: "public_observed",
    publicUrl: "https://blog.csdn.net/example/article/details/1",
    urlStatus: "provisional"
  };
  const zhihuSchedule = {
    ...lifecycleSchedule(),
    id: "schedule-zhihu",
    platform: "zhihu",
    status: "public_observed",
    publicUrl: "https://zhuanlan.zhihu.com/p/2",
    urlStatus: "provisional"
  };
  const merged = mergePublishRecordPlatformResult(mergePublishRecordPlatformResult(record, csdnSchedule), zhihuSchedule);
  assert.equal(merged.platformResults.csdn.publicUrl, csdnSchedule.publicUrl);
  assert.equal(merged.platformResults.zhihu.publicUrl, zhihuSchedule.publicUrl);
  assert.equal(merged.publishedUrl, undefined);
  assert.equal(merged.publishStatus, "queued");
});

test("primary platform failure clears a stale URL previously written by another platform", () => {
  const record = {
    id: "record-1",
    draftId: "draft-1",
    channel: "wechat",
    title: "Title",
    publishStatus: "url_filled",
    publishedUrl: "https://zhuanlan.zhihu.com/p/2",
    urlStatus: "provisional"
  };
  const failedWechat = {
    ...lifecycleSchedule(),
    id: "schedule-wechat",
    platform: "wechat",
    status: "failed",
    failureCode: "adapter_failed",
    failureReason: "cover missing"
  };
  const merged = mergePublishRecordPlatformResult(record, failedWechat);
  assert.equal(merged.publishStatus, "failed");
  assert.equal(merged.publishedUrl, undefined);
  assert.equal(merged.platformResults.wechat.status, "failed");
});

test("browser publish jobs are idempotent and serialized per platform", () => {
  const directory = mkdtempSync(join(tmpdir(), "joto-browser-publish-"));
  const store = createBrowserPublishJobStore(join(directory, "jobs.json"), { leaseMs: 30_000 });
  const first = store.enqueue({ platform: "juejin", idempotencyKey: "key-1", payload: { title: "One" } });
  const duplicate = store.enqueue({ platform: "juejin", idempotencyKey: "key-1", payload: { title: "Duplicate" } });
  const second = store.enqueue({ platform: "juejin", idempotencyKey: "key-2", payload: { title: "Two" } });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, first.job.id);

  const claimed = store.claim("worker-a", ["juejin"]);
  assert.equal(claimed.id, first.job.id);
  assert.equal(claimed.payload.title, "One");
  assert.equal(store.claim("worker-b", ["juejin"]), undefined);
  assert.equal(store.complete(claimed.id, "worker-b", { ok: true }), undefined);
  const completed = store.complete(claimed.id, "worker-a", { ok: true, status: "published_pending_url" });
  assert.equal(completed.status, "completed");
  assert.equal(store.claim("worker-b", ["juejin"]).id, second.job.id);
});

test("juejin preflight blocks promotional shallow content and allows one immutable rewrite", () => {
  const original = "扫码免费领取资料 https://one.example https://two.example https://three.example";
  const blocked = preflightPublishContent({ platform: "juejin", title: "重磅！！", markdown: original });
  assert.equal(blocked.passed, false);
  assert.ok(blocked.blockers.some((item) => item.code === "juejin_promotion_risk"));
  const rewritten = rewriteJuejinContentOnce({
    title: "重磅！！",
    markdown: `${original}\n\n${"实现细节与验证内容。".repeat(100)}`
  });
  assert.equal(original.includes("扫码"), true);
  assert.equal(rewritten.markdown.includes("扫码"), false);
  assert.match(rewritten.markdown, /## 验证步骤/);
});

test("AI preflight creates one immutable rewrite variant and never rewrites the rewrite", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/workbench-store.ts"), "utf8");
  const start = source.indexOf("export async function preparePublishContentWithAi");
  const end = source.indexOf("export function createDistributionTargetsForPublishRecord", start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /preparePublishContent\(\{ \.\.\.input, autoRewrite: false \}\)/);
  assert.match(implementation, /preflight\?\.rewriteApplied === true/);
  assert.match(implementation, /rewriteOfVariantId: sourceVariant\.id/);
  assert.match(implementation, /state\.platformDraftVariants\.push\(variant\)/);
  assert.doesNotMatch(implementation, /state\.platformDraftVariants\[index\] = variant/);
});

test("reliability metrics distinguish public observation, stability, and removal", () => {
  const metrics = buildPublishReliabilityMetrics(
    [
      {
        id: "schedule-1",
        platform: "juejin",
        status: "stable_published",
        scheduledAt: "2026-07-01T00:00:00.000Z",
        draftId: "draft-1",
        contentHash: "hash",
        idempotencyKey: "key",
        attemptIds: [],
        publishedAt: "2026-07-01T00:00:00.000Z",
        firstPublicObservedAt: "2026-07-01T00:10:00.000Z",
        lastVerifiedAt: "2026-07-04T01:00:00.000Z",
        retryCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z"
      },
      {
        id: "schedule-2",
        platform: "juejin",
        status: "removed_after_publish",
        scheduledAt: "2026-07-01T00:00:00.000Z",
        draftId: "draft-2",
        contentHash: "hash",
        idempotencyKey: "key-2",
        attemptIds: [],
        publishedAt: "2026-07-01T00:00:00.000Z",
        firstPublicObservedAt: "2026-07-01T00:10:00.000Z",
        lastVerifiedAt: "2026-07-01T12:00:00.000Z",
        removedAt: "2026-07-01T12:00:00.000Z",
        retryCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z"
      }
    ],
    []
  ).find((item) => item.platform === "juejin");
  assert.equal(metrics.publicObserved, 2);
  assert.equal(metrics.stablePublished, 1);
  assert.equal(metrics.removedAfterPublish, 1);
  assert.equal(metrics.survival72hRate, 0.5);
});

test("URL backfill latency starts at the first real publish action", () => {
  const schedule = {
    ...lifecycleSchedule(),
    id: "schedule-latency",
    platform: "zhihu",
    status: "public_observed",
    publishedAt: "2026-07-31T00:05:00.000Z",
    firstPublicObservedAt: "2026-07-31T00:05:00.000Z",
    lastVerifiedAt: "2026-07-31T00:05:00.000Z"
  };
  const attempt = {
    id: "attempt-latency",
    scheduleId: schedule.id,
    platform: "zhihu",
    contentHash: "hash",
    idempotencyKey: "key",
    status: "pending_verify",
    startedAt: "2026-07-31T00:00:00.000Z",
    mode: "real",
    authStatus: "ready",
    payloadStatus: "valid",
    publishStatus: "failed",
    verifyStatus: "pending",
    failureCode: "publish_action_unconfirmed",
    pendingCsvReturn: true
  };
  const metrics = buildPublishReliabilityMetrics([schedule], [attempt]).find((item) => item.platform === "zhihu");
  assert.equal(metrics.averageUrlBackfillLatencyMinutes, 5);
});

test("ambiguous pending verification is not counted as an accepted submission", () => {
  const schedule = lifecycleSchedule({ id: "schedule-ambiguous", platform: "zhihu", status: "pending_verify" });
  const attempt = {
    id: "attempt-ambiguous",
    scheduleId: schedule.id,
    platform: "zhihu",
    contentHash: "hash",
    idempotencyKey: "key",
    status: "pending_verify",
    startedAt: "2026-07-31T00:00:00.000Z",
    mode: "real",
    authStatus: "ready",
    payloadStatus: "valid",
    publishStatus: "failed",
    verifyStatus: "pending",
    pendingCsvReturn: true
  };
  const metrics = buildPublishReliabilityMetrics([schedule], [attempt]).find((item) => item.platform === "zhihu");
  assert.equal(metrics.submitted, 0);
  assert.equal(metrics.uniqueSubmittedDrafts, 0);
  assert.equal(metrics.submissionAcceptanceRate, 0);
});

test("reliability metrics report risk blocks and real duplicate publishes as rates", () => {
  const schedules = [
    lifecycleSchedule({ id: "schedule-risk", status: "risk_blocked" }),
    lifecycleSchedule({ id: "schedule-duplicate", status: "published_pending_url" })
  ];
  const baseAttempt = {
    platform: "juejin",
    contentHash: "hash",
    idempotencyKey: "key",
    status: "published_pending_url",
    startedAt: "2026-07-31T00:00:00.000Z",
    mode: "real",
    authStatus: "ready",
    payloadStatus: "valid",
    publishStatus: "confirmed",
    verifyStatus: "pending",
    verificationKind: "initial",
    pendingCsvReturn: true
  };
  const attempts = [
    { ...baseAttempt, id: "attempt-1", scheduleId: "schedule-duplicate" },
    { ...baseAttempt, id: "attempt-2", scheduleId: "schedule-duplicate" },
    { ...baseAttempt, id: "attempt-liveness", scheduleId: "schedule-duplicate", verificationKind: "liveness" },
    {
      ...baseAttempt,
      id: "attempt-legacy-verify",
      scheduleId: "schedule-duplicate",
      diagnosticSummary: "verify_only_no_publish_action"
    }
  ];
  const metrics = buildPublishReliabilityMetrics(schedules, attempts).find((item) => item.platform === "juejin");
  assert.equal(metrics.riskBlockRate, 0.5);
  assert.equal(metrics.duplicatePublishCount, 1);
  assert.equal(metrics.duplicatePublishRate, 1);
});

test("reliability metrics count one public entity when multiple schedules resolve to the same article", () => {
  const schedules = ["schedule-a", "schedule-b", "schedule-c"].map((id, index) => ({
    id,
    platform: "zhihu",
    status: "public_observed",
    scheduledAt: `2026-08-01T0${index}:00:00.000Z`,
    draftId: "draft-1",
    contentHash: `hash-${index}`,
    idempotencyKey: `key-${index}`,
    attemptIds: [],
    retryCount: 0,
    platformArticleId: "article-1",
    publicUrl: "https://zhuanlan.zhihu.com/p/article-1?utm_source=test",
    firstPublicObservedAt: `2026-08-02T0${index}:00:00.000Z`,
    lastVerifiedAt: `2026-08-02T1${index}:00:00.000Z`
  }));
  const metric = buildPublishReliabilityMetrics(schedules, []).find((item) => item.platform === "zhihu");
  assert.equal(metric.submitted, 3);
  assert.equal(metric.uniqueSubmittedDrafts, 1);
  assert.equal(metric.publicObserved, 1);
  assert.equal(metric.publicConversionRate, 0.3333);
});

test("rollout readiness stays false until every platform meets sample and 24/72 hour thresholds", () => {
  const incomplete = buildPublishReliabilityMetrics([], []);
  const blocked = evaluatePublishRolloutReadiness(incomplete);
  assert.equal(blocked.every((item) => item.ready), false);
  assert.ok(blocked.every((item) => item.blockers.includes("insufficient_submitted_samples")));
  assert.ok(blocked.every((item) => item.blockers.includes("insufficient_unique_drafts")));

  const passingMetric = {
    total: 3,
    submitted: 3,
    uniqueSubmittedDrafts: 3,
    publicObserved: 3,
    stablePublished: 3,
    removedAfterPublish: 0,
    platformRejected: 0,
    riskBlocked: 0,
    duplicateProtectedAttempts: 0,
    duplicatePublishCount: 0,
    submissionAcceptanceRate: 1,
    publicConversionRate: 1,
    survival24hRate: 1,
    survival72hRate: 1,
    riskBlockRate: 0,
    duplicatePublishRate: 0,
    averageUrlBackfillLatencyMinutes: 1
  };
  const ready = evaluatePublishRolloutReadiness(
    ["juejin", "csdn", "zhihu"].map((platform) => ({ ...passingMetric, platform }))
  );
  assert.equal(ready.every((item) => item.ready), true);
});

function lifecycleSchedule(overrides = {}) {
  return {
    id: "schedule-lifecycle",
    platform: "juejin",
    status: "pending_verify",
    scheduledAt: "2026-07-31T00:00:00.000Z",
    draftId: "draft-1",
    contentHash: "hash",
    idempotencyKey: "key",
    attemptIds: [],
    retryCount: 0,
    createdAt: "2026-07-31T00:00:00.000Z",
    ...overrides
  };
}

test("first reachable public URL is provisional until a later liveness check", () => {
  const verifiedAt = "2026-07-31T01:00:00.000Z";
  const lifecycle = resolvePublishVerificationLifecycle(
    lifecycleSchedule(),
    {
      ok: true,
      status: "published_verified",
      publishStatus: "confirmed",
      verifyStatus: "verified",
      platformArticleId: "article-1",
      publicUrl: "https://juejin.cn/post/article-1",
      nextAction: "verified"
    },
    verifiedAt
  );
  assert.equal(lifecycle.status, "public_observed");
  assert.equal(lifecycle.urlStatus, "provisional");
  assert.equal(lifecycle.firstPublicObservedAt, verifiedAt);
  assert.ok(lifecycle.nextVerificationAt);
});

test("a later reachable check promotes a public URL to stable after the configured window", () => {
  const previousWindow = process.env.DIRECT_PUBLISH_STABLE_AFTER_HOURS;
  process.env.DIRECT_PUBLISH_STABLE_AFTER_HOURS = "1";
  try {
    const lifecycle = resolvePublishVerificationLifecycle(
      lifecycleSchedule({
        status: "public_observed",
        publicUrl: "https://juejin.cn/post/article-1",
        urlStatus: "provisional",
        firstPublicObservedAt: "2026-07-31T01:00:00.000Z",
        verificationCount: 1
      }),
      {
        ok: true,
        status: "published_verified",
        publishStatus: "confirmed",
        verifyStatus: "verified",
        platformArticleId: "article-1",
        publicUrl: "https://juejin.cn/post/article-1",
        nextAction: "verified"
      },
      "2026-07-31T02:01:00.000Z"
    );
    assert.equal(lifecycle.status, "stable_published");
    assert.equal(lifecycle.urlStatus, "stable");
    assert.equal(lifecycle.stablePublishedAt, "2026-07-31T02:01:00.000Z");
  } finally {
    if (previousWindow === undefined) delete process.env.DIRECT_PUBLISH_STABLE_AFTER_HOURS;
    else process.env.DIRECT_PUBLISH_STABLE_AFTER_HOURS = previousWindow;
  }
});

test("two consecutive inaccessible checks mark a previously public article as removed", () => {
  const result = {
    ok: true,
    status: "published_pending_url",
    publishStatus: "pending_review",
    verifyStatus: "pending",
    platformArticleId: "article-1",
    nextAction: "retry verification"
  };
  const first = resolvePublishVerificationLifecycle(
    lifecycleSchedule({
      status: "public_observed",
      publicUrl: "https://juejin.cn/post/article-1",
      urlStatus: "provisional",
      firstPublicObservedAt: "2026-07-31T01:00:00.000Z",
      verificationCount: 1
    }),
    result,
    "2026-07-31T01:10:00.000Z"
  );
  assert.equal(first.status, "published_pending_url");
  assert.equal(first.consecutiveVerificationFailures, 1);

  const second = resolvePublishVerificationLifecycle(
    lifecycleSchedule({
      status: first.status,
      publicUrl: "https://juejin.cn/post/article-1",
      urlStatus: first.urlStatus,
      firstPublicObservedAt: first.firstPublicObservedAt,
      verificationStartedAt: first.verificationStartedAt,
      verificationCount: first.verificationCount,
      consecutiveVerificationFailures: first.consecutiveVerificationFailures
    }),
    result,
    "2026-07-31T01:20:00.000Z"
  );
  assert.equal(second.status, "removed_after_publish");
  assert.equal(second.urlStatus, "removed");
  assert.equal(second.failureCode, "removed_after_publish");
});

test("verification scheduling respects nextVerificationAt", () => {
  const schedule = lifecycleSchedule({ nextVerificationAt: "2026-07-31T01:10:00.000Z" });
  assert.equal(isPublishVerificationDue(schedule, new Date("2026-07-31T01:09:59.000Z")), false);
  assert.equal(isPublishVerificationDue(schedule, new Date("2026-07-31T01:10:00.000Z")), true);
});

test("unpublished verification backs off instead of polling every minute for seven days", () => {
  const lifecycle = resolvePublishVerificationLifecycle(
    lifecycleSchedule({
      verificationStartedAt: "2026-07-31T00:00:00.000Z",
      verificationCount: 8,
      consecutiveVerificationFailures: 8
    }),
    {
      ok: false,
      status: "pending_verify",
      publishStatus: "failed",
      verifyStatus: "pending",
      failureCode: "publish_action_unconfirmed",
      failureReason: "not public"
    },
    "2026-07-31T02:00:00.000Z"
  );
  assert.equal(lifecycle.nextVerificationAt, "2026-07-31T03:00:00.000Z");
  assert.equal(lifecycle.status, "pending_verify");
});

test("public liveness scheduling lands on the stability threshold instead of overshooting it", () => {
  const lifecycle = resolvePublishVerificationLifecycle(
    lifecycleSchedule({
      status: "public_observed",
      publicUrl: "https://juejin.cn/post/article-1",
      urlStatus: "provisional",
      firstPublicObservedAt: "2026-07-31T00:00:00.000Z",
      verificationStartedAt: "2026-07-31T00:00:00.000Z",
      verificationCount: 4
    }),
    {
      ok: true,
      status: "published_verified",
      publishStatus: "confirmed",
      verifyStatus: "verified",
      publicUrl: "https://juejin.cn/post/article-1"
    },
    "2026-08-02T07:00:00.000Z"
  );
  assert.equal(lifecycle.nextVerificationAt, "2026-08-03T00:00:00.000Z");
});

test("public liveness scheduling lands on the 24 hour survival milestone", () => {
  const schedule = lifecycleSchedule({
    status: "public_observed",
    firstPublicObservedAt: "2026-07-31T00:00:00.000Z",
    lastVerifiedAt: "2026-07-31T08:00:00.000Z",
    verificationStartedAt: "2026-07-31T00:00:00.000Z",
    verificationCount: 2,
    urlStatus: "provisional",
    publicUrl: "https://juejin.cn/post/test"
  });
  const lifecycle = resolvePublishVerificationLifecycle(
    schedule,
    {
      ok: true,
      status: "published_verified",
      mode: "real",
      publishStatus: "confirmed",
      verifyStatus: "verified",
      publicUrl: schedule.publicUrl,
      pendingCsvReturn: false
    },
    "2026-07-31T08:00:00.000Z"
  );
  assert.equal(lifecycle.nextVerificationAt, "2026-08-01T00:00:00.000Z");
});

test("safe retry recovers legacy pre-publish failures and interrupted schedules", () => {
  const store = readFileSync(new URL("../src/lib/workbench-store.ts", import.meta.url), "utf8");
  assert.match(store, /const retryFailureIsBeforePublish = Boolean\(/);
  assert.match(store, /schedule\.status === "failed"[\s\S]{0,80}schedule\.status === "precheck_failed"[\s\S]{0,80}schedule\.status === "publishing"/);
  assert.match(store, /retryAttemptForRetry\.failureCode === "adapter_failed"[\s\S]{0,100}retryAttemptForRetry\.failureReason\?\.startsWith\("BrowserConnectError"\)/);
  assert.match(store, /schedule\.platform === "csdn" && schedule\.status === "pending_verify"/);
  assert.match(store, /retryAttemptForRetry\.publishStatus === "failed" \|\| retryAttemptForRetry\.publishStatus === undefined/);
  assert.match(store, /retryAttemptForRetry\?\.verifyStatus === "not_started"/);
  assert.match(store, /const canVerifyAfterPriorPublishAction = Boolean\(/);
});
