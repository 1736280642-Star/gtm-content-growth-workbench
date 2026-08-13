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
    content: [{ type: "text", text: error instanceof Error ? error.message : "Capture tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createCaptureMcpServer() {
  const server = new McpServer(
    { name: "joto-capture-workbench", version: "1.0.0" },
    {
      instructions:
        "Manage capture devices, tasks, leases, and evidence uploads. Never expose device credentials, browser cookies, or login tokens."
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

  // Device management
  register(
    "capture_device_list",
    "List all registered capture devices.",
    z.object({}),
    () => request("/api/v5/capture-devices")
  );

  register(
    "capture_device_register",
    "Register/pair a new capture device.",
    z.object({
      deviceId: z.string(),
      workspaceId: z.string(),
      userId: z.string(),
      platforms: z.array(z.string())
    }),
    (input) => request("/api/v5/capture-devices", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "capture_device_heartbeat",
    "Send heartbeat to keep device lease alive.",
    z.object({
      deviceId: z.string(),
      status: z.string().optional(),
      adapterVersion: z.string().optional()
    }),
    (input) => request(`/api/v5/capture-devices/${encodeURIComponent(String(input.deviceId))}/heartbeat`, {
      method: "PUT",
      body: JSON.stringify({ status: input.status, adapterVersion: input.adapterVersion })
    })
  );

  register(
    "capture_device_revoke",
    "Revoke/unpair a capture device.",
    z.object({ deviceId: z.string() }),
    ({ deviceId }) => request(`/api/v5/capture-devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE"
    })
  );

  // Task management
  register(
    "capture_task_create",
    "Create a capture task matrix entry.",
    z.object({
      productId: z.string(),
      question: z.string(),
      platform: z.string(),
      idempotencyKey: z.string(),
      priority: z.number().optional()
    }),
    (input) => request("/api/v5/capture-tasks", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "capture_task_lease",
    "Acquire or renew a lease on a capture task.",
    z.object({
      taskId: z.string(),
      deviceId: z.string(),
      durationMs: z.number().optional()
    }),
    (input) => request(`/api/v5/capture-tasks/${encodeURIComponent(String(input.taskId))}/lease`, {
      method: "POST",
      body: JSON.stringify({ deviceId: input.deviceId, durationMs: input.durationMs })
    })
  );

  register(
    "capture_task_status",
    "Get capture task status and workspace.",
    z.object({ taskId: z.string().optional() }),
    (input) => request(`/api/v5/capture-tasks${input.taskId ? `?taskId=${encodeURIComponent(String(input.taskId))}` : ""}`)
  );

  // Evidence management
  register(
    "capture_evidence_upload",
    "Upload desensitized capture evidence (idempotent by hash).",
    z.object({
      taskId: z.string(),
      artifactHash: z.string(),
      deviceId: z.string(),
      collectedBy: z.string().optional(),
      payload: z.record(z.string(), z.unknown())
    }),
    (input) => request("/api/v5/capture-evidence", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  // Frontend capture answers
  register(
    "capture_answers_list",
    "List captured AI answers with evidence.",
    z.object({
      productId: z.string().optional(),
      platform: z.string().optional()
    }),
    (input) => {
      const params = new URLSearchParams();
      if (input.productId) params.set("productId", String(input.productId));
      if (input.platform) params.set("platform", String(input.platform));
      const qs = params.toString();
      return request(`/api/v5/frontend-capture/answers${qs ? `?${qs}` : ""}`);
    }
  );

  register(
    "capture_answer_detail",
    "Get detailed answer with evidence and gaps.",
    z.object({ answerId: z.string() }),
    ({ answerId }) => request(`/api/v5/frontend-capture/answers/${encodeURIComponent(String(answerId))}`)
  );

  return server;
}

void serveStdio(createCaptureMcpServer);
