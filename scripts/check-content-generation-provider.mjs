import process from "node:process";
import { callAiProvider } from "../src/lib/ai-provider.ts";

const configured = String(process.env.CONTENT_GENERATION_PROVIDER || "qwen").trim().toLowerCase();
if (!new Set(["qwen", "deepseek", "doubao"]).has(configured)) {
  console.error(JSON.stringify({ ok: false, code: "unsupported_provider", provider: configured }));
  process.exit(1);
}

const result = await callAiProvider({
  provider: configured,
  systemPrompt: "Return strict JSON only.",
  userPrompt: JSON.stringify({ task: "provider health check", output: { ok: true } }),
  temperature: 0,
  maxTokens: 64,
  timeoutMs: 60_000
});

console.log(JSON.stringify({
  ok: result.ok,
  status: result.status,
  provider: result.provider,
  model: result.model,
  responseChars: result.content?.length || 0,
  errorMessage: result.errorMessage
}, null, 2));
if (!result.ok) process.exit(1);
