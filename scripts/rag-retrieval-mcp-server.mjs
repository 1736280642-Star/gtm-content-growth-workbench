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
    content: [{ type: "text", text: error instanceof Error ? error.message : "RAG tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createRagRetrievalMcpServer() {
  const server = new McpServer(
    { name: "joto-rag-retrieval-workbench", version: "1.0.0" },
    {
      instructions:
        "Retrieve and align evidence from RAG indexes. Never expose raw index internals or embedding configurations."
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
    "rag_retrieve",
    "Perform vector + keyword retrieval from the RAG index.",
    z.object({
      query: z.string(),
      productId: z.string().optional(),
      topK: z.number().optional().default(5),
      filters: z.record(z.string(), z.unknown()).optional()
    }),
    (input) => request("/api/rag/retrieve", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "rag_evidence_pack",
    "Get evidence pack for a specific claim or question.",
    z.object({
      questionId: z.string().optional(),
      claimId: z.string().optional(),
      productId: z.string().optional()
    }),
    (input) => request("/api/rag/evidence-packs", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "rag_source_snapshot",
    "Get the latest source snapshot for a product.",
    z.object({ productId: z.string() }),
    ({ productId }) => request(`/api/v5/products/${encodeURIComponent(String(productId))}`)
  );

  return server;
}

void serveStdio(createRagRetrievalMcpServer);
