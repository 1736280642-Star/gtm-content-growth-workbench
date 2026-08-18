const workbenchBaseUrl = String(process.env.WORKBENCH_BASE_URL || "http://workbench-web:3027").replace(/\/$/, "");
const intervalSeconds = Math.max(300, Number(process.env.CONTENT_METRICS_INTERVAL_SECONDS || 21_600));
const startupDelaySeconds = Math.max(5, Number(process.env.CONTENT_METRICS_STARTUP_DELAY_SECONDS || 30));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function synchronize() {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${workbenchBaseUrl}/api/v5/content-monitor/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(120_000)
    });
    const payload = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ worker: "content-metrics", startedAt, ok: response.ok, status: payload.data?.status || payload.status || "unknown", capturedItems: payload.data?.capturedItems || 0, message: payload.data?.message || payload.message || payload.error?.message }));
  } catch (error) {
    console.error(JSON.stringify({ worker: "content-metrics", startedAt, ok: false, status: "failed", message: error instanceof Error ? error.message : "Unknown sync error" }));
  }
}

await wait(startupDelaySeconds * 1000);
while (true) {
  await synchronize();
  await wait(intervalSeconds * 1000);
}
