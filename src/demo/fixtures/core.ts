import type { ProductRegistryItem } from "@/lib/v5/product-registry-contracts";
import type { ProductionMatrixTask } from "@/lib/v5/monthly-workspace-contracts";
import { DEMO_CHANNELS, DEMO_ORDER_ID, DEMO_SCHEMA, type DemoOrder, type DemoScenario, type DemoState } from "../model";
import { makeExpressions, makeFreeBatch } from "./production";
import { makeKnowledge, makeProductDetail, makeResearch, makeStrategy, makeArticleTypes, makeCollectionSources } from "./knowledge";
import { makeMonitoring, makeSiteAudits } from "./monitoring";
import { initializeDemoHistory } from "../hosted-history";
export function articleText(productName: string, title: string) {
    return `# ${title}\n\n> 演示资料：以下产品、场景和结果均为虚构，不代表真实企业能力或业务成效。\n\n## 一个需要被接住的工作请求\n\n运营同事收到一份活动需求，需要确认目标、拆分任务、找到资料，并在交付前核对结果。信息分散时，最耗时的是反复确认“现在做到哪一步”。\n\n${productName} 在这个虚拟案例中提供任务记录、资料引用和人工确认入口。系统先整理输入，再生成可检查的草稿；最终判断仍由用户完成。\n\n## 从资料到可检查的结果\n\n1. 录入任务目标，关联产品说明与使用边界。\n2. 依据已确认资料组织初稿，每项关键表述保留来源。\n3. 检查是否缺少事实、素材或发布授权。\n4. 人工确认后进入排程，并记录处理结果。\n\n| 环节 | 系统输出 | 用户判断 |\n| --- | --- | --- |\n| 资料整理 | 来源清单与事实摘要 | 确认适用范围 |\n| 内容生成 | 正文与引用 | 确认表达和证据 |\n| 发布与监测 | 状态、链接和指标 | 处理系统无法判断的事项 |\n\n## 使用边界\n\n演示中的数据采用固定样本。系统不能将没有证据的数字写成真实效果，也不能替用户决定对外承诺。资料缺失时，页面展示补充入口；确认完成后，任务从原阶段继续。\n\n## 下一步\n\n可以从一个月度计划开始，查看同一条任务在正文、发布结果和监控页之间如何流转。\n\n资料来源：[虚拟产品说明](/demo-article/product-guide)。`;
}
export function makeProducts(now: string): ProductRegistryItem[] {
    return [{ productId: "orbitdesk", canonicalName: "OrbitDesk", displayName: "OrbitDesk 协作助手", productCategory: "团队协作与知识管理" }, { productId: "harborflow", canonicalName: "HarborFlow", displayName: "HarborFlow 流程助手", productCategory: "流程自动化" }].map(p => ({ ...p, entityRelationship: "星屿实验室自主设计的虚构演示产品", brandName: "星屿实验室（虚构）", officialEntity: "星屿实验室（虚构）", officialUrl: "https://example.com/" + p.productId, aliases: [p.canonicalName], status: "active", rowVersion: 1, isPromoting: true, strategyPackId: `strategy-${p.productId}`, createdAt: now, updatedAt: now }));
}
export function makeOrder(product: ProductRegistryItem, now: string, id = DEMO_ORDER_ID): DemoOrder {
    return { orderId: id, productId: product.productId, productName: product.displayName, contactEmail: "presenter@example.com", contactEmailVerified: true, status: "running", rowVersion: 1, channels: DEMO_CHANNELS.map(channel => ({ channel, dailyCap: 2 })), dailyCaps: Object.fromEntries(DEMO_CHANNELS.map(c => [c, 2])), notificationPreferences: { dailyDigest: true, monthlyCompleted: true }, materialSummary: { officialUrl: product.officialUrl!, fileNames: ["virtual-product-guide.md", "virtual-use-cases.md"], acceptedSourceCount: 3, failedSources: [], importStatus: "completed" }, updatedAt: now };
}
export function makeTask(product: ProductRegistryItem, month: string, now: string, index: number): ProductionMatrixTask {
    const taskId = `demo-task-${index + 1}`;
    const titles = ["从分散信息到协作闭环：OrbitDesk 使用指南", "团队知识如何进入实际工作流程", "流程自动化中哪些判断应交给人", "从任务输入到可追溯的交付结果", "一次活动方案的资料与审核流程", "如何核对产品介绍中的效果数据"];
    const title = titles[index] || `${product.displayName} 使用场景 ${index + 1}`;
    const status = index < 3 ? "published" : index === 5 ? "awaiting_material" : "scheduled";
    const draftId = `demo-draft-${index + 1}`;
    return { taskId, monthlyPlanId: `demo-plan-${month}`, productId: product.productId, productNameSnapshot: product.displayName, planningSource: "geo_strategy", strategyPackageId: `strategy-${product.productId}`, quotaRuleId: `quota-${index + 1}`, questionVersionId: `question-${product.productId === "orbitdesk" ? (index % 2) + 1 : (index % 2) + 3}`, question: "团队如何建立可追溯的内容协作流程？", baseTopicIndex: index, title, contentType: "scenario", articleTypeProfileVersionId: "article-type-guide-v1", articleTypeNameSnapshot: "场景解读", typeMatchRunId: "demo-type-match", typeSelectionSource: "ai_recommended", matchReasonSnapshot: "适合展示从需求到结果的操作过程。", articleTypePromptConstraintSnapshot: "只引用已确认的虚拟资料；不编造真实效果。", articleTypePromptConstraintSnapshotHash: "demo-rules-v1", channel: DEMO_CHANNELS[index % 4], rulePackageVersionId: `rule-${product.productId}`, knowledgeBaseIds: [`kb-${product.productId}`], sourceSnapshotHash: `snapshot-${product.productId}`, evidencePackSourceSnapshotHash: `evidence-${product.productId}`, status, recoveryAttemptCount: 0, automaticRepairCount: 0, currentDraft: { draftId, title, markdown: articleText(product.displayName, title), status: "available", basisSummary: ["虚拟产品说明", "虚拟使用场景"], updatedAt: now }, scheduledAt: index === 5 ? undefined : `${month}-${String(index < 3 ? index + 1 : 15 + index % 10).padStart(2, "0")}T09:00:00+08:00`, platformAccount: "demo-account", formal: true, formalDraftId: draftId, ctaValidationStatus: "passed", failureReason: index === 5 ? "缺少效果数据的依据，请补充虚拟材料后继续。" : undefined, publicUrl: index < 3 ? `/demo-article/${taskId}` : undefined, updatedAt: now };
}
export function createDemoState(scenario: DemoScenario = "populated", date = new Date()): DemoState {
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(date);
    const now = `${month}-05T10:30:00+08:00`;
    const products = makeProducts(now);
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(products[0], month, now, i));
    const order = makeOrder(products[0], now);
    const expressions = makeExpressions(products, now);
    const state: DemoState = { schema: DEMO_SCHEMA, revision: 1, scenario, month, now, identity: { email: "presenter@example.com", workspaceId: "demo-workspace", role: "workspace_admin" }, products, orders: [order], tasks, taskOrders: Object.fromEntries(tasks.map(t => [t.taskId, order.orderId])), drafts: {}, productDetails: {}, research: {}, strategies: {}, knowledge: [], collectionSources: [], questions: [], expressions, freeBatches: [], articleTypes: makeArticleTypes(now), expressionProfiles: [], assets: [], siteAudits: [], monitoringQuestions: [], connections: [], reviews: {}, mails: [], settings: { id: "workspace-setting-default", enabledChannels: ["wechat", "csdn", "juejin", "zhihu_toutiao_general"], enabledProducts: ["joto_brand", "weike_guardrails"], productPlans: [{ product: "joto_brand", channels: ["wechat"], knowledgeBaseId: "kb-orbitdesk", knowledgeBaseIds: ["kb-orbitdesk"], productExpressionRulePackageId: "kb-orbitdesk", enabled: true }, { product: "weike_guardrails", channels: ["csdn"], knowledgeBaseId: "kb-harborflow", knowledgeBaseIds: ["kb-harborflow"], productExpressionRulePackageId: "kb-harborflow", enabled: true }], currentRole: "content_publisher", finalReviewMode: "default_final", logMode: "demo_csv" }, events: [{ id: "demo-event-initial", action: "monthly_plan_approved", objectId: `demo-plan-${month}`, at: now, summary: "演示月度计划已确认，任务进入生产与发布。" }], idempotency: {} };
    for (const product of products) {
        state.productDetails[product.productId] = makeProductDetail(product, now);
        state.knowledge.push(makeKnowledge(product, now));
        state.research[product.productId] = makeResearch(product, now);
        state.strategies[product.productId] = makeStrategy(product, month, now);
    }
    for (const task of tasks)
        state.drafts[task.formalDraftId!] = { id: task.formalDraftId, draftId: task.formalDraftId, taskId: task.taskId, title: task.title, markdown: task.currentDraft!.markdown, body: task.currentDraft!.markdown, status: "available", version: 1, createdAt: now, updatedAt: now };
    if (scenario !== "first-use")
        for (const draft of Object.values(state.drafts))
            draft.sampleApproved = true;
    state.collectionSources = makeCollectionSources(products, now);
    state.monitoringQuestions = makeMonitoring(products, month, now);
    state.siteAudits = makeSiteAudits(products, now);
    state.monitoringQuestions.forEach((q, i) => { q.questionId = `question-${i + 1}`; });
    state.questions = state.monitoringQuestions.map((q, i) => ({ ...q, currentVersion: { text: q.questionText, product: products.find(p => p.productId === q.productId)?.displayName }, geoMonitoringApproval: { status: "approved", approvedAt: now, approvedBy: "demo-user" }, questionId: `question-${i + 1}`, questionVersionId: `question-${i + 1}`, versionId: `question-${i + 1}`, text: q.question, questionText: q.question, status: "monthly_ready", priority: "P0", tags: ["场景"], semanticKeywords: ["团队协作", "知识管理"], monthlyDecision: "keep", rowVersion: 1, versions: [] }));
    state.freeBatches = [makeFreeBatch(products[0], expressions[0].activeVersion!, month, now, "demo-free-ready"), makeFreeBatch(products[1], expressions[1].activeVersion!, month, now, "demo-free-published")];
    state.freeBatches[1].status = "ready_for_confirmation";
    state.assets = products.flatMap(p => ["workflow", "cover"].map((kind, i) => ({ id: `asset-${p.productId}-${kind}`, productId: p.productId, kind: i ? "brand_visual" : "workflow_diagram", name: `${p.canonicalName} ${i ? "封面" : "流程图"}`, title: `${p.canonicalName} ${i ? "封面" : "流程图"}`, description: "自行绘制的虚拟演示素材", originalFileName: `${kind}.svg`, productNameSnapshot: p.displayName, mediaKind: "image", byteSize: 1200, createdBy: "demo-user", updatedBy: "demo-user", mimeType: "image/svg+xml", width: 1200, height: 630, sizeBytes: 1200, version: 1, status: "active", tags: ["虚拟素材", "流程"], url: `/demo-assets/${kind}.svg`, contentUrl: `/demo-assets/${kind}.svg`, previewUrl: `/demo-assets/${kind}.svg`, sourceType: "upload", createdAt: now, updatedAt: now })));
    state.connections = DEMO_CHANNELS.map((channel, i) => ({ id: `demo-connection-${channel}`, channel, platform: channel, productId: products[0].productId, orderId: order.orderId, status: "connected", phase: "connected", authorizationPhase: "connected", authorizationStatus: "connected", accountId: `demo-account-${channel}`, accountLabel: "星屿实验室（虚拟账号）", displayName: "星屿实验室（虚拟账号）", accountFingerprint: `demo-account-${i}`, executorNodeId: "demo-node", rowVersion: 1, updatedAt: now }));
    const reviewOrder = makeOrder(products[1], now, "demo-order-review");
    reviewOrder.status = "pending_strategy_review";
    reviewOrder.channels = [{ channel: "zhihu", dailyCap: 1 }];
    reviewOrder.dailyCaps = { zhihu: 1 };
    state.orders.push(reviewOrder);
    const reviewTask = makeTask(products[1], month, now, 6);
    reviewTask.status = "available";
    reviewTask.channel = "zhihu";
    reviewTask.scheduledAt = undefined;
    tasks.push(reviewTask);
    state.taskOrders[reviewTask.taskId] = reviewOrder.orderId;
    state.drafts[reviewTask.formalDraftId!] = { ...reviewTask.currentDraft, version: 1 };
    for (const gate of ["strategy", "sample"] as const)
        state.reviews[`demo-${gate}`] = { orderId: reviewOrder.orderId, gateType: gate, status: "pending", expiresAt: `${month}-28T23:59:59+08:00` };
    state.mails = [{ id: "demo-mail-digest", orderId: order.orderId, kind: "digest", subject: "OrbitDesk 每日发布结果：3 篇已发布，1 项需你处理", to: order.contactEmail, createdAt: now, href: `/hosted/email?orderId=${order.orderId}`, summary: "计划 6 篇，已发布 3 篇，审核或顺延 2 篇，需补充资料 1 篇。", status: "simulated" }, ...(["strategy", "sample"] as const).map(gate => ({ id: `demo-mail-${gate}`, orderId: reviewOrder.orderId, kind: gate, subject: gate === "strategy" ? "请确认 HarborFlow 本月推广策略" : "请确认 HarborFlow 代表样文", to: order.contactEmail, createdAt: now, href: `/hosted/review/demo-${gate}`, summary: "请查看内容后确认，或提交修改意见。", status: "simulated" as const }))];
    if (scenario === "first-use") {
        state.identity = null;
        order.status = "pending_strategy_review";
        for (const review of Object.values(state.reviews)) {
            review.status = "pending";
            review.orderId = order.orderId;
            delete review.decision;
        }
        for (const task of tasks) {
            task.status = "available";
            task.publicUrl = undefined;
            task.failureReason = undefined;
        }
        state.mails = state.mails.filter(m => m.kind === "strategy");
    }
    if (scenario !== "first-use")
        state.strategies[order.productId].status = "production_ready";
    if (scenario === "attention") {
        order.status = "action_required";
        order.lastError = { code: "evidence_missing", message: "效果数据缺少依据，请补充演示资料。" };
    }
    if (scenario === "completed") {
        for (const o of state.orders)
            o.status = "completed";
        for (const r of Object.values(state.reviews))
            r.status = "acted";
        order.status = "completed";
        for (const task of tasks) {
            task.status = "published";
            task.failureReason = undefined;
            task.publicUrl = `/demo-article/${task.taskId}`;
        }
        state.mails.unshift({ id: "demo-mail-completed", orderId: order.orderId, kind: "completed", subject: "本月执行完成与下一月建议", to: order.contactEmail, createdAt: now, href: "/content-monitor?tab=ai", summary: "本月六篇内容已完成模拟发布。建议下月补充对比场景与使用边界。", status: "simulated" });
    }
    return initializeDemoHistory(state);
}
