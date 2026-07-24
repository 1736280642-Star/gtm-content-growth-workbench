import { callEmbeddingProvider } from "@/lib/embedding-provider";
import type { KnowledgeEmbeddingModelProvider } from "@/lib/types";
import { buildClaimAwareChunks } from "./chunking-service";
import { getRagInfrastructureStatus, RagInfrastructureError } from "./infrastructure";
import { persistRagIndexBuild, readRagIndexBuildContext } from "./index-build-repository";
import { HttpRagOpenSearchAdapter } from "./opensearch-adapter";
import { LocalRagRawAssetStore, type RagRawAssetStore } from "./raw-asset-store";
import type { RagKnowledgeChunk } from "./contracts";

export interface RagIndexBuildResult {
  indexSnapshotId: string;
  indexedChunkCount: number;
  reviewRequiredCount: number;
  qualityIssues: Array<{ chunkId: string; codes: string[] }>;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  status: "awaiting_validation";
}

function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(maximum, parsed) : fallback;
}

export async function runRagIndexBuild(indexSnapshotId: string, dependencies: { rawAssetStore?: RagRawAssetStore; openSearch?: HttpRagOpenSearchAdapter } = {}): Promise<RagIndexBuildResult> {
  const infrastructure = getRagInfrastructureStatus();
  if (infrastructure.status !== "ready") {
    throw new RagInfrastructureError("pending_config", "RAG 索引构建基础设施尚未完整配置。", [
      ...infrastructure.mysql.missingConfig,
      ...infrastructure.opensearch.missingConfig,
      ...infrastructure.embedding.missingConfig
    ]);
  }
  const context = await readRagIndexBuildContext(indexSnapshotId);
  if (!context) throw new Error("IndexSnapshot 或 Manifest 不存在。" );
  if (context.snapshot.status !== "building") throw new Error(`IndexSnapshot 当前为 ${context.snapshot.status}，不能构建。`);
  if (context.manifest.status !== "approved") throw new Error("只有 approved Manifest 能构建生产索引。" );
  if (!context.governanceReady) throw new Error("Manifest 绑定的 active 规则包或 G6 月度生产准入已失效。" );
  if (context.sources.length !== context.manifest.approvedSourceRevisionIds.length) throw new Error("Manifest 中存在无法读取的 SourceRevision。" );
  const loadedClaimIds = new Set(context.sources.flatMap((item) => item.claims.map((claim) => claim.claimId)));
  const missingClaimIds = context.manifest.approvedClaimIds.filter((id) => !loadedClaimIds.has(id));
  if (missingClaimIds.length) throw new Error(`Manifest 中有 ${missingClaimIds.length} 条已批准 Claim 无法加载。`);

  const store = dependencies.rawAssetStore || new LocalRagRawAssetStore();
  const chunks: RagKnowledgeChunk[] = [];
  const reviewRequired: RagKnowledgeChunk[] = [];
  const qualityIssues: Array<{ chunkId: string; codes: string[] }> = [];
  for (const item of context.sources) {
    if (context.snapshot.namespace === "production_public" && (item.source.visibility !== "public" || item.source.safetyStatus !== "passed")) {
      throw new Error(`Source ${item.source.sourceId} 不满足 production_public 的公开可见与安全准入。`);
    }
    if (context.snapshot.namespace === "production_internal" && !["public", "internal"].includes(item.source.visibility)) {
      throw new Error(`Source ${item.source.sourceId} 不满足 production_internal 的可见性准入。`);
    }
    if (!item.claims.length) continue;
    if (!item.source.normalizedTextRef && !item.revision.normalizedTextRef) throw new Error(`SourceRevision ${item.revision.sourceRevisionId} 缺少 normalizedTextRef。`);
    const markdown = await store.readNormalizedText(item.revision.normalizedTextRef || item.source.normalizedTextRef!);
    const result = buildClaimAwareChunks({
      indexSnapshotId,
      namespace: context.snapshot.namespace,
      productId: context.manifest.productId,
      productName: context.productName,
      knowledgeBaseIds: context.manifest.knowledgeBaseIds,
      rulePackageVersionId: context.manifest.activeRulePackageVersionId,
      source: item.source,
      revision: item.revision,
      normalizedMarkdown: markdown,
      approvedClaims: item.claims,
      blockedClaimIds: context.manifest.blockedClaimIds,
      unresolvedConflictIds: context.manifest.unresolvedConflictIds,
      chunkerVersion: context.snapshot.chunkerVersion
    });
    chunks.push(...result.chunks);
    reviewRequired.push(...result.reviewRequired);
    qualityIssues.push(...result.qualityIssues);
  }
  if (!chunks.length) throw new Error("没有通过质量门的生产 Chunk，索引构建终止。" );
  const provider = infrastructure.embedding.provider as KnowledgeEmbeddingModelProvider;
  const vectors = new Map<string, number[]>();
  let model = infrastructure.embedding.model || "";
  const batchSize = boundedPositiveInteger(process.env.RAG_EMBEDDING_BATCH_SIZE, 32, 64);
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const result = await callEmbeddingProvider({ provider, input: batch.map((chunk) => `${chunk.chunkTitle}\n${chunk.summary}\n${chunk.content}`) });
    if (!result.ok || !result.vectors || result.vectors.length !== batch.length) {
      const details = result.missingConfig?.join(", ") || result.errorMessage || "向量数量与 Chunk 数量不一致";
      throw new Error(`真实 Embedding 批次失败：${details}`);
    }
    model = result.model || model;
    batch.forEach((chunk, index) => vectors.set(chunk.chunkId, result.vectors![index]));
  }
  const dimensions = vectors.values().next().value?.length || 0;
  if (!dimensions || [...vectors.values()].some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("Embedding 维度不一致或包含非有限数值。" );
  }
  const openSearch = dependencies.openSearch || new HttpRagOpenSearchAdapter();
  await openSearch.createSnapshotIndex(context.snapshot.indexName, dimensions);
  const bulkSize = boundedPositiveInteger(process.env.RAG_OPENSEARCH_BULK_SIZE, 100, 500);
  for (let start = 0; start < chunks.length; start += bulkSize) {
    await openSearch.bulkIndex(context.snapshot.indexName, chunks.slice(start, start + bulkSize), vectors);
  }
  await persistRagIndexBuild({ indexSnapshotId, chunks, provider, model, dimensions, vectors, reviewRequiredCount: reviewRequired.length });
  return {
    indexSnapshotId,
    indexedChunkCount: chunks.length,
    reviewRequiredCount: reviewRequired.length,
    qualityIssues,
    embeddingProvider: provider,
    embeddingModel: model,
    embeddingDimensions: dimensions,
    status: "awaiting_validation"
  };
}
