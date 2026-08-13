import { JOTO_OFFICIAL_WECHAT_TEMPLATE_ID, renderJotoOfficialWechatHtml } from "./joto-wechat-layout-renderer";
import type { WechatLayoutTemplateId, WechatRenderableTemplateId } from "./wechat-presentation-contracts";

interface Theme {
  accent: string;
  accentSoft: string;
  surface: string;
  text: string;
  muted: string;
  headerStyle: "command" | "blueprint" | "cobalt" | "editorial" | "fieldnotes" | "notebook" | "column" | "calm";
  headingStyle: "bar" | "number-card" | "band" | "editorial" | "note" | "tab" | "column" | "calm";
  bodyFont: string;
  radius: number;
}

const themes: Record<WechatLayoutTemplateId, Theme> = {
  "official-command": { accent: "#0b708a", accentSoft: "#e7f0f3", surface: "#ffffff", text: "#18303d", muted: "#526671", headerStyle: "command", headingStyle: "bar", bodyFont: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", radius: 4 },
  "official-blueprint": { accent: "#075987", accentSoft: "#e5f1f7", surface: "#f8fcff", text: "#123652", muted: "#526b7d", headerStyle: "blueprint", headingStyle: "number-card", bodyFont: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", radius: 4 },
  "official-cobalt": { accent: "#1554a3", accentSoft: "#edf4ff", surface: "#ffffff", text: "#172033", muted: "#526071", headerStyle: "cobalt", headingStyle: "band", bodyFont: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", radius: 2 },
  "official-graphite": { accent: "#30343b", accentSoft: "#f1f2f4", surface: "#ffffff", text: "#15171a", muted: "#656b73", headerStyle: "editorial", headingStyle: "editorial", bodyFont: "'Songti SC','STSong','Noto Serif CJK SC',serif", radius: 0 },
  "natural-fieldnotes": { accent: "#9a4f3d", accentSoft: "#f7eee8", surface: "#fffdf9", text: "#3f403c", muted: "#77736b", headerStyle: "fieldnotes", headingStyle: "note", bodyFont: "'Songti SC','STSong','Noto Serif CJK SC',serif", radius: 2 },
  "natural-notebook": { accent: "#a46321", accentSoft: "#fff4da", surface: "#fffdf6", text: "#342f29", muted: "#756b60", headerStyle: "notebook", headingStyle: "tab", bodyFont: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", radius: 6 },
  "natural-column": { accent: "#3157c8", accentSoft: "#eef1fa", surface: "#ffffff", text: "#202b45", muted: "#66708a", headerStyle: "column", headingStyle: "column", bodyFont: "'Songti SC','STSong','Noto Serif CJK SC',serif", radius: 0 },
  "natural-calm": { accent: "#4f8068", accentSoft: "#edf4ef", surface: "#fbfdfb", text: "#34473e", muted: "#718078", headerStyle: "calm", headingStyle: "calm", bodyFont: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif", radius: 8 }
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
  const base = `margin:${level === 2 ? 34 : 24}px 0 14px;color:${theme.text};font-size:${level === 2 ? 21 : 18}px;line-height:1.45;font-weight:700;letter-spacing:0;box-sizing:border-box;`;
  if (theme.headingStyle === "bar") return `<h${level} style="${base}padding-left:12px;border-left:4px solid ${theme.accent};">${text}</h${level}>`;
  if (theme.headingStyle === "number-card") return `<section style="display:flex;align-items:center;gap:12px;margin:34px 0 16px;padding:14px 16px;background:${theme.accentSoft};border:1px solid #c8ddea;border-radius:4px;"><span style="font-size:12px;color:${theme.accent};font-weight:700;letter-spacing:.08em;">STEP ${String(index).padStart(2, "0")}</span><h${level} style="margin:0;color:${theme.text};font-size:${level === 2 ? 20 : 17}px;line-height:1.45;">${text}</h${level}></section>`;
  if (theme.headingStyle === "band") return `<h${level} style="${base}margin-left:-16px;margin-right:-16px;padding:10px 16px;background:${theme.accent};color:#fff;">${text}</h${level}>`;
  if (theme.headingStyle === "editorial") return `<h${level} style="${base}padding:0 0 10px;border-bottom:2px solid ${theme.text};font-family:${theme.bodyFont};"><span style="margin-right:10px;color:${theme.muted};font-size:12px;">${String(index).padStart(2, "0")}</span>${text}</h${level}>`;
  if (theme.headingStyle === "note") return `<h${level} style="${base}position:relative;padding:4px 0 4px 18px;color:${theme.accent};font-family:${theme.bodyFont};"><span style="position:absolute;left:0;top:13px;width:8px;height:8px;background:${theme.accent};border-radius:50%;"></span>${text}</h${level}>`;
  if (theme.headingStyle === "tab") return `<h${level} style="${base}display:inline-block;padding:7px 14px;background:${theme.accentSoft};border-radius:7px 7px 7px 0;color:${theme.accent};">${text}</h${level}>`;
  if (theme.headingStyle === "column") return `<section style="display:grid;grid-template-columns:46px 1fr;align-items:end;margin:36px 0 17px;border-bottom:1px solid ${theme.accent};"><span style="padding-bottom:8px;color:${theme.accent};font-size:28px;line-height:1;font-weight:300;">${String(index).padStart(2, "0")}</span><h${level} style="margin:0;padding:0 0 8px;color:${theme.text};font-family:${theme.bodyFont};font-size:${level === 2 ? 21 : 18}px;line-height:1.45;">${text}</h${level}></section>`;
  return `<h${level} style="${base}margin-top:42px;text-align:center;color:${theme.accent};font-weight:600;"><span style="display:block;margin:0 auto 10px;width:22px;height:1px;background:${theme.accent};"></span>${text}</h${level}>`;
}

function headerHtml(title: string, theme: Theme) {
  const safeTitle = escapeHtml(title);
  if (theme.headerStyle === "command") return `<header style="margin:0 0 30px;padding:18px 20px;background:${theme.accent};color:#fff;border-radius:4px;"><span style="display:block;margin-bottom:8px;font-size:11px;letter-spacing:.16em;opacity:.76;">JOTO · DECISION BRIEF</span><h1 style="margin:0;font-size:25px;line-height:1.45;font-weight:700;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "blueprint") return `<header style="margin:0 0 30px;padding:18px 20px;background:${theme.accentSoft};border:1px solid #b9d4e5;border-top:5px solid ${theme.accent};"><span style="color:${theme.accent};font-size:11px;font-weight:700;letter-spacing:.14em;">IMPLEMENTATION BLUEPRINT</span><h1 style="margin:9px 0 0;color:${theme.text};font-size:25px;line-height:1.45;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "cobalt") return `<header style="margin:-20px -16px 32px;padding:34px 24px 28px;background:#123c78;color:#fff;"><span style="display:inline-block;margin-bottom:13px;padding:3px 8px;border:1px solid rgba(255,255,255,.55);font-size:10px;letter-spacing:.16em;">CAPABILITY NOTE</span><h1 style="margin:0;font-size:27px;line-height:1.42;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "editorial") return `<header style="margin:0 0 34px;padding:0 0 17px;border-top:4px solid ${theme.text};border-bottom:1px solid ${theme.text};font-family:${theme.bodyFont};"><span style="display:block;margin:8px 0 16px;color:${theme.muted};font-size:10px;letter-spacing:.2em;">JOTO BUSINESS REVIEW</span><h1 style="margin:0;color:${theme.text};font-size:28px;line-height:1.4;font-weight:700;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "fieldnotes") return `<header style="margin:0 0 34px;padding:8px 0 18px;border-bottom:1px dashed #c9b6a8;font-family:${theme.bodyFont};"><span style="display:inline-block;margin-bottom:12px;padding:4px 9px;background:${theme.accentSoft};color:${theme.accent};font-size:11px;transform:rotate(-1deg);">现场记录 / FIELD NOTES</span><h1 style="margin:0;color:${theme.text};font-size:27px;line-height:1.5;font-weight:600;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "notebook") return `<header style="margin:0 0 30px;padding:20px 20px 18px;background:${theme.accentSoft};border-left:7px solid ${theme.accent};border-radius:0 8px 8px 0;"><span style="color:${theme.accent};font-size:11px;font-weight:700;">研究手记</span><h1 style="margin:8px 0 0;color:${theme.text};font-size:25px;line-height:1.48;">${safeTitle}</h1></header>`;
  if (theme.headerStyle === "column") return `<header style="margin:0 0 36px;padding:0 0 20px;border-bottom:4px double ${theme.accent};text-align:center;font-family:${theme.bodyFont};"><span style="display:block;margin-bottom:13px;color:${theme.accent};font-size:11px;letter-spacing:.2em;">JOTO 专栏</span><h1 style="margin:0;color:${theme.text};font-size:29px;line-height:1.45;font-weight:700;">${safeTitle}</h1></header>`;
  return `<header style="margin:12px 0 46px;text-align:center;"><span style="display:inline-block;width:34px;height:2px;margin-bottom:18px;background:${theme.accent};"></span><h1 style="margin:0 auto;max-width:560px;color:${theme.text};font-size:26px;line-height:1.55;font-weight:600;">${safeTitle}</h1><span style="display:block;margin-top:14px;color:${theme.muted};font-size:11px;letter-spacing:.14em;">慢一点，想清楚</span></header>`;
}

export function renderWechatHtml(input: { title: string; markdown: string; templateId: WechatRenderableTemplateId }) {
  if (input.templateId === JOTO_OFFICIAL_WECHAT_TEMPLATE_ID) return renderJotoOfficialWechatHtml(input);
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
    blocks.push(`<${tag} style="margin:18px 0;padding:14px 18px 14px 38px;background:${theme.accentSoft};color:${theme.text};font-size:16px;line-height:1.85;border-radius:${theme.radius}px;">${listItems.map((item) => `<li style="margin:6px 0;">${item}</li>`).join("")}</${tag}>`);
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
      blocks.push(`<p style="margin:0 0 ${theme.headerStyle === "calm" ? 22 : 16}px;color:${theme.text};font-family:${theme.bodyFont};font-size:${theme.headerStyle === "editorial" || theme.headerStyle === "column" ? 17 : 16}px;line-height:${theme.headerStyle === "calm" ? 2.05 : 1.9};text-align:justify;letter-spacing:${theme.headerStyle === "fieldnotes" ? ".02em" : "0"};">${inlineMarkdown(line, theme)}</p>`);
    }
  }
  flushList(); flushQuote();

  return `<section data-wechat-layout="${input.templateId}" style="max-width:677px;margin:0 auto;padding:${theme.headerStyle === "calm" ? "30px 30px 50px" : "20px 16px 36px"};background:${theme.surface};font-family:${theme.bodyFont};box-sizing:border-box;">
  ${headerHtml(input.title, theme)}
  ${blocks.join("\n  ")}
</section>`;
}
