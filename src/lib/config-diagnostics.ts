import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { callAiProvider, type AiProviderKey } from "./ai-provider";
import { DEFAULT_BLOG_SOURCE_URLS } from "./blog-source";
import { callEmbeddingProvider } from "./embedding-provider";
import { getRuntimeConfigStatus, type RuntimeCapability } from "./runtime-config";
import type { KnowledgeEmbeddingModelProvider } from "./types";
import { getWorkspaceSetting, probeKnowledgeUrlCrawler } from "./workbench-store";
import { checkWechatsyncAuth, getWechatsyncRuntimeStatus } from "./wechatsync-client";

export interface ConfigDiagnosticResult {
  key: string;
  label: string;
  ok: boolean;
  status: "ready" | "pending_config" | "failed";
  message: string;
  missingEnv: string[];
  checkedAt: string;
}

function createPendingResult(capability: RuntimeCapability): ConfigDiagnosticResult {
  return {
    key: capability.key,
    label: capability.label,
    ok: false,
    status: "pending_config",
    message: `缺少配置：${capability.missingEnv.join(", ")}`,
    missingEnv: capability.missingEnv,
    checkedAt: new Date().toISOString()
  };
}

function createReadyResult(capability: RuntimeCapability, message = "配置已就绪。"): ConfigDiagnosticResult {
  return {
    key: capability.key,
    label: capability.label,
    ok: true,
    status: "ready",
    message,
    missingEnv: [],
    checkedAt: new Date().toISOString()
  };
}

function createFailedResult(capability: RuntimeCapability, message: string): ConfigDiagnosticResult {
  return {
    key: capability.key,
    label: capability.label,
    ok: false,
    status: "failed",
    message,
    missingEnv: [],
    checkedAt: new Date().toISOString()
  };
}

function findCapability(key: string) {
  return getRuntimeConfigStatus().capabilities.find((item) => item.key === key);
}

function checkPathCapability(capability: RuntimeCapability, envName: string) {
  if (capability.missingEnv.length) {
    return createPendingResult(capability);
  }

  const pathValue = process.env[envName];

  if (!pathValue) {
    return createPendingResult({
      ...capability,
      missingEnv: [envName],
      status: "pending_config"
    });
  }

  const resolvedPath = resolve(pathValue);
  const targetPath = existsSync(resolvedPath) ? resolvedPath : dirname(resolvedPath);

  if (!existsSync(targetPath)) {
    return createFailedResult(capability, `路径不存在：${targetPath}`);
  }

  return createReadyResult(capability, `路径可访问：${targetPath}`);
}

