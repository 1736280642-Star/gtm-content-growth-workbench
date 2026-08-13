import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { runMultiProviderWebSearch } = await import("../src/lib/v5/geo-search-adapters.ts");
const timeoutMs = Math.max(10_000, Math.min(120_000, Number(process.env.GEO_PROVIDER_PROBE_TIMEOUT_MS || 120_000)));
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const pack = await runMultiProviderWebSearch({
    queries: [{
      queryId: "live-capability-probe",
      query: "WorkBuddy JOTO 官方产品功能",
      intent: "provider_capability_probe",
      expectedEvidenceRole: "public_traceable_source",
      freshnessRequirement: "current",
      stopCondition: "返回至少一个可追溯的公开网页来源",
      round: 0
    }],
    officialUrl: "https://joto.ai/solutions/workbuddy",
    signal: controller.signal
  });

  const results = pack.providerRuns
    .filter((run) => ["zhipu", "doubao", "qwen"].includes(run.provider))
    .map((run) => ({
      provider: run.provider,
      configured: run.status !== "pending_config",
      model: run.model,
      endpoint: run.endpoint,
      requestStatus: run.status,
      webSearchVerified: run.status === "success" && run.sourceCount > 0,
      traceableSourceCount: run.sourceCount,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage?.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500)
    }));

  console.log(JSON.stringify({
    keyValuesExposed: false,
    probe: "real_network_request",
    results
  }, null, 2));

  if (results.some((result) => !result.webSearchVerified)) process.exitCode = 2;
} finally {
  clearTimeout(timer);
}
