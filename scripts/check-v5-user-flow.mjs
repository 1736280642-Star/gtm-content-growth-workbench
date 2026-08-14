import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import mysql from "mysql2/promise";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const month = process.argv.find((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value))
  || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());

function resolveDataPath(envName, fallback) {
  return path.resolve(process.cwd(), process.env[envName]?.trim() || fallback);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function stage(id, label, status, detail, action) {
  return { id, label, status, detail, ...(action ? { action } : {}) };
}

const paths = {
  foundation: resolveDataPath("V5_FOUNDATION_STATE_PATH", "data/v5-foundation-state.json"),
  monthly: resolveDataPath("V5_MONTHLY_STATE_PATH", "data/v5-monthly-workbench.json"),
  articleTypes: resolveDataPath("V5_ARTICLE_TYPE_STATE_PATH", "data/v5-article-types.json"),
  articleTemplates: path.resolve(process.cwd(), "data/v5-article-type-templates.json"),
  observation: resolveDataPath("V5_OBSERVATION_STATE_PATH", "data/v5-observation-state.json"),
  workbench: resolveDataPath("WORKBENCH_STATE_PATH", "data/workbench-state.json")
};

const [foundation, monthly, articleTypes, articleTemplates, observation, workbench, dailyPage, batchPage, monthlyReadModel] = await Promise.all([
  readJson(paths.foundation, {}),
  readJson(paths.monthly, { plans: {} }),
  readJson(paths.articleTypes, { profiles: {}, versions: {}, matchRuns: {}, monthRunIds: {} }),
  readJson(paths.articleTemplates, []),
  readJson(paths.observation, { tasks: {}, answers: {}, proposals: {} }),
  readJson(paths.workbench, { knowledgeBases: [], workspaceSetting: {} }),
  readFile(path.resolve(process.cwd(), "src/app/daily-execution/page.tsx"), "utf8"),
  readFile(path.resolve(process.cwd(), "src/app/monthly-matrix/batch-generation/page.tsx"), "utf8"),
  readFile(path.resolve(process.cwd(), "src/lib/v5/monthly-workspace-read-model.ts"), "utf8")
]);

const mysqlEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missingMysql = mysqlEnv.filter((name) => !process.env[name]?.trim());
const database = {
  products: [],
  rules: [],
  readiness: [],
  knowledgeLinks: [],
  plans: [],
  matrix: [],
  drafts: [],
  presentations: [],
  publishResults: []
};
let databaseError;

if (!missingMysql.length) {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectionLimit: 1
  });
  try {
    const queries = {
      products: "SELECT id, canonical_name, display_name, aliases, status, confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AS confirmed FROM product_entity ORDER BY created_at",
      rules: "SELECT id, product_id, version, status, approved_by IS NOT NULL AS approved, immutable_at IS NOT NULL AS immutable FROM rule_package_version ORDER BY created_at",
      readiness: "SELECT id, product_id, rule_package_version_id, monthly_production_ready, status, approved_by IS NOT NULL AND approved_at IS NOT NULL AS approved, max_monthly_quota FROM monthly_production_readiness ORDER BY created_at",
      knowledgeLinks: "SELECT knowledge_base_id, product_id, relation_type, status, confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AS confirmed FROM knowledge_base_product_link ORDER BY created_at",
      plans: "SELECT id, plan_month, status, strategy_package_version_id, matrix_version_id, approved_by IS NOT NULL AND approved_at IS NOT NULL AS approved, version FROM monthly_plan WHERE plan_month = ?",
      matrix: "SELECT id, monthly_plan_id, product_id, channel, content_type, status, production_scope, publish_date, publish_time, final_evidence_pack_id, version FROM content_matrix_item WHERE monthly_plan_id IN (SELECT id FROM monthly_plan WHERE plan_month = ?) ORDER BY publish_date, publish_time",
      drafts: "SELECT d.id, d.matrix_item_id, d.copy_allowed, g.status FROM draft_version d JOIN generation_run g ON g.id = d.generation_run_id WHERE d.matrix_item_id IN (SELECT i.id FROM content_matrix_item i JOIN monthly_plan p ON p.id = i.monthly_plan_id WHERE p.plan_month = ?) AND d.test_only = FALSE",
      presentations: "SELECT w.id, w.draft_version_id, w.review_status, w.publish_status, w.published_at IS NOT NULL AS sent_to_draft FROM wechat_presentation_artifact w JOIN draft_version d ON d.id = w.draft_version_id JOIN content_matrix_item i ON i.id = d.matrix_item_id JOIN monthly_plan p ON p.id = i.monthly_plan_id WHERE p.plan_month = ?",
      publishResults: "SELECT r.id, r.matrix_item_id, r.status, r.public_url, r.metrics, r.version FROM content_publish_result r JOIN content_matrix_item i ON i.id = r.matrix_item_id JOIN monthly_plan p ON p.id = i.monthly_plan_id WHERE p.plan_month = ?"
    };
    for (const [key, sql] of Object.entries(queries)) {
      const params = ["plans", "matrix", "drafts", "presentations", "publishResults"].includes(key) ? [month] : [];
      const [rows] = await pool.query(sql, params);
      database[key] = rows;
    }
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "unknown_database_error";
  } finally {
    await pool.end();
  }
}

