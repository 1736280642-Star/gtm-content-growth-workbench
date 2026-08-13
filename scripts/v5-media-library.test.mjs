import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "joto-media-library-"));
process.env.V5_MEDIA_LIBRARY_STATE_PATH = path.join(temporaryRoot, "state.json");
process.env.V5_MEDIA_LIBRARY_STORAGE_PATH = path.join(temporaryRoot, "assets");

const {
  archiveMediaLibraryAsset,
  createMediaLibraryAsset,
  listMediaLibraryAssets,
  readMediaLibraryAssetContent,
  updateMediaLibraryAsset
} = await import("../src/lib/v5/media-library-service.ts");
const { getFreeProductionCatalog } = await import("../src/lib/v5/free-production-service.ts");

const catalog = await getFreeProductionCatalog();
const product = catalog.products[0];
assert.ok(product, "media library test requires one production-ready product");

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("test-image-payload")
]);

test.after(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("creates, replays, reads, updates and archives a product media asset", async () => {
  const input = {
    expectedVersion: 0,
    auditReason: "test create media asset",
    productId: product.productId,
    description: "产品功能界面截图，适合能力介绍章节。",
    file: { fileName: "feature.png", mimeType: "image/png", dataBase64: png.toString("base64") }
  };
  const created = await createMediaLibraryAsset(input, "test-create-media");
  assert.equal(created.productId, product.productId);
  assert.equal(created.mediaKind, "image");
  assert.match(created.contentUrl, new RegExp(created.id));

  const replayed = await createMediaLibraryAsset(input, "test-create-media");
  assert.equal(replayed.id, created.id);

  const listed = await listMediaLibraryAssets({ productId: product.productId });
  assert.equal(listed.total, 1);

  const content = await readMediaLibraryAssetContent(created.id);
  assert.deepEqual(content.data, png);
  assert.equal(content.mimeType, "image/png");

  const updated = await updateMediaLibraryAsset(created.id, {
    expectedVersion: created.version,
    auditReason: "test update media description",
    productId: product.productId,
    description: "更新后的产品截图说明。"
  }, "test-update-media");
  assert.equal(updated.description, "更新后的产品截图说明。");
  assert.equal(updated.version, 2);

  const archived = await archiveMediaLibraryAsset(created.id, {
    expectedVersion: updated.version,
    auditReason: "test archive media asset"
  }, "test-archive-media");
  assert.equal(archived.status, "archived");
  assert.equal((await listMediaLibraryAssets()).total, 0);
});

test("rejects a file whose declared MIME does not match its signature", async () => {
  await assert.rejects(
    createMediaLibraryAsset({
      expectedVersion: 0,
      auditReason: "test invalid media signature",
      productId: product.productId,
      description: "伪造格式测试素材。",
      file: { fileName: "fake.gif", mimeType: "image/gif", dataBase64: png.toString("base64") }
    }, "test-invalid-media"),
    (error) => error?.code === "MEDIA_FILE_SIGNATURE_INVALID"
  );
});
