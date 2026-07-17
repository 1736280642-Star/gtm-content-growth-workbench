import type { RagKnowledgeChunk, RagNamespace, RagRetrievalRequest } from "./contracts";
import { RagInfrastructureError, getRagInfrastructureStatus } from "./infrastructure";

export interface RagOpenSearchHit {
  chunk: RagKnowledgeChunk;
  score: number;
}

export interface RagOpenSearchAdapter {
  createSnapshotIndex(indexName: string, dimensions: number): Promise<void>;
  bulkIndex(indexName: string, chunks: RagKnowledgeChunk[], vectors: Map<string, number[]>): Promise<void>;
  keywordSearch(indexName: string, request: RagRetrievalRequest, limit: number, forbiddenSupportModes?: string[]): Promise<RagOpenSearchHit[]>;
  vectorSearch(indexName: string, request: RagRetrievalRequest, vector: number[], limit: number, forbiddenSupportModes?: string[]): Promise<RagOpenSearchHit[]>;
  relationSearch(indexName: string, request: RagRetrievalRequest, limit: number, forbiddenSupportModes?: string[]): Promise<RagOpenSearchHit[]>;
  requiredEvidenceSearch(indexName: string, request: RagRetrievalRequest, semanticTypes: string[], limit: number, forbiddenSupportModes?: string[]): Promise<RagOpenSearchHit[]>;
  activateAlias(alias: string, nextIndex: string, previousIndex?: string): Promise<void>;
  deleteIndex(indexName: string): Promise<void>;
}

function safeIndexPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildRagIndexName(namespace: RagNamespace, productId: string, language: string, indexVersion: string) {
  return ["v5-rag", namespace, productId, language, indexVersion].map(safeIndexPart).join("-");
}

