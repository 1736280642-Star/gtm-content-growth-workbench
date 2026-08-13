import assert from "node:assert/strict";
import test from "node:test";

const { evaluateGeoSourceSnapshotQuality, isTestGeoSource } = await import("../src/lib/v5/geo-source-quality.ts");

function source(overrides = {}) {
  return {
    sourceId: "source-official",
    sourceRevisionId: "revision-official",
    title: "产品官网",
    canonicalUrl: "https://product.vendor.cn/product",
    fileName: "official-product-page.md",
    documentType: "official_product_page",
    authorityLevel: "A2",
    visibility: "public",
    lifecycleStatus: "current",
    status: "approved_for_claim_extraction",
    safetyStatus: "passed",
    ...overrides
  };
}

test("A1/A2 public current source with an original URL passes the formal GEO gate", () => {
  const quality = evaluateGeoSourceSnapshotQuality({
    declaredSourceCount: 1,
    declaredRevisionCount: 1,
    sources: [source()]
  });
  assert.equal(quality.status, "ready");
  assert.equal(quality.officialSourceCount, 1);
  assert.deepEqual(quality.issueCodes, []);
});

test("background-only B2 material cannot establish the formal product truth", () => {
  const quality = evaluateGeoSourceSnapshotQuality({
    declaredSourceCount: 1,
    declaredRevisionCount: 1,
    sources: [source({ authorityLevel: "B2", documentType: "official_channel_history" })]
  });
  assert.equal(quality.status, "blocked");
  assert.equal(quality.publicCitableSourceCount, 1);
  assert.ok(quality.issueCodes.includes("official_product_source_required"));
});

test("smoke, fixture, mock, reserved-host, and Chinese placeholder sources are deterministic test data", () => {
  for (const candidate of [
    source({ fileName: "codex-config-smoke.md" }),
    source({ fileName: "product-fixture.json" }),
    source({ title: "产品 mock source" }),
    source({ canonicalUrl: "https://example.com/product" }),
    source({ title: "测试资料" })
  ]) assert.equal(isTestGeoSource(candidate), true);

  const quality = evaluateGeoSourceSnapshotQuality({
    declaredSourceCount: 1,
    declaredRevisionCount: 1,
    sources: [source({ fileName: "codex-config-smoke.md" })]
  });
  assert.equal(quality.status, "blocked");
  assert.equal(quality.testSourceCount, 1);
  assert.ok(quality.issueCodes.includes("test_source_detected"));
});

test("snapshot declarations must match the immutable linked source items", () => {
  const quality = evaluateGeoSourceSnapshotQuality({
    declaredSourceCount: 2,
    declaredRevisionCount: 3,
    sources: [source()]
  });
  assert.ok(quality.issueCodes.includes("snapshot_source_mismatch"));
  assert.ok(quality.issueCodes.includes("snapshot_revision_mismatch"));
});
