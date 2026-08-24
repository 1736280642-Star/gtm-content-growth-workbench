import { demoId, demoLatencyMs, isDemoMode } from "./demo/config";
import { demoAiContent } from "./demo/providers";
import { getRuntimeConfigStatus } from "./runtime-config";

export type AiProviderKey = "qwen" | "deepseek" | "doubao" | "zhipu";

export interface AiProviderRequest {
  provider: AiProviderKey;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface AiProviderResult {
  ok: boolean;
  status: "success" | "pending_config" | "failed";
  provider: AiProviderKey;
  model?: string;
  content?: string;
  raw?: unknown;
  missingConfig?: string[];
  errorMessage?: string;
  metrics: {
    durationMs: number;
    httpStatus?: number;
    requestId?: string;
    finishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const providerEnvMap: Record<AiProviderKey, { baseUrl: string; apiKey: string; model: string; defaultBaseUrl: string }> = {
  qwen: {
    baseUrl: "QWEN_BASE_URL",
    apiKey: "DASHSCOPE_API_KEY",
    model: "QWEN_MODEL",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  deepseek: {
    baseUrl: "DEEPSEEK_BASE_URL",
    apiKey: "DEEPSEEK_API_KEY",
    model: "DEEPSEEK_MODEL",
    defaultBaseUrl: "https://api.deepseek.com"
  },
  doubao: {
    baseUrl: "DOUBAO_BASE_URL",
    apiKey: "DOUBAO_API_KEY",
    model: "DOUBAO_MODEL",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  },
  zhipu: {
    baseUrl: "GEO_RESEARCH_ZHIPU_BASE_URL",
    apiKey: "GEO_RESEARCH_ZHIPU_API_KEY",
    model: "GEO_RESEARCH_ZHIPU_MODEL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4"
  }
};

const defaultProviderTimeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 120000);

function getMissingConfig(provider: AiProviderKey) {
  const status = getRuntimeConfigStatus();
  return status.capabilities.find((item) => item.key === provider)?.missingEnv || [];
}

function formatAiProviderError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "AbortError") {
    return `模型服务调用超时，超过 ${timeoutMs}ms 未返回。`;
  }

  const message = error instanceof Error ? error.message : String(error || "");
  const cause = error instanceof Error && "cause" in error ? String(error.cause || "") : "";
  const combined = `${message} ${cause}`;

  if (/fetch failed|econnreset|enotfound|etimedout|econnrefused|network|und_err/i.test(combined)) {
    return "模型服务网络连接失败，请检查该 Provider 的 base URL、出口网络或服务可用性。";
  }

  return message || "未知模型服务错误。";
}

export async function callAiProvider(request: AiProviderRequest): Promise<AiProviderResult> {
  if (isDemoMode()) {
    const env = providerEnvMap[request.provider];
    return {
      ok: true,
      status: "success",
      provider: request.provider,
      model: process.env[env.model] || "demo-model",
      content: demoAiContent(request.userPrompt),
      metrics: {
        durationMs: demoLatencyMs(),
        requestId: demoId("req"),
        finishReason: "stop",
        inputTokens: 180,
        outputTokens: 640,
        totalTokens: 820
      }
    };
  }
  const startedAt = Date.now();
  const env = providerEnvMap[request.provider];
  const missingConfig = getMissingConfig(request.provider);

  if (missingConfig.length) {
    return {
      ok: false,
      status: "pending_config",
      provider: request.provider,
      missingConfig,
      metrics: { durationMs: Date.now() - startedAt }
    };
  }

  const apiKey = process.env[env.apiKey];
  const model = process.env[env.model];
  const baseUrl = (process.env[env.baseUrl] || env.defaultBaseUrl).replace(/\/$/, "");
  const timeoutMs = Number.isFinite(request.timeoutMs)
    ? Math.max(1_000, Math.min(Number(request.timeoutMs), 300_000))
    : defaultProviderTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt }
        ],
        temperature: request.temperature ?? 0.4,
        ...(Number.isFinite(request.maxTokens) ? { max_tokens: Math.max(1, Math.floor(Number(request.maxTokens))) } : {})
      })
    });

    const raw = await response.json();
    const finishReason = typeof raw?.choices?.[0]?.finish_reason === "string" ? raw.choices[0].finish_reason : undefined;
    const usage = raw?.usage && typeof raw.usage === "object" ? raw.usage : {};
    const metrics = {
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || undefined,
      finishReason,
      inputTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : undefined,
      outputTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : undefined,
      totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : undefined
    };

    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        provider: request.provider,
        model,
        raw,
        errorMessage: raw?.error?.message || `AI provider request failed: ${response.status}`,
        metrics
      };
    }

    const content = raw?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      return {
        ok: false,
        status: "failed",
        provider: request.provider,
        model,
        raw,
        errorMessage: `模型返回空正文，finish_reason=${finishReason || "unknown"}。`,
        metrics
      };
    }

    return {
      ok: true,
      status: "success",
      provider: request.provider,
      model,
      content,
      raw,
      metrics
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      provider: request.provider,
      model,
      errorMessage: formatAiProviderError(error, timeoutMs),
      metrics: { durationMs: Date.now() - startedAt }
    };
  } finally {
    clearTimeout(timeout);
  }
}
