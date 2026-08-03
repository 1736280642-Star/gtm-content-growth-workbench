import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const baseUrl = new URL(process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3047");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("WORKBENCH_BASE_URL must point to a loopback host.");
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Workbench request failed (${response.status}).`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : "Publish tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createPublishMcpServer() {
  const server = new McpServer(
    { name: "joto-publish-workbench", version: "1.0.0" },
    {
      instructions:
        "Create and reconcile high-level publish jobs only. Never reproduce platform cookies, tokens, DOM selectors, or low-level click sequences."
    }
  );

  const register = (name, description, inputSchema, handler) =>
    server.registerTool(name, { description, inputSchema }, async (input) => {
      try {
        return toolResult(await handler(input));
      } catch (error) {
        return toolError(error);
      }
    });

  register(
    "platform_auth_probe",
    "Check whether a platform executor is authenticated without returning credentials.",
    z.object({ platform: z.enum(["wechat", "juejin", "csdn", "zhihu"]) }),
    ({ platform }) => request(`/api/publishing/platforms/${platform}/auth`)
  );
  register(
    "publish_content_preflight",
    "Evaluate a draft or supplied content against versioned platform publishing rules.",
    z.object({
      draftId: z.string().optional(),
      platform: z.enum(["wechat", "juejin", "csdn", "zhihu"]),
      title: z.string().optional(),
      markdown: z.string().optional(),
      autoRewrite: z.boolean().optional()
    }),
    (input) => request("/api/publishing/preflight", { method: "POST", body: JSON.stringify(input) })
  );
  register(
    "publish_job_create",
    "Create an idempotent workbench-owned publish job from a final draft.",
    z.object({
      draftId: z.string(),
      platform: z.enum(["wechat", "juejin", "csdn", "zhihu"]),
      scheduledAt: z.string().optional(),
      matrixItemId: z.string().optional()
    }),
    (input) => request("/api/publish-jobs", { method: "POST", body: JSON.stringify(input) })
  );
  register(
    "publish_job_run",
    "Queue one existing publish job for deterministic worker execution and return its durable handle immediately.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(jobId)}/dispatch`, { method: "POST" })
  );
  register(
    "publish_job_get",
    "Read one publish job and its attempts from the workbench source of truth.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(jobId)}`)
  );
  register(
    "publish_job_reconcile",
    "Queue read-only reconciliation for a previously submitted job and return its durable handle immediately.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(jobId)}/reconcile-dispatch`, { method: "POST" })
  );
  register(
    "publish_url_verify",
    "Verify and backfill the public URL for an existing publish job.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(jobId)}/reconcile-dispatch`, { method: "POST" })
  );
  register(
    "publish_liveness_check",
    "Check whether an observed public article is still live and advance its lifecycle.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(jobId)}/reconcile-dispatch`, { method: "POST" })
  );

  return server;
}

void serveStdio(createPublishMcpServer);
console.error("JOTO publish MCP server running on stdio.");
