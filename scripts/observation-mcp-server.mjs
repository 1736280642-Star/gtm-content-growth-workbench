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
    content: [{ type: "text", text: error instanceof Error ? error.message : "Observation tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createObservationMcpServer() {
  const server = new McpServer(
    { name: "joto-observation-workbench", version: "1.0.0" },
    {
      instructions:
        "Review publish records, liveness checks, and monthly reviews. Never modify published content or bypass platform rules."
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
    "monthly_review_get",
    "Get monthly review for a specific month.",
    z.object({ month: z.string() }),
    ({ month }) => request(`/api/v5/monthly-reviews/${encodeURIComponent(String(month))}`)
  );

  register(
    "monthly_review_proposal",
    "Create next month proposal based on review.",
    z.object({
      month: z.string(),
      findings: z.array(z.string()).optional(),
      recommendations: z.array(z.string()).optional()
    }),
    (input) => request(`/api/v5/monthly-reviews/${encodeURIComponent(String(input.month))}/proposals`, {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "publish_liveness_check",
    "Check whether a published article is still live.",
    z.object({ jobId: z.string() }),
    ({ jobId }) => request(`/api/publish-jobs/${encodeURIComponent(String(jobId))}/reconcile-dispatch`, {
      method: "POST"
    })
  );

  register(
    "monthly_workspace_summary",
    "Get monthly workspace summary for current status.",
    z.object({ month: z.string().optional() }),
    (input) => {
      const params = new URLSearchParams();
      if (input.month) params.set("month", String(input.month));
      const qs = params.toString();
      return request(`/api/v5/monthly-workspace/summary${qs ? `?${qs}` : ""}`);
    }
  );

  register(
    "automation_status",
    "Get automation pipeline status.",
    z.object({}),
    () => request("/api/v5/automation/status")
  );

  register(
    "content_task_publish_result",
    "Get publish result for a content task.",
    z.object({ taskId: z.string() }),
    ({ taskId }) => request(`/api/v5/content-tasks/${encodeURIComponent(String(taskId))}/publish-result`)
  );

  return server;
}

void serveStdio(createObservationMcpServer);
