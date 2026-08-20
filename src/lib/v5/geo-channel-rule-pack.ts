/**
 * GEO 渠道规则包：受治理的平台收录规则配置载体。
 *
 * 领域代码不硬编码平台域名、板块名、CTA 文案或账号策略（AGENTS.md 规则 8）。
 * 规则包由外部配置（环境变量 JSON）注入，未来切换为治理存储表 + 人工激活。
 * 规则包缺失时链路以"无平台感知"模式运行（向后兼容）；配置了但结构非法则 fail-closed。
 */

export interface GeoChannelRule {
  /** 稳定渠道标识，如 tencent_cloud_community */
  channelKey: string;
  /** 展示名，用于查询词与综合提示，如 腾讯云开发者社区 */
  displayName: string;
  /** 该平台的域名集合（小写，含主域与子域匹配） */
  domains: string[];
  /** 该平台当前在收录的内容形态描述（人工确权后固化） */
  inclusionPatterns: string[];
  /** 结构化写作要求（标题层级/表格/FAQ模块/金句块等） */
  structureRequirements: string[];
  /** FAQ 板块枚举（供问题目录 faqBoard 字段映射） */
  faqBoards?: string[];
  /** 选型对比维度（供竞品/替代格局按维度标注证据） */
  comparisonDimensions?: string[];
  /** CTA 变体引用 ID（文案本体在治理存储，不内联进规则包） */
  ctaVariantRefs?: string[];
  /** 发布账号策略描述 */
  authorAccountPolicy?: string;
  /** 支撑该渠道规则的证据候选（来自调研，人工确认后回填） */
  evidenceCandidateIds?: string[];
}

export interface GeoChannelRulePack {
  rulePackVersionId: string;
  /** 人工激活记录（Agent 不能激活规则包） */
  activatedBy?: string;
  activatedAt?: string;
  channels: GeoChannelRule[];
}

function parseChannelRulePack(raw: string): GeoChannelRulePack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GEO_CHANNEL_RULE_PACK_JSON 不是合法 JSON");
  }
  const pack = parsed as GeoChannelRulePack;
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.channels) || !pack.channels.length) {
    throw new Error("GEO_CHANNEL_RULE_PACK_JSON 缺少非空 channels 数组");
  }
  if (typeof pack.rulePackVersionId !== "string" || !pack.rulePackVersionId.trim()) {
    throw new Error("GEO_CHANNEL_RULE_PACK_JSON 缺少 rulePackVersionId");
  }
  if (typeof pack.activatedBy !== "string" || !pack.activatedBy.trim()) {
    throw new Error("GEO_CHANNEL_RULE_PACK_JSON 缺少人工激活人 activatedBy");
  }
  if (typeof pack.activatedAt !== "string" || !pack.activatedAt.trim() || Number.isNaN(Date.parse(pack.activatedAt))) {
    throw new Error("GEO_CHANNEL_RULE_PACK_JSON 缺少合法的人工激活时间 activatedAt");
  }
  const seenKeys = new Set<string>();
  for (const channel of pack.channels) {
    if (!channel || typeof channel !== "object") throw new Error("渠道规则必须是对象");
    const { channelKey, displayName, domains, inclusionPatterns, structureRequirements } = channel;
    if (typeof channelKey !== "string" || !/^[a-z0-9_]{2,64}$/.test(channelKey)) {
      throw new Error(`渠道 channelKey 非法：${String(channelKey)}`);
    }
    if (seenKeys.has(channelKey)) throw new Error(`渠道 channelKey 重复：${channelKey}`);
    seenKeys.add(channelKey);
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new Error(`渠道 ${channelKey} 缺少 displayName`);
    }
    if (!Array.isArray(domains) || !domains.length || domains.some((item) => typeof item !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(item.trim()))) {
      throw new Error(`渠道 ${channelKey} 的 domains 必须是非空合法域名数组`);
    }
    if (!Array.isArray(inclusionPatterns) || !Array.isArray(structureRequirements)) {
      throw new Error(`渠道 ${channelKey} 缺少 inclusionPatterns/structureRequirements`);
    }
  }
  return {
    rulePackVersionId: pack.rulePackVersionId,
    activatedBy: typeof pack.activatedBy === "string" ? pack.activatedBy : undefined,
    activatedAt: typeof pack.activatedAt === "string" ? pack.activatedAt : undefined,
    channels: pack.channels
  };
}

