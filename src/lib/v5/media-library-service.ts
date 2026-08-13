import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ACTOR } from "@/lib/workspace-actor";
import {
  MEDIA_LIBRARY_MIME_TYPES,
  type MediaLibraryAsset,
  type MediaLibraryAssetRecord,
  type MediaLibraryFileInput,
  type MediaLibraryListResult,
  type MediaLibraryMimeType
} from "./media-library-contracts";
import { getFreeProductionCatalog } from "./free-production-service";
import { mediaLibraryStorageDirectory, readMediaLibraryState, updateMediaLibraryState } from "./media-library-repository";

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export class MediaLibraryServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = "MediaLibraryServiceError";
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

function mutationContext(input: { auditReason: string }, idempotencyKey: string | null) {
  const auditReason = String(input.auditReason || "").trim();
  const key = idempotencyKey?.trim() || "";
  if (!auditReason || auditReason.length > 200) throw new MediaLibraryServiceError(422, "MEDIA_AUDIT_REASON_INVALID", "请填写 200 个字符以内的操作原因。", "刷新页面后重新提交。");
  if (key.length < 8 || key.length > 200) throw new MediaLibraryServiceError(400, "MEDIA_IDEMPOTENCY_KEY_INVALID", "写请求必须携带有效的幂等键。", "刷新页面后重新提交。");
  return { auditReason, key };
}

function toView(record: MediaLibraryAssetRecord): MediaLibraryAsset {
  const { contentHash: _contentHash, storageKey: _storageKey, ...safe } = record;
  return { ...safe, contentUrl: `/api/v5/free-production/assets/${encodeURIComponent(record.id)}/content?v=${record.version}` };
}

function detectMime(data: Buffer): MediaLibraryMimeType | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

async function resolveProduct(productId: string) {
  const product = (await getFreeProductionCatalog()).products.find((item) => item.productId === productId);
  if (!product) throw new MediaLibraryServiceError(422, "MEDIA_PRODUCT_INVALID", "所选产品不存在或尚未进入生产池。", "刷新产品列表后重新选择。");
  return product;
}

function validateDescription(value: string) {
  const description = String(value || "").trim();
  if (!description || description.length > 300) throw new MediaLibraryServiceError(422, "MEDIA_DESCRIPTION_INVALID", "素材描述不能为空且不能超过 300 字。", "说明素材内容、适用场景或推荐位置后重试。");
  return description;
}

function validateFile(file: MediaLibraryFileInput) {
  if (!MEDIA_LIBRARY_MIME_TYPES.includes(file.mimeType as MediaLibraryMimeType)) throw new MediaLibraryServiceError(422, "MEDIA_FILE_TYPE_INVALID", "仅支持 JPG、PNG、WebP 和 GIF。", "选择支持的图片或动图后重试。");
  let data: Buffer;
  try { data = Buffer.from(file.dataBase64, "base64"); } catch { data = Buffer.alloc(0); }
  if (!data.length || data.length > MAX_MEDIA_BYTES) throw new MediaLibraryServiceError(422, "MEDIA_FILE_SIZE_INVALID", "素材文件必须大于 0 且不超过 5 MB。", "压缩素材后重试。");
  const detectedMime = detectMime(data);
  if (!detectedMime || detectedMime !== file.mimeType) throw new MediaLibraryServiceError(422, "MEDIA_FILE_SIGNATURE_INVALID", "文件内容与声明格式不一致。", "重新导出图片或动图后再上传。");
  const originalFileName = path.basename(String(file.fileName || "未命名素材")).slice(0, 160);
  return { data, mimeType: detectedMime, originalFileName };
}

