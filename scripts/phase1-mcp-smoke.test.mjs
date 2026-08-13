import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

function createMockWorkbench() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, method: request.method, path: request.url }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, requests, baseUrl: `http://127.0.0.1:${address.port}` });
  }));
}

function startMcp(file, baseUrl) {
  const child = spawn(process.execPath, [file], {
    cwd: process.cwd(),
    env: { ...process.env, WORKBENCH_BASE_URL: baseUrl },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${file} timed out for ${method}. stderr: ${stderr}`));
      }, 5_000);
      pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  return { child, request, notify };
}

async function withMcp(file, baseUrl, operation) {
  const client = startMcp(file, baseUrl);
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "phase1-acceptance", version: "1.0.0" }
    });
    assert.ok(initialized.result, initialized.error?.message);
    client.notify("notifications/initialized");
    await operation(client);
  } finally {
    client.child.kill();
  }
}

test("all six Phase 1 MCP servers start and expose tools", async () => {
  const mock = await createMockWorkbench();
  try {
    for (const file of [
      "scripts/knowledge-mcp-server.mjs",
      "scripts/geo-research-mcp-server.mjs",
      "scripts/rag-retrieval-mcp-server.mjs",
      "scripts/publish-mcp-server.mjs",
      "scripts/observation-mcp-server.mjs",
      "scripts/capture-mcp-server.mjs"
    ]) {
      await withMcp(file, mock.baseUrl, async (client) => {
        const listed = await client.request("tools/list");
        assert.ok(listed.result?.tools?.length > 0, `${file} did not expose tools`);
      });
    }
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("MCP client can call knowledge, GEO research, and publish tools", async () => {
  const mock = await createMockWorkbench();
  try {
    const cases = [
      ["scripts/knowledge-mcp-server.mjs", "knowledge_base_list", {}, "/api/v5/knowledge-bases"],
      ["scripts/geo-research-mcp-server.mjs", "geo_questions_list", {}, "/api/v5/questions"],
      ["scripts/publish-mcp-server.mjs", "platform_auth_probe", { platform: "csdn" }, "/api/publishing/platforms/csdn/auth"]
    ];
    for (const [file, name, args, expectedPath] of cases) {
      await withMcp(file, mock.baseUrl, async (client) => {
        const called = await client.request("tools/call", { name, arguments: args });
        assert.equal(called.result?.isError, undefined, called.error?.message);
        assert.equal(called.result?.structuredContent?.path, expectedPath);
      });
    }
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
});
