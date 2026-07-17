import type { RagInfrastructureStatus } from "./contracts";

const mysqlConfig = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"] as const;
const openSearchConfig = ["OPENSEARCH_URL", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD"] as const;

const embeddingProviders = {
  qwen_embedding: { apiKey: "DASHSCOPE_API_KEY", model: "QWEN_EMBEDDING_MODEL" },
  doubao_embedding: { apiKey: "DOUBAO_API_KEY", model: "DOUBAO_EMBEDDING_MODEL" }
} as const;

function missing(names: readonly string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

export function getRagInfrastructureStatus(): RagInfrastructureStatus {
  const mysqlMissing = missing(mysqlConfig);
  const openSearchMissing = missing(openSearchConfig);
  const provider = process.env.RAG_EMBEDDING_PROVIDER?.trim() as keyof typeof embeddingProviders | undefined;
  const providerConfig = provider ? embeddingProviders[provider] : undefined;
  const embeddingMissing = providerConfig
    ? missing([providerConfig.apiKey, providerConfig.model])
    : ["RAG_EMBEDDING_PROVIDER"];
  const embeddingModel = providerConfig ? process.env[providerConfig.model]?.trim() : undefined;
  const status: RagInfrastructureStatus = {
    status: mysqlMissing.length === 0 && openSearchMissing.length === 0 && embeddingMissing.length === 0 ? "ready" : "pending_config",
    mysql: { status: mysqlMissing.length ? "pending_config" : "ready", missingConfig: mysqlMissing },
    opensearch: { status: openSearchMissing.length ? "pending_config" : "ready", missingConfig: openSearchMissing },
    embedding: {
      status: embeddingMissing.length ? "pending_config" : "ready",
      provider,
      model: embeddingModel,
      missingConfig: embeddingMissing
    }
  };
  return status;
}

export function assertRagInfrastructureReady() {
  const status = getRagInfrastructureStatus();
  if (status.status !== "ready") {
    const missingConfig = [
      ...status.mysql.missingConfig,
      ...status.opensearch.missingConfig,
      ...status.embedding.missingConfig
    ];
    throw new RagInfrastructureError("pending_config", "RAG 基础设施尚未完整配置。", missingConfig);
  }
  return status;
}

export class RagInfrastructureError extends Error {
  constructor(public readonly code: "pending_config", message: string, public readonly missingConfig: string[]) {
    super(message);
    this.name = "RagInfrastructureError";
  }
}