function authHeader() {
  const username = process.env.OPENSEARCH_USERNAME?.trim() || "";
  const password = process.env.OPENSEARCH_PASSWORD?.trim() || "";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function requestTimeoutMs() {
  const parsed = Number(process.env.OPENSEARCH_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 120000) : 15000;
}

function hardFilter(request: RagRetrievalRequest, forbiddenSupportModes: string[] = []) {
  const filters: unknown[] = [
    { term: { namespace: request.namespace } },
    { term: { productId: request.productId } },
    { term: { status: "active" } },
    { term: { rulePackageVersionId: request.rulePackageVersionId } },
    { terms: { visibility: request.permissionScope } },
    { terms: { lifecycleStatus: request.lifecycleStatuses } },
    { terms: { capabilityStatus: request.lifecycleStatuses } },
    { bool: { must_not: { exists: { field: "conflictGroupIds" } } } }
  ];
  if (forbiddenSupportModes.length) filters.push({ bool: { must_not: { terms: { supportMode: forbiddenSupportModes } } } });
  const now = request.requestedAt;
  filters.push({ bool: { should: [{ bool: { must_not: { exists: { field: "validFrom" } } } }, { range: { validFrom: { lte: now } } }], minimum_should_match: 1 } });
  filters.push({ bool: { should: [{ bool: { must_not: { exists: { field: "validUntil" } } } }, { range: { validUntil: { gte: now } } }], minimum_should_match: 1 } });
  return filters;
}

export class HttpRagOpenSearchAdapter implements RagOpenSearchAdapter {
  private async request(path: string, init: RequestInit = {}) {
    const status = getRagInfrastructureStatus();
    if (status.opensearch.status !== "ready") {
      throw new RagInfrastructureError("pending_config", "OpenSearch 尚未配置。", status.opensearch.missingConfig);
    }
    const response = await fetch(`${process.env.OPENSEARCH_URL!.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
      ...init,
      headers: { authorization: authHeader(), "content-type": "application/json", ...init.headers },
      signal: init.signal || AbortSignal.timeout(requestTimeoutMs())
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenSearch ${response.status}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) as Record<string, unknown> : {};
  }

  async createSnapshotIndex(indexName: string, dimensions: number) {
    try {
      await this.request(indexName, {
        method: "PUT",
        body: JSON.stringify({
        settings: { index: { knn: true, number_of_shards: 1, number_of_replicas: 1 } },
        mappings: {
          dynamic: false,
          properties: {
            chunkId: { type: "keyword" }, namespace: { type: "keyword" }, productId: { type: "keyword" },
            status: { type: "keyword" }, visibility: { type: "keyword" }, lifecycleStatus: { type: "keyword" },
            capabilityStatus: { type: "keyword" },
            rulePackageVersionId: { type: "keyword" }, authorityLevel: { type: "keyword" }, semanticType: { type: "keyword" },
            supportMode: { type: "keyword" }, claimIds: { type: "keyword" }, conflictGroupIds: { type: "keyword" },
            duplicateClusterId: { type: "keyword" }, sourceId: { type: "keyword" }, validFrom: { type: "date" }, validUntil: { type: "date" },
            chunkTitle: { type: "text" }, summary: { type: "text" }, content: { type: "text" }, originalQuote: { type: "text" },
            scenarioTags: { type: "keyword" }, capabilityTags: { type: "keyword" }, audienceTags: { type: "keyword" }, problemTags: { type: "keyword" },
            channelTags: { type: "keyword" }, distilledTermIds: { type: "keyword" }, questionCandidateIds: { type: "keyword" },
            embedding: { type: "knn_vector", dimension: dimensions, method: { name: "hnsw", space_type: "cosinesimil", engine: "lucene" } }
          }
        }
        })
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("resource_already_exists_exception")) throw error;
    }
  }

  async bulkIndex(indexName: string, chunks: RagKnowledgeChunk[], vectors: Map<string, number[]>) {
    const lines: string[] = [];
    for (const chunk of chunks) {
      const vector = vectors.get(chunk.chunkId);
      if (!vector?.length) throw new Error(`Chunk ${chunk.chunkId} 缺少真实 Embedding。`);
      lines.push(JSON.stringify({ index: { _index: indexName, _id: chunk.chunkId } }));
      lines.push(JSON.stringify({ ...chunk, embedding: vector }));
    }
    const result = await this.request("_bulk?refresh=true", { method: "POST", headers: { "content-type": "application/x-ndjson" }, body: `${lines.join("\n")}\n` });
    if (result.errors) {
      const items = Array.isArray(result.items) ? result.items as Array<Record<string, { status?: number; error?: { type?: string } }>> : [];
      const failures = items.flatMap((item) => Object.values(item)).filter((item) => Number(item.status || 0) >= 300);
      const errorTypes = Array.from(new Set(failures.map((item) => item.error?.type || "unknown"))).slice(0, 5);
      throw new Error(`OpenSearch bulk 写入存在 ${failures.length} 条失败：${errorTypes.join(", ")}`);
    }
  }

  async keywordSearch(indexName: string, request: RagRetrievalRequest, limit: number, forbiddenSupportModes: string[] = []) {
    const body = await this.request(`${indexName}/_search`, {
      method: "POST",
      body: JSON.stringify({ size: limit, query: { bool: { filter: hardFilter(request, forbiddenSupportModes), must: { multi_match: { query: `${request.title} ${request.sourceProblem}`, fields: ["chunkTitle^3", "summary^2", "content", "originalQuote"] } } } } })
    });
    return this.mapHits(body);
  }

  async vectorSearch(indexName: string, request: RagRetrievalRequest, vector: number[], limit: number, forbiddenSupportModes: string[] = []) {
    const body = await this.request(`${indexName}/_search`, {
      method: "POST",
      body: JSON.stringify({ size: limit, query: { bool: { filter: hardFilter(request, forbiddenSupportModes), must: { knn: { embedding: { vector, k: limit } } } } } })
    });
    return this.mapHits(body);
  }

  async relationSearch(indexName: string, request: RagRetrievalRequest, limit: number, forbiddenSupportModes: string[] = []) {
    const should: unknown[] = [
      { term: { channelTags: request.channel } },
      { term: { audienceTags: request.targetAudience } },
      { term: { problemTags: request.sourceProblem } }
    ];
    if (request.distilledTermIds.length) should.push({ terms: { distilledTermIds: request.distilledTermIds } });
    const body = await this.request(`${indexName}/_search`, {
      method: "POST",
      body: JSON.stringify({ size: limit, query: { bool: { filter: hardFilter(request, forbiddenSupportModes), should, minimum_should_match: 1 } } })
    });
    return this.mapHits(body);
  }

  async requiredEvidenceSearch(indexName: string, request: RagRetrievalRequest, semanticTypes: string[], limit: number, forbiddenSupportModes: string[] = []) {
    const body = await this.request(`${indexName}/_search`, {
      method: "POST",
      body: JSON.stringify({
        size: limit,
        query: { bool: { filter: [...hardFilter(request, forbiddenSupportModes), { terms: { semanticType: semanticTypes } }] } },
        sort: [{ authorityLevel: { order: "asc" } }, { _score: { order: "desc" } }]
      })
    });
    return this.mapHits(body);
  }

  async activateAlias(alias: string, nextIndex: string, previousIndex?: string) {
    const actions: unknown[] = [];
    if (previousIndex) actions.push({ remove: { index: previousIndex, alias } });
    actions.push({ add: { index: nextIndex, alias, is_write_index: false } });
    await this.request("_aliases", { method: "POST", body: JSON.stringify({ actions }) });
  }

  async deleteIndex(indexName: string) {
    await this.request(indexName, { method: "DELETE" });
  }

  private mapHits(body: Record<string, unknown>): RagOpenSearchHit[] {
    const hits = (body.hits as { hits?: Array<{ _score?: number; _source?: RagKnowledgeChunk }> } | undefined)?.hits || [];
    return hits.filter((hit): hit is { _score?: number; _source: RagKnowledgeChunk } => Boolean(hit._source)).map((hit) => ({ chunk: hit._source, score: hit._score || 0 }));
  }
}
