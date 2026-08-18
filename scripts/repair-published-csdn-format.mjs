import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { prepareCsdnArticleContent } from "./lib/csdn-content-format.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = new Map(
  process.argv.slice(2).map((item) => {
    const [key, ...parts] = item.replace(/^--/, "").split("=");
    return [key, parts.length ? parts.join("=") : "true"];
  })
);
const apply = args.get("apply") === "true";
const onlyIndex = args.has("only-index") ? Number(args.get("only-index")) : undefined;
const onlyArticleId = String(args.get("article-id") || "").trim();
const auditReason = String(args.get("audit-reason") || "").trim();
const baseUrl = String(args.get("base-url") || "http://127.0.0.1:3027").replace(/\/$/, "");
const runnerToken = String(process.env.JOTO_PUBLISH_RUNNER_TOKEN || process.env.WECHATSYNC_BRIDGE_TOKEN || "").trim();
const bridgeUrl = String(args.get("bridge-url") || "http://127.0.0.1:9528").replace(/\/$/, "");
const repairVersion = "csdn-format-v1";

async function readState() {
  const response = await fetch(`${baseUrl}/api/workbench-state`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Workbench state request failed with HTTP ${response.status}`);
  const payload = await response.json();
  return payload.state;
}

function selectArticles(state, targetArticleId = "") {
  const variants = new Map((state.platformDraftVariants || []).map((item) => [item.id, item]));
  const drafts = new Map((state.drafts || []).map((item) => [item.id, item]));
  const attempts = state.publishAttempts || [];
  const seen = new Set();
  const selected = [];

  for (const schedule of state.publishSchedules || []) {
    if (schedule.platform !== "csdn" || !schedule.publicUrl || seen.has(schedule.matrixItemId)) continue;
    const publicArticleId = String(schedule.publicUrl).match(/\/details\/(\d+)/)?.[1] || "";
    if (targetArticleId && publicArticleId !== targetArticleId) continue;
    const variant = variants.get(schedule.platformVariantId);
    const draft = drafts.get(schedule.draftId);
    const relatedAttempts = attempts
      .filter((item) => item.scheduleId === schedule.id)
      .sort((left, right) => String(right.finishedAt || right.startedAt || "").localeCompare(String(left.finishedAt || left.startedAt || "")));
    const articleId = String(schedule.platformArticleId || relatedAttempts.find((item) => item.platformArticleId)?.platformArticleId || "").trim();
    if (!articleId || articleId !== publicArticleId) {
      throw new Error(`CSDN article identity mismatch for schedule ${schedule.id}`);
    }
    const title = String(variant?.title || draft?.title || "").trim();
    const sourceMarkdown = String(variant?.content || draft?.content || "").trim();
    if (!title || !sourceMarkdown) throw new Error(`CSDN source content is missing for schedule ${schedule.id}`);
    const formatted = prepareCsdnArticleContent({ title, markdown: sourceMarkdown });
    selected.push({
      schedule,
      articleId,
      title,
      summary: String(variant?.summary || draft?.summary || "").trim(),
      sourceMarkdown,
      formattedMarkdown: formatted.markdown,
      formattedHtml: formatted.html
    });
    seen.add(schedule.matrixItemId);
  }
  return selected;
}

async function updateCsdnArticle(article) {
  const response = await fetch(`${bridgeUrl}/sync_article`, {
    method: "POST",
    headers: { authorization: `Bearer ${runnerToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      platforms: ["csdn"],
      title: article.title,
      markdown: article.formattedMarkdown,
      summary: article.summary,
      externalDraftId: article.articleId,
      platformArticleId: article.articleId
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const state = await readState();
let articles = selectArticles(state, onlyArticleId);
if (onlyArticleId) {
  articles = articles.filter((article) => article.articleId === onlyArticleId);
  if (!articles.length) throw new Error(`article-id ${onlyArticleId} was not found in published CSDN schedules`);
}
if (Number.isInteger(onlyIndex)) {
  if (onlyIndex < 1 || onlyIndex > articles.length) throw new Error(`only-index must be between 1 and ${articles.length}`);
  articles = [articles[onlyIndex - 1]];
}

const preview = articles.map((article, index) => ({
  index: Number.isInteger(onlyIndex) ? onlyIndex : index + 1,
  scheduleId: article.schedule.id,
  articleId: article.articleId,
  title: article.title,
  sourceLength: article.sourceMarkdown.length,
  formattedLength: article.formattedMarkdown.length,
  duplicateLeadingH1Removed: /^#\s+/.test(article.sourceMarkdown) && !/^#\s+/.test(article.formattedMarkdown),
  renderedHeadings: article.formattedHtml.match(/<h[1-6]>/g)?.length || 0,
  renderedParagraphs: article.formattedHtml.match(/<p>/g)?.length || 0,
  rawHeadingLeaks: article.formattedHtml.match(/##[ \t]+/g)?.length || 0
}));

if (!apply) {
  console.log(JSON.stringify({ mode: "preview", repairVersion, articleCount: articles.length, preview }, null, 2));
} else {
  if (!auditReason) throw new Error("--audit-reason is required with --apply");
  if (!runnerToken) throw new Error("Runner token is not configured");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(".tmp", `csdn-format-repair-${timestamp}.json`);
  await mkdir(resolve(".tmp"), { recursive: true });
  await writeFile(
    backupPath,
    `${JSON.stringify({ repairVersion, createdAt: new Date().toISOString(), auditReason, articles }, null, 2)}\n`,
    "utf8"
  );

  const results = [];
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const { response, payload } = await updateCsdnArticle(article);
    const returnedArticleId = String(payload.externalDraftId || "").trim();
    const ok = response.ok && returnedArticleId === article.articleId;
    results.push({
      index: Number.isInteger(onlyIndex) ? onlyIndex : index + 1,
      http: response.status,
      ok,
      articleIdentityConfirmed: returnedArticleId === article.articleId,
      errorCode: payload.errorCode
    });
    if (!ok) break;
  }

  console.log(JSON.stringify({ mode: "apply", repairVersion, backupFile: backupPath.split(/[\\/]/).at(-1), results }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 2;
}
