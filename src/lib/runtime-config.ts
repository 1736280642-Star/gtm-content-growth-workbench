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

function createKnowledgeUrlCrawlerCapability(): RuntimeCapability {
  const hasXcrawl = hasEnv("XCRAWL_API_KEY");
  const hasProxy = hasEnv("KNOWLEDGE_PROXY_FETCH_BASE_URL");
  const missingEnv = hasXcrawl || hasProxy ? [] : ["XCRAWL_API_KEY 或 KNOWLEDGE_PROXY_FETCH_BASE_URL"];

  return {
    key: "knowledge_url_crawler",
    label: "知识库 URL 抓取",
    purpose: "知识库 URL 导入、官网首页、博客聚合页和 sitemap 真实正文抓取",
    requiredEnv: [],
    missingEnv,
    optionalEnv: [
      "XCRAWL_API_KEY",
      "XCRAWL_BASE_URL",
      "XCRAWL_TIMEOUT_MS",
      "KNOWLEDGE_PROXY_FETCH_BASE_URL",
      "KNOWLEDGE_PROXY_FETCH_API_KEY",
      "KNOWLEDGE_CRAWL_PRIMARY_PROVIDER",
      "KNOWLEDGE_CRAWL_TIMEOUT_MS",
      "KNOWLEDGE_CRAWL_DOMAIN_DELAY_MS",
      "KNOWLEDGE_CRAWL_MIN_TEXT_LENGTH"
    ],
    status: missingEnv.length ? "pending_config" : "ready"
  };
}

function createXcrawlFetchCapability(): RuntimeCapability {
  return createCapability({
    key: "xcrawl_fetch",
    label: "XCrawl 抓取",
    purpose: "知识库 URL 导入的 XCrawl 主抓取链路",
    requiredEnv: ["XCRAWL_API_KEY"],
    optionalEnv: ["XCRAWL_BASE_URL", "XCRAWL_TIMEOUT_MS"]
  });
}

function createKnowledgeProxyFetchCapability(): RuntimeCapability {
  return createCapability({
    key: "knowledge_proxy_fetch",
    label: "代理抓取",
    purpose: "知识库 URL 导入的代理抓取兜底链路",
    requiredEnv: ["KNOWLEDGE_PROXY_FETCH_BASE_URL"],
    optionalEnv: ["KNOWLEDGE_PROXY_FETCH_API_KEY", "KNOWLEDGE_PROXY_FETCH_TIMEOUT_MS"]
  });
}

function createWechatsyncBridgeCapability(): RuntimeCapability {
  return createCapability({
    key: "wechatsync_bridge",
    label: "平台草稿 Bridge",
    purpose: "今日发布终稿写入本机平台草稿服务，真实模式只允许 localhost bridge",
    requiredEnv: ["WECHATSYNC_ENABLED"],
    optionalEnv: ["WECHATSYNC_BRIDGE_URL", "WECHATSYNC_BRIDGE_TOKEN", "WECHATSYNC_MOCK"]
  });
}

function createWechatMpDraftCapability(): RuntimeCapability {
  return createCapability({
    key: "wechat_mp_draft",
    label: "微信公众号草稿",
    purpose: "通过微信公众号官方草稿箱 API 创建微信草稿，不自动发布",
    requiredEnv: ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"],
    optionalEnv: [
      "WECHAT_MP_THUMB_MEDIA_ID",
      "WECHAT_MP_THUMB_IMAGE_PATH",
      "WECHAT_MP_AUTHOR",
      "WECHAT_MP_DIGEST",
      "WECHAT_MP_CONTENT_SOURCE_URL",
      "WECHAT_MP_NEED_OPEN_COMMENT",
      "WECHAT_MP_ONLY_FANS_CAN_COMMENT",
      "WECHAT_MP_API_BASE_URL"
    ]
  });
}

