import { parseCsv, readNumber, readTextInput } from "./import-utils";
import type { PublishRecord } from "./types";

export interface ChannelMetrics {
  impressions?: number;
  views?: number;
  likes?: number;
  favorites?: number;
  comments?: number;
  shares?: number;
  importedAt: string;
}

export interface ChannelMetricImportTable {
  fileName?: string;
  sheetName?: string;
  csv: string;
}

interface NormalizedChannelMetricRow {
  publishRecordId?: string;
  recordId?: string;
  draftId?: string;
  channel?: string;
  title?: string;
  publishedUrl?: string;
  metricDate?: string;
  periodStart?: string;
  periodEnd?: string;
  impressions?: number;
  views?: number;
  likes?: number;
  favorites?: number;
  comments?: number;
  shares?: number;
  sourceFile?: string;
  sourceSheet?: string;
}

export interface ChannelMetricImportResult {
  ok: boolean;
  status: "success" | "pending_input" | "failed";
  message: string;
  records?: PublishRecord[];
  matched?: number;
  unmatched?: number;
  importedRows?: number;
  normalizedRows?: NormalizedChannelMetricRow[];
}

const fieldAliases = {
  publishRecordId: ["publishRecordId", "发布记录ID", "发布记录 Id", "记录ID", "recordId"],
  recordId: ["recordId", "记录ID"],
  draftId: ["draftId", "草稿ID"],
  channel: ["channel", "渠道", "平台", "来源平台", "sourcePlatform"],
  title: ["title", "标题", "文章标题", "内容标题", "篇名"],
  publishedUrl: ["publishedUrl", "url", "URL", "链接", "发布链接", "文章链接", "原文链接"],
  metricDate: ["metricDate", "date", "日期", "数据日期"],
  periodStart: ["periodStart", "开始日期"],
  periodEnd: ["periodEnd", "结束日期"],
  impressions: ["impressions", "exposures", "曝光", "曝光量", "展现", "展现数", "展示", "展示量", "文章展现数"],
  views: ["views", "reads", "pv", "阅读", "阅读数", "浏览", "浏览量", "访问量", "文章阅读数"],
  likes: ["likes", "like", "点赞", "点赞数", "赞", "赞同", "喜欢", "文章点赞数"],
  favorites: ["favorites", "collects", "collections", "收藏", "收藏数", "文章收藏数"],
  comments: ["comments", "comment", "评论", "评论数", "文章评论数"],
  shares: ["shares", "share", "分享", "分享数", "转发", "转发数"]
} satisfies Record<string, string[]>;

function normalizeKey(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\/\\（）()：:]/g, "");
}

function readCell(row: Record<string, string>, aliases: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));

  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));

    if (value !== undefined && value !== "") {
      return value.trim();
    }
  }

  return undefined;
}

function readMetric(row: Record<string, string>, aliases: string[]) {
  const value = readCell(row, aliases);

  if (!value) {
    return undefined;
  }

  const parsed = readNumber(value);
  return parsed === undefined ? undefined : parsed;
}

function normalizeComparable(value?: string) {
  return value?.trim().toLowerCase().replace(/\s+/g, "") || "";
}

function normalizeUrl(value?: string) {
  return value?.trim().replace(/\/$/, "") || "";
}

function normalizeRow(row: Record<string, string>, source?: { fileName?: string; sheetName?: string }): NormalizedChannelMetricRow {
  return {
    publishRecordId: readCell(row, fieldAliases.publishRecordId),
    recordId: readCell(row, fieldAliases.recordId),
    draftId: readCell(row, fieldAliases.draftId),
    channel: readCell(row, fieldAliases.channel),
    title: readCell(row, fieldAliases.title),
    publishedUrl: readCell(row, fieldAliases.publishedUrl),
    metricDate: readCell(row, fieldAliases.metricDate),
    periodStart: readCell(row, fieldAliases.periodStart),
    periodEnd: readCell(row, fieldAliases.periodEnd),
    impressions: readMetric(row, fieldAliases.impressions),
    views: readMetric(row, fieldAliases.views),
    likes: readMetric(row, fieldAliases.likes),
    favorites: readMetric(row, fieldAliases.favorites),
    comments: readMetric(row, fieldAliases.comments),
    shares: readMetric(row, fieldAliases.shares),
    sourceFile: source?.fileName,
    sourceSheet: source?.sheetName
  };
}

function readTables(input: Record<string, unknown>) {
  if (Array.isArray(input.tables)) {
    return input.tables
      .filter((item): item is ChannelMetricImportTable => Boolean(item) && typeof item === "object" && typeof (item as ChannelMetricImportTable).csv === "string")
      .filter((item) => item.csv.trim());
  }

  const textInput = readTextInput(input, ["csv", "text"]);

  if (!textInput.ok || !textInput.text) {
    return textInput;
  }

  return [
    {
      fileName: textInput.fileName,
      csv: textInput.text
    }
  ];
}

export function importChannelMetrics(input: Record<string, unknown>, records: PublishRecord[]): ChannelMetricImportResult {
  const tables = readTables(input);

  if (!Array.isArray(tables)) {
    return {
      ok: false,
      status: tables.status,
      message: tables.message || "请提供渠道数据 CSV 文本、上传文件，或允许目录内的 filePath。"
    };
  }

  const rows = tables.flatMap((table) => parseCsv(table.csv).map((row) => normalizeRow(row, table)));
  let matched = 0;
  let unmatched = 0;
  const importedAt = new Date().toISOString();
  const nextRecords = records.map((record) => {
    const row = rows.find(
      (item) =>
        item.publishRecordId === record.id ||
        item.recordId === record.id ||
        item.draftId === record.draftId ||
        (item.publishedUrl && record.publishedUrl && normalizeUrl(item.publishedUrl) === normalizeUrl(record.publishedUrl)) ||
        (item.title && normalizeComparable(item.title) === normalizeComparable(record.title))
    );

    if (!row) {
      unmatched += 1;
      return record;
    }

    matched += 1;

    return {
      ...record,
      channelMetrics: {
        impressions: row.impressions,
        views: row.views,
        likes: row.likes,
        favorites: row.favorites,
        comments: row.comments,
        shares: row.shares,
        importedAt
      }
    };
  });

  return {
    ok: true,
    status: "success",
    message: `渠道数据导入完成：读取 ${rows.length} 行，匹配 ${matched} 条，未匹配 ${unmatched} 条。`,
    records: nextRecords,
    matched,
    unmatched,
    importedRows: rows.length,
    normalizedRows: rows
  };
}
