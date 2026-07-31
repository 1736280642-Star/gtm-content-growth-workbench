import type { RagInfrastructureStatus } from "./contracts";

const mysqlConfig = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"] as const;
const openSearchUrlConfig = ["OPENSEARCH_URL"] as const;

export type OpenSearchAuthMode = "auto" | "none" | "basic";

const embeddingProviders = {
  qwen_embedding: { apiKey: "DASHSCOPE_API_KEY", model: "QWEN_EMBEDDING_MODEL" },
  doubao_embedding: { apiKey: "DOUBAO_API_KEY", model: "DOUBAO_EMBEDDING_MODEL" }
} as const;

function missing(names: readonly string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

export function getOpenSearchAuthMode(): OpenSearchAuthMode {
  const configured = process.env.OPENSEARCH_AUTH_MODE?.trim().toLowerCase();
  if (configured === "none" || configured === "basic") return configured;
  return "auto";
}

export function getOpenSearchMissingConfig() {
  const missingConfig = missing(openSearchUrlConfig);
  const configuredMode = process.env.OPENSEARCH_AUTH_MODE?.trim().toLowerCase();
  if (configuredMode && !["auto", "none", "basic"].includes(configuredMode)) {
    missingConfig.push("OPENSEARCH_AUTH_MODE");
  }
  const authMode = getOpenSearchAuthMode();
  const username = process.env.OPENSEARCH_USERNAME?.trim();
  const password = process.env.OPENSEARCH_PASSWORD?.trim();
  if (authMode === "basic" || (authMode === "auto" && Boolean(username || password))) {
    if (!username) missingConfig.push("OPENSEARCH_USERNAME");
    if (!password) missingConfig.push("OPENSEARCH_PASSWORD");
  }
  return missingConfig;
}

export function getOpenSearchAuthorizationHeader() {
  const authMode = getOpenSearchAuthMode();
  const username = process.env.OPENSEARCH_USERNAME?.trim();
  const password = process.env.OPENSEARCH_PASSWORD?.trim();
  if (authMode === "none" || (authMode === "auto" && !username && !password)) return undefined;
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export function getRagInfrastructureStatus(): RagInfrastructureStatus {
  const mysqlMissing = missing(mysqlConfig);
  const openSearchMissing = getOpenSearchMissingConfig();
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
