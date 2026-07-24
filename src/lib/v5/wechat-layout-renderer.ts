import type { WechatLayoutTemplateId } from "./wechat-presentation-contracts";

interface Theme {
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  headingStyle: "bar" | "number" | "line" | "plain";
  radius: number;
}

const themes: Record<WechatLayoutTemplateId, Theme> = {
  "official-command": { accent: "#0b708a", accentSoft: "#e7f0f3", text: "#18303d", muted: "#526671", headingStyle: "bar", radius: 4 },
  "official-blueprint": { accent: "#075987", accentSoft: "#e5f1f7", text: "#123652", muted: "#526b7d", headingStyle: "number", radius: 4 },
  "official-cobalt": { accent: "#155e75", accentSoft: "#ecfeff", text: "#172033", muted: "#526071", headingStyle: "line", radius: 2 },
  "official-graphite": { accent: "#374151", accentSoft: "#f3f4f6", text: "#111827", muted: "#5b6472", headingStyle: "bar", radius: 2 },
  "natural-fieldnotes": { accent: "#a34e3d", accentSoft: "#f6f1ee", text: "#35434c", muted: "#63727b", headingStyle: "plain", radius: 2 },
  "natural-notebook": { accent: "#b45309", accentSoft: "#fffbeb", text: "#292524", muted: "#6b625d", headingStyle: "line", radius: 6 },
  "natural-column": { accent: "#3157c8", accentSoft: "#eef1fa", text: "#202b45", muted: "#66708a", headingStyle: "number", radius: 2 },
  "natural-calm": { accent: "#4f8068", accentSoft: "#edf4ef", text: "#34473e", muted: "#6c8175", headingStyle: "plain", radius: 6 }
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(value: string) {
  const url = value.trim();
  return /^https:\/\//i.test(url) ? escapeHtml(url) : undefined;
}

function inlineMarkdown(value: string, theme: Theme) {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  };
  let output = value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) => {
      const src = safeUrl(url);
      return src
        ? stash(`<img src="${src}" alt="${escapeHtml(alt)}" style="display:block;width:100%;height:auto;margin:24px auto 8px;border-radius:${theme.radius}px;" />`)
        : escapeHtml(alt);
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
      const href = safeUrl(url);
      return href ? stash(`<a href="${href}" style="color:${theme.accent};text-decoration:underline;">${escapeHtml(label)}</a>`) : escapeHtml(label);
    });
  output = escapeHtml(output)
    .replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${theme.text};font-weight:700;">$1</strong>`)
    .replace(/`([^`]+)`/g, `<code style="padding:2px 5px;background:${theme.accentSoft};color:${theme.accent};border-radius:3px;font-size:14px;">$1</code>`);
  return output.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] || "");
}

function headingHtml(text: string, level: number, index: number, theme: Theme) {
  const base = `margin:${level === 2 ? 34 : 24}px 0 14px;color:${theme.text};font-size:${level === 2 ? 21 : 18}px;line-height:1.45;font-weight:700;letter-spacing:0;`;
  if (theme.headingStyle === "bar") return `<h${level} style="${base}padding-left:12px;border-left:4px solid ${theme.accent};">${text}</h${level}>`;
  if (theme.headingStyle === "line") return `<h${level} style="${base}padding-bottom:9px;border-bottom:1px solid ${theme.accent};">${text}</h${level}>`;
  if (theme.headingStyle === "number") return `<h${level} style="${base}"><span style="display:inline-block;margin-right:8px;color:${theme.accent};font-size:14px;">${String(index).padStart(2, "0")}</span>${text}</h${level}>`;
  return `<h${level} style="${base}color:${theme.accent};">${text}</h${level}>`;
}

export function renderWechatHtml(input: { title: string; markdown: string; templateId: WechatLayoutTemplateId }) {
  const theme = themes[input.templateId];
  const lines = input.markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let headingIndex = 0;
  let quoteLines: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listOrdered ? "ol" : "ul";
    blocks.push(`<${tag} style="margin:16px 0;padding-left:24px;color:${theme.text};font-size:16px;line-height:1.85;">${listItems.map((item) => `<li style="margin:6px 0;">${item}</li>`).join("")}</${tag}>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    blocks.push(`<blockquote style="margin:20px 0;padding:14px 16px;background:${theme.accentSoft};border-left:3px solid ${theme.accent};color:${theme.muted};font-size:15px;line-height:1.8;">${quoteLines.join("<br />")}</blockquote>`);
    quoteLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushList(); flushQuote(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushList(); flushQuote(); headingIndex += 1;
      if (heading[1].length === 1 && heading[2].trim() === input.title.trim()) continue;
      blocks.push(headingHtml(inlineMarkdown(heading[2], theme), heading[1].length <= 2 ? 2 : 3, headingIndex, theme));
      continue;
    }
    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) { flushList(); quoteLines.push(inlineMarkdown(quote[1], theme)); continue; }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushQuote();
      const nextOrdered = Boolean(ordered);
      if (listItems.length && nextOrdered !== listOrdered) flushList();
      listOrdered = nextOrdered;
      listItems.push(inlineMarkdown((ordered || unordered)![1], theme));
      continue;
    }
    flushList(); flushQuote();
    if (/^---+$/.test(line)) {
      blocks.push(`<hr style="margin:28px 0;border:0;border-top:1px solid #d8dee7;" />`);
    } else {
      blocks.push(`<p style="margin:0 0 16px;color:${theme.text};font-size:16px;line-height:1.9;text-align:justify;letter-spacing:0;">${inlineMarkdown(line, theme)}</p>`);
    }
  }
  flushList(); flushQuote();

  return `<section data-wechat-layout="${input.templateId}" style="max-width:677px;margin:0 auto;padding:20px 16px;background:#ffffff;box-sizing:border-box;">
  <header style="margin:0 0 30px;padding:0 0 18px;border-bottom:2px solid ${theme.accent};">
    <h1 style="margin:0;color:${theme.text};font-size:25px;line-height:1.45;font-weight:700;letter-spacing:0;">${escapeHtml(input.title)}</h1>
  </header>
  ${blocks.join("\n  ")}
</section>`;
}