function createCsdnDraftCapability(): RuntimeCapability {
  return createCapability({
    key: "csdn_draft",
    label: "CSDN 草稿",
    purpose: "通过 CSDN 创作中心接口创建文章草稿，不自动发布",
    requiredEnv: ["CSDN_COOKIE"],
    optionalEnv: ["CSDN_DRAFT_API_URL", "CSDN_DRAFT_PAYLOAD_JSON", "CSDN_HEADERS_JSON", "CSDN_TAGS", "CSDN_CATEGORIES", "CSDN_AUTH_CHECK_URL"]
  });
}

function createJuejinDraftCapability(): RuntimeCapability {
  return createCapability({
    key: "juejin_draft",
    label: "掘金草稿",
    purpose: "通过掘金创作接口创建文章草稿，不自动发布",
    requiredEnv: ["JUEJIN_COOKIE", "JUEJIN_TAG_IDS"],
    optionalEnv: [
      "JUEJIN_DRAFT_API_URL",
      "JUEJIN_DRAFT_API_QUERY",
      "JUEJIN_DRAFT_PAYLOAD_JSON",
      "JUEJIN_HEADERS_JSON",
      "JUEJIN_CATEGORY_ID",
      "JUEJIN_CSRF_TOKEN",
      "JUEJIN_UUID",
      "JUEJIN_AUTH_CHECK_URL"
    ]
  });
}

function createZhihuDraftCapability(): RuntimeCapability {
  return createCapability({
    key: "zhihu_draft",
    label: "知乎草稿",
    purpose: "通过知乎写作接口创建文章草稿，不自动发布",
    requiredEnv: ["ZHIHU_COOKIE"],
    optionalEnv: [
      "ZHIHU_DRAFT_API_URL",
      "ZHIHU_DRAFT_PAYLOAD_JSON",
      "ZHIHU_DRAFT_UPDATE_URL_TEMPLATE",
      "ZHIHU_DRAFT_UPDATE_PAYLOAD_JSON",
      "ZHIHU_DRAFT_UPDATE_METHOD",
      "ZHIHU_HEADERS_JSON",
      "ZHIHU_XSRF_TOKEN",
      "ZHIHU_AUTH_CHECK_URL"
    ]
  });
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
      purpose: "GEO 测试与内容生成",
      requiredEnv: ["DASHSCOPE_API_KEY", "QWEN_MODEL"],
      optionalEnv: ["QWEN_BASE_URL"]
    }),
    createCapability({
      key: "deepseek",
      label: "DeepSeek",
      purpose: "GEO 测试与内容生成",
      requiredEnv: ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
      optionalEnv: ["DEEPSEEK_BASE_URL"]
    }),
    createCapability({
      key: "doubao",
      label: "豆包",
      purpose: "GEO 测试",
      requiredEnv: ["DOUBAO_API_KEY", "DOUBAO_MODEL"],
      optionalEnv: ["DOUBAO_BASE_URL"]
    }),
    createCapability({
      key: "qwen_embedding",
      label: "Qwen Embedding",
      purpose: "知识库真实向量写入",
      requiredEnv: ["DASHSCOPE_API_KEY", "QWEN_EMBEDDING_MODEL"],
      optionalEnv: ["QWEN_EMBEDDING_BASE_URL", "EMBEDDING_PROVIDER_TIMEOUT_MS"]
    }),
    createCapability({
      key: "doubao_embedding",
      label: "豆包 Embedding",
      purpose: "知识库真实向量写入",
      requiredEnv: ["DOUBAO_API_KEY", "DOUBAO_EMBEDDING_MODEL"],
      optionalEnv: ["DOUBAO_EMBEDDING_BASE_URL", "EMBEDDING_PROVIDER_TIMEOUT_MS"]
    }),
    createKnowledgeUrlCrawlerCapability(),
    createXcrawlFetchCapability(),
    createKnowledgeProxyFetchCapability(),
    createWechatsyncBridgeCapability(),
    createWechatMpDraftCapability(),
    createCsdnDraftCapability(),
    createJuejinDraftCapability(),
    createZhihuDraftCapability(),
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

export function getProviderMissingEnv(platforms: string[]) {
  const providerKeys = platforms.map((platform) => {
    if (platform === "DeepSeek") return "deepseek";
    if (platform === "豆包") return "doubao";
    return "qwen";
  });

  return getMissingEnvFor(providerKeys);
}
