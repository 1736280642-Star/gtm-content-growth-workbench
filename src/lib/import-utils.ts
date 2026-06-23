import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface TextImportResult {
  ok: boolean;
  status: "success" | "pending_input" | "failed";
  text?: string;
  fileName?: string;
  message?: string;
}

function isInside(targetPath: string, rootPath: string) {
  const normalizedTarget = resolve(targetPath).toLowerCase();
  const normalizedRoot = resolve(rootPath).toLowerCase();
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}\\`) || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function getAllowedRoots() {
  const roots = [resolve(process.cwd(), "data"), resolve(process.cwd(), "imports")];

  if (process.env.IMPORT_ALLOWED_ROOT) {
    roots.push(resolve(process.env.IMPORT_ALLOWED_ROOT));
  }

  if (process.env.NGINX_ACCESS_LOG_PATH) {
    roots.push(resolve(dirname(process.env.NGINX_ACCESS_LOG_PATH)));
  }

  if (process.env.CDN_LOG_EXPORT_PATH) {
    roots.push(resolve(dirname(process.env.CDN_LOG_EXPORT_PATH)));
  }

  return roots;
}

export function readTextInput(input: Record<string, unknown>, textKeys: string[] = ["text", "csv", "raw", "rawLog"]): TextImportResult {
  for (const key of textKeys) {
    const value = input[key];

    if (typeof value === "string" && value.trim()) {
      return {
        ok: true,
        status: "success",
        text: value,
        fileName: typeof input.fileName === "string" ? input.fileName : undefined
      };
    }
  }

  const filePath = typeof input.filePath === "string" ? input.filePath : typeof input.sourcePath === "string" ? input.sourcePath : undefined;

  if (!filePath) {
    return {
      ok: false,
      status: "pending_input",
      message: "请提供文本内容、csv/raw 字段，或提供允许目录内的 filePath/sourcePath。"
    };
  }

  const resolvedPath = resolve(filePath);
  const allowed = getAllowedRoots().some((root) => isInside(resolvedPath, root));

  if (!allowed) {
    return {
      ok: false,
      status: "failed",
      message: "文件路径不在允许导入目录内。默认只允许 data/、imports/ 或显式配置的日志目录。"
    };
  }

  if (!existsSync(resolvedPath)) {
    return {
      ok: false,
      status: "failed",
      message: `文件不存在：${resolvedPath}`
    };
  }

  return {
    ok: true,
    status: "success",
    text: readFileSync(resolvedPath, "utf8"),
    fileName: basename(resolvedPath)
  };
}

export function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((item) => item.trim());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""]));
  });
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

export function readNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}
