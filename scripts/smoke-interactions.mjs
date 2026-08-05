import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const contracts = [
  {
    name: "monthly_matrix_workspace",
    file: "src/app/monthly-matrix/page.tsx",
    includes: ["useMonthlyWorkspace", "MonthlyMatrixTable", "月度内容矩阵"]
  },
  {
    name: "monthly_strategy_workspace",
    file: "src/app/monthly-matrix/strategy/page.tsx",
    includes: ["MonthlyPlanConfigPanel", "月度策略工作区", "saveMonthlyPlan", "confirmTypeMatch"]
  },
  {
    name: "monthly_batch_generation",
    file: "src/app/monthly-matrix/batch-generation/page.tsx",
    includes: ["BatchGenerationMatrixTable", "/api/v5/monthly-plans/", "/schedule/"]
  },
  {
    name: "daily_execution_publish_closure",
    file: "src/app/daily-execution/page.tsx",
    includes: ["当日执行", "/api/v5/content-tasks/", "/publish-result"]
  },
  {
    name: "monthly_review",
    file: "src/app/monthly-review/page.tsx",
    includes: ["useMonthlyObservationReview", "MonthlyQuestionReviewTable", "createProposal"]
  },
  {
    name: "unified_product_material_import",
    file: "src/components/ProductMaterialImport.tsx",
    includes: ["/api/v5/knowledge-imports/documents", "/api/v5/knowledge-imports/urls", "publicUseConfirmed", "idempotencyKey"]
  },
  {
    name: "monthly_permissions",
    file: "src/lib/permissions.ts",
    includes: ["/monthly-matrix", "/daily-execution", "/monthly-review", "canManageMonthlyReviewProposals"]
  },
  {
    name: "monthly_prompt_template",
    file: "src/lib/prompt-templates.ts",
    includes: ["monthly_plan_generation", "月度计划生成模板", "批量生成中心"]
  },
  {
    name: "monthly_plan_compatibility_redirect",
    file: "src/app/monthly-plan/page.tsx",
    includes: ["redirect(\"/monthly-matrix\")"]
  },
  {
    name: "date_execution_compatibility_redirect",
    file: "src/app/today/page.tsx",
    includes: ["redirect(\"/daily-execution\")"]
  }
];

const obsoleteCycleTokens = [
  ["week", "ly-plan"].join(""),
  ["week", "ly-report"].join(""),
  ["week", "ly-review"].join(""),
  ["Week", "lyPlan"].join(""),
  ["Week", "lyReport"].join(""),
  ["周", "计划"].join(""),
  ["周", "报"].join(""),
  ["周", "复盘"].join("")
];

const scanRoots = ["scripts", "docs", "workers", "data"];
const scanFiles = [
  "README.md",
  "package.json",
  "src/lib/permissions.ts",
  "src/lib/prompt-templates.ts",
  "src/app/settings/page.tsx",
  "src/app/publish/page.tsx",
  "src/app/api/ai-governance/route.ts",
  "src/app/monthly-plan/page.tsx",
  "src/app/today/page.tsx"
];
const ignoredDirectories = new Set(["node_modules", ".next", "保存"]);
const results = [];

for (const contract of contracts) {
  try {
    const source = await readFile(contract.file, "utf8");
    const missing = contract.includes.filter((token) => !source.includes(token));
    results.push({
      name: contract.name,
      ok: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(", ")}` : contract.file
    });
  } catch (error) {
    results.push({ name: contract.name, ok: false, detail: error instanceof Error ? error.message : "read failed" });
  }
}

const maintainedFiles = new Set(scanFiles);
for (const root of scanRoots) {
  for (const file of await listFiles(root)) maintainedFiles.add(file);
}
maintainedFiles.delete("data/workbench-state.json");

for (const file of [...maintainedFiles].sort()) {
  try {
    const source = await readFile(file, "utf8");
    const found = obsoleteCycleTokens.filter((token) => source.toLowerCase().includes(token.toLowerCase()));
    results.push({
      name: `monthly_cycle_only:${file}`,
      ok: found.length === 0,
      detail: found.length ? `obsolete identifiers: ${found.join(", ")}` : "clean"
    });
  } catch (error) {
    results.push({ name: `monthly_cycle_only:${file}`, ok: false, detail: error instanceof Error ? error.message : "read failed" });
  }
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ script: "smoke-interactions", status: failed.length ? "failed" : "passed", passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;

async function listFiles(root) {
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(process.cwd(), fullPath).replaceAll("\\", "/"));
      }
    }
  }

  await walk(root);
  return files;
}
