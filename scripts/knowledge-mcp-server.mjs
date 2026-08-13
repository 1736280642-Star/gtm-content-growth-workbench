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
    content: [{ type: "text", text: error instanceof Error ? error.message : "Knowledge tool failed." }],
    structuredContent: error?.payload || { ok: false }
  };
}

export function createKnowledgeMcpServer() {
  const server = new McpServer(
    { name: "joto-knowledge-workbench", version: "1.0.0" },
    {
      instructions:
        "Collect, manage, and retrieve knowledge base sources. Never expose raw credentials or internal storage paths."
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
    "knowledge_base_list",
    "List all knowledge bases and their status.",
    z.object({}),
    () => request("/api/v5/knowledge-bases")
  );

  register(
    "knowledge_base_get",
    "Get details of a specific knowledge base.",
    z.object({ id: z.string() }),
    ({ id }) => request(`/api/v5/knowledge-bases/${encodeURIComponent(String(id))}`)
  );

  register(
    "knowledge_collection_run",
    "Trigger a knowledge collection run for a source.",
    z.object({ sourceId: z.string().optional() }),
    (input) => request("/api/v5/knowledge-collection/run", {
      method: "POST",
      body: JSON.stringify({ sourceId: input.sourceId })
    })
  );

  register(
    "knowledge_collection_status",
    "Get today's knowledge collection status.",
    z.object({}),
    () => request("/api/v5/knowledge-collection/today")
  );

  register(
    "knowledge_import_url",
    "Import knowledge from a URL.",
    z.object({
      url: z.string(),
      knowledgeBaseId: z.string(),
      productId: z.string().optional()
    }),
    (input) => request("/api/v5/knowledge-imports/urls", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  register(
    "knowledge_import_document",
    "Trigger document import for a knowledge base.",
    z.object({
      knowledgeBaseId: z.string(),
      productId: z.string().optional()
    }),
    (input) => request("/api/v5/knowledge-imports/documents", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );

  return server;
}

void serveStdio(createKnowledgeMcpServer);
