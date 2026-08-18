import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const apiKey = process.env.GEO_RESEARCH_ZHIPU_API_KEY?.trim();
const model = process.env.GEO_RESEARCH_ZHIPU_MODEL?.trim();
const baseUrl = (process.env.GEO_RESEARCH_ZHIPU_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

if (!apiKey || !model) {
  console.log(JSON.stringify({ status: "pending_config", keyValuesExposed: false }));
  process.exit(2);
}

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    candidateId: `probe-candidate-${index + 1}`,
    url: `https://example.com/probe-${index + 1}`,
    title: `WorkBuddy enterprise service discussion ${index + 1}`,
    publisher: "capability-probe",
    excerpt: "A public discussion about enterprise AI deployment, implementation support, integration, and user questions.",
    queries: ["WorkBuddy enterprise AI implementation questions"]
  }));
}

async function probe(candidateCount) {
  const controller = new AbortController();
  const timeoutMs = Math.max(10_000, Math.min(120_000, Number(process.env.GEO_ENTITY_RESOLUTION_PROBE_TIMEOUT_MS || 90_000)));
  const timeout = setTimeout(() => controller.abort(new DOMException("probe timed out", "TimeoutError")), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Classify every supplied candidate. Return strict JSON only with {\"results\":[{\"candidateId\":\"\",\"classification\":\"target_match|category_related|user_demand|unrelated|insufficient_evidence\",\"matchedIdentityAnchors\":[],\"confidence\":0.0}]} and one result per candidateId."
          },
          {
            role: "user",
            content: JSON.stringify({
              researchTask: "live_question_discovery",
              productIdentity: {
                canonicalName: "WorkBuddy",
                brandName: "Tencent",
                category: "enterprise_ai_service"
              },
              candidates: candidates(candidateCount)
            })
          }
        ]
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    const content = payload?.choices?.[0]?.message?.content;
    let resultCount = 0;
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content);
        resultCount = Array.isArray(parsed.results) ? parsed.results.length : 0;
      } catch {
        resultCount = 0;
      }
    }
    return {
      candidateCount,
      status: response.ok ? "success" : "failed",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      resultCount,
      finishReason: payload?.choices?.[0]?.finish_reason || null
    };
  } catch (error) {
    return {
      candidateCount,
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : "unknown error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const candidateCount of [1, 12]) results.push(await probe(candidateCount));

console.log(JSON.stringify({
  keyValuesExposed: false,
  provider: "zhipu",
  model,
  probe: "entity_resolution_chat_completions",
  results
}, null, 2));

if (results.some((result) => result.status !== "success" || result.resultCount !== result.candidateCount)) process.exitCode = 2;
