import { dataReply, demoError, expectVersion, required, type DemoRecord, type DemoRequest, type DemoState } from "../model";
import { makeSiteAudits, monitorOverview, questionMetric } from "../fixtures/monitoring";
export function monthlyReview(state: DemoState, month = state.month): DemoRecord {
    const published = state.tasks.filter(t => t.status === "published");
    const questions = state.monitoringQuestions.map(q => ({ id: `review-${q.id}`, month, questionKey: q.questionId || q.id, questionText: q.questionText, geoMonitoringApproved: q.status === "active", monthlyPlanIds: [`demo-plan-${month}`], plannedContentCount: state.tasks.filter(t => t.productId === q.productId).length, publishedContent: published.filter(t => t.productId === q.productId).map(t => ({ contentId: t.taskId, title: t.title, channel: t.channel, publishedAt: t.updatedAt, publicUrl: t.publicUrl, liveness24h: "passed", liveness72h: "passed", hasMetricReturn: true, metricSummary: "合成演示指标" })), captureTaskIds: [`capture-${q.id}-1`, `capture-${q.id}-2`, `capture-${q.id}-3`], captureSummary: "12 次虚拟样本，用于演示计算口径", geoMetric: questionMetric(q, month), crossLineObservation: "虚拟样本展示前后变化，不代表实际投放带来的因果效果。", lastRetestedAt: state.now, confirmedGapCodes: ["scenario_detail"], recommendationEvidenceRefs: [`snapshot-${q.productId}`], recommendation: "下月补充具体操作步骤与使用边界。", dataStatus: "complete" }));
    const [year, m] = month.split("-").map(Number), nextMonth = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7);
    return { id: `review-${month}`, month, dataAsOf: state.now, source: "fixture", metrics: { plannedContent: state.tasks.length, publishedContent: published.length, effectiveMetricReturns: published.length, survival24hPassed: published.length, survival24hEligible: published.length, survival72hPassed: published.length, survival72hEligible: published.length, captureTasks: state.monitoringQuestions.length * 12, pendingGaps: state.tasks.filter(t => t.failureReason).length, activeMonitoringQuestions: state.monitoringQuestions.filter(q => q.status === "active").length }, siteMonitoring: { source: "formal_database", latestRunId: state.siteAudits[0]?.id, coreReadinessScore: 82, openFindingCount: state.siteAudits.flatMap(r => r.findings).filter(f => f.status === "open").length, criticalFindingCount: 0, newFindingCount: 2, resolvedFindingCount: 2, note: "虚拟官网审计样本" }, questions, productOptimizations: productOptimizations(state), proposals: questions.map(q => ({ id: `proposal-${q.id}`, version: 1, sourceMonthlyReviewId: `review-${month}`, sourceMonth: month, targetMonth: nextMonth, questionKey: q.questionKey, recommendation: q.recommendation, rationale: "虚拟问答样本显示操作细节覆盖不足。", evidenceRefs: q.recommendationEvidenceRefs, status: "proposal", monthlyTaskCreated: false, quotaChanged: false, createdAt: state.now, createdBy: "demo-worker" })), message: "本页结果为合成数据，不代表真实成效。" };
}
function productOptimizations(state: DemoState) {
    return state.products.map(p => ({ id: `optimization-${p.productId}`, productId: p.productId, productName: p.displayName, month: state.month, batchClosed: true, websiteReadiness: "partial", signals: { targetMentionRate: 0.75, ownedCitationRate: 2 / 3, relationshipAccuracyRate: 1 }, actions: [{ action: "refresh_existing", title: "补充产品说明中的操作步骤", priority: "P1", candidateDestination: "monthly_plan", reason: "覆盖用户的问题意图" }], evidenceRefs: [`snapshot-${p.productId}`] }));
}
export function monitoringRequest(state: DemoState, req: DemoRequest) {
    const url = new URL(req.path, "https://demo.invalid"), path = url.pathname, body = req.body, write = req.method !== "GET";
    if (path === "/api/v5/content-monitor/overview")
        return dataReply(monitorOverview(state, url.searchParams.get("platforms")?.split(",")));
    if (path === "/api/v5/content-monitor/alerts")
        return dataReply({ items: state.tasks.filter(t => t.failureReason).map(t => ({ id: `alert-${t.taskId}`, kind: "publish_retry", title: t.title, platform: t.channel, occurredAt: state.now, reason: t.failureReason, nextAction: "补充虚拟资料后重试", retryCount: 0 })) });
    if (path === "/api/v5/content-monitor/sync" && write) {
        state.now = new Date(new Date(state.now).getTime() + 60000).toISOString();
        return dataReply({ accepted: true, status: "completed", syncedPlatforms: body.platforms || [], capturedItems: state.tasks.filter(t => t.status === "published").length, message: "模拟采集已更新，指标来自当前演示任务。" });
    }
    if (path === "/api/v5/content-monitor/product-optimizations")
        return dataReply({ products: productOptimizations(state), source: "formal_database" });
    if (path === "/api/v5/geo-monitoring-questions") {
        if (write) {
            if (!body.questionText?.trim())
                demoError("请输入监控问题。");
            required(state.products.find(p => p.productId === body.productId), "产品");
            const question = { ...structuredClone(state.monitoringQuestions[0]), ...body, id: `monitor-${state.revision}`, question: body.questionText, rowVersion: 1, status: "active", createdAt: state.now, updatedAt: state.now };
            state.monitoringQuestions.push(question);
        }
        const month = url.searchParams.get("month") || state.month;
        return dataReply({ source: "formal_database", questions: state.monitoringQuestions, recommendations: state.products.map(p => ({ id: `recommend-${p.productId}`, productId: p.productId, questionText: `${p.canonicalName} 如何核对任务结果？`, source: "strategy", reason: "虚拟策略建议补充操作细节", questionVersionId: `question-${p.productId}`, strategyPackId: `strategy-${p.productId}`, priority: "high" })), metrics: state.monitoringQuestions.map(q => questionMetric(q, month, month !== state.month)), message: "采用合成问答样本展示指标，不调用真实 AI 平台。" });
    }
    const question = path.match(/^\/api\/v5\/geo-monitoring-questions\/([^/]+)$/);
    if (question && write) {
        const item = required(state.monitoringQuestions.find(q => q.id === question[1]), "监控问题");
        expectVersion(item.rowVersion, body.expectedVersion);
        if (!["active", "paused", "archived"].includes(body.status))
            demoError("监控状态无效。");
        item.status = body.status;
        item.rowVersion++;
        return dataReply(item);
    }
    if (path === "/api/v5/site-audits") {
        if (write) {
            try {
                new URL(body.scopeUrl);
            }
            catch {
                demoError("请输入有效的官网 URL。");
            }
            const product = required(state.products.find(p => p.productId === body.productId) || state.products[0], "产品");
            const run = makeSiteAudits([product], state.now)[0];
            run.id = `audit-${state.revision}`;
            run.scopeUrl = body.scopeUrl;
            run.findings = run.findings.map((f: DemoRecord) => ({ ...f, id: `${f.id}-${state.revision}`, runId: run.id }));
            state.siteAudits.unshift(run);
        }
        return dataReply({ source: "formal_database", runs: state.siteAudits.map(({ findings, ...run }) => run), findings: state.siteAudits.flatMap(r => r.findings), remediationTasks: state.siteAudits.flatMap(r => r.findings.filter((f: DemoRecord) => f.status === "remediation_pending").map((f: DemoRecord) => ({ id: `remediation-${f.id}`, findingId: f.id, title: f.title, status: "open" }))), diffs: state.siteAudits.map(r => ({ comparisonRunId: r.id, newFindingIds: r.findings.filter((f: DemoRecord) => f.status === "open").map((f: DemoRecord) => f.id), resolvedFindingIds: r.findings.filter((f: DemoRecord) => f.status === "resolved").map((f: DemoRecord) => f.id) })), score: 82, experimentalSignals: [{ code: "llms.txt", status: "present", note: "虚拟实验信号，不计入核心分" }] });
    }
    const finding = path.match(/^\/api\/v5\/site-audit-findings\/([^/]+)\/(remediation|review)$/);
    if (finding && write) {
        const row = required(state.siteAudits.flatMap(r => r.findings).find(f => f.id === finding[1]), "审计问题");
        expectVersion(row.version, body.expectedVersion);
        if (!body.note?.trim())
            demoError("请填写处理说明。");
        row.status = finding[2] === "remediation" ? "remediation_pending" : body.decision;
        row.note = body.note;
        row.version++;
        return dataReply(row);
    }
    const review = path.match(/^\/api\/v5\/monthly-reviews\/([^/]+)(?:\/proposals)?$/);
    if (review)
        return dataReply(monthlyReview(state, review[1]));
    if (path === "/api/v5/questions")
        return dataReply({ questions: state.questions, items: state.questions, stateVersion: state.revision });
    if (path === "/api/v5/frontend-capture/tasks")
        return dataReply({ source: "persisted", reference: { products: state.products, questions: state.questions, platforms: ["doubao", "deepseek", "qwen", "chatgpt"] }, tasks: [], artifacts: [], answers: [], gaps: [], reviews: [], comparisons: [], environment: { source: "persisted", extension: { status: "connected", version: "demo-1.0" }, runner: { status: "ready", queueDepth: 0, recoveryAction: "当前使用虚拟采集结果" }, adapters: ["doubao", "deepseek", "qwen", "chatgpt"].map(platform => ({ platform, status: "ready", message: "虚拟平台已就绪", version: "demo-v1" })) } });
    return undefined;
}