export async function runConfigDiagnostic(key: string): Promise<ConfigDiagnosticResult> {
  const capability = findCapability(key);

  if (!capability) {
    return {
      key,
      label: key,
      ok: false,
      status: "failed",
      message: `未知配置能力：${key}`,
      missingEnv: [],
      checkedAt: new Date().toISOString()
    };
  }

  if (capability.missingEnv.length) {
    return createPendingResult(capability);
  }

  if (key === "local_json_repository" || key === "csv_log_import") {
    return createReadyResult(capability);
  }

  if (key === "mysql_repository") {
    return createReadyResult(capability, "MySQL 必填配置已齐全；连接检查请继续使用 npm.cmd run check:mysql。");
  }

  if (key === "nginx_log_import") {
    return checkPathCapability(capability, "NGINX_ACCESS_LOG_PATH");
  }

  if (key === "cdn_log_import") {
    return checkPathCapability(capability, "CDN_LOG_EXPORT_PATH");
  }

  if (key === "xcrawl_blog_sync") {
    const urls = (process.env.XCRAWL_BLOG_INDEX_URL ? process.env.XCRAWL_BLOG_INDEX_URL.split(/\r?\n|,/) : [...DEFAULT_BLOG_SOURCE_URLS])
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      urls.forEach((url) => new URL(url));
      return createReadyResult(capability, `博客源 URL 格式有效：${urls.join(", ")}`);
    } catch {
      return createFailedResult(capability, "博客源 URL 不是有效 URL。");
    }
  }

  if (key === "knowledge_url_crawler") {
    const probe = await probeKnowledgeUrlCrawler();

    if (probe.ok) {
      return createReadyResult(capability, probe.message);
    }

    if (probe.status === "pending_config") {
      return createPendingResult({
        ...capability,
        missingEnv: capability.missingEnv.length ? capability.missingEnv : ["XCRAWL_API_KEY 或 KNOWLEDGE_PROXY_FETCH_BASE_URL"],
        status: "pending_config"
      });
    }

    return createFailedResult(capability, `${probe.message}（${probe.errorCode}）`);
  }

  if (key === "wechatsync_bridge") {
    const runtime = await getWechatsyncRuntimeStatus();

    if (runtime.mode === "mock") {
      return createFailedResult(capability, "当前仍是 mock 模式：本地流程可验收，但不会写入真实平台草稿。");
    }

    if (runtime.bridgeStatus === "ready") {
      return createReadyResult(capability, runtime.message);
    }

    if (runtime.bridgeStatus === "pending_config") {
      return createPendingResult({
        ...capability,
        missingEnv: capability.missingEnv.length ? capability.missingEnv : ["WECHATSYNC_ENABLED"],
        status: "pending_config"
      });
    }

    return createFailedResult(capability, runtime.message);
  }

  if (key === "wechat_mp_draft") {
    const runtime = await getWechatsyncRuntimeStatus();

    if (runtime.mode !== "real") {
      return createPendingResult({
        ...capability,
        missingEnv: ["WECHATSYNC_ENABLED"],
        status: "pending_config"
      });
    }

    if (runtime.bridgeStatus !== "ready") {
      return createFailedResult(capability, runtime.message);
    }

    const auth = await checkWechatsyncAuth("weixin");

    if (auth.authenticated) {
      return createReadyResult(capability, auth.message);
    }

    if (capability.missingEnv.length) {
      return createPendingResult(capability);
    }

    return createFailedResult(capability, auth.message);
  }

  if (key === "csdn_draft" || key === "juejin_draft" || key === "zhihu_draft") {
    const platform = key === "csdn_draft" ? "csdn" : key === "juejin_draft" ? "juejin" : "zhihu";
    const runtime = await getWechatsyncRuntimeStatus();

    if (runtime.mode !== "real") {
      return createPendingResult({
        ...capability,
        missingEnv: ["WECHATSYNC_ENABLED"],
        status: "pending_config"
      });
    }

    if (runtime.bridgeStatus !== "ready") {
      return createFailedResult(capability, runtime.message);
    }

    if (!runtime.supportedPlatforms.includes(platform)) {
      return createPendingResult({
        ...capability,
        missingEnv: [`${capability.label} adapter`],
        status: "pending_config"
      });
    }

    const auth = await checkWechatsyncAuth(platform);

    if (auth.authenticated) {
      return createReadyResult(capability, auth.message);
    }

    if (capability.missingEnv.length) {
      return createPendingResult(capability);
    }

    return createFailedResult(capability, auth.message);
  }

  if (key === "qwen" || key === "deepseek" || key === "doubao") {
    const result = await callAiProvider({
      provider: key as AiProviderKey,
      systemPrompt: "You are a config diagnostic probe. Reply with ok.",
      userPrompt: "ok",
      temperature: 0
    });

    if (result.ok) {
      return createReadyResult(capability, `${capability.label} 测试调用成功。`);
    }

    if (result.status === "pending_config") {
      return createPendingResult({
        ...capability,
        missingEnv: result.missingConfig || capability.missingEnv,
        status: "pending_config"
      });
    }

    return createFailedResult(capability, result.errorMessage || `${capability.label} 测试调用失败。`);
  }

  if (key === "qwen_embedding" || key === "doubao_embedding") {
    const result = await callEmbeddingProvider({
      provider: key as KnowledgeEmbeddingModelProvider,
      input: "JOTO knowledge base embedding diagnostic"
    });

    if (result.ok) {
      const dimensions = result.vectors?.[0]?.length || 0;
      return createReadyResult(capability, `${capability.label} 测试调用成功，向量维度 ${dimensions}。`);
    }

    if (result.status === "pending_config") {
      return createPendingResult({
        ...capability,
        missingEnv: result.missingConfig || capability.missingEnv,
        status: "pending_config"
      });
    }

    return createFailedResult(capability, result.errorMessage || `${capability.label} 测试调用失败。`);
  }

  return createReadyResult(capability);
}

export async function runAllConfigDiagnostics() {
  const status = getRuntimeConfigStatus();
  const selectedEmbeddingProvider = getWorkspaceSetting().knowledgeRagConfig?.embeddingModelProvider;
  const embeddingKeys = new Set(["qwen_embedding", "doubao_embedding"]);
  const capabilities = status.capabilities.filter((capability) => {
    if (!embeddingKeys.has(capability.key)) return true;
    return capability.key === selectedEmbeddingProvider;
  });
  const results: ConfigDiagnosticResult[] = [];

  for (const capability of capabilities) {
    results.push(await runConfigDiagnostic(capability.key));
  }

  return {
    ok: results.every((item) => item.ok || item.status === "pending_config"),
    status: results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "pending_config") ? "pending_config" : "ready",
    results
  };
}
