import process from "node:process";
import { loadProjectEnv } from "./load-project-env.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

loadProjectEnv();

function loopbackOrigin(hostValue, portValue, fallbackPort) {
  const host = String(hostValue || "127.0.0.1").trim();
  const port = Number(portValue || fallbackPort);
  if (!LOOPBACK_HOSTS.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  const formattedHost = host === "::1" ? "[::1]" : host;
  return `http://${formattedHost}:${port}`;
}

function configuredRunnerOrigin() {
  const configured = String(process.env.ARCS_RUNNER_URL || "").trim();
  if (!configured) return loopbackOrigin(process.env.ARCS_RUNNER_HOST, process.env.ARCS_RUNNER_PORT, 9530);
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

async function fetchServiceStatus(url, expectedService, token) {
  if (!url) return { ready: false, reason: "invalid_loopback_config" };
  try {
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(2_500)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ready: false, reason: response.status === 401 ? "unauthorized" : "unhealthy", statusCode: response.status };
    }
    if (payload?.ok !== true || payload?.service !== expectedService) {
      return { ready: false, reason: "unexpected_service", statusCode: response.status };
    }
    return { ready: true, statusCode: response.status };
  } catch {
    return { ready: false, reason: "unreachable" };
  }
}

const bridgeOrigin = loopbackOrigin(process.env.WECHATSYNC_BRIDGE_HOST, process.env.WECHATSYNC_BRIDGE_PORT, 9528);
const runnerOrigin = configuredRunnerOrigin();
const bridgeToken = String(process.env.WECHATSYNC_BRIDGE_TOKEN || "").trim();
const runnerToken = String(process.env.JOTO_PUBLISH_RUNNER_TOKEN || "").trim() || bridgeToken;

const [bridge, runner] = await Promise.all([
  fetchServiceStatus(bridgeOrigin ? `${bridgeOrigin}/health` : undefined, "joto-wechatsync-bridge"),
  fetchServiceStatus(runnerOrigin ? `${runnerOrigin}/status` : undefined, "joto-arcs-publish-runner", runnerToken)
]);

const result = {
  ok: bridge.ready && runner.ready,
  configuration: {
    bridgeTokenConfigured: Boolean(bridgeToken),
    runnerTokenConfigured: Boolean(runnerToken),
    bridgeLoopbackValid: Boolean(bridgeOrigin),
    runnerLoopbackValid: Boolean(runnerOrigin)
  },
  bridge,
  runner
};

process.stdout.write(`${JSON.stringify(result)}\n`);