let cachedPack: { envValue: string | undefined; pack?: GeoChannelRulePack } | undefined;

/**
 * 读取当前激活的渠道规则包。
 * - 未配置环境变量：返回 undefined（无平台感知模式，向后兼容）；
 * - 配置但非法：抛错（fail-closed，配置坏了不能静默降级）。
 */
export function getActiveGeoChannelRulePack(): GeoChannelRulePack | undefined {
  const envValue = process.env.GEO_CHANNEL_RULE_PACK_JSON?.trim();
  if (!envValue) return undefined;
  if (cachedPack?.envValue === envValue) return cachedPack.pack;
  const pack = parseChannelRulePack(envValue);
  cachedPack = { envValue, pack };
  return pack;
}

/** 按主机名匹配渠道；主域与子域均命中（host === domain || host.endsWith(`.${domain}`)） */
export function matchChannelForHost(
  hostname: string,
  pack: GeoChannelRulePack | undefined
): GeoChannelRule | undefined {
  if (!pack) return undefined;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return pack.channels.find((channel) =>
    channel.domains.some((domain) => {
      const normalized = domain.toLowerCase();
      return host === normalized || host.endsWith(`.${normalized}`);
    })
  );
}

/** 汇总规则包内的全部 FAQ 板块（无规则包或渠道未配置时返回空数组） */
export function listChannelFaqBoards(pack: GeoChannelRulePack | undefined): string[] {
  if (!pack) return [];
  return [...new Set(pack.channels.flatMap((channel) => channel.faqBoards || []))];
}

/** 汇总规则包内的全部选型对比维度 */
export function listChannelComparisonDimensions(pack: GeoChannelRulePack | undefined): string[] {
  if (!pack) return [];
  return [...new Set(pack.channels.flatMap((channel) => channel.comparisonDimensions || []))];
}

/** 自有渠道（发布/测量面），不属于第三方平台收录规则包治理范围 */
export const GEO_OWNED_CHANNEL_KEYS = new Set(["wechat", "official_website", "ai_frontend"]);

/**
 * M9 就绪检查：targetChannels 中声明的第三方平台渠道必须被已激活的规则包覆盖（fail-closed）。
 * 返回 undefined = 通过；返回字符串 = blocked 原因。
 */
export function evaluateTargetChannelRuleCoverage(input: {
  targetChannels: string[];
  pack: GeoChannelRulePack | undefined;
  packError?: unknown;
}): string | undefined {
  const platformChannels = input.targetChannels.filter((channelKey) => !GEO_OWNED_CHANNEL_KEYS.has(channelKey));
  if (!platformChannels.length) return undefined;
  if (input.packError) {
    return `渠道规则包配置非法：${input.packError instanceof Error ? input.packError.message : "解析失败"}。`;
  }
  if (!input.pack) {
    return `研究边界声明了第三方平台渠道（${platformChannels.join("、")}），但尚未激活渠道规则包（GEO_CHANNEL_RULE_PACK_JSON）。`;
  }
  if (!input.pack.activatedBy?.trim() || !input.pack.activatedAt || Number.isNaN(Date.parse(input.pack.activatedAt))) {
    return `渠道规则包 ${input.pack.rulePackVersionId} 尚无有效人工激活记录（activatedBy/activatedAt）。`;
  }
  const packKeys = new Set(input.pack.channels.map((channel) => channel.channelKey));
  const missingChannels = platformChannels.filter((channelKey) => !packKeys.has(channelKey));
  if (missingChannels.length) {
    return `目标平台渠道未包含在已激活的渠道规则包中：${missingChannels.join("、")}（规则包 ${input.pack.rulePackVersionId}）。`;
  }
  return undefined;
}
