import { DEMO_CHANNELS, DEMO_CHANNEL_LABELS, DEMO_ORDER_ID, dataReply, demoError, expectVersion, reply, required, type DemoMail, type DemoOrder, type DemoRecord, type DemoRequest, type DemoState } from "../model";
import { createProduct, prepareOrderTasks, completeOrderSimulation } from "../entities";
import { makeOrder } from "../fixtures/core";
export function orderBatches(state: DemoState, order: DemoOrder) {
    const tasks = state.tasks.filter(task => state.taskOrders[task.taskId] === order.orderId);
    const results = tasks.map((task, i) => ({ taskId: task.taskId, title: task.title, channel: task.channel, status: task.status === "published" ? "published" : ["awaiting_material", "intercepted"].includes(task.status) ? "failed" : i % 2 ? "platform_review" : "deferred", publicUrl: task.publicUrl, publishedAt: task.status === "published" ? task.updatedAt : undefined, failureReason: task.failureReason, responsibility: ["awaiting_material", "intercepted"].includes(task.status) ? "user" : task.status === "published" ? undefined : i % 2 ? "external" : "system", userActionRequired: ["awaiting_material", "intercepted"].includes(task.status), nextAction: task.status === "intercepted" ? "此任务已由人工拦截，不会继续模拟发布。" : ["awaiting_material", "intercepted"].includes(task.status) ? "补充虚拟资料后，系统继续处理。" : "系统将继续跟踪模拟发布结果。", attemptCount: 1 }));
    return [{ batchId: `batch-${order.orderId}-${state.month}`, orderId: order.orderId, businessDate: state.now.slice(0, 10), plannedCount: results.length, publishedCount: results.filter(r => r.status === "published").length, pendingCount: results.filter(r => ["platform_review", "deferred"].includes(r.status)).length, failedCount: results.filter(r => r.status === "failed").length, status: "closed", closedAt: state.now, results }];
}
export function addMail(state: DemoState, order: DemoOrder, kind: DemoMail["kind"], token?: string) {
    const subject = { login: "演示登录链接", strategy: `请确认 ${order.productName} 的推广策略`, sample: `请确认 ${order.productName} 的代表样文`, digest: `${order.productName} 每日发布结果`, completed: `${order.productName} 本月完成与复盘建议`, action: `${order.productName} 需要补充资料` }[kind];
    const href = kind === "login" ? "/hosted/login/verify#token=demo-login" : kind === "strategy" || kind === "sample" ? `/hosted/review/${token || Object.keys(state.reviews).find(k => state.reviews[k].orderId === order.orderId && state.reviews[k].gateType === kind && state.reviews[k].status === "pending") || `demo-${kind}`}` : kind === "completed" ? "/content-monitor?tab=ai" : `/hosted/email?orderId=${order.orderId}`;
    state.mails.unshift({ id: `mail-${state.revision}-${state.mails.length}`, orderId: order.orderId, kind, subject, to: "presenter@example.com", createdAt: state.now, href, summary: kind === "digest" ? "请查看关联文章、发布状态与需处理事项。" : "请打开关联页面检查内容后继续。", status: "simulated" });
    return state.mails[0];
}
function reviewPayload(state: DemoState, token: string) {
    const review = required(state.reviews[token], "演示确认链接");
    const order = required(state.orders.find(o => o.orderId === review.orderId), "演示委托");
    const pack = required(state.strategies[order.productId], "演示策略");
    const plan = pack.contentPlan;
    const task = required(state.tasks.find(t => state.taskOrders[t.taskId] === order.orderId), "演示样文");
    return { review, order, strategy: review.gateType === "strategy" ? { strategyVersion: pack.strategyVersion, rowVersion: pack.rowVersion, summary: { coreExpressions: plan.coreExpressions, automaticStrategy: { targetAudience: plan.productPositioning.targetAudience, promotionPurpose: plan.productPositioning.promotionPurpose, keyMessages: plan.expressionDirection.keyMessages, channels: plan.channelPriorities.map((c: DemoRecord) => c.channel), articleDirections: plan.articleTypePortfolio.map((p: DemoRecord) => ({ portfolioItemId: p.portfolioItemId, name: p.name, direction: p.definition })), prohibitedClaims: plan.productPositioning.prohibitedClaims } } } : undefined, sample: review.gateType === "sample" ? { title: task.title, markdown: task.currentDraft?.markdown, copyAllowed: true, articleTypeName: task.articleTypeNameSnapshot, channel: task.channel } : undefined };
}
function orderPayload(state: DemoState, order: DemoOrder) {
    const gate = order.status === "pending_strategy_review" ? "strategy" : order.status === "pending_sample_review" ? "sample" : undefined;
    const token = gate ? Object.keys(state.reviews).find(key => state.reviews[key].orderId === order.orderId && state.reviews[key].gateType === gate && state.reviews[key].status === "pending") : undefined;
    return { ok: true, order, nextAction: gate ? { type: gate, label: gate === "strategy" ? "查看并确认策略" : "查看并确认样文", description: "打开演示邮件中的链接确认内容。", href: `/hosted/review/${token}` } : { type: "results", label: "查看每日发布结果", description: "查看本次任务的正文、结果和待处理事项。", href: `/hosted/email?orderId=${order.orderId}` }, pendingReview: token ? state.reviews[token] : undefined, sampleProgress: { operationStatus: "completed", progressStage: "completed", attemptCount: 1 } };
}
export function hostedRequest(state: DemoState, req: DemoRequest) {
    const url = new URL(req.path, "https://demo.invalid");
    const path = url.pathname;
    const body = req.body;
    const write = req.method !== "GET";
    if (path === "/api/v5/hosted/auth/session")
        return state.identity ? reply({ identity: state.identity }) : reply({ message: "请使用演示邮箱登录。" }, 401);
    if (path === "/api/v5/hosted/auth/request" && write) {
        if (!/^\S+@\S+\.\S+$/.test(body.email || ""))
            demoError("请输入有效的邮箱格式。");
        const mail = addMail(state, state.orders[0], "login");
        return reply({ ok: true, simulated: true, mail, redirectTo: mail.href });
    }
    if (path === "/api/v5/hosted/auth/verify" && write) {
        if (body.token !== "demo-login")
            demoError("演示登录链接无效，请从演示邮件打开。", 401);
        state.identity = { email: "presenter@example.com", workspaceId: "demo-workspace", role: "workspace_admin" };
        return reply({ ok: true, identity: state.identity, redirectTo: "/" });
    }
    if (path === "/api/v5/hosted/auth/logout" && write) {
        state.identity = null;
        return reply({ ok: true });
    }
    if (path === "/api/v5/hosted/email-sender")
        return reply({ sender: { configured: true, provider: "gmail", senderHint: "notifications@example.com", senderEmail: "notifications@example.com", status: "connected", lastVerifiedAt: state.now }, configured: true });
    if (path.startsWith("/api/v5/hosted/email-sender/") && write)
        return reply({ ok: true, simulated: true, redirectUrl: "/hosted/email-sender?result=connected", authorizationUrl: "/hosted/email-sender?result=connected", message: "演示发件连接已确认，无需真实凭证。" });
    if (path === "/api/v5/hosted/products")
        return reply({ products: state.products.map(p => ({ ...p, linkedToWorkspace: true })) });
    if (/^\/api\/v5\/hosted\/products\/[^/]+\/link$/.test(path) && write)
        return reply({ ok: true, productId: path.split("/")[5], linkedToWorkspace: true });
    if (path === "/api/v5/hosted/channels")
        return reply({ channels: DEMO_CHANNELS.map(channel => ({ channel, capability: "auto_publish", authorizationStatus: "connected", authorizationPhase: "connected", accountCandidate: `demo-account-${channel}`, accountCandidateLabel: "星屿实验室（虚拟账号）", accountLabel: "星屿实验室（虚拟账号）", accountBindingVersion: 1, detail: `${DEMO_CHANNEL_LABELS[channel]} 模拟连接已就绪。`, nextAction: "可查看模拟发布结果。" })) });
    if (path === "/api/v5/hosted/orders") {
        if (!write)
            return reply({ orders: state.orders });
        if (!state.identity)
            demoError("请先通过演示邮件登录。", 401);
        const channels = typeof body.channels === "string" ? JSON.parse(body.channels) : body.channels;
        if (!Array.isArray(channels) || !channels.length || channels.some(c => !DEMO_CHANNELS.includes(c.channel)))
            demoError("请至少选择一个有效渠道。");
        const product = body.productId ? required(state.products.find(p => p.productId === body.productId), "演示产品") : createProduct(state, body);
        const order = makeOrder(product, state.now, `demo-order-${state.revision}`);
        order.status = "pending_strategy_review";
        order.channels = channels.map(c => ({ channel: c.channel, dailyCap: Number(c.dailyCap || 2) }));
        state.orders.unshift(order);
        prepareOrderTasks(state, order);
        state.strategies[product.productId].status = "pending_strategy_review";
        order.dailyCaps = Object.fromEntries(order.channels.map(c => [c.channel, c.dailyCap]));
        for (const gateType of ["strategy", "sample"]) {
            const token = `${order.orderId}-${gateType}`;
            state.reviews[token] = { orderId: order.orderId, gateType, status: "pending", expiresAt: `${state.month}-28T23:59:59+08:00` };
        }
        addMail(state, order, "strategy", `${order.orderId}-strategy`);
        return reply(orderPayload(state, order), 201);
    }
    const orders = path.match(/^\/api\/v5\/hosted\/orders\/([^/]+)(?:\/(.+))?$/);
    if (orders) {
        const order = required(state.orders.find(o => o.orderId === orders[1]), "演示委托"), action = orders[2];
        if (!action)
            return reply(orderPayload(state, order));
        if (action === "daily-batches")
            return reply({ batches: orderBatches(state, order) });
        if (action === "settings" && write) {
            expectVersion(order.rowVersion, body.expectedVersion);
            if (body.channels) {
                if (!body.channels.length)
                    demoError("至少保留一个渠道。");
                order.channels = body.channels;
                order.dailyCaps = Object.fromEntries(body.channels.map((c: DemoRecord) => [c.channel, Number(c.dailyCap || 2)]));
            }
            for (const key of ["dailyDigest", "monthlyCompleted"] as const)
                if (typeof body[key] === "boolean")
                    order.notificationPreferences[key] = body[key];
            order.rowVersion++;
            return reply({ ok: true, order });
        }
        if (action === "pause" && write) {
            expectVersion(order.rowVersion, body.expectedVersion);
            order.status = body.paused === false || body.pause === false || body.action === "resume" ? "running" : order.status === "paused" ? "running" : "paused";
            order.rowVersion++;
            return reply({ ok: true, order });
        }
        if (action === "review-email" && write) {
            const gate = order.status === "pending_sample_review" ? "sample" : "strategy";
            const token = Object.keys(state.reviews).find(key => state.reviews[key].orderId === order.orderId && state.reviews[key].gateType === gate);
            return reply({ ok: true, simulated: true, mail: addMail(state, order, gate, token) });
        }
        if (action === "sample-retry" && write) {
            order.status = "pending_sample_review";
            order.rowVersion++;
            addMail(state, order, "sample");
            return reply(orderPayload(state, order));
        }
        if (action === "channel-connections") {
            if (write) {
                const channel = body.channel;
                if (!DEMO_CHANNELS.includes(channel))
                    demoError("请选择有效的演示渠道。");
                const session = { id: `demo-session-${channel}`, channel, executorType: body.executorType || "cloud_browser", status: "confirmed", rowVersion: 1, detectedAccount: { providerAccountRef: `demo-${channel}`, publicDisplayName: "星屿实验室（虚拟账号）", capabilities: ["publish"] } };
                return reply({ ok: true, session, sessionStatusUrl: `/hosted/browser-session/${session.id}` });
            }
            return reply({ channels: order.channels.filter(c => c.channel !== "wechat").map(c => ({ channel: c.channel, connection: { accountConnectionId: `demo-connection-${c.channel}`, publicDisplayName: "星屿实验室（虚拟账号）", authorizationStatus: "connected", executorType: "cloud_browser" } })) });
        }
        if (/channels\/[^/]+\/authorization/.test(action) && write)
            return reply({ ok: true, status: "connected", authorizationPhase: "connected", sessionStatusUrl: "/hosted/browser-session/demo-session-zhihu", loginUrl: "/hosted/browser-session/demo-session-zhihu" });
    }
    const review = path.match(/^\/api\/v5\/hosted\/reviews\/([^/]+)$/);
    if (review) {
        const token = review[1], payload = reviewPayload(state, token), pack = state.strategies[payload.order.productId];
        if (req.method === "PATCH") {
            expectVersion(pack.rowVersion, body.expectedVersion);
            if (!body.edit?.productIdentity?.trim())
                demoError("产品身份不能为空。");
            Object.assign(pack.contentPlan.coreExpressions, body.edit);
            pack.rowVersion++;
            return reply(reviewPayload(state, token));
        }
        if (req.method === "POST") {
            if (payload.review.gateType === "sample" && payload.order.status === "pending_strategy_review")
                demoError("请先从策略邮件确认核心表达，再确认样文。", 409);
            if (payload.review.status !== "pending")
                demoError("这项确认已经完成。", 409);
            if (!["approve", "changes_requested"].includes(body.decision))
                demoError("请选择有效的审核决定。");
            if (body.decision === "changes_requested" && !body.comment?.trim())
                demoError("请填写修改意见。");
            Object.assign(payload.review, { status: "acted", decision: body.decision, comment: body.comment });
            if (body.decision === "approve") {
                pack.status = payload.review.gateType === "strategy" ? "pending_sample_review" : "production_ready";
                payload.order.status = payload.review.gateType === "strategy" ? "pending_sample_review" : "running";
                if (payload.review.gateType === "sample")
                    completeOrderSimulation(state, payload.order);
                const gate = payload.review.gateType === "strategy" ? "sample" : "digest";
                const nextToken = Object.keys(state.reviews).find(k => state.reviews[k].orderId === payload.order.orderId && state.reviews[k].gateType === "sample");
                addMail(state, payload.order, gate, nextToken);
            }
            else {
                pack.status = "pending_strategy_review";
                payload.order.status = payload.review.gateType === "strategy" ? "pending_strategy_review" : "pending_sample_review";
                const nextToken = `${token}-revision-${state.revision}`;
                state.reviews[nextToken] = { ...payload.review, status: "pending", decision: undefined, comment: undefined };
                addMail(state, payload.order, payload.review.gateType, nextToken);
            }
            pack.rowVersion++;
            payload.order.rowVersion++;
            return reply({ ok: true, ...reviewPayload(state, token) });
        }
        return reply(payload);
    }
    const preferences = path.match(/^\/api\/v5\/hosted\/preferences\/([^/]+)$/);
    if (preferences) {
        const id = preferences[1] === "demo-preferences" ? DEMO_ORDER_ID : preferences[1];
        const order = required(state.orders.find(o => o.orderId === id), "演示通知偏好");
        if (write) {
            expectVersion(order.rowVersion, body.expectedVersion);
            for (const key of ["dailyDigest", "monthlyCompleted"] as const)
                if (typeof body[key] === "boolean")
                    order.notificationPreferences[key] = body[key];
            order.rowVersion++;
        }
        return reply({ ok: true, order });
    }
    const session = path.match(/^\/api\/v5\/hosted\/authorization-sessions\/([^/]+)(?:\/confirm)?$/);
    if (session) {
        const channel = session[1].replace("demo-session-", "");
        if (!DEMO_CHANNELS.some(c => c === channel))
            demoError("演示授权会话不存在。", 404);
        return reply({ session: { id: session[1], orderId: DEMO_ORDER_ID, failureMessage: "虚拟账号已识别，演示期间不会连接或保存真实平台账号。", channel, executorType: "cloud_browser", status: "confirmed", rowVersion: 1, detectedAccount: { providerAccountRef: `demo-${channel}`, publicDisplayName: "星屿实验室（虚拟账号）", capabilities: ["publish"] } }, events: [], browser: { status: "connected" } });
    }
    if (path === "/api/v5/publish-executors/nodes")
        return reply({ nodes: [{ nodeId: "demo-node", executorType: "cloud_browser", displayName: "演示云端执行器", status: "online" }, { nodeId: "demo-desktop", executorType: "desktop_connector", displayName: "演示本机执行器", status: "online" }] });
    if (path === "/api/v5/publish-executors/pairing-codes" && write)
        return reply({ code: "DEMO-1234", pairingCode: "DEMO-1234", expiresAt: `${state.month}-28T23:59:59+08:00` });
    return undefined;
}