const versionsById = new Map((foundation.questionVersions || []).map((item) => [item.questionVersionId, item]));
const confirmedQuestions = (foundation.questions || []).filter((item) => item.geoMonitoringApproval?.status === "approved");
const lockedQuestions = confirmedQuestions.map((item) => versionsById.get(item.currentVersionId)).filter(Boolean);
const questionProducts = Array.from(new Set(lockedQuestions.map((item) => item.product).filter(Boolean)));
const missingQuestionProductCount = lockedQuestions.filter((item) => !item.product).length;

const formalNames = new Map();
for (const product of database.products) {
  const names = [product.id, product.canonical_name, product.display_name, ...parseJson(product.aliases, [])];
  for (const name of names) formalNames.set(normalizeName(name), String(product.id));
}
const matchedProductIds = Array.from(new Set(questionProducts.map((name) => formalNames.get(normalizeName(name))).filter(Boolean)));
const unmatchedQuestionProducts = questionProducts.filter((name) => !formalNames.has(normalizeName(name)));
const activeRuleProductIds = new Set(database.rules.filter((item) => item.status === "active" && item.approved && item.immutable).map((item) => String(item.product_id)));
const readyProductIds = new Set(database.readiness.filter((item) => item.monthly_production_ready && item.status === "approved" && item.approved).map((item) => String(item.product_id)));
const linkedProductIds = new Set(database.knowledgeLinks.filter((item) => item.status === "active" && item.confirmed).map((item) => String(item.product_id)));

