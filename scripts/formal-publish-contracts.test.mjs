import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPublishIdempotencyKey, hashDirectPublishContent } from "../src/lib/publish-idempotency.ts";
import { getPublishAdapter } from "../src/lib/publish-adapters/index.ts";
import { createPublishIdempotencyLedger } from "./lib/publish-idempotency.mjs";
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
  assert.match(store, /schedule\.status === "scheduled" && new Date\(schedule\.scheduledAt\)\.getTime\(\) <= now\.getTime\(\)/);
});

test("safe retry recovers legacy pre-publish failures and interrupted schedules", () => {
  const store = readFileSync(new URL("../src/lib/workbench-store.ts", import.meta.url), "utf8");
  assert.match(store, /const retryFailureIsBeforePublish = Boolean\(/);
  assert.match(store, /schedule\.status === "failed"[\s\S]{0,80}schedule\.status === "precheck_failed"[\s\S]{0,80}schedule\.status === "publishing"/);
  assert.match(store, /retryAttemptForRetry\.failureCode === "adapter_failed"[\s\S]{0,100}retryAttemptForRetry\.failureReason === "BrowserConnectError"/);
  assert.match(store, /schedule\.platform === "csdn" && schedule\.status === "pending_verify"/);
  assert.match(store, /retryAttemptForRetry\.publishStatus === "failed" \|\| retryAttemptForRetry\.publishStatus === undefined/);
  assert.match(store, /retryAttemptForRetry\?\.verifyStatus === "not_started"/);
  assert.match(store, /const canVerifyAfterPriorPublishAction = Boolean\(/);
});
