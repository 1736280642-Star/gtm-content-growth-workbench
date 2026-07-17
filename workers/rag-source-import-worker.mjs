import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

const [sourceRegistry, sourceImportService, sourceImportRepository, governanceRepository] = await Promise.all([
  import("../src/lib/v5/rag/source-registry.ts"),
  import("../src/lib/v5/rag/source-import-service.ts"),
  import("../src/lib/v5/rag/source-import-repository.ts"),
  import("../src/lib/v5/knowledge-governance-repository.ts")
]);
const { buildRagSourceImportPlan, summarizeRagSourceImportPlan } = sourceRegistry;
const { prepareRagSourceImport } = sourceImportService;
const { writeRagSourceImport } = sourceImportRepository;
const { hasV5GovernanceDatabaseConfig } = governanceRepository;

const argv = process.argv.slice(2);
const args = new Set(argv);
const write = args.has("--write");
const includeAuditAssets = !args.has("--production-text-only");
const productArgument = argv.find((argument) => argument.startsWith("--product="));
const productId = productArgument?.slice("--product=".length).trim();

try {
  if (productArgument && !productId) throw Object.assign(new Error("--product 缺少产品 ID。"), { code: "invalid_argument" });
  const knownProductIds = new Set(sourceRegistry.ragSourceRegistry.map((entry) => entry.productId));
  if (productId && !knownProductIds.has(productId)) {
    throw Object.assign(new Error("--product 不在固定来源注册表中。"), { code: "invalid_argument" });
  }
  const discovered = await buildRagSourceImportPlan({ includeAuditAssets, productIds: productId ? [productId] : undefined });
  const plan = prepareRagSourceImport(discovered);
  if (!write) {
    console.log(JSON.stringify({
      status: "dry_run",
      writeRequired: "重新运行并显式添加 --write",
      productScope: productId || "all_registered_products",
      registrySummary: summarizeRagSourceImportPlan(discovered),
      planHash: plan.planHash,
      importVersion: plan.importVersion,
      summary: plan.summary
    }));
  } else {
    const actorNames = ["RAG_IMPORT_ACTOR_ID", "RAG_IMPORT_ACTOR_ROLE", "RAG_IMPORT_AUDIT_REASON"];
    const missingActorConfig = actorNames.filter((name) => !process.env[name]?.trim());
    if (!hasV5GovernanceDatabaseConfig()) {
      throw Object.assign(new Error("V5 知识治理 MySQL 尚未配置。"), {
        code: "pending_config",
        missingConfig: ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"]
          .filter((name) => !process.env[name]?.trim())
      });
    }
    if (missingActorConfig.length) {
      throw Object.assign(new Error("Source Import 缺少审计身份配置。"), { code: "pending_config", missingConfig: missingActorConfig });
    }
    const result = await writeRagSourceImport({
      plan,
      idempotencyKey: `rag-source-import:${plan.planHash}`,
      actor: {
        actorId: process.env.RAG_IMPORT_ACTOR_ID.trim(),
        actorRole: process.env.RAG_IMPORT_ACTOR_ROLE.trim(),
        actorType: ["human", "agent", "scheduler", "system"].includes(process.env.RAG_IMPORT_ACTOR_TYPE)
          ? process.env.RAG_IMPORT_ACTOR_TYPE
          : "system",
        auditReason: process.env.RAG_IMPORT_AUDIT_REASON.trim()
      }
    });
    console.log(JSON.stringify({ status: "awaiting_human_governance", result }));
  }
} catch (error) {
  const pending = error?.code === "pending_config";
  console.error(JSON.stringify({
    status: pending ? "pending_config" : "failed",
    code: pending ? "pending_config" : error?.code || "source_import_failed",
    details: pending ? (error?.missingConfig || []) : ["Source Import 执行失败，请查看受限服务端日志。"]
  }));
  process.exitCode = pending ? 2 : 1;
}
