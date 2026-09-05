import { articleText, makeProducts, makeTask } from "./fixtures/core";
import { makeKnowledge, makeProductDetail, makeResearch, makeStrategy } from "./fixtures/knowledge";
import { demoError, type DemoRecord, type DemoState, type DemoOrder } from "./model";
export function createProduct(state: DemoState, input: DemoRecord) {
    const name = String(input.canonicalName || input.productName || input.displayName || "").trim();
    if (!name)
        demoError("请输入虚拟产品名称。");
    const id = `demo-product-${state.revision}`;
    const product = { ...makeProducts(state.now)[0], productId: id, canonicalName: name, displayName: input.displayName || name, officialUrl: "https://example.com/demo", productCategory: input.productCategory || "虚拟演示产品", strategyPackId: `strategy-${id}` };
    state.products.push(product);
    state.productDetails[id] = makeProductDetail(product, state.now);
    state.knowledge.push(makeKnowledge(product, state.now));
    state.research[id] = makeResearch(product, state.now);
    state.strategies[id] = makeStrategy(product, state.month, state.now);
    return product;
}
export function prepareOrderTasks(state: DemoState, order: DemoOrder) {
    const product = state.products.find(p => p.productId === order.productId)!;
    for (const [index, channel] of order.channels.entries()) {
        const task = makeTask(product, state.month, state.now, state.tasks.length);
        task.taskId = `${order.orderId}-task-${index}`;
        task.title = `${product.displayName}：${index ? "操作流程与人工确认" : "从需求到可检查结果"}`;
        task.channel = channel.channel as typeof task.channel;
        task.status = "available";
        task.failureReason = undefined;
        task.formalDraftId = `${task.taskId}-draft`;
        task.publicUrl = undefined;
        task.scheduledAt = undefined;
        task.currentDraft = { ...task.currentDraft!, title: task.title, markdown: articleText(product.displayName, task.title), draftId: task.formalDraftId };
        state.tasks.push(task);
        state.taskOrders[task.taskId] = order.orderId;
        state.drafts[task.formalDraftId] = { ...task.currentDraft, version: 1, taskId: task.taskId };
    }
}
export function completeOrderSimulation(state: DemoState, order: DemoOrder) {
    // External execution is deterministic; the same tasks feed results, mail and metrics.
    for (const task of state.tasks.filter(t => state.taskOrders[t.taskId] === order.orderId)) {
        task.status = "published";
        task.publicUrl = `/demo-article/${task.taskId}`;
        task.updatedAt = state.now;
        task.failureReason = undefined;
    }
}
