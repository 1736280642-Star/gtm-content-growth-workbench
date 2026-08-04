export function normalizeMarkdownBlocks(value: string) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u3000]/g, " ")
    .replace(/([^\n])[ \t]+(?=#{1,3}[ \t]+)/g, "$1\n\n")
    .replace(/([：:；;。！？!?])[ \t]+(?=[-*][ \t]+)/g, "$1\n");

  return normalized
    .split("\n")
    .flatMap((line) => {
      if (!/^[ \t]*[-*][ \t]+/.test(line)) return [line];
      const [first, ...rest] = line.split(/[ \t]+[-*][ \t]+(?=\S)/g);
      return [first, ...rest.map((item) => `- ${item}`)];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
