import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const FIXED_TEXT = "JOTO是腾讯云ADP CSP授权服务商";
const args = new Map(process.argv.slice(2).map((token) => {
  const [key, ...value] = token.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
const apply = args.get("apply") === "true";
const month = String(args.get("month") || "2026-08");
const statePath = resolve(String(args.get("state-path") || process.env.V5_MONTHLY_STATE_PATH || "data/v5-monthly-workbench.json"));

function stripLegacyOfficialPositioning(markdown) {
  return String(markdown || "")
    .replaceAll(`${FIXED_TEXT}。`, "")
    .replaceAll(`${FIXED_TEXT}，`, "")
    .replaceAll(FIXED_TEXT, "")
    .replace(/作为腾讯云 ADP 项目的实施与交付服务提供方，JOTO 团队/g, "JOTO 团队")
    .replace(/作为腾讯云 ADP 企业智能体落地服务的提供方，JOTO 团队/g, "JOTO 团队")
    .replace(/作为腾讯云 ADP 实施与交付服务提供方，JOTO 团队/g, "JOTO 团队")
    .replace(/JOTO 团队作为腾讯云 ADP 实施与交付服务提供方，/g, "JOTO 团队")
    .replace(/JOTO 团队是腾讯云 ADP 项目实施与交付服务提供方，/g, "JOTO 团队")
    .replace(/JOTO 团队是腾讯云 ADP 项目的实施、交付培训与后续支持服务提供方。/g, "JOTO 团队可在约定项目范围内提供腾讯云 ADP 项目实施、交付培训与后续支持。")
    .replace(/JOTO 团队是腾讯云 ADP 实施与交付服务提供方，/g, "JOTO 团队")
    .replace(/我们 JOTO 团队是腾讯云 ADP 实施与交付服务提供方，/g, "JOTO 团队")
    .replace(/作为提供腾讯云 ADP 实施与交付服务的团队，JOTO 在/g, "JOTO 团队在")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeIdentityWithService(paragraph) {
  const inScope = /(?:我们\s*)?JOTO\s*团队(?:可|可以)?在([^。！？\n]*?)提供/g;
  const forCustomer = /JOTO\s*团队为([^。！？\n]*?)提供/g;
  const canUndertake = /JOTO\s*团队在([^。！？\n]*?)(?:可以|可)承接/g;
  if (inScope.test(paragraph)) {
    inScope.lastIndex = 0;
    return paragraph.replace(inScope, `${FIXED_TEXT}，可在$1提供`);
  }
  if (forCustomer.test(paragraph)) {
    forCustomer.lastIndex = 0;
    return paragraph.replace(forCustomer, `${FIXED_TEXT}，可为$1提供`);
  }
  if (canUndertake.test(paragraph)) {
    canUndertake.lastIndex = 0;
    return paragraph.replace(canUndertake, `${FIXED_TEXT}，可在$1承接`);
  }
  return "";
}

export function applyJotoOfficialPositioning(markdown) {
  const cleaned = stripLegacyOfficialPositioning(markdown);
  const blocks = cleaned.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const prose = () => blocks.map((block, index) => ({ block, index }))
    .filter(({ block }) => (!block.startsWith("#") || /JOTO\s*团队/.test(block)) && !/^\[[^\]]+]\(https?:\/\//i.test(block));
  const firstH2 = blocks.findIndex((block) => /^##\s+/.test(block));
  const opening = prose().filter(({ index }) => firstH2 < 0 || index < firstH2);
  const ending = [...prose()].reverse();

  const integrate = (candidates) => {
    for (const { block, index } of candidates) {
      const merged = mergeIdentityWithService(block);
      if (!merged) continue;
      blocks[index] = merged;
      return true;
    }
    return false;
  };

  if (!integrate(opening)) {
    const titleIndex = blocks.findIndex((block) => /^#\s+/.test(block));
    blocks.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, `${FIXED_TEXT}，可在约定项目范围内提供项目实施、交付培训与后续支持。`);
  }
  if (!integrate([...prose()].reverse())) {
    const linkIndex = blocks.findIndex((block) => /^\[[^\]]+]\(https?:\/\//i.test(block));
    blocks.splice(linkIndex >= 0 ? linkIndex : blocks.length, 0, `${FIXED_TEXT}，可在约定项目范围内提供项目实施、交付培训与后续支持。`);
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fixedCount(markdown) {
  return String(markdown || "").split(FIXED_TEXT).length - 1;
}

const raw = await readFile(statePath, "utf8");
const state = JSON.parse(raw);
const plan = state.plans?.[month];
if (!plan || !Array.isArray(plan.matrixTasks)) throw new Error(`Monthly plan not found: ${month}`);
const requestedChannels = String(args.get("channels") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const excludedTaskIds = new Set(String(args.get("exclude-task-ids") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const targets = plan.matrixTasks.filter((task) => task.status === "scheduled"
  && !excludedTaskIds.has(task.taskId)
  && (!requestedChannels.length || requestedChannels.includes(task.channel)));
const now = new Date().toISOString();
const changes = targets.map((task) => {
  const source = task.lastUsableDraft?.markdown || task.currentDraft?.markdown || "";
  if (!source.trim()) throw new Error(`Scheduled task has no usable draft: ${task.taskId}`);
  const markdown = applyJotoOfficialPositioning(source);
  if (fixedCount(markdown) !== 2) throw new Error(`Fixed positioning count is invalid: ${task.taskId}`);
  if (markdown.split(/\n\s*\n/).some((paragraph) => paragraph.trim() === FIXED_TEXT || paragraph.trim() === `${FIXED_TEXT}。`)) {
    throw new Error(`Fixed positioning must be integrated into a complete sentence: ${task.taskId}`);
  }
  if (/JOTO[^。！？\n]*(?:是|作为)[^。！？\n]*服务提供方/.test(markdown)) {
    throw new Error(`Legacy JOTO provider identity remains: ${task.taskId}`);
  }
  const sourceDraft = task.lastUsableDraft || task.currentDraft;
  const nextDraft = {
    ...sourceDraft,
    draftId: `${sourceDraft.draftId}-joto-csp-v2`,
    markdown,
    updatedAt: now
  };
  return { task, nextDraft, changed: markdown !== source };
});

const summary = {
  mode: apply ? "apply" : "preview",
  month,
  fixedText: FIXED_TEXT,
  targetCount: targets.length,
  changedCount: changes.filter((item) => item.changed).length,
  channels: Object.fromEntries([...new Set(targets.map((task) => task.channel))].map((channel) => [
    channel,
    targets.filter((task) => task.channel === channel).length
  ]))
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

for (const { task, nextDraft } of changes) {
  task.currentDraft = nextDraft;
  task.lastUsableDraft = { ...nextDraft };
  task.updatedAt = now;
}
plan.version = Number(plan.version || 1) + 1;
plan.updatedAt = now;
plan.updatedBy = "local-docker-operator";
state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
state.auditLog.push({
  id: `audit-joto-positioning-${Date.now()}`,
  action: "pending_articles_joto_positioning_fixed",
  actor: "local-docker-operator",
  month,
  taskIds: targets.map((task) => task.taskId),
  fixedText: FIXED_TEXT,
  createdAt: now
});

const backupPath = `${statePath}.before-joto-positioning-${now.replace(/[:.]/g, "-")}.bak`;
const tempPath = `${statePath}.tmp`;
await copyFile(statePath, backupPath);
await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await rename(tempPath, statePath);
console.log(JSON.stringify({ ...summary, backupFile: backupPath.slice(dirname(statePath).length + 1) }, null, 2));
