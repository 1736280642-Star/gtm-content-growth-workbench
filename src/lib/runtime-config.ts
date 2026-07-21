export type RuntimeCapabilityStatus = "ready" | "pending_config";

export interface RuntimeCapability {
  key: string;
  label: string;
  purpose: string;
  status: RuntimeCapabilityStatus;
  requiredEnv: string[];
  missingEnv: string[];
  optionalEnv?: string[];
}

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function createCapability(input: Omit<RuntimeCapability, "status" | "missingEnv">): RuntimeCapability {
  const missingEnv = input.requiredEnv.filter((name) => !hasEnv(name));

  return {
    ...input,
    missingEnv,
    status: missingEnv.length ? "pending_config" : "ready"
  };
}

export function getRuntimeConfigStatus() {
  const capabilities = [
    createCapability({
      key: "local_json_repository",
      label: "本地 JSON Repository",
      purpose: "本地试运行状态持久化",
      requiredEnv: [],
      optionalEnv: ["WORKBENCH_STATE_PATH"]
    }),
    createCapability({
      key: "mysql_repository",
      label: "MySQL Repository",
      purpose: "生产级数据持久化",
      requiredEnv: ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"]
    }),
    createCapability({
      key: "qwen",
      label: "通义千问 / Qwen",
      purpose: "内容生成",
      requiredEnv: ["DASHSCOPE_API_KEY", "QWEN_MODEL"],
      optionalEnv: ["QWEN_BASE_URL"]
    }),
    createCapability({
      key: "deepseek",
      label: "DeepSeek",
      purpose: "内容生成",
      requiredEnv: ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
      optionalEnv: ["DEEPSEEK_BASE_URL"]
    }),
    createCapability({
      key: "doubao",
      label: "豆包",
      purpose: "内容生成",
      requiredEnv: ["DOUBAO_API_KEY", "DOUBAO_MODEL"],
      optionalEnv: ["DOUBAO_BASE_URL"]
    }),
    createCapability({
      key: "xcrawl_blog_sync",
      label: "官网博客同步",
      purpose: "官网 sitemap / JSON 源同步博客列表，XCRAWL_BLOG_INDEX_URL 可覆盖默认源",
      requiredEnv: [],
      optionalEnv: ["XCRAWL_BLOG_INDEX_URL"]
    }),
    createCapability({
      key: "csv_log_import",
      label: "CSV 日志导入",
      purpose: "本地 CSV 文本导入并生成 AI Bot 汇总",
      requiredEnv: []
    }),
    createCapability({
      key: "nginx_log_import",
      label: "Nginx 日志导入",
      purpose: "读取服务器 access log",
      requiredEnv: ["NGINX_ACCESS_LOG_PATH"]
    }),
    createCapability({
      key: "cdn_log_import",
      label: "CDN 日志导入",
      purpose: "读取 CDN 导出日志",
      requiredEnv: ["CDN_LOG_EXPORT_PATH"]
    })
  ] satisfies RuntimeCapability[];

  return {
    capabilities,
    ready: capabilities.filter((item) => item.status === "ready"),
    pending: capabilities.filter((item) => item.status === "pending_config")
  };
}

export function getMissingEnvFor(keys: string[]) {
  const status = getRuntimeConfigStatus();
  const selected = status.capabilities.filter((item) => keys.includes(item.key));

  return Array.from(new Set(selected.flatMap((item) => item.missingEnv)));
}