export async function listMediaLibraryAssets(filters: { productId?: string; mediaKind?: string; query?: string } = {}): Promise<MediaLibraryListResult> {
  const query = String(filters.query || "").trim().toLocaleLowerCase("zh-CN");
  const state = await readMediaLibraryState();
  const items = Object.values(state.assets)
    .filter((item) => item.status === "active")
    .filter((item) => !filters.productId || item.productId === filters.productId)
    .filter((item) => !filters.mediaKind || item.mediaKind === filters.mediaKind)
    .filter((item) => !query || `${item.description} ${item.originalFileName} ${item.productNameSnapshot}`.toLocaleLowerCase("zh-CN").includes(query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(toView);
  return { items, total: items.length };
}

export async function createMediaLibraryAsset(input: { expectedVersion: number; auditReason: string; productId: string; description: string; file: MediaLibraryFileInput }, idempotencyKey: string | null) {
  if (input.expectedVersion !== 0) throw new MediaLibraryServiceError(409, "MEDIA_CREATE_VERSION_INVALID", "新建素材的 expectedVersion 必须为 0。", "刷新素材图库后重试。");
  const context = mutationContext(input, idempotencyKey);
  const product = await resolveProduct(String(input.productId || ""));
  const description = validateDescription(input.description);
  const file = validateFile(input.file);
  const requestHash = hash({ productId: product.productId, description, fileName: file.originalFileName, mimeType: file.mimeType, contentHash: hash(file.data) });
  const existingReplay = (await readMediaLibraryState()).idempotency[context.key];
  if (existingReplay) {
    if (existingReplay.requestHash !== requestHash) throw new MediaLibraryServiceError(409, "MEDIA_IDEMPOTENCY_CONFLICT", "同一操作标识已用于不同请求。", "刷新页面后重新上传。");
    return existingReplay.response as MediaLibraryAsset;
  }
  const duplicate = Object.values((await readMediaLibraryState()).assets).find((item) => item.status === "active" && item.productId === product.productId && item.contentHash === hash(file.data));
  if (duplicate) throw new MediaLibraryServiceError(409, "MEDIA_DUPLICATE", "该产品下已经存在相同素材。", "直接修改已有素材的描述，或选择其他文件。", [duplicate.description]);
  const id = `media-asset-${randomUUID()}`;
  await mkdir(mediaLibraryStorageDirectory(), { recursive: true });
  await writeFile(path.join(mediaLibraryStorageDirectory(), id), file.data, { flag: "wx" });
  return updateMediaLibraryState((state) => {
    const replay = state.idempotency[context.key];
    if (replay) {
      if (replay.requestHash !== requestHash) throw new MediaLibraryServiceError(409, "MEDIA_IDEMPOTENCY_CONFLICT", "同一操作标识已用于不同请求。", "刷新页面后重新上传。");
      return replay.response as MediaLibraryAsset;
    }
    const duplicate = Object.values(state.assets).find((item) => item.status === "active" && item.productId === product.productId && item.contentHash === hash(file.data));
    if (duplicate) throw new MediaLibraryServiceError(409, "MEDIA_DUPLICATE", "该产品下已经存在相同素材。", "直接修改已有素材的描述，或选择其他文件。", [duplicate.description]);
    const now = new Date().toISOString();
    const actorId = WORKSPACE_ACTOR.actorId;
    const record: MediaLibraryAssetRecord = {
      id,
      productId: product.productId,
      productNameSnapshot: product.name,
      description,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      mediaKind: file.mimeType === "image/gif" ? "animated_image" : "image",
      byteSize: file.data.length,
      contentHash: hash(file.data),
      storageKey: id,
      status: "active",
      createdBy: actorId,
      createdAt: now,
      updatedBy: actorId,
      updatedAt: now,
      version: 1
    };
    state.assets[id] = record;
    const response = toView(record);
    state.idempotency[context.key] = { requestHash, response, createdAt: now };
    state.audits.push({ auditId: randomUUID(), action: "media_asset_created", objectId: id, actor: actorId, auditReason: context.auditReason, createdAt: now, summary: { productId: product.productId, mimeType: file.mimeType, byteSize: file.data.length } });
    return response;
  });
}

export async function updateMediaLibraryAsset(id: string, input: { expectedVersion: number; auditReason: string; productId: string; description: string }, idempotencyKey: string | null) {
  const context = mutationContext(input, idempotencyKey);
  const product = await resolveProduct(String(input.productId || ""));
  const description = validateDescription(input.description);
  const requestHash = hash({ id, expectedVersion: input.expectedVersion, productId: product.productId, description });
  return updateMediaLibraryState((state) => {
    const replay = state.idempotency[context.key];
    if (replay) {
      if (replay.requestHash !== requestHash) throw new MediaLibraryServiceError(409, "MEDIA_IDEMPOTENCY_CONFLICT", "同一操作标识已用于不同请求。", "刷新页面后重新提交。");
      return replay.response as MediaLibraryAsset;
    }
    const record = state.assets[id];
    if (!record || record.status !== "active") throw new MediaLibraryServiceError(404, "MEDIA_ASSET_NOT_FOUND", "素材不存在或已移出图库。", "刷新素材图库后重试。");
    if (record.version !== input.expectedVersion) throw new MediaLibraryServiceError(409, "MEDIA_VERSION_CONFLICT", "素材已被更新。", "刷新后重新修改。");
    const now = new Date().toISOString();
    record.productId = product.productId;
    record.productNameSnapshot = product.name;
    record.description = description;
    record.updatedBy = WORKSPACE_ACTOR.actorId;
    record.updatedAt = now;
    record.version += 1;
    const response = toView(record);
    state.idempotency[context.key] = { requestHash, response, createdAt: now };
    state.audits.push({ auditId: randomUUID(), action: "media_asset_updated", objectId: id, actor: record.updatedBy, auditReason: context.auditReason, createdAt: now, summary: { productId: product.productId, version: record.version } });
    return response;
  });
}

export async function archiveMediaLibraryAsset(id: string, input: { expectedVersion: number; auditReason: string }, idempotencyKey: string | null) {
  const context = mutationContext(input, idempotencyKey);
  const requestHash = hash({ id, expectedVersion: input.expectedVersion });
  return updateMediaLibraryState((state) => {
    const replay = state.idempotency[context.key];
    if (replay) {
      if (replay.requestHash !== requestHash) throw new MediaLibraryServiceError(409, "MEDIA_IDEMPOTENCY_CONFLICT", "同一操作标识已用于不同请求。", "刷新页面后重新提交。");
      return replay.response as MediaLibraryAsset;
    }
    const record = state.assets[id];
    if (!record || record.status !== "active") throw new MediaLibraryServiceError(404, "MEDIA_ASSET_NOT_FOUND", "素材不存在或已移出图库。", "刷新素材图库后重试。");
    if (record.version !== input.expectedVersion) throw new MediaLibraryServiceError(409, "MEDIA_VERSION_CONFLICT", "素材已被更新。", "刷新后重新操作。");
    const now = new Date().toISOString();
    record.status = "archived";
    record.updatedBy = WORKSPACE_ACTOR.actorId;
    record.updatedAt = now;
    record.version += 1;
    const response = toView(record);
    state.idempotency[context.key] = { requestHash, response, createdAt: now };
    state.audits.push({ auditId: randomUUID(), action: "media_asset_archived", objectId: id, actor: record.updatedBy, auditReason: context.auditReason, createdAt: now, summary: { productId: record.productId, version: record.version } });
    return response;
  });
}

export async function readMediaLibraryAssetContent(id: string) {
  const record = (await readMediaLibraryState()).assets[id];
  if (!record || record.status !== "active") throw new MediaLibraryServiceError(404, "MEDIA_ASSET_NOT_FOUND", "素材不存在或已移出图库。", "刷新素材图库后重试。");
  try {
    const data = await readFile(path.join(mediaLibraryStorageDirectory(), record.storageKey));
    if (hash(data) !== record.contentHash) throw new Error("digest mismatch");
    return { data, mimeType: record.mimeType, fileName: record.originalFileName };
  } catch {
    throw new MediaLibraryServiceError(500, "MEDIA_FILE_UNAVAILABLE", "素材文件不可读取或完整性校验失败。", "重新上传该素材。");
  }
}
