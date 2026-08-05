import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("workbench imports persist managed SourceRevision content and queue formal RAG refresh", () => {
  const migration = fs.readFileSync(path.join(root, "database/migrations/20260728_013_v5_managed_source_content.sql"), "utf8");
  const repository = fs.readFileSync(path.join(root, "src/lib/v5/rag/source-import-repository.ts"), "utf8");
  const indexBuild = fs.readFileSync(path.join(root, "src/lib/v5/rag/index-build-service.ts"), "utf8");
  const refreshWorker = fs.readFileSync(path.join(root, "workers/knowledge-refresh-worker.mjs"), "utf8");
  const importWorkspace = fs.readFileSync(path.join(root, "src/components/ProductMaterialImport.tsx"), "utf8");
  const legacyImportPage = fs.readFileSync(path.join(root, "src/app/knowledge/import/page.tsx"), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS source_revision_content/);
  assert.match(migration, /normalized_text LONGTEXT NOT NULL/);
  assert.match(repository, /INSERT INTO source_revision_content/);
  assert.match(repository, /'knowledge_refresh'/);
  assert.match(repository, /deferAutomaticClaims/);
  assert.match(refreshWorker, /extractManagedClaimsForProduct/);
  assert.match(indexBuild, /new DefaultRagRawAssetStore\(\)/);
  assert.match(importWorkspace, /\/api\/v5\/knowledge-imports\/documents/);
  assert.match(importWorkspace, /\/api\/v5\/knowledge-imports\/urls/);
  assert.match(importWorkspace, /productId/);
  assert.match(importWorkspace, /导入资料/);
  assert.doesNotMatch(importWorkspace, /解析并预览/);
  assert.doesNotMatch(importWorkspace, /所属产品/);
  assert.doesNotMatch(importWorkspace, /\/api\/knowledge-bases"/);
  assert.match(legacyImportPage, /redirect/);
});

test("normal workbench imports do not require local RAG source roots", () => {
  const template = fs.readFileSync(path.join(root, ".env.local.example"), "utf8");
  const managedService = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-source-import-service.ts"), "utf8");
  const managedReference = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-content-reference.ts"), "utf8");

  assert.doesNotMatch(template, /^RAG_SOURCE_ROOT_/m);
  assert.doesNotMatch(template, /^RAG_IMPORT_/m);
  assert.match(managedReference, /mysql:\/\/source-revision/);
  assert.doesNotMatch(managedService, /RAG_SOURCE_ROOT_/);
  assert.match(managedService, /stableId\("kb-product-", input\.productId/);
});
