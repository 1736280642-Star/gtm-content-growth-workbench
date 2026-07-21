import { getRuntimeConfigStatus } from "./runtime-config";

export type AiProviderKey = "qwen" | "deepseek" | "doubao";

export interface AiProviderRequest {
  provider: AiProviderKey;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
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
  }
};

const defaultProviderTimeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 60000);

function getMissingConfig(provider: AiProviderKey) {
  const status = getRuntimeConfigStatus();
  return status.capabilities.find((item) => item.key === provider)?.missingEnv || [];
}

export async function callAiProvider(request: AiProviderRequest): Promise<AiProviderResult> {
  const env = providerEnvMap[request.provider];
  const missingConfig = getMissingConfig(request.provider);

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
  const baseUrl = (process.env[env.baseUrl] || env.defaultBaseUrl).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultProviderTimeoutMs);

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
        temperature: request.temperature ?? 0.4
      })
    });

    const raw = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        provider: request.provider,
        model,
        raw,
        errorMessage: raw?.error?.message || `AI provider request failed: ${response.status}`
      };
    }

    const content = raw?.choices?.[0]?.message?.content;

    return {
      ok: true,
      status: "success",
      provider: request.provider,
      model,
      content: typeof content === "string" ? content : "",
      raw
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return {
      ok: false,
      status: "failed",
      provider: request.provider,
      model,
      errorMessage: isTimeout
        ? `AI provider request timed out after ${defaultProviderTimeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Unknown AI provider error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
