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
    content: [{ type: "text", text: error instanceof Error ? error.message : "GEO Research tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createGeoResearchMcpServer() {
  const server = new McpServer(
    { name: "joto-geo-research-workbench", version: "1.0.0" },
    {
      instructions:
        "Query GEO research questions, keywords, and research runs. Never modify research outcomes without explicit approval."
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
    "geo_questions_list",
    "List all GEO research questions.",
    z.object({
      productId: z.string().optional(),
      status: z.string().optional()
    }),
    (input) => {
      const params = new URLSearchParams();
      if (input.productId) params.set("productId", String(input.productId));
      if (input.status) params.set("status", String(input.status));
      const qs = params.toString();
      return request(`/api/v5/questions${qs ? `?${qs}` : ""}`);
    }
  );

  register(
    "geo_questions_select_monthly",
    "Select and approve monthly questions for a product.",
    z.object({
      productId: z.string(),
      month: z.string()
    }),
    (input) => request("/api/v5/questions/select-monthly", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "geo_questions_ingest_signals",
    "Ingest external signals for question discovery.",
    z.object({
      productId: z.string(),
      signals: z.array(z.object({
        source: z.string(),
        query: z.string(),
        volume: z.number().optional()
      }))
    }),
    (input) => request("/api/v5/questions/ingest-signals", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "geo_keywords_list",
    "List semantic keywords with status.",
    z.object({
      productId: z.string().optional(),
      status: z.string().optional()
    }),
    (input) => {
      const params = new URLSearchParams();
      if (input.productId) params.set("productId", String(input.productId));
      if (input.status) params.set("status", String(input.status));
      const qs = params.toString();
      return request(`/api/v5/semantic-keywords${qs ? `?${qs}` : ""}`);
    }
  );

  register(
    "geo_product_research_status",
    "Get GEO research workspace for a product.",
    z.object({ productId: z.string() }),
    ({ productId }) => request(`/api/v5/products/${encodeURIComponent(String(productId))}`)
  );

  register(
    "geo_product_research_runs",
    "List research runs for a product.",
    z.object({ productId: z.string() }),
    ({ productId }) => request(`/api/v5/products/${encodeURIComponent(String(productId))}/research-runs`)
  );

  return server;
}

void serveStdio(createGeoResearchMcpServer);
