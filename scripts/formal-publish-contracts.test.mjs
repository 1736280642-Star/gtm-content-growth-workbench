import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPublishIdempotencyKey, hashDirectPublishContent } from "../src/lib/publish-idempotency.ts";
import { getPublishAdapter } from "../src/lib/publish-adapters/index.ts";
import { createPublishIdempotencyLedger } from "./lib/publish-idempotency.mjs";
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
    return new Response(JSON.stringify({ authenticated: true, ok: true, publishStatus: "submitted", status: String(url).endsWith("/publish") ? "pending_verify" : "ready", externalTaskId: "task-1", nextAction: "verify" }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    assert.equal(auth.ok, true);
    assert.equal(result.status, "pending_verify");
    assert.equal(requests[0].body.platform, "weixin");
    assert.equal(requests[1].body.idempotencyKey, payload.idempotencyKey);
    assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer test-token");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({ DIRECT_PUBLISH_ENABLED: previous.enabled, DIRECT_PUBLISH_MOCK: previous.mock, WECHATSYNC_BRIDGE_URL: previous.url, WECHATSYNC_BRIDGE_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
