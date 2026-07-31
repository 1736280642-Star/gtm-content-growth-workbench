import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { getV5GovernancePool } from "../knowledge-governance-repository";
import { parseManagedNormalizedTextRef } from "./managed-content-reference";
import { ragSourceRegistry } from "./source-registry";

export interface RagRawAssetStore {
  readNormalizedText(reference: string): Promise<string>;
}

export class LocalRagRawAssetStore implements RagRawAssetStore {
  private readonly roots = ragSourceRegistry.map((entry) => path.resolve(entry.rootPath).toLowerCase());

  async readNormalizedText(reference: string) {
    const resolved = path.resolve(reference);
    const normalized = resolved.toLowerCase();
    if (!this.roots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
      throw new Error("normalizedTextRef 不属于已登记的四个知识来源根目录。");
    }
    if (!/\.md$/i.test(resolved)) throw new Error("生产文本索引只接受规范 Markdown。" );
    return readFile(resolved, "utf8");
  }
}

export class ManagedRagRawAssetStore implements RagRawAssetStore {
  async readNormalizedText(reference: string) {
    const sourceRevisionId = parseManagedNormalizedTextRef(reference);
    if (!sourceRevisionId) throw new Error("The normalizedTextRef is not a managed MySQL reference.");
    const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      "SELECT normalized_text FROM source_revision_content WHERE source_revision_id = ? LIMIT 1",
      [sourceRevisionId]
    );
    if (!rows[0]) throw new Error(`Managed content for SourceRevision ${sourceRevisionId} does not exist.`);
    return String(rows[0].normalized_text);
  }
}

export class DefaultRagRawAssetStore implements RagRawAssetStore {
  private readonly managed = new ManagedRagRawAssetStore();
  private readonly legacy = new LocalRagRawAssetStore();

  readNormalizedText(reference: string) {
    return parseManagedNormalizedTextRef(reference)
      ? this.managed.readNormalizedText(reference)
      : this.legacy.readNormalizedText(reference);
  }
}
