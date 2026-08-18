import assert from "node:assert/strict";
import test from "node:test";
import { assertSafePublicUrl, auditSiteHtml, runSiteAudit } from "../src/lib/v5/site-audit-runner.ts";
import { computeGeoQuestionMetric, getGeoMonitoringSampleSchedule } from "../src/lib/v5/geo-monitoring-repository.ts";
import { parseMonitoringQuestions } from "../src/lib/geo-monitoring-input.ts";
import { toMysqlDateTime } from "../src/lib/v5/site-audit-repository.ts";

test("website audit normalizes ISO evidence timestamps before MySQL writes", () => {
  assert.equal(toMysqlDateTime("2026-08-16T12:28:34.446Z"), "2026-08-16 12:28:34");
  assert.throws(() => toMysqlDateTime("not-a-date"), /无效时间/);
});

test("website audit reports deterministic evidence without experimental signals in the core checks", () => {
  const healthy = auditSiteHtml("run-1", "https://example.com/guide", `<!doctype html><html lang="zh-CN"><head><title>产品指南</title><meta name="description" content="清晰说明"><link rel="canonical" href="https://example.com/guide"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"产品指南","author":{"@type":"Organization","name":"Example"}}</script></head><body><h1>产品指南</h1><p>${"这是有事实依据的正文。".repeat(30)}</p><a href="https://www.rfc-editor.org/rfc/rfc9309.html">RFC 9309</a><ul><li>边界</li></ul></body></html>`);
  assert.equal(healthy.evidence.validSchema, 1);
  assert.equal(healthy.evidence.h1Count, 1);
  assert.equal(healthy.findings.some((item) => item.code === "schema_missing"), false);
  assert.equal(healthy.findings.some((item) => item.code === "missing_title"), false);

  const broken = auditSiteHtml("run-2", "https://example.com/empty", "<html><body><p>少量正文</p></body></html>");
  assert.ok(broken.findings.some((item) => item.code === "missing_title"));
  assert.ok(broken.findings.some((item) => item.code === "schema_missing"));
  assert.ok(broken.findings.every((item) => item.evidenceSource === "page_audit_deterministic"));
});

test("website audit applies page-aware evidence and platform compliance rules", () => {
  const page = (title, heading, body, schemaType = "WebPage") => `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="Clear description"><link rel="canonical" href="https://joto.ai/test"><script type="application/ld+json">{"@context":"https://schema.org","@type":"${schemaType}","name":"${title}","url":"https://joto.ai/test"}</script></head><body><h1>${heading}</h1>${body}<ul><li>Boundary</li></ul></body></html>`;

  const terms = auditSiteHtml("run-terms", "https://joto.ai/terms", page("Terms of Service | AdsBridge", "AdsBridge Terms of Service", `<h2>Acceptance and eligibility</h2><p>Operators must comply with Google Ads and relevant Google API policies.</p><p>${"Authorized internal business use only. ".repeat(20)}</p>`));
  assert.equal(terms.evidence.pageType, "terms");
  assert.equal(terms.findings.some((item) => item.code === "source_evidence_missing"), false, "first-party legal terms must not require generic citations");
  const termsReference = terms.findings.find((item) => item.code === "platform_terms_reference_unlinked");
  assert.ok(termsReference);
  assert.equal(termsReference.category, "compliance");
  assert.ok(termsReference.remediationGuidance.targetLocations.some((item) => item.includes("Acceptance")));

  const product = auditSiteHtml("run-product", "https://joto.ai/adsbridge", page("AdsBridge Google Ads workspace", "A private Google Ads operations workspace", `<h2>How Google data is used</h2><p>${"Google Ads account data is used for authorized campaign operations and OAuth workflows. ".repeat(12)}</p>`, "SoftwareApplication"));
  assert.equal(product.evidence.pageType, "product_service");
  const productReference = product.findings.find((item) => item.code === "platform_reference_missing");
  assert.ok(productReference);
  assert.ok(productReference.remediationGuidance.suggestedCopy[0].includes("Google API Services User Data Policy"));

  const privacy = auditSiteHtml("run-privacy", "https://joto.ai/privacy-policy", page("Privacy Policy | AdsBridge", "AdsBridge Privacy Policy", `<h2>Google API and Google user data</h2><p>We explain the categories of information we may process, how we use information, sharing and disclosure, retention, security and access controls for Google Ads OAuth data.</p>`));
  assert.equal(privacy.evidence.pageType, "privacy_policy");
  assert.equal(privacy.findings.some((item) => item.code === "source_evidence_missing"), false, "privacy commitments are not third-party evidence claims");
  assert.ok(privacy.findings.some((item) => item.code === "google_data_policy_reference_missing"));
  const controls = privacy.findings.find((item) => item.code === "google_data_controls_incomplete");
  assert.ok(controls.detectionEvidence.includes("用户删除流程"));
  assert.ok(controls.detectionEvidence.includes("撤销 OAuth 授权步骤"));
  assert.ok(controls.detectionEvidence.includes("OAuth scope 清单"));
  assert.ok(controls.remediationGuidance.acceptanceCriteria.length >= 3);

  const sourcedTerms = auditSiteHtml("run-terms-linked", "https://joto.ai/terms", page("Terms of Service | AdsBridge", "AdsBridge Terms of Service", `<p>Operators comply with Google Ads and Google API policies.</p><a href="https://developers.google.com/terms">Google APIs Terms</a>`));
  assert.equal(sourcedTerms.findings.some((item) => item.code === "platform_terms_reference_unlinked"), false);

  const weakArticleLink = auditSiteHtml("run-article-weak-link", "https://joto.ai/blog/benchmark", page("2026 industry benchmark", "Industry benchmark", `<p>${"The report shows performance increased by 35%. ".repeat(35)}</p><a href="https://example.com/promotion">click here</a>`, "Article"));
  assert.equal(weakArticleLink.evidence.externalEvidenceLinkCount, 1);
  assert.equal(weakArticleLink.evidence.traceableEvidenceLinkCount, 0);
  assert.ok(weakArticleLink.findings.some((item) => item.code === "source_evidence_missing"), "an arbitrary external link must not satisfy the evidence rule");
});

