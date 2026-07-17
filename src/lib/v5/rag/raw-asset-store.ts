import { readFile } from "node:fs/promises";
import path from "node:path";
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
