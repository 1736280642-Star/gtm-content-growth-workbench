import { parseCsv, readTextInput } from "./import-utils";
import type { BotVisitSummary, DataConfidence } from "./types";

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function identifyBot(userAgent: string) {
  const lower = userAgent.toLowerCase();

  if (lower.includes("gptbot")) return "GPTBot";
  if (lower.includes("claudebot")) return "ClaudeBot";
  if (lower.includes("perplexity")) return "PerplexityBot";
  if (lower.includes("google-extended")) return "Google-Extended";
  if (lower.includes("bytespider")) return "ByteSpider";
  if (lower.includes("bot") || lower.includes("spider") || lower.includes("crawler")) return "OtherBot";

  return undefined;
}

function readRowValue(row: Record<string, string>, keys: string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [
      key
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_\-]/g, ""),
      value
    ])
  );

  for (const key of keys) {
    const value = normalized.get(key.toLowerCase().replace(/[\s_\-]/g, ""));

    if (value) {
      return value;
    }
  }

  return "";
}

function parseNginxAccessLog(text: string) {
  const linePattern = /"([A-Z]+)\s+([^"\s]+)[^"]*"\s+(\d{3})\s+\S+\s+"[^"]*"\s+"([^"]*)"/;

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(linePattern);
      return {
        method: match?.[1] || "",
        path: match?.[2] || "/",
        status_code: match?.[3] || "",
        user_agent: match?.[4] || ""
      };
    });
}

function groupBotVisits(rows: Record<string, string>[], confidence: DataConfidence) {
  const grouped = new Map<string, BotVisitSummary>();
  const summaryDate = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    const userAgent = readRowValue(row, ["user_agent", "userAgent", "ua", "user-agent", "http_user_agent", "cs_user_agent"]);
    const botName = identifyBot(userAgent);
    const path = readRowValue(row, ["path", "request_path", "requestUri", "request_uri", "uri", "url", "cs_uri_stem", "request"]) || "/";

    if (!botName) {
      continue;
    }

    const key = `${path}::${botName}`;
    const current = grouped.get(key);
    grouped.set(key, {
      id: current?.id || createId("bot"),
      path,
      botName,
      pv: (current?.pv || 0) + 1,
      dataConfidence: confidence,
      summaryDate
    });
  }

  return Array.from(grouped.values());
}

export function parseBotLogInput(input: Record<string, unknown>) {
  const textInput = readTextInput(input, ["csv", "rawLog", "raw", "text"]);

  if (!textInput.ok || !textInput.text) {
    return {
      ok: false,
      status: textInput.status,
      message: textInput.message || "请提供 CSV、Nginx/CDN 原始日志文本，或允许目录内的 filePath。"
    } as const;
  }

  const sourceType = typeof input.sourceType === "string" ? input.sourceType : textInput.fileName?.endsWith(".log") ? "nginx_log" : "csv_import";
  const confidence: DataConfidence = sourceType === "demo_csv" ? "demo" : "imported";
  const looksLikeCsv = /(^|,)(user_agent|userAgent|ua|User-Agent|request_uri|requestUri|path|uri|url)(,|\r?\n)/i.test(textInput.text);
  const rows = looksLikeCsv ? parseCsv(textInput.text) : parseNginxAccessLog(textInput.text);
  const summaries = groupBotVisits(rows, confidence);

  return {
    ok: true,
    status: "success",
    message: `已解析 ${rows.length} 行日志，生成 ${summaries.length} 条 AI Bot 汇总。`,
    summaries,
    rows,
    sourceType,
    dataConfidence: confidence
  } as const;
}
