import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [sourcePath, outputDirectory] = process.argv.slice(2);

if (!sourcePath || !outputDirectory) {
  console.error(
    "Usage: node scripts/extract-wechat-article-layout.mjs <source-html> <output-directory>",
  );
  process.exit(1);
}

const source = await readFile(sourcePath, "utf8");
const title =
  source.match(
    /<h1[^>]*id=["']activity-name["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*js_title_inner[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  )?.[1]?.trim() ?? "微信公众号文章排版复刻";
const account =
  source.match(
    /<a[^>]*id=["']js_name["'][^>]*>([\s\S]*?)<\/a>/i,
  )?.[1]?.trim() ?? "";
const contentMatch = source.match(
  /<div([^>]*\bid=["']js_content["'][^>]*)>([\s\S]*?)<\/div>\s*<script[^>]*>[\s\S]*?var\s+first_sceen__time/i,
);

if (!contentMatch) {
  throw new Error("Unable to find the WeChat article body (#js_content).");
}

const contentAttributes = contentMatch[1]
  .replace(/\s*style=["'][^"']*["']/i, "")
  .replace(/\s*id=["']js_content["']/i, "")
  .trim();
const rawContent = contentMatch[2]
  .replace(/<img\b[^>]*>/gi, (imageTag) => {
    if (/(?:^|\s)src=("[^"]*"|'[^']*')/i.test(imageTag)) return imageTag;
    return imageTag.replace(
      /\sdata-src=("[^"]*"|'[^']*')/i,
      (_match, sourceUrl) => ` src=${sourceUrl} data-src=${sourceUrl}`,
    );
  })
  .replace(/\sdata-aistatus=("[^"]*"|'[^']*')/gi, "")
  .trim();
const phoneNumberCount = (rawContent.match(/(?<!\d)1[3-9]\d{9}(?!\d)/g) ?? []).length;
const content = rawContent.replace(
  /(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g,
  "$1****$2",
);

const snippet = `<section class="wechat-article-layout-copy" style="max-width: 100%; margin: 0 auto; box-sizing: border-box;">\n${content}\n</section>\n`;
const standalone = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f3f3f3;
        color: #3e3e3e;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC",
          "Microsoft YaHei", Arial, sans-serif;
      }
      .page {
        width: min(100%, 677px);
        margin: 0 auto;
        min-height: 100vh;
        padding: 28px 20px 48px;
        background: #fff;
      }
      .article-title {
        margin: 0 0 14px;
        color: #222;
        font-size: 22px;
        line-height: 1.45;
        font-weight: 700;
      }
      .article-meta {
        margin-bottom: 28px;
        color: #8c8c8c;
        font-size: 15px;
        line-height: 1.6;
      }
      #js_content { visibility: visible !important; opacity: 1 !important; }
      #js_content img { height: auto; }
      @media (max-width: 480px) {
        .page { padding: 22px 16px 40px; }
        .article-title { font-size: 21px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <h1 class="article-title">${title}</h1>
      ${account ? `<div class="article-meta">${account}</div>` : ""}
      <div ${contentAttributes} id="js_content" style="visibility: visible; opacity: 1;">
${content}
      </div>
    </main>
  </body>
</html>
`;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "wechat-article-layout-preview.html"), standalone, "utf8"),
  writeFile(path.join(outputDirectory, "wechat-article-body-snippet.html"), snippet, "utf8"),
]);

console.log(
  JSON.stringify(
    {
      title,
      account,
      sourceBytes: Buffer.byteLength(source),
      bodyBytes: Buffer.byteLength(content),
      imageCount: (content.match(/<img\b/gi) ?? []).length,
      maskedPhoneNumberCount: phoneNumberCount,
      outputDirectory: path.resolve(outputDirectory),
    },
    null,
    2,
  ),
);
