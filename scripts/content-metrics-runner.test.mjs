import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkAuthorization, collectPlatformMetrics, extractExternalId, finiteMetric } from "./lib/content-metrics-adapters.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
}

test("metric parsers keep non-negative integer values and resolve platform ids", () => {
  assert.equal(finiteMetric("1.2万"), 12000);
  assert.equal(finiteMetric("-1"), undefined);
  assert.equal(extractExternalId({ platform: "juejin", publicUrl: "https://juejin.cn/post/123456" }), "123456");
  assert.equal(extractExternalId({ platform: "zhihu", publicUrl: "https://zhuanlan.zhihu.com/p/98765" }), "98765");
  assert.equal(extractExternalId({ platform: "csdn", publicUrl: "https://blog.csdn.net/a/article/details/13579" }), "13579");
  assert.equal(extractExternalId({ platform: "zhihu", externalContentId: "24680", publicUrl: "https://zhuanlan.zhihu.com/p/24680" }), "24680");
});

test("wechat authorization performs a real access token probe", async () => {
  await withEnv({ WECHAT_MP_APP_ID: "test-app", WECHAT_MP_APP_SECRET: "test-secret" }, async () => {
    const result = await checkAuthorization("wechat", async (url) => {
      assert.match(String(url), /cgi-bin\/token/);
      return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 7200 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(result.status, "ready");
    assert.equal(result.authenticated, true);
  });
});

test("configured CSDN adapter maps response paths without leaking credentials", async () => {
  await withEnv({
    CSDN_COOKIE: "local-test-cookie",
    CSDN_METRICS_URL_TEMPLATE: "https://metrics.invalid/{{externalContentId}}",
    CSDN_METRICS_PATHS_JSON: JSON.stringify({ views: "result.views", likes: "result.likes", favorites: "result.favorites" })
  }, async () => {
    const result = await collectPlatformMetrics("csdn", [{
      publishResultId: "workspace-task-1",
      platform: "csdn",
      publicUrl: "https://blog.csdn.net/a/article/details/13579",
      publishedAt: "2026-08-14T00:00:00.000Z"
    }], async (url, init) => {
      assert.equal(String(url), "https://metrics.invalid/13579");
      assert.equal(init.headers.Cookie, "local-test-cookie");
      return new Response(JSON.stringify({ result: { views: 101, likes: 7, favorites: 3 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.authorization.status, "ready");
    assert.deepEqual({ views: result.items[0].views, likes: result.items[0].likes, favorites: result.items[0].favorites }, { views: 101, likes: 7, favorites: 3 });
  });
});

test("cookie adapter marks a platform as auth required after a 403 metric response", async () => {
  await withEnv({ ZHIHU_COOKIE: "expired-cookie", ZHIHU_METRICS_AUTH_CHECK_URL: undefined }, async () => {
    const result = await collectPlatformMetrics("zhihu", [{
      publishResultId: "workspace-task-3",
      platform: "zhihu",
      externalContentId: "24680",
      publicUrl: "https://zhuanlan.zhihu.com/p/24680",
      publishedAt: "2026-08-14T00:00:00.000Z"
    }], async () => new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } }));
    assert.equal(result.authorization.status, "auth_required");
    assert.equal(result.authorization.authenticated, false);
  });
});

test("CSDN adapter reads the current public article metadata format", async () => {
  await withEnv({ CSDN_COOKIE: "local-test-cookie", CSDN_METRICS_URL_TEMPLATE: undefined, CSDN_METRICS_PATHS_JSON: undefined }, async () => {
    const result = await collectPlatformMetrics("csdn", [{
      publishResultId: "workspace-task-2",
      platform: "csdn",
      externalContentId: "163495801",
      publicUrl: "https://blog.csdn.net/a/article/details/163495801",
      publishedAt: "2026-08-14T00:00:00.000Z"
    }], async () => new Response('<meta name="description" content="文章浏览阅读254次，点赞3次，收藏5次。"><script>var viewCountFormat = 254;</script>', { status: 200, headers: { "content-type": "text/html" } }));
    assert.equal(result.items.length, 1);
    assert.deepEqual({ views: result.items[0].views, likes: result.items[0].likes, favorites: result.items[0].favorites }, { views: 254, likes: 3, favorites: 5 });
  });
});

test("runner, scheduler and Docker topology stay isolated from GEO workers", async () => {
  const [runner, worker, compose, configuration, packageJson] = await Promise.all([
    read("scripts/content-metrics-runner.mjs"),
    read("workers/content-metrics-worker.mjs"),
    read("compose.yaml"),
    read("src/app/configuration/page.tsx"),
    read("package.json")
  ]);
  assert.match(runner, /\/metrics\/pull/);
  assert.match(runner, /\/auth\/status/);
  assert.match(worker, /CONTENT_METRICS_INTERVAL_SECONDS \|\| 21_600/);
  assert.match(compose, /content_metrics_private:[\s\S]*internal: true/);
  assert.match(compose, /content-metrics-runner:[\s\S]*healthcheck:/);
  assert.doesNotMatch(compose.match(/content-metrics-worker:[\s\S]*?(?=\n  [a-z][\w-]+:|\nvolumes:)/)?.[0] || "", /GEO_RESEARCH_/);
  assert.match(configuration, /contentMetrics/);
  assert.match(configuration, /内容指标授权/);
  assert.match(packageJson, /worker:content-metrics/);
});
