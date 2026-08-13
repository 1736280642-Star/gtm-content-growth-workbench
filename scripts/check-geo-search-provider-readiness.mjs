import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { getMultiSearchProviderReadiness } = await import("../src/lib/v5/geo-search-adapters.ts");
const readiness = getMultiSearchProviderReadiness();

console.log(JSON.stringify({
  status: readiness.status,
  providers: readiness.providers.map((item) => ({
    provider: item.provider,
    status: item.status,
    missingConfig: item.missingConfig
  })),
  missingConfig: readiness.missingConfig
}, null, 2));

if (readiness.status !== "ready") process.exitCode = 2;
