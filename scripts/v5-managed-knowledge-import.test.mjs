import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { isManagedResearchOnlySource } from "../src/lib/v5/rag/managed-source-import-service.ts";

const root = process.cwd();

test("GEO、关键词与实体消歧交付物只进入研究治理区", () => {
  assert.equal(isManagedResearchOnlySource({
    title: "JOTO 腾讯云 ADP GEO 交付物分类整理",
    originalFileName: "B2_腾讯云ADP资料与关键词研究表_简洁版.docx"
  }), true);
  assert.equal(isManagedResearchOnlySource({
    title: "腾讯云 ADP 官方产品能力",
    originalFileName: "腾讯云ADP产品文档.docx"
  }), false);
  assert.equal(isManagedResearchOnlySource({
    title: "公开 GEO 产品文章",
    canonicalUrl: "https://example.com/geo-product"
  }), false);

  const managedService = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-source-import-service.ts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "database/migrations/20260829_044_v5_geo_research_evidence_isolation.sql"), "utf8");
  assert.match(managedService, /researchOnly \? "governance_preview" : "production_candidate"/);
  assert.match(managedService, /\["research_observation", "search_strategy", "badcase"\]/);
  assert.match(managedService, /\["production_fact", "public_citation", "formal_generation"\]/);
  assert.match(migration, /research_only_source_removed/);
  assert.match(migration, /draft\.copy_allowed = FALSE/);
  assert.match(migration, /review\.status = 'cancelled'/);
  assert.match(migration, /https:\/\/cloud\.tencent\.com\/document\/product\/1759/);
});

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
  const claimExtractionService = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-claim-extraction-service.ts"), "utf8");

  assert.doesNotMatch(template, /^RAG_SOURCE_ROOT_/m);
  assert.match(template, /Workbench document and URL imports are stored in MySQL/);
  assert.match(template, /They do not require/);
  assert.match(managedReference, /mysql:\/\/source-revision/);
  assert.match(claimExtractionService, /managed-claim-extraction:\$\{versionedPlanHash\}/);
  assert.doesNotMatch(claimExtractionService, /managed-claim-extraction:\$\{productId\}:/);
  assert.doesNotMatch(managedService, /RAG_SOURCE_ROOT_/);
  assert.match(managedService, /stableId\("kb-product-", input\.productId/);
});

test("confirmed A2 sources can fill product identity gaps without overwriting manual values", () => {
  const managedService = fs.readFileSync(path.join(root, "src/lib/v5/rag/managed-source-import-service.ts"), "utf8");
  const productRepository = fs.readFileSync(path.join(root, "src/lib/v5/product-registry-repository.ts"), "utf8");
  const readinessService = fs.readFileSync(path.join(root, "src/lib/v5/geo-research-service.ts"), "utf8");
  const configurationPage = fs.readFileSync(path.join(root, "src/app/configuration/page.tsx"), "utf8");

  assert.match(managedService, /input\.authorityLevel !== "A2"/);
  assert.match(managedService, /new Set\(candidates\.map\(\(item\) => item\.host\)\)\.size !== 1/);
  assert.match(managedService, /inferProductIdentityFromConfirmedSources/);
  assert.match(managedService, /Object\.values\(inferredIdentity\)\.some\(Boolean\)/);
  assert.match(productRepository, /COALESCE\(brand_name, \?\)/);
  assert.match(productRepository, /COALESCE\(official_entity, \?\)/);
  assert.match(productRepository, /COALESCE\(official_url, \?\)/);
  assert.match(productRepository, /sa\.authority_level = 'A2'/);
  assert.match(productRepository, /sa\.visibility = 'public'/);
  assert.match(productRepository, /sa\.lifecycle_status = 'current'/);
  assert.match(productRepository, /product_identity_confirmed_from_sources/);
  assert.match(readinessService, /\/settings\?tab=models/);
  assert.match(configurationPage, /智谱负责事实搜索、检索规划和最终语义综合/);
  assert.match(configurationPage, /npm\.cmd run docker:3027/);
  assert.match(configurationPage, /API Key 不在页面填写或回显/);
});

test("product detail exposes an audited, versioned manual identity editor", () => {
  const page = fs.readFileSync(path.join(root, "src/app/products/[productId]/page.tsx"), "utf8");
  const route = fs.readFileSync(path.join(root, "src/app/api/v5/products/[productId]/route.ts"), "utf8");
  const repository = fs.readFileSync(path.join(root, "src/lib/v5/product-registry-repository.ts"), "utf8");

  assert.match(page, /编辑产品信息/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /expectedVersion: data\.product\.rowVersion/);
  assert.match(route, /export async function PATCH/);
  assert.match(repository, /product_version_conflict/);
  assert.match(repository, /writeV5Idempotency/);
  assert.match(repository, /eventType: "product_registry_updated"/);
});
