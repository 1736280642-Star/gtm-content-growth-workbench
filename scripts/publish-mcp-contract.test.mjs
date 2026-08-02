import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("official MCP client discovers the high-level publish tools over stdio", async () => {
  const client = new Client({ name: "joto-publish-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/publish-mcp-server.mjs")],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = new Set(result.tools.map((tool) => tool.name));
    for (const name of [
      "platform_auth_probe",
      "publish_content_preflight",
      "publish_job_create",
      "publish_job_run",
      "publish_job_get",
      "publish_job_reconcile",
      "publish_url_verify",
      "publish_liveness_check"
    ]) {
      assert.equal(names.has(name), true, `${name} should be discoverable`);
    }
    assert.equal(client.getProtocolEra() === "2026" || client.getProtocolEra() === "legacy", true);
  } finally {
    await client.close();
  }
});
