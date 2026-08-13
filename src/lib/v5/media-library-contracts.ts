export const MEDIA_LIBRARY_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type MediaLibraryMimeType = (typeof MEDIA_LIBRARY_MIME_TYPES)[number];
export type MediaLibraryKind = "image" | "animated_image";
export type MediaLibraryStatus = "active" | "archived";

export interface MediaLibraryAssetRecord {
  id: string;
  productId: string;
  productNameSnapshot: string;
  description: string;
  originalFileName: string;
  mimeType: MediaLibraryMimeType;
  mediaKind: MediaLibraryKind;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  status: MediaLibraryStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  version: number;
}

export interface MediaLibraryAsset extends Omit<MediaLibraryAssetRecord, "contentHash" | "storageKey"> {
  contentUrl: string;
}

export interface MediaLibraryListResult {
  items: MediaLibraryAsset[];
  total: number;
}

export interface MediaLibraryAuditEvent {
  auditId: string;
  action: "media_asset_created" | "media_asset_updated" | "media_asset_archived";
  objectId: string;
  actor: string;
  auditReason: string;
  createdAt: string;
  summary: Record<string, unknown>;
}

export interface MediaLibraryFileInput {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}