const localPlan = monthly.plans?.[month];
const formalPlan = database.plans[0];
const matchRunIds = articleTypes.monthRunIds?.[month] || [];
const confirmedMatchRuns = matchRunIds.map((id) => articleTypes.matchRuns?.[id]).filter((item) => item?.status === "confirmed");
const activeArticleTypeCount = Object.values(articleTypes.profiles || {}).filter((item) => item?.status === "active").length || articleTemplates.length;
const matrix = database.matrix;
const usableDraftCount = database.drafts.filter((item) => item.copy_allowed && item.status === "completed").length;
const scheduledCount = matrix.filter((item) => item.status === "scheduled").length;
const publishedCount = matrix.filter((item) => item.status === "published").length;
const openSearchAuthMode = process.env.OPENSEARCH_AUTH_MODE?.trim().toLowerCase() || "auto";
const openSearchCredentialsPresent = Boolean(process.env.OPENSEARCH_USERNAME?.trim() || process.env.OPENSEARCH_PASSWORD?.trim());
const ragRequired = ["OPENSEARCH_URL", "RAG_EMBEDDING_PROVIDER"];
if (openSearchAuthMode === "basic" || (openSearchAuthMode === "auto" && openSearchCredentialsPresent)) {
  ragRequired.push("OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD");
}
if (!["auto", "none", "basic"].includes(openSearchAuthMode)) ragRequired.push("OPENSEARCH_AUTH_MODE");
const ragMissing = ragRequired.filter((name) => !process.env[name]?.trim() || (name === "OPENSEARCH_AUTH_MODE" && !["auto", "none", "basic"].includes(openSearchAuthMode)));
const observationConfigured = Boolean(process.env.V5_OBSERVATION_REFERENCE_PATH?.trim());
const sourceFiles = await Promise.all([
  readFile(path.resolve(process.cwd(), "src/lib/v5/monthly-service.ts"), "utf8"),
  readFile(path.resolve(process.cwd(), "src/lib/v5/monthly-execution-repository.ts"), "utf8"),
  readFile(path.resolve(process.cwd(), "src/lib/v5/observation-reference-adapter.ts"), "utf8")
]);
const [monthlyServiceSource, executionRepositorySource, observationAdapterSource] = sourceFiles;

const stages = [
  stage("questions", "目标问题", confirmedQuestions.length ? "ready" : "blocked", `${confirmedQuestions.length} 个 GEO 调研人工确认问题`, confirmedQuestions.length ? undefined : "在产品 GEO 调研结果中确认需要监控的问题。"),
  stage(
    "product_binding",
    "问题 -> 正式产品",
    !unmatchedQuestionProducts.length && !missingQuestionProductCount && lockedQuestions.length ? "ready" : "blocked",
    `${matchedProductIds.length} 个产品已匹配；${unmatchedQuestionProducts.length + missingQuestionProductCount} 个未匹配`,
    "当前没有正式 ProductEntity 配置页面；通过 POST /api/product-entities 确认产品，问题 product 必须匹配正式产品 id、名称或 alias。"
  ),
  stage(
    "knowledge_binding",
    "正式产品 -> 知识库",
    matchedProductIds.length && matchedProductIds.every((id) => linkedProductIds.has(id)) ? "ready" : "blocked",
    `${matchedProductIds.filter((id) => linkedProductIds.has(id)).length}/${matchedProductIds.length || questionProducts.length} 个目标产品已确认知识库绑定`,
    "通过 /api/knowledge-ingestion/batches 与正式治理审核 API 完成资料导入、产品确认和 knowledge_base_product_link。"
  ),
  stage(
    "rules_g6",
    "规则包与 G6 准入",
    matchedProductIds.length && matchedProductIds.every((id) => activeRuleProductIds.has(id) && readyProductIds.has(id)) ? "ready" : "blocked",
    `${matchedProductIds.filter((id) => readyProductIds.has(id)).length}/${matchedProductIds.length || questionProducts.length} 个目标产品通过 G6`,
    "当前 /knowledge/rule-packages 不是正式 MySQL 页面；使用 /api/products/[productId]/rule-packages/drafts、/api/rule-package-versions/[id]/approve、/activate 和 /api/products/[productId]/monthly-production-readiness/evaluate。"
  ),
  stage("article_types", "文章类型", activeArticleTypeCount ? "ready" : "blocked", `${activeArticleTypeCount} 个 active 类型`, "在 /monthly-matrix/content-types 启用至少一个文章类型。"),
  stage("type_match", "问题 -> 文章类型匹配", confirmedMatchRuns.length ? "ready" : "pending", `${confirmedMatchRuns.length} 个当月已确认匹配`, "在 /monthly-matrix/strategy 运行匹配并人工确认。"),
  stage("monthly_plan", "MonthlyPlan", formalPlan ? "ready" : "pending", formalPlan ? `正式计划 ${formalPlan.id}` : "正式写入链路已接通，尚未创建", "在 /monthly-matrix/strategy 保存正式 MonthlyPlan 草稿。"),
  stage("strategy_matrix", "策略包与矩阵", matrix.length ? "ready" : "pending", `${matrix.length} 个正式矩阵项；正式批准写入=${monthlyServiceSource.includes("persistFormalApprovedStrategy")}`, "在 /monthly-matrix 批准策略，系统将事务化写入正式矩阵。"),
  stage("rag", "证据检索与冻结", ragMissing.length ? "blocked" : "ready", ragMissing.length ? `缺少 ${ragMissing.join(", ")}` : "RAG 基础设施配置齐全", "在 .env.local 配置 OpenSearch 与 RAG Embedding，然后启动对应 worker。"),
  stage("generation", "正式生成", usableDraftCount ? "ready" : matrix.length ? "pending" : "blocked", `${usableDraftCount} 个可用正式正文`, "在 /monthly-matrix/batch-generation 触发正式 prepare-and-generate。"),
  stage("batch_ui", "批量生成页面数据源", monthlyReadModel.includes("toFormalProductionTask") && batchPage.includes("workspace?.productionTasks") ? "ready" : "disconnected", monthlyReadModel.includes("toFormalProductionTask") ? "正式 batchQueueItems 已适配到生产任务表格" : "页面未消费正式 batchQueueItems", "接通正式队列到批量生成表格。"),
  stage("schedule", "排程", executionRepositorySource.includes("scheduleFormalProductionTask") ? "ready" : "disconnected", `${scheduledCount} 个正式已排程任务`, "在批量生成中心为可用正文安排日期。"),
  stage("daily_execution", "当日执行", dailyPage.includes("v5-ui-mock-data") ? "disconnected" : "ready", dailyPage.includes("v5-ui-mock-data") ? "页面仍读取 mock 数据" : "页面已读取正式执行数据", "接通正式矩阵、草稿/发布状态到 /daily-execution。"),
  stage("publish", "发布与 URL/指标回传", executionRepositorySource.includes("saveFormalPublishResult") ? "ready" : "disconnected", `${publishedCount} 个正式 published 矩阵项；${database.publishResults.length} 条发布结果`, "在 /daily-execution 回填公开 URL 与渠道指标。"),
  stage("monthly_review", "MonthlyReview", observationAdapterSource.includes("readFormalObservationRows") ? "ready" : "disconnected", observationConfigured ? "使用显式观察引用" : "自动聚合正式问题、MonthlyPlan 与发布结果", "访问 /monthly-review 查看问题级复盘。")
];

