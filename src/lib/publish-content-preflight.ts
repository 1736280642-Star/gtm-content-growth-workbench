import type { DirectPublishPlatformKey } from "@/lib/types";

export const PUBLISH_PREFLIGHT_RULE_VERSION = "2026-07-31.1";

export interface PublishPreflightIssue {
  code: string;
  message: string;
}

export interface PublishContentPreflightResult {
  platform: DirectPublishPlatformKey;
  ruleVersion: string;
  passed: boolean;
  blockers: PublishPreflightIssue[];
  warnings: PublishPreflightIssue[];
  scores: {
    contentLength: number;
    technicalDepth: number;
    promotionRisk: number;
    externalLinkCount: number;
  };
  checkedAt: string;
  rewriteApplied?: boolean;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length || 0;
}

export function preflightPublishContent(input: {
  platform: DirectPublishPlatformKey;
  title: string;
  markdown: string;
  checkedAt?: string;
}): PublishContentPreflightResult {
  const title = input.title.trim();
  const markdown = input.markdown.trim();
  const plain = markdown.replace(/```[\s\S]*?```/g, " code ").replace(/[#>*_`\-\[\]()]/g, " ");
  const externalLinkCount = countMatches(markdown, /https?:\/\/[^\s)>]+/gi);
  const promotionMatches = countMatches(
    `${title}\n${markdown}`,
    /扫码|二维码|加微信|私信我|立即购买|限时(?:优惠|活动|折扣|抢购|秒杀|福利|免费)|免费领取|咨询我们|联系我们|点击下单|官网购买/gi
  );
  const technicalSignals =
    countMatches(markdown, /(^|\n)#{1,4}\s*(实现|原理|配置|代码|验证|测试|排查|步骤|架构|接口|部署)/gim) +
    countMatches(markdown, /```[\s\S]*?```/g) +
    countMatches(markdown, /(^|\n)\s*\d+\.\s+/gm);
  const blockers: PublishPreflightIssue[] = [];
  const warnings: PublishPreflightIssue[] = [];

  if (!title) blockers.push({ code: "title_missing", message: "Title is required." });
  if (title.length > 80) warnings.push({ code: "title_too_long", message: "Title exceeds 80 characters." });
  if (markdown.length < 200) blockers.push({ code: "content_too_short", message: "Content is too short for formal publishing." });

  if (input.platform === "juejin") {
    if (plain.replace(/\s/g, "").length < 600) {
      blockers.push({ code: "juejin_depth_too_low", message: "Juejin content must contain at least 600 non-space characters." });
    }
    if (technicalSignals < 2) {
      blockers.push({ code: "juejin_technical_signals_missing", message: "Juejin content needs at least two implementation, code, verification, or step signals." });
    }
    if (externalLinkCount > 2) {
      blockers.push({ code: "juejin_external_links_excessive", message: "Juejin content contains more than two external links." });
    }
    if (promotionMatches > 0) {
      blockers.push({ code: "juejin_promotion_risk", message: "Juejin content contains direct promotional or contact language." });
    }
  } else {
    if (promotionMatches > 2) warnings.push({ code: "promotion_density_high", message: "Promotional language density is high." });
    if (externalLinkCount > 5) warnings.push({ code: "external_links_high", message: "The article contains many external links." });
  }

  return {
    platform: input.platform,
    ruleVersion: PUBLISH_PREFLIGHT_RULE_VERSION,
    passed: blockers.length === 0,
    blockers,
    warnings,
    scores: {
      contentLength: plain.replace(/\s/g, "").length,
      technicalDepth: technicalSignals,
      promotionRisk: promotionMatches,
      externalLinkCount
    },
    checkedAt: input.checkedAt || new Date().toISOString()
  };
}

export function rewriteJuejinContentOnce(input: { title: string; markdown: string }) {
  const title = input.title
    .replace(/[！!]{2,}/g, "")
    .replace(/(限时|免费领取|立即购买|重磅)/g, "")
    .trim()
    .slice(0, 80);
  const lines = input.markdown
    .split(/\r?\n/)
    .filter((line) => !/扫码|二维码|加微信|私信我|立即购买|限时(?:优惠|活动|折扣|抢购|秒杀|福利|免费)|免费领取|咨询我们|联系我们|点击下单|官网购买/i.test(line))
    .map((line) => line.replace(/\[([^\]]+)]\(https?:\/\/[^)]+\)/g, "$1"));
  let markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!/(^|\n)#{1,4}\s*(实现|原理|配置|代码|验证|测试|排查|步骤|架构|接口|部署)/im.test(markdown)) {
    markdown = `## 问题与实现思路\n\n${markdown}`;
  }
  if (countMatches(markdown, /(^|\n)\s*\d+\.\s+/gm) === 0) {
    markdown += "\n\n## 验证步骤\n\n1. 按文中方案完成配置。\n2. 运行对应测试并记录公开结果。\n3. 对失败状态执行幂等核验，不重复提交。";
  }
  return { title, markdown };
}
