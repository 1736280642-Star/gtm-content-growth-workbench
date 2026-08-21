import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [baseUrl = "http://127.0.0.1:3027", productId, label = "snapshot"] = process.argv.slice(2);
if (!productId) {
  throw new Error("Usage: node scripts/archive-product-geo-state.mjs <baseUrl> <productId> [label]");
}

const capturedAt = new Date();
const timestamp = capturedAt.toISOString().replace(/[:.]/g, "-");
const archiveDir = resolve("artifacts", "geo-strategy-archive", `${timestamp}-${productId}-${label}`);
await mkdir(archiveDir, { recursive: true });

const endpoints = {
  product: `/api/v5/products/${encodeURIComponent(productId)}`,
  researchWorkspace: `/api/v5/products/${encodeURIComponent(productId)}/research-workspace`,
  strategyPack: `/api/v5/products/${encodeURIComponent(productId)}/strategy-pack`,
  sampleArticles: `/api/v5/products/${encodeURIComponent(productId)}/sample-article`,
  rolloutReadiness: `/api/v5/products/${encodeURIComponent(productId)}/rollout-readiness`
};

const captures = {};
for (const [key, pathname] of Object.entries(endpoints)) {
  const response = await fetch(new URL(pathname, baseUrl), { headers: { accept: "application/json" } });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawText: text };
  }
  captures[key] = { status: response.status, ok: response.ok, pathname, body };
  await writeFile(resolve(archiveDir, `${key}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

const product = captures.product.body?.product || captures.product.body;
const research = captures.researchWorkspace.body?.workspace || captures.researchWorkspace.body;
const strategy = captures.strategyPack.body?.latestStrategyPack || captures.strategyPack.body?.strategyPack;
const samples = captures.sampleArticles.body?.data;
const articleTypes = strategy?.contentPlan?.articleTypePortfolio || [];
const sampleItems = Array.isArray(samples) ? samples : samples ? [samples] : [];
const manifest = {
  contractVersion: "local-geo-strategy-archive.v1",
  capturedAt: capturedAt.toISOString(),
  baseUrl,
  productId,
  label,
  productName: product?.displayName || product?.canonicalName,
  researchRunId: research?.latestRun?.runId,
  researchRunStatus: research?.latestRun?.status,
  blueprintVersionId: research?.currentBlueprint?.blueprintVersionId,
  strategyPackId: strategy?.id,
  strategyPackStatus: strategy?.status,
  articleTypeCount: articleTypes.length,
  sampleArticleCount: sampleItems.length,
  endpoints: Object.fromEntries(Object.entries(captures).map(([key, value]) => [key, {
    pathname: value.pathname,
    status: value.status,
    ok: value.ok
  }]))
};
await writeFile(resolve(archiveDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const summary = `# ${manifest.productName || productId} GEO 状态本地存档\n\n` +
  `- 归档时间：${manifest.capturedAt}\n` +
  `- 产品 ID：${productId}\n` +
  `- GEO Run：${manifest.researchRunId || "无"}（${manifest.researchRunStatus || "未知"}）\n` +
  `- Blueprint：${manifest.blueprintVersionId || "无"}\n` +
  `- 策略包：${manifest.strategyPackId || "无"}（${manifest.strategyPackStatus || "未知"}）\n` +
  `- 内容类型：${manifest.articleTypeCount}\n` +
  `- 样文记录：${manifest.sampleArticleCount}\n\n` +
  `本目录为启动新 GEO 链路前的只读历史基线。\n`;
await writeFile(resolve(archiveDir, "README.md"), summary, "utf8");

console.log(JSON.stringify({ status: "archived", archiveDir, manifest }));
