import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "v5-knowledge-collection-"));
const statePath = join(temporaryDirectory, "foundation.json");
process.env.V5_FOUNDATION_STATE_PATH = statePath;

const {
  createKnowledgeCollectionSource,
  listKnowledgeCollectionWorkspace,
  parseKnowledgeCollectionDiscoveryDocument,
  updateKnowledgeCollectionSource
} = await import("../src/lib/v5/knowledge-collection-service.ts");

const actor = {
  actorId: "knowledge-collection-test",
  actorRole: "test",
  actorType: "system",
  auditReason: "验证动态知识采集来源与快照契约"
};

async function seedState() {
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    version: 0,
    knowledgeBases: [{
      knowledgeBaseId: "kb-product-a",
      name: "产品 A",
      focus: "产品 A 的能力与服务",
      defaultVisibility: "conditional_public",
      productionStatus: "empty",
      dataSource: "real",
      sourceSnapshotHash: "empty",
      sourceSnapshotVersion: 1,
      materialCount: 0,
      openActionCount: 0,
      productionBlockingActionCount: 0,
      rowVersion: 1,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    }]
  }), "utf8");
}

test("来源导入具备幂等、默认知识库与每日执行状态", async () => {
  await seedState();
  const input = {
    actor,
    idempotencyKey: "source-import-1",
    name: "产品 A 官方站点",
    sourceType: "site",
    entryUrl: "https://example.com/blog",
    defaultKnowledgeBaseId: "kb-product-a",
    defaultProductId: "product-a",
    defaultProductName: "产品 A",
    publicUseConfirmed: true,
    scheduleHour: 8
  };
  const created = createKnowledgeCollectionSource(input);
  const replayed = createKnowledgeCollectionSource(input);
  assert.equal(created.status, "created");
  assert.equal(replayed.status, "replayed");
  assert.equal(created.data.source.sourceId, replayed.data.source.sourceId);

  const workspace = listKnowledgeCollectionWorkspace();
  assert.equal(workspace.data.sources.length, 1);
  assert.equal(workspace.data.sources[0].defaultKnowledgeBaseId, "kb-product-a");
  assert.equal(workspace.data.sources[0].nextCollectAt <= new Date().toISOString(), true);

  const updated = updateKnowledgeCollectionSource({
    actor,
    idempotencyKey: "source-disable-1",
    sourceId: created.data.source.sourceId,
    expectedVersion: created.data.source.rowVersion,
    enabled: false
  });
  assert.equal(updated.data.source.enabled, false);
  const stored = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(stored.knowledgeCollectionSources[0].enabled, false);
});

test("发现解析覆盖 Sitemap、RSS、Atom 与文章页链接并自动去重", () => {
  const sitemap = parseKnowledgeCollectionDiscoveryDocument({
    baseUrl: "https://example.com/sitemap.xml",
    contentType: "application/xml",
    text: `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/blog/article-1</loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/blog/article-1#section</loc></url>
    </urlset>`
  });
  assert.deepEqual(sitemap.map((item) => item.url), ["https://example.com/blog/article-1"]);

  const atom = parseKnowledgeCollectionDiscoveryDocument({
    baseUrl: "https://feed.example.com",
    contentType: "application/atom+xml",
    text: `<feed><entry><link href="https://mp.weixin.qq.com/s?__biz=test&amp;mid=1" /></entry></feed>`
  });
  assert.equal(atom.length, 1);
  assert.match(atom[0].url, /mp\.weixin\.qq\.com/);

  const html = parseKnowledgeCollectionDiscoveryDocument({
    baseUrl: "https://example.com/news",
    contentType: "text/html",
    text: `<a href="/news/detail/42">新文章</a><a href="/contact">联系我们</a>`
  });
  assert.equal(html.length, 1);
  assert.equal(html[0].title, "新文章");
});

test("完整采集链路自动区分首次收录、内容未变与正文更新", async () => {
  await seedState();
  const created = createKnowledgeCollectionSource({
    actor,
    idempotencyKey: "source-chain-1",
    name: "产品 A 内容源",
    sourceType: "site",
    entryUrl: "https://example.com/blog",
    defaultKnowledgeBaseId: "kb-product-a",
    publicUseConfirmed: true,
    scheduleHour: 8
  });
  let articleContent = "产品 A 提供稳定的内容治理能力，并支持自动归档。";
  const runtime = {
    async discover() {
      return [{ url: "https://example.com/blog/article-1", title: "产品 A 内容治理" }];
    },
    async fetchArticle() {
      return { title: "产品 A 内容治理", content: articleContent };
    }
  };

  const first = await (await import("../src/lib/v5/knowledge-collection-service.ts")).runKnowledgeCollection({
    actor,
    sourceId: created.data.source.sourceId,
    force: true,
    runtime
  });
  assert.equal(first.data.runs[0].collectedCount, 1);

  const second = await (await import("../src/lib/v5/knowledge-collection-service.ts")).runKnowledgeCollection({
    actor,
    sourceId: created.data.source.sourceId,
    force: true,
    runtime
  });
  assert.equal(second.data.runs[0].unchangedCount, 1);

  articleContent = "产品 A 提供稳定的内容治理能力，并新增了每日自动更新与索引刷新。";
  const third = await (await import("../src/lib/v5/knowledge-collection-service.ts")).runKnowledgeCollection({
    actor,
    sourceId: created.data.source.sourceId,
    force: true,
    runtime
  });
  assert.equal(third.data.runs[0].updatedCount, 1);

  const stored = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(stored.knowledgeMaterials.length, 1);
  assert.deepEqual(
    stored.knowledgeCollectionSnapshots.map((item) => item.collectionStatus),
    ["collected", "unchanged", "updated"]
  );
  assert.equal(stored.knowledgeCollectionSnapshots[2].knowledgeBaseId, "kb-product-a");
  assert.equal(stored.knowledgeCollectionSnapshots[2].entityName, "产品 A");
});

test.after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});
