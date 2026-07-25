import { createHash } from "node:crypto";
import type { DirectPublishPlatformKey } from "./types";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashDirectPublishContent(title: string, markdown: string) {
  const normalizedTitle = title.trim();
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n").trim();
  return sha256(`${normalizedTitle}\n\u0000\n${normalizedMarkdown}`);
}

export function buildPublishIdempotencyKey(scheduleId: string, platform: DirectPublishPlatformKey, contentHash: string) {
  return sha256(`${scheduleId}:${platform}:${contentHash}`);
}

export function isValidPublishIdempotencyKey(
  idempotencyKey: string,
  scheduleId: string,
  platform: DirectPublishPlatformKey,
  contentHash: string
) {
  return idempotencyKey === buildPublishIdempotencyKey(scheduleId, platform, contentHash);
}
