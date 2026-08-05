function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function comparableText(value) {
  return String(value || "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function normalizeOutsideFence(line) {
  return line
    .replace(/[ \t]+(?=#{1,6}[ \t]+\S)/g, "\n\n")
    .replace(/([\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A,:;!?])[ \t]+(?=[-*][ \t]+\S)/g, "$1\n")
    .replace(/([\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A.,:;!?])[ \t]+(?=\d+[.)][ \t]+\S)/g, "$1\n");
}

export function normalizeCsdnMarkdown(markdown, title = "") {
  const source = String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u3000]/g, " ");
  const expanded = [];
  let fence;

  for (const sourceLine of source.split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(sourceLine)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      expanded.push(sourceLine.trimEnd());
      continue;
    }
    expanded.push(...(fence ? [sourceLine] : normalizeOutsideFence(sourceLine).split("\n")));
  }

  const lines = expanded.map((line) => line.trimEnd());
  while (lines[0]?.trim() === "") lines.shift();
  const leadingHeading = /^#\s+(.+)$/.exec(lines[0]?.trim() || "");
  if (leadingHeading && comparableText(leadingHeading[1]) === comparableText(title)) {
    lines.shift();
    while (lines[0]?.trim() === "") lines.shift();
  }

  const output = [];
  fence = undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    const marker = /^(```+|~~~+)/.exec(trimmed)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      output.push(line);
      continue;
    }
    if (!fence && /^#{1,6}\s+\S/.test(trimmed)) {
      if (output.length && output.at(-1) !== "") output.push("");
      output.push(trimmed, "");
      continue;
    }
    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

export function renderCsdnHtml(markdown) {
  const lines = String(markdown || "").split("\n");
  const blocks = [];
  let paragraph = [];
  let listType;
  let listItems = [];
  let codeFence;
  let codeLanguage = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInline(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listType}>`);
    listType = undefined;
    listItems = [];
  };
  const flushFlow = () => {
    flushParagraph();
    flushList();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const fence = /^(```+|~~~+)\s*([\w.+-]*)/.exec(trimmed);
    if (fence) {
      if (!codeFence) {
        flushFlow();
        codeFence = fence[1][0];
        codeLanguage = fence[2] || "";
        codeLines = [];
      } else if (fence[1][0] === codeFence) {
        const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
        blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeFence = undefined;
        codeLanguage = "";
        codeLines = [];
      }
      continue;
    }
    if (codeFence) {
      codeLines.push(rawLine);
      continue;
    }
    if (!trimmed) {
      flushFlow();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushFlow();
      // CSDN reserves the page H1 for the article title and renders Markdown
      // headings one DOM level deeper (# -> h2, ## -> h3).
      const level = Math.min(6, heading[1].length + 1);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((ordered || unordered)[1]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushFlow();
      blocks.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`);
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushFlow();
      blocks.push("<hr>");
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  if (codeFence) {
    const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
    blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushFlow();
  return blocks.join("\n");
}

export function prepareCsdnArticleContent({ title, markdown }) {
  const normalizedMarkdown = normalizeCsdnMarkdown(markdown, title);
  return {
    markdown: normalizedMarkdown,
    html: renderCsdnHtml(normalizedMarkdown)
  };
}

export function enforceCsdnContentFields(payload, article) {
  const result = {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
    title: String(article.title || "").slice(0, 100),
    markdowncontent: String(article.markdown || ""),
    content: String(article.html || ""),
    source: "pc_mdeditor"
  };
  const articleId = String(article.articleId || "").trim();
  if (articleId) {
    result.id = articleId;
    result.article_id = articleId;
    result.is_new = 0;
    result.status = 0;
    result.pubStatus = "publish";
  }
  return result;
}
