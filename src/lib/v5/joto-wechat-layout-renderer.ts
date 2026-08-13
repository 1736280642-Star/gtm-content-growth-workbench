import type { DraftSection, VisualMaterialSuggestion } from "./free-production-contracts";

export const JOTO_OFFICIAL_WECHAT_TEMPLATE_ID = "joto-official-v1" as const;
export const WORKBENCH_MEDIA_REF_PREFIX = "workbench-media:" as const;

const JOTO_QR_CODE_URL = "https://mmbiz.qpic.cn/sz_mmbiz_jpg/Ex8RD14hF0re9XUqv9X3Oo2UaYWTLXKUM8Al6mJOibC9ebGF1ZJ0NvzicmiacMPtmphN2rmxkA1TSUv4euia0AHXqriaUBzibRYVqStrAiciaWNjlLI/640?wx_fmt=jpeg";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(value: string) {
  const url = value.trim();
  return /^https:\/\//i.test(url) ? escapeHtml(url) : undefined;
}

function boundAssetUrl(value: string, mode: "preview" | "publish") {
  const remote = safeUrl(value);
  if (remote) return remote;
  if (!value.startsWith(WORKBENCH_MEDIA_REF_PREFIX)) return undefined;
  const mediaAssetId = value.slice(WORKBENCH_MEDIA_REF_PREFIX.length);
  if (!/^media-asset-[0-9a-f-]{36}$/i.test(mediaAssetId)) return undefined;
  return mode === "preview"
    ? `/api/v5/free-production/assets/${encodeURIComponent(mediaAssetId)}/content`
    : `workbench-media://${mediaAssetId}`;
}

function inlineMarkdown(value: string) {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  };
  let output = value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) => {
      const src = safeUrl(url);
      return src
        ? stash(`<img src="${src}" alt="${escapeHtml(alt)}" style="display:block;width:100%;height:auto;margin:22px auto 7px;box-sizing:border-box;" />`)
        : escapeHtml(alt);
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
      const href = safeUrl(url);
      return href ? stash(`<a href="${href}" style="color:#0022fc;text-decoration:underline;">${escapeHtml(label)}</a>`) : escapeHtml(label);
    });
  output = escapeHtml(output)
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700;">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="padding:2px 5px;background:#eef3ff;color:#0022fc;font-size:13px;">$1</code>');
  return output.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] || "");
}

