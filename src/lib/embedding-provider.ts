import { getRuntimeConfigStatus } from "./runtime-config";
import type { KnowledgeEmbeddingModelProvider } from "./types";

export interface EmbeddingProviderRequest {
  provider: KnowledgeEmbeddingModelProvider;
  input: string | string[];
}

export interface EmbeddingProviderResult {
  ok: boolean;
  status: "success" | "pending_config" | "failed";
  provider: KnowledgeEmbeddingModelProvider;
  model?: string;
  vectors?: number[][];
  missingConfig?: string[];
  errorMessage?: string;
}

const embeddingProviderEnvMap: Record<
  KnowledgeEmbeddingModelProvider,
  { baseUrl: string; apiKey: string; model: string; defaultBaseUrl?: string }
> = {
  qwen_embedding: {
    baseUrl: "QWEN_EMBEDDING_BASE_URL",
    apiKey: "DASHSCOPE_API_KEY",
    model: "QWEN_EMBEDDING_MODEL",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  doubao_embedding: {
    baseUrl: "DOUBAO_EMBEDDING_BASE_URL",
    apiKey: "DOUBAO_API_KEY",
    model: "DOUBAO_EMBEDDING_MODEL",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  }
};

const defaultEmbeddingTimeoutMs = Number(process.env.EMBEDDING_PROVIDER_TIMEOUT_MS || 60000);

export function getEmbeddingProviderMissingEnv(provider: KnowledgeEmbeddingModelProvider) {
  return getRuntimeConfigStatus().capabilities.find((item) => item.key === provider)?.missingEnv || [];
}

function normalizeEmbeddingVector(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  const vector = value.map((item) => Number(item));
  return vector.length && vector.every((item) => Number.isFinite(item)) ? vector : undefined;
}

export async function callEmbeddingProvider(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
  const env = embeddingProviderEnvMap[request.provider];
  const missingConfig = getEmbeddingProviderMissingEnv(request.provider);

  if (missingConfig.length) {
    return {
      ok: false,
      status: "pending_config",
      provider: request.provider,
      missingConfig
    };
  }

  const apiKey = process.env[env.apiKey];
  const model = process.env[env.model];
  const baseUrl = (process.env[env.baseUrl] || env.defaultBaseUrl || "").replace(/\/$/, "");

  if (!apiKey || !model || !baseUrl) {
    const missing = [
      !apiKey ? env.apiKey : undefined,
      !model ? env.model : undefined,
      !baseUrl ? env.baseUrl : undefined
    ].filter((item): item is string => Boolean(item));

    return {
      ok: false,
      status: "pending_config",
      provider: request.provider,
      missingConfig: missing
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultEmbeddingTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: request.input
      })
    });
    const raw = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        provider: request.provider,
        model,
        errorMessage: raw?.error?.message || raw?.message || `Embedding provider request failed: ${response.status}`
      };
    }

    const vectors = Array.isArray(raw?.data)
      ? raw.data.map((item: { embedding?: unknown }) => normalizeEmbeddingVector(item.embedding)).filter(Boolean)
      : [];

    if (!vectors.length) {
      return {
        ok: false,
        status: "failed",
        provider: request.provider,
        model,
        errorMessage: "Embedding provider did not return a usable vector array."
      };
    }

    return {
      ok: true,
      status: "success",
      provider: request.provider,
      model,
      vectors: vectors as number[][]
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return {
      ok: false,
      status: "failed",
      provider: request.provider,
      model,
      errorMessage: isTimeout
        ? `Embedding provider request timed out after ${defaultEmbeddingTimeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown embedding provider error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
