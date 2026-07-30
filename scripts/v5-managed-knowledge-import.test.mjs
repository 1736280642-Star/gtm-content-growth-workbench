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
  const documentPage = fs.readFileSync(path.join(root, "src/app/knowledge/import/document/page.tsx"), "utf8");
  const urlPage = fs.readFileSync(path.join(root, "src/app/knowledge/import/url/page.tsx"), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS source_revision_content/);
  assert.match(migration, /normalized_text LONGTEXT NOT NULL/);
  assert.match(repository, /INSERT INTO source_revision_content/);
  assert.match(repository, /'knowledge_refresh'/);
  assert.match(repository, /deferAutomaticClaims/);
  assert.match(refreshWorker, /extractManagedClaimsForProduct/);
  assert.match(indexBuild, /new DefaultRagRawAssetStore\(\)/);
  assert.match(documentPage, /\/api\/v5\/knowledge-imports\/documents/);
  assert.match(urlPage, /\/api\/v5\/knowledge-imports\/urls/);
  assert.match(documentPage, /showUploadList=\{false\}/);
  assert.match(documentPage, /解析并预览/);
  assert.match(documentPage, /knowledge-upload-file-list/);
  assert.match(documentPage, /parsedFileSignature === currentFileSignature/);
  assert.doesNotMatch(documentPage, /\/api\/knowledge-bases"/);
  assert.doesNotMatch(urlPage, /\/api\/knowledge-bases"/);
});

test("normal workbench imports do not require local RAG source roots", () => {
  const managedService = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-source-import-service.ts"), "utf8");
  const managedReference = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-content-reference.ts"), "utf8");

  assert.match(managedReference, /mysql:\/\/source-revision/);
  assert.doesNotMatch(managedService, /RAG_SOURCE_ROOT_/);
  assert.doesNotMatch(managedService, /RAG_IMPORT_/);
});