test("website audit URL guard rejects loopback and metadata targets", async () => {
  await assert.rejects(() => assertSafePublicUrl("http://127.0.0.1/admin"), /private_network_target/);
  await assert.rejects(() => assertSafePublicUrl("http://169.254.169.254/latest/meta-data"), /private_network_target/);
  await assert.rejects(() => assertSafePublicUrl("http://[::1]/admin"), /private_network_target/);
  await assert.rejects(() => assertSafePublicUrl("https://203.0.113.10/test"), /private_network_target/);
});

test("website audit renders SPA pages on demand and fails closed when rendering is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  const scopeUrl = "https://93.184.216.34/";
  const spaHtml = '<!doctype html><html lang="zh-CN"><head><title>品牌官网</title><meta name="description" content="品牌说明"><link rel="canonical" href="https://93.184.216.34/"></head><body><div id="root"></div><script src="/assets/app.chunk.js"></script></body></html>';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return new Response(spaHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
  };
  try {
    const rendered = await runSiteAudit({
      runId: "run-rendered",
      scopeUrl,
      maxPages: 1,
      renderPage: async () => ({
        finalUrl: scopeUrl,
        httpStatus: 200,
        html: `<!doctype html><html lang="zh-CN"><head><title>品牌官网</title><meta name="description" content="品牌说明"><link rel="canonical" href="${scopeUrl}"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","url":"${scopeUrl}"}</script></head><body><h1>品牌官网</h1><p>${"这是服务端渲染后可验证的产品事实与适用边界。".repeat(35)}</p><a href="https://www.rfc-editor.org/rfc/rfc9309.html">公开依据</a><ul><li>适用范围</li></ul></body></html>`
      })
    });
    assert.equal(rendered.pages[0].renderMode, "browser_rendered");
    assert.equal(rendered.findings.some((item) => item.code === "javascript_rendering_unverified"), false);
    assert.equal(typeof rendered.technicalReadinessScore, "number");
    assert.equal(typeof rendered.contentCitabilityScore, "number");
    assert.equal(rendered.platformComplianceScore, 100);

    const unavailable = await runSiteAudit({ runId: "run-unavailable", scopeUrl, maxPages: 1, renderPage: async () => { throw new Error("renderer_offline"); } });
    assert.equal(unavailable.pages[0].renderMode, "raw_html");
    assert.equal(unavailable.findings.some((item) => item.code === "javascript_rendering_unverified"), true);
    assert.equal(unavailable.findings.some((item) => item.code === "thin_content"), false, "raw SPA shell must not create a false content finding");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("question metrics are calculated only from real capture evidence", () => {
  const config = {
    id: "monitor-1", productId: "product-1", questionText: "哪个产品适合企业？", status: "active", selectionSource: "manual",
    priority: "high", platforms: ["doubao", "chatgpt"], locale: "zh-CN", region: "CN", ownedDomains: ["example.com"], samplesPerMonth: 3,
    activeFrom: "2026-08-01", approvedBy: "user", approvedAt: "2026-08-01T00:00:00.000Z", rowVersion: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const rows = [
    { monitoring_question_id: "monitor-1", platform: "doubao", status: "completed", payload: { targetEntityMentioned: true, citations: [{ url: "https://example.com/a", position: 1 }] } },
    { monitoring_question_id: "monitor-1", platform: "doubao", status: "completed", payload: { targetEntityMentioned: true, citations: [{ url: "https://competitor.com/a", position: 1 }, { url: "https://docs.example.com/b", position: 2 }] } },
    { monitoring_question_id: "monitor-1", platform: "chatgpt", status: "completed", payload: { targetEntityMentioned: false, citations: [] } },
    { monitoring_question_id: "monitor-1", platform: "chatgpt", status: "failed" },
    { monitoring_question_id: "monitor-1", platform: "chatgpt", status: "pending" }
  ];
  const metric = computeGeoQuestionMetric(config, rows, "2026-08");
  assert.equal(metric.evidenceSource, "ui_capture_real");
  assert.equal(metric.successfulRuns, 3);
  assert.equal(metric.brandMentionRate, 2 / 3);
  assert.equal(metric.ownedCitationRate, 2 / 3);
  assert.equal(metric.citationShareOfVoice, 2 / 3);
  assert.equal(metric.medianCitationRank, 1.5);
  assert.equal(metric.answerFailureRate, 1 / 4);
  assert.equal(metric.totalRuns, 4, "pending samples must not dilute the observed failure rate");
  assert.equal(metric.sampleStatus, "directional");
  assert.equal(metric.platformCoverageComplete, false);
  assert.ok(metric.brandMentionConfidence95.lower < metric.brandMentionRate);
  assert.ok(metric.brandMentionConfidence95.upper > metric.brandMentionRate);
  assert.ok(metric.ownedCitationConfidence95.lower < metric.ownedCitationRate);
});

test("question samples are deterministically spread across the calendar month", () => {
  assert.deepEqual(getGeoMonitoringSampleSchedule("2026-08", 3), [
    "2026-08-01T01:00:00.000Z",
    "2026-08-16T01:00:00.000Z",
    "2026-08-31T01:00:00.000Z"
  ]);
});

test("manual monitoring input accepts multiple questions and removes duplicate list items", () => {
  assert.deepEqual(parseMonitoringQuestions("1. 第一个监控问题？\n\n- 第二个监控问题？\n第一个监控问题？"), [
    "第一个监控问题？",
    "第二个监控问题？"
  ]);
});

test("question metrics omit owned citation rates when no owned domain is configured", () => {
  const config = {
    id: "monitor-without-domain", productId: "product-1", questionText: "企业如何选择产品？", status: "active", selectionSource: "manual",
    priority: "medium", platforms: ["doubao"], locale: "zh-CN", region: "CN", ownedDomains: [], targetSolutionUrls: [], samplesPerMonth: 3,
    activeFrom: "2026-08-01", approvedBy: "user", approvedAt: "2026-08-01T00:00:00.000Z", rowVersion: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const metric = computeGeoQuestionMetric(config, [
    { monitoring_question_id: config.id, platform: "doubao", status: "completed", payload: { targetEntityMentioned: true, citations: [{ url: "https://example.com/a", position: 1 }] } }
  ], "2026-08");
  assert.equal(metric.brandMentionRate, 1);
  assert.equal(metric.ownedCitationRate, null);
  assert.equal(metric.ownedCitationConfidence95, null);
  assert.equal(metric.citationShareOfVoice, null);
  assert.equal(metric.platformBreakdown[0].ownedCitationRate, null);
});
