import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, route, service, repository] = await Promise.all([
  readFile("src/app/products/page.tsx", "utf8"),
  readFile("src/app/api/v5/products/[productId]/route.ts", "utf8"),
  readFile("src/lib/v5/product-registry-service.ts", "utf8"),
  readFile("src/lib/v5/product-registry-repository.ts", "utf8")
]);

test("product knowledge list exposes an irreversible confirmed delete action", () => {
  assert.match(page, /<Popconfirm/);
  assert.match(page, /已上传文件、网页正文、解析资料和检索内容都会清除，且无法恢复/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /expectedVersion: product\.rowVersion/);
});

test("delete API requires a trusted product owner and delegates to the domain service", () => {
  assert.match(route, /export async function DELETE/);
  assert.match(route, /readTrustedServerActor\("product_owner"\)/);
  assert.match(route, /deleteProductKnowledgeBase\(\{/);
  assert.match(service, /permission_denied/);
  assert.match(service, /Number\.isInteger\(input\.expectedVersion\)/);
});

test("repository purges stored material while preserving shared sources", () => {
  assert.match(repository, /NOT EXISTS \(\s*SELECT 1 FROM knowledge_base_source_asset other/);
  assert.match(repository, /DELETE FROM source_revision_content/);
  assert.match(repository, /DELETE FROM source_asset/);
  assert.match(repository, /DELETE FROM rag_knowledge_chunk WHERE product_id/);
  assert.match(repository, /DELETE FROM knowledge_collection_snapshot WHERE product_id/);
  assert.match(service, /HttpRagOpenSearchAdapter/);
  assert.match(service, /openSearch\.deleteIndex/);
  assert.match(repository, /eventType: "product_knowledge_base_deleted"/);
  assert.match(repository, /operationType: "delete_product_knowledge_base"/);
});