const summary = {
  month,
  status: stages.every((item) => item.status === "ready") ? "ready" : "blocked",
  counts: {
    ready: stages.filter((item) => item.status === "ready").length,
    pending: stages.filter((item) => item.status === "pending").length,
    blocked: stages.filter((item) => item.status === "blocked").length,
    disconnected: stages.filter((item) => item.status === "disconnected").length
  },
  data: {
    lockedQuestions: confirmedQuestions.length,
    questionProducts,
    unmatchedQuestionProducts,
    missingQuestionProductCount,
    formalProducts: database.products.map((item) => ({ id: item.id, name: item.display_name, status: item.status, confirmed: Boolean(item.confirmed) })),
    formalPlans: database.plans.length,
    formalMatrixItems: matrix.length,
    usableDrafts: usableDraftCount,
    scheduledItems: scheduledCount,
    publishedItems: publishedCount,
    observationTasks: Object.keys(observation.tasks || {}).length
  },
  configuration: {
    mysql: missingMysql.length ? { status: "pending_config", missing: missingMysql } : databaseError ? { status: "failed", message: databaseError } : { status: "ready" },
    rag: ragMissing.length ? { status: "pending_config", missing: ragMissing } : { status: "ready" },
    observationReference: observationConfigured ? "explicit_adapter" : "formal_mysql_adapter"
  },
  stages
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === "ready" ? 0 : 1;