function renderMarkdown(markdown: string) {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quoteLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p style="white-space:normal;margin:0 20px 15px;padding:0;color:#3e3e3e;font-size:14px;line-height:1.85;text-align:justify;letter-spacing:0;box-sizing:border-box;">${paragraph.map(inlineMarkdown).join("<br />")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const tag = listOrdered ? "ol" : "ul";
    blocks.push(`<${tag} style="margin:4px 20px 17px;padding-left:22px;color:#3e3e3e;font-size:14px;line-height:1.85;box-sizing:border-box;">${listItems.map((item) => `<li style="margin:4px 0;">${item}</li>`).join("")}</${tag}>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    blocks.push(`<section style="margin:12px 20px 18px;padding:1px 0 1px 9px;border-left:3px solid #dbdbdb;color:#0022fc;font-size:14px;line-height:1.75;box-sizing:border-box;"><p style="margin:0;padding:0;"><strong>${quoteLines.join("<br />")}</strong></p></section>`);
    quoteLines = [];
  };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(`<p style="margin:24px 20px 13px;padding:0;color:#0022fc;font-size:${heading[1].length <= 2 ? 18 : 16}px;line-height:1.55;font-weight:700;box-sizing:border-box;">${inlineMarkdown(heading[2])}</p>`);
      continue;
    }
    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) { flushParagraph(); flushList(); quoteLines.push(inlineMarkdown(quote[1])); continue; }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph(); flushQuote();
      const nextOrdered = Boolean(ordered);
      if (listItems.length && nextOrdered !== listOrdered) flushList();
      listOrdered = nextOrdered;
      listItems.push(inlineMarkdown((ordered || unordered)![1]));
      continue;
    }
    if (/^---+$/.test(line)) {
      flush();
      blocks.push('<section style="margin:24px 20px;border-top:1px solid #dbdbdb;height:1px;box-sizing:border-box;"></section>');
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.join("\n");
}

function renderFollowPrompt() {
  const chevrons = Array.from({ length: 3 }, () => '<span style="display:inline-block;width:12px;height:12px;border-top:3px solid #456bb0;border-right:3px solid #456bb0;transform:rotate(45deg);box-sizing:border-box;"></span>').join("");
  const dots = ["#4577da", "#5f9cef", "#c1dff4"].map((color) => `<span style="display:inline-block;width:22px;height:22px;margin:0 3px;border-radius:50%;background:${color};color:#fff;font-size:12px;line-height:22px;text-align:center;">♥</span>`).join("");
  return `<section style="margin:8px 0 24px;text-align:center;box-sizing:border-box;">
    <section style="display:flex;align-items:center;justify-content:center;gap:18px;margin:0 0 8px;box-sizing:border-box;">
      <span style="display:inline-flex;gap:0;transform:rotate(180deg);">${chevrons}</span>
      <strong style="color:#456bb0;font-size:16px;line-height:1.5;">点击蓝字 关注我们</strong>
      <span style="display:inline-flex;gap:0;">${chevrons}</span>
    </section>
    <section>${dots}</section>
  </section>`;
}

function renderSectionHeading(heading: string, index: number) {
  if (index === 0) {
    return `<section style="margin:26px 20px 18px;color:#0022fc;font-size:20px;line-height:1.5;font-weight:700;box-sizing:border-box;">${escapeHtml(heading)}</section>`;
  }
  return `<section style="display:flex;align-items:flex-end;margin:28px 20px 18px;box-sizing:border-box;">
    <span style="display:inline-block;min-width:30px;height:30px;padding:0 6px;background:#0022fc;color:#fff;font-size:18px;line-height:30px;text-align:center;box-sizing:border-box;">${index}</span>
    <span style="display:inline-block;margin-left:7px;padding:0 4px 2px;color:#30343b;font-size:14px;line-height:24px;font-weight:700;border-bottom:7px solid #dbdbdb;box-sizing:border-box;">${escapeHtml(heading)}</span>
  </section>`;
}

function renderVisualSuggestion(suggestion: VisualMaterialSuggestion) {
  return `<section data-preview-only="visual-suggestion" style="margin:20px;padding:16px;border:1px dashed #5f9cef;background:#f6f9ff;color:#456bb0;box-sizing:border-box;">
    <p style="margin:0 0 6px;font-size:13px;line-height:1.6;font-weight:700;">配图建议｜${escapeHtml(suggestion.recommendation)}</p>
    <p style="margin:0;color:#6f7d94;font-size:12px;line-height:1.65;">图注：${escapeHtml(suggestion.captionSuggestion)} · ${escapeHtml(suggestion.purpose)}</p>
  </section>`;
}

function renderBoundVisual(suggestion: VisualMaterialSuggestion, mode: "preview" | "publish") {
  const src = suggestion.boundAssetRef ? boundAssetUrl(suggestion.boundAssetRef, mode) : undefined;
  if (!src) return "";
  return `<figure style="margin:22px 20px 24px;padding:0;box-sizing:border-box;">
    <img src="${src}" alt="${escapeHtml(suggestion.captionSuggestion)}" style="display:block;width:100%;height:auto;margin:0 auto;box-sizing:border-box;" />
    <figcaption style="margin:7px 0 0;color:#8a8f99;font-size:12px;line-height:1.6;text-align:center;">${escapeHtml(suggestion.captionSuggestion)}</figcaption>
  </figure>`;
}

function renderBrandFooter() {
  return `<section style="margin:34px 0 0;box-sizing:border-box;">
    <section style="display:flex;align-items:center;margin:10px 0 18px;box-sizing:border-box;">
      <span style="flex:1;height:1px;background:#4577da;"></span>
      <span style="display:inline-block;width:44px;margin:0 10px;padding:5px 0;background:#4577da;color:#fff;font-size:12px;line-height:1;text-align:center;">JOTO</span>
      <span style="flex:1;height:1px;background:#4577da;"></span>
    </section>
    <section style="display:flex;align-items:center;justify-content:center;gap:20px;margin:0 20px 16px;box-sizing:border-box;">
      <img src="${JOTO_QR_CODE_URL}" data-src="${JOTO_QR_CODE_URL}" alt="JOTO AI 微信公众号二维码" style="display:block;width:132px;height:auto;margin:0;box-sizing:border-box;" />
      <section style="font-size:14px;line-height:1.7;color:#3e3e3e;text-align:left;box-sizing:border-box;">
        <p style="margin:0 0 8px;"><strong style="padding:2px 6px;background:#4577da;color:#fff;">微信公众号</strong><br /><strong>JOTO AI</strong></p>
        <p style="margin:0;"><strong style="padding:2px 6px;background:#ffc145;color:#fff;">官方网址</strong><br />www.joto.ai</p>
      </section>
    </section>
    <p style="margin:0 20px 8px;color:#3e3e3e;font-size:13px;line-height:1.7;text-align:center;"><strong style="color:#5f9cef;">长按识别二维码 关注我们</strong></p>
    <p style="margin:0 20px;color:#626b78;font-size:12px;line-height:1.7;text-align:center;">联系我们：jotoai@jototech.cn</p>
  </section>`;
}

export function renderJotoOfficialWechatBody(input: {
  sections: DraftSection[];
  visualSuggestions?: VisualMaterialSuggestion[];
  includeVisualPlaceholders?: boolean;
  assetReferenceMode?: "preview" | "publish";
}) {
  const suggestions = input.visualSuggestions || [];
  const assetReferenceMode = input.assetReferenceMode || "publish";
  const content = input.sections.map((section, index) => {
    const visualHtml = suggestions
      .filter((item) => item.placementAnchor === section.sectionKey)
      .map((visual) => renderBoundVisual(visual, assetReferenceMode) || (input.includeVisualPlaceholders ? renderVisualSuggestion(visual) : ""))
      .join("\n");
    return `${renderSectionHeading(section.heading, index)}\n${renderMarkdown(section.markdown)}\n${visualHtml}`;
  }).join("\n");
  return `<section data-wechat-layout="${JOTO_OFFICIAL_WECHAT_TEMPLATE_ID}" style="max-width:677px;margin:0 auto;padding:10px 0 30px;background:#fff;color:#3e3e3e;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',Arial,sans-serif;font-size:14px;font-style:normal;font-weight:400;text-align:justify;box-sizing:border-box;">
    ${renderFollowPrompt()}
    ${content}
    ${renderBrandFooter()}
  </section>`;
}

export function markdownSections(title: string, markdown: string): DraftSection[] {
  const sections: DraftSection[] = [];
  let current: DraftSection = { sectionKey: "introduction", heading: "核心内容", markdown: "" };
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current.markdown.trim()) sections.push({ ...current, markdown: current.markdown.trim() });
      current = { sectionKey: `section-${sections.length + 1}`, heading: heading[1].trim(), markdown: "" };
      continue;
    }
    if (/^#\s+/.test(line) && line.replace(/^#\s+/, "").trim() === title.trim()) continue;
    current.markdown += `${line}\n`;
  }
  if (current.markdown.trim()) sections.push({ ...current, markdown: current.markdown.trim() });
  return sections.length ? sections : [{ sectionKey: "content", heading: "核心内容", markdown: markdown.trim() || title }];
}

export function renderJotoOfficialWechatHtml(input: { title: string; markdown: string }) {
  return renderJotoOfficialWechatBody({ sections: markdownSections(input.title, input.markdown) });
}

export function renderJotoOfficialWechatPreviewDocument(input: {
  title: string;
  summary?: string;
  bodyHtml: string;
}) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(input.title)}</title></head><body style="margin:0;background:#f3f3f3;color:#3e3e3e;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',Arial,sans-serif;"><main style="width:min(100%,677px);min-height:100vh;margin:0 auto;padding:24px 18px 40px;background:#fff;box-sizing:border-box;"><h1 style="margin:0 0 10px;color:#20242c;font-size:22px;line-height:1.45;font-weight:700;">${escapeHtml(input.title)}</h1><p style="margin:0 0 24px;color:#8c8c8c;font-size:14px;line-height:1.6;">JOTO AI${input.summary ? ` · ${escapeHtml(input.summary)}` : ""}</p>${input.bodyHtml}</main></body></html>`;
}
