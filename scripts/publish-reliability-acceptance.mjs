const baseUrl = new URL(process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3047");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("WORKBENCH_BASE_URL must point to a loopback host.");
}

const response = await fetch(new URL("/api/publish-reliability", baseUrl));
if (!response.ok) throw new Error(`Reliability API failed (${response.status}).`);
const payload = await response.json();
const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
const readiness = Array.isArray(payload.readiness) ? payload.readiness : [];
const requiredPlatforms = ["juejin", "csdn", "zhihu"];
const missing = requiredPlatforms.filter((platform) => !metrics.some((item) => item.platform === platform));
if (missing.length) throw new Error(`Missing platform metrics: ${missing.join(", ")}`);
const missingReadiness = requiredPlatforms.filter((platform) => !readiness.some((item) => item.platform === platform));
if (missingReadiness.length) throw new Error(`Missing platform readiness: ${missingReadiness.join(", ")}`);

for (const metric of metrics) {
  for (const key of [
    "submissionAcceptanceRate",
    "publicConversionRate",
    "survival24hRate",
    "survival72hRate",
    "riskBlockRate",
    "duplicatePublishRate"
  ]) {
    const value = metric[key];
    if (value !== null && (value < 0 || value > 1)) throw new Error(`${metric.platform}.${key} is outside [0, 1].`);
  }
  if (metric.stablePublished > metric.publicObserved) {
    throw new Error(`${metric.platform} has more stable publications than observed public URLs.`);
  }
  if (metric.duplicatePublishCount !== 0) {
    throw new Error(`${metric.platform} has ${metric.duplicatePublishCount} duplicate publish actions.`);
  }
}

if (process.env.PUBLISH_RELIABILITY_ENFORCE === "true" && payload.rolloutReady !== true) {
  const blockers = readiness.flatMap((item) => item.blockers.map((blocker) => `${item.platform}:${blocker}`));
  throw new Error(`Publish rollout is not ready: ${blockers.join(", ")}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      generatedAt: payload.generatedAt,
      rolloutReady: payload.rolloutReady === true,
      thresholds: payload.thresholds,
      readiness,
      metrics
    },
    null,
    2
  )}\n`
);
