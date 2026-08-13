const WORKBENCH_MEDIA_PATTERN = /workbench-media:\/\/(media-asset-[0-9a-f-]{36})/gi;

export function collectWorkbenchMediaIds(html) {
  return Array.from(new Set(Array.from(String(html || "").matchAll(WORKBENCH_MEDIA_PATTERN), (match) => match[1])));
}

export async function rewriteWorkbenchMediaSources(html, resolveUrl) {
  let output = String(html || "");
  const ids = collectWorkbenchMediaIds(output);
  for (const id of ids) {
    const url = String(await resolveUrl(id) || "").trim();
    if (!/^https:\/\//i.test(url)) throw new Error(`素材 ${id} 未返回有效的 HTTPS 正文图片地址。`);
    output = output.split(`workbench-media://${id}`).join(url);
  }
  if (/workbench-media:\/\//i.test(output)) throw new Error("公众号正文仍包含未解析的工作台素材引用。");
  return output;
}

