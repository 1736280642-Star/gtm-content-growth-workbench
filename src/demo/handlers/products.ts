import { dataReply, demoError, expectVersion, reply, required, type DemoRecord, type DemoRequest, type DemoState } from "../model";
import { createProduct } from "../entities";
import { makeTask } from "../fixtures/core";
import { makeKnowledge, makeProductDetail, makeResearch, makeStrategy } from "../fixtures/knowledge";
import { addMail } from "./hosted";
export function rolloutReadiness(state: DemoState, productId: string, platform = "wechat") {
    return { productId, platform, strategyPackId: `strategy-${productId}`, calibrationVersionId: `calibration-${productId}`, configuredAccountCandidate: `demo-account-${platform}`, configuredAccountCandidateLabel: "星屿实验室（虚拟账号）", confirmedAccount: `demo-account-${platform}`, accountBindingVersion: 1, authorizationRuntimeStatus: "ready", productionInputSummary: { rulePackageReady: true, knowledgeBaseReadyCount: 1, evidenceReadyArticleTypeCount: 2 }, canEnterBatchGeneration: true, canScheduleRealPublish: true, gates: ["strategy", "sample", "knowledge", "account"].map(code => ({ key: code === "account" ? "auth" : code, code, detail: "虚拟演示条件就绪。", label: { strategy: "策略确认", sample: "样文校验", knowledge: "资料与证据", account: "发布账号" }[code], status: "ready", blocking: false, reason: "虚拟演示条件就绪。", message: "虚拟演示条件就绪。", nextAction: "可继续操作" })) };
}
function samples(state: DemoState, productId: string) {
    const pack = state.strategies[productId];
    const selectedIds = state.settings.sampleTasks?.[productId];
    const rows = state.tasks.filter(t => t.productId === productId && (!selectedIds || selectedIds.includes(t.taskId))).slice(0, 2);
    return { strategyPackId: pack.id, strategyVersion: pack.strategyVersion, strategyStatus: pack.status, requiredCount: rows.length, approvedCount: rows.filter(t => state.drafts[t.formalDraftId!]?.sampleApproved).length, items: rows.map(t => ({ articleTypeVersionId: t.articleTypeProfileVersionId + "-" + t.taskId, articleTypeName: t.articleTypeNameSnapshot, evidenceReadiness: "ready", taskId: t.taskId, title: t.title, reviewStatus: state.drafts[t.formalDraftId!]?.sampleApproved ? "approved" : "pending_review", draft: { versionNumber: state.drafts[t.formalDraftId!]?.version || 1, createdAt: state.now }, operation: { status: "completed", progressStage: "completed" } })) };
}
function recoverTasks(state: DemoState, productId: string) {
    const kb = state.knowledge.find(k => k.productId === productId);
    if (kb) {
        kb.productionStatus = "ready";
        kb.openActionCount = 0;
        kb.productionBlockingActionCount = 0;
        for (const action of kb.actionItems) {
            action.status = "resolved";
            action.updatedAt = state.now;
        }
    }
    for (const task of state.tasks.filter(t => t.productId === productId && t.status === "awaiting_material")) {
        task.status = "available";
        task.scheduledAt = undefined;
        task.publicUrl = undefined;
        task.failureReason = undefined;
        task.failureReason = undefined;
        task.updatedAt = state.now;
    }
    for (const order of state.orders.filter(o => o.productId === productId && o.status === "action_required")) {
        order.status = "running";
        order.lastError = undefined;
        order.rowVersion++;
    }
}
function addMaterial(state: DemoState, productId: string, body: DemoRecord) {
    const kb = required(state.knowledge.find(k => k.productId === productId), "演示知识库");
    const id = `material-${productId}-${state.revision}`, title = body.title || body.name || "新导入的虚拟资料";
    const material = { materialId: id, title, kind: body.kind || "document", status: "ready", summary: body.summary || "本次导入采用虚拟内容演示整理与索引过程。", evidenceExcerpt: body.evidenceExcerpt || "演示效果数字均为合成样本，不能用作实际业务承诺。", sourceOwner: "演示用户", visibility: "public", createdAt: state.now, updatedAt: state.now, rowVersion: 1 };
    kb.materials.push(material);
    kb.materialCount = kb.materials.length;
    kb.rowVersion++;
    kb.understanding.push({ understandingId: `understanding-${id}`, summary: material.summary, evidenceExcerpt: material.evidenceExcerpt, materialId: id, materialTitle: title, sourceOwner: "演示用户", visibility: "public", trace: { steps: [], actor: "demo-user", processedAt: state.now } });
    const detail = state.productDetails[productId];
    detail.materialSummary.materialCount = kb.materialCount;
    detail.materialSummary.latestUpdate = { sourceLabel: title, sourceType: "file", updatedAt: state.now };
    recoverTasks(state, productId);
    return material;
}
export function productRequest(state: DemoState, req: DemoRequest) {
    const url = new URL(req.path, "https://demo.invalid"), path = url.pathname, body = req.body, write = req.method !== "GET";
    if (path === "/api/v5/products") {
        if (!write)
            return reply({ ok: true, products: state.products, summaries: state.products.map(p => state.productDetails[p.productId].workflowSummary), workflowSummaries: state.products.map(p => state.productDetails[p.productId].workflowSummary), overviews: state.products.map(p => ({ productId: p.productId, isPromoting: p.isPromoting, hasSourceSnapshot: true, sourceCount: 3, latestRunStatus: "completed", blueprintStatus: "approved", strategyPackId: `strategy-${p.productId}`, nextAction: "monthly_strategy" })) });
        const input = body.input || body;
        const product = createProduct(state, input), id = product.productId;
        const task = makeTask(product, state.month, state.now, state.tasks.length);
        task.status = "available";
        state.tasks.push(task);
        state.drafts[task.formalDraftId!] = { ...task.currentDraft, version: 1 };
        return reply({ ok: true, product, productId: id, data: { product }, message: "虚拟产品已创建。" }, 201);
    }
    const match = path.match(/^\/api\/v5\/products\/([^/]+)(?:\/(.+))?$/);
    if (match) {
        const id = decodeURIComponent(match[1]), action = match[2], product = required(state.products.find(p => p.productId === id), "产品"), pack = state.strategies[id];
        if (!action) {
            if (req.method === "DELETE") {
                if (state.orders.some(o => o.productId === id))
                    demoError("该产品有关联委托，请保留以便查收结果；可用演示重置恢复初始数据。", 409);
                if (state.products.length === 1)
                    demoError("至少保留一个演示产品。");
                state.products = state.products.filter(p => p.productId !== id);
                state.tasks = state.tasks.filter(t => t.productId !== id);
                state.freeBatches = state.freeBatches.filter(b => b.productId !== id);
                state.knowledge = state.knowledge.filter(k => k.productId !== id);
                return reply({ ok: true, message: "虚拟产品已删除，可重置演示数据恢复。" });
            }
            if (write) {
                expectVersion(product.rowVersion, body.expectedVersion);
                const input = body.input || body;
                for (const key of ["canonicalName", "displayName", "brandName", "entityRelationship", "officialEntity", "officialUrl", "productCategory", "aliases"] as const)
                    if (input[key] !== undefined)
                        (product as DemoRecord)[key] = input[key];
                product.rowVersion++;
                product.updatedAt = state.now;
                const detail = state.productDetails[id];
                detail.product = product;
                if (input.knowledgeProfile) {
                    for (const key of ["positioning", "audiences", "capabilities", "scenarios", "boundaries"])
                        if (input.knowledgeProfile[key])
                            detail.productProfile[key] = input.knowledgeProfile[key].map((text: string, i: number) => ({ claimId: `claim-${id}-${key}-${i}`, text, sourceId: `source-${id}`, sourceRevisionId: `revision-${id}` }));
                    detail.productProfile.source = "human_corrected";
                }
                return reply({ ok: true, product, message: "产品信息已保存。" });
            }
            return reply({ ...state.productDetails[id], product });
        }
        if (action === "promotion" && write) {
            product.isPromoting = Boolean(body.isPromoting);
            return reply({ ok: true, product, message: "推广范围已保存。" });
        }
        if (action === "research-workspace")
            return reply({ ok: true, ...state.research[id], product });
        if (action === "research-project" && write) {
            const project = state.research[id].workspace.project;
            expectVersion(project.rowVersion, body.expectedVersion);
            Object.assign(project, body.input || body, { rowVersion: project.rowVersion + 1 });
            return reply({ ok: true, project });
        }
        if (action === "research-runs" && write) {
            const previous = state.research[id];
            const research = makeResearch(product, state.now, `run-${id}-${state.revision}`);
            research.workspace.project.rowVersion = previous.workspace.project.rowVersion + 1;
            research.workspace.latestRun.runVersion = previous.workspace.latestRun.runVersion + 1;
            research.workspace.runs = [research.workspace.latestRun, ...previous.workspace.runs];
            research.history = { ...previous.history, [previous.runWorkspace.run.runId]: previous.runWorkspace };
            state.research[id] = research;
            return reply({ ok: true, run: research.workspace.latestRun });
        }
        if (action.startsWith("research-runs/")) {
            const stored = state.research[id];
            const runId = action.split("/")[1];
            const runWorkspace = required(stored.runWorkspace.run.runId === runId ? stored.runWorkspace : stored.history?.[runId], "研究运行");
            const research: DemoRecord = { ...stored, runWorkspace };
            if (action.endsWith("/question-catalog") && write) {
                expectVersion(state.revision, body.expectedQuestionPoolVersion);
                const selected = body.findingIds || [];
                if (!selected.length)
                    demoError("请选择要纳入的问题。");
                for (const q of research.runWorkspace.questionCatalog.items.filter((q: DemoRecord) => selected.includes(q.findingId))) {
                    q.reviewStatus = "confirmed";
                    if (!state.questions.some(c => c.questionId === q.id))
                        state.questions.push({ ...q, questionId: q.id, questionVersionId: q.id, productId: id, status: "available", rowVersion: 1, currentVersion: { text: q.question, product: product.displayName }, geoMonitoringApproval: { status: "approved", approvedAt: state.now, approvedBy: "demo-user" } });
                    if (!state.monitoringQuestions.some(m => m.questionId === q.id))
                        state.monitoringQuestions.push({ ...structuredClone(state.monitoringQuestions[0]), id: `monitor-${q.id}`, questionId: q.id, productId: id, question: q.question, questionText: q.question, status: "active", rowVersion: 1 });
                }
                research.runWorkspace.questionCatalog.importedCount = research.runWorkspace.questionCatalog.items.filter((q: DemoRecord) => q.reviewStatus === "confirmed").length;
                return reply({ ok: true, message: "调研问题已加入问题库。" });
            }
            return reply({ ok: true, product, runWorkspace: research.runWorkspace, readiness: research.readiness, downstreamCandidates: { questionCandidates: research.runWorkspace.questionCatalog.items, articleTypeCandidates: [], rulePackageCandidates: [], monthlyCandidates: [] } });
        }
        if (action === "strategy-pack") {
            if (write) {
                expectVersion(pack.rowVersion, body.expectedVersion);
                if (body.fixedExpression)
                    pack.contentPlan.fixedExpression = body.fixedExpression;
                pack.rowVersion++;
            }
            return reply({ ok: true, productId: id, latestStrategyPack: pack, currentStrategyPack: pack, latestArticleTypeVersions: [], currentArticleTypeVersions: [] });
        }
        if (action === "strategy-pack/apply" && write) {
            expectVersion(pack.rowVersion, body.expectedVersion);
            if (!["approve", "reject"].includes(body.decision))
                demoError("请选择策略确认或拒绝。");
            pack.status = body.decision === "approve" ? "pending_sample_review" : "rejected";
            pack.rowVersion++;
            pack.selectedPortfolioItemIds = body.selectedPortfolioItemIds;
            if (body.fixedExpression)
                pack.contentPlan.fixedExpression = body.fixedExpression;
            const order = state.orders.find(o => o.productId === id);
            if (order && body.decision === "approve") {
                order.status = "pending_sample_review";
                order.rowVersion++;
                addMail(state, order, "sample");
            }
            return reply({ ok: true, status: pack.status, sample: { status: "queued", draftVersionId: state.tasks.find(t => t.productId === id)?.formalDraftId } });
        }
        if (action === "sample-article") {
            if (write) {
                const rows: DemoState["tasks"] = [];
                for (let index = 0; index < 2; index++) {
                    const task = makeTask(product, state.month, state.now, state.tasks.length);
                    task.status = "available";
                    task.publicUrl = undefined;
                    task.scheduledAt = undefined;
                    task.failureReason = undefined;
                    state.tasks.push(task);
                    state.drafts[task.formalDraftId!] = { ...task.currentDraft, version: 1 };
                    rows.push(task);
                }
                state.settings.sampleTasks = { ...state.settings.sampleTasks, [id]: rows.map(task => task.taskId) };
                for (const task of rows.slice(0, 2))
                    state.drafts[task.formalDraftId!].sampleApproved = false;
                pack.status = "pending_sample_review";
                pack.rowVersion++;
            }
            return dataReply(samples(state, id));
        }
        if (action.startsWith("sample-articles/")) {
            const task = required(state.tasks.find(t => t.taskId === action.split("/")[1] && t.productId === id), "样文任务"), draft = state.drafts[task.formalDraftId!];
            const currentVersion = { draftVersionId: task.formalDraftId, versionNumber: draft.version || 1, title: draft.title, markdown: draft.markdown, copyAllowed: true, createdAt: state.now, provider: "demo", model: "deterministic-simulator", brief: { 任务: "展示协作过程与人工确认点", 资料: "虚拟产品说明" }, technicalPrompt: { system: "演示生成器只使用虚拟资料。", user: task.title }, decision: draft.sampleApproved ? "approved" : undefined };
            return dataReply({ productId: id, strategyPackId: pack.id, taskId: task.taskId, articleTypeVersionId: task.articleTypeProfileVersionId, articleTypeName: task.articleTypeNameSnapshot, title: task.title, reviewStatus: draft.sampleApproved ? "approved" : "pending_review", operation: { status: "completed", progressStage: "completed" }, versions: [currentVersion, ...(draft.history || [])], currentVersion });
        }
        if (action === "rollout-readiness")
            return dataReply(rolloutReadiness(state, id, url.searchParams.get("platform") || "wechat"));
        if (action === "publish-account-binding" && write)
            return reply({ ok: true, data: rolloutReadiness(state, id, body.platform), message: "虚拟发布账号已确认。" });
    }
    if (path === "/api/v5/knowledge-bases")
        return dataReply({ knowledgeBases: state.knowledge, stateVersion: state.revision });
    const kbMatch = path.match(/^\/api\/v5\/knowledge-bases\/([^/]+)(?:\/(materials))?$/);
    if (kbMatch) {
        const kb = required(state.knowledge.find(k => k.knowledgeBaseId === kbMatch[1]), "知识库");
        if (kbMatch[2] && write) {
            expectVersion(kb.rowVersion, body.expectedVersion);
            addMaterial(state, kb.productId, body);
        }
        return dataReply({ knowledgeBase: kb, stateVersion: state.revision });
    }
    if (path.startsWith("/api/v5/knowledge-action-items/") && write) {
        const id = path.split("/").at(-1);
        const kb = required(state.knowledge.find(k => k.actionItems.some((a: DemoRecord) => a.actionItemId === id)), "待处理事项");
        const action = kb.actionItems.find((a: DemoRecord) => a.actionItemId === id);
        expectVersion(action.rowVersion, body.expectedVersion);
        action.status = "resolved";
        action.rowVersion++;
        recoverTasks(state, kb.productId);
        return dataReply(action);
    }
    if (path.startsWith("/api/v5/knowledge-imports/") && write) {
        const product = required(state.products.find(p => p.productId === body.productId), "导入产品");
        if (body.publicUseConfirmed !== true && body.publicUseConfirmed !== "true")
            demoError("请确认虚拟资料可用于公开演示。");
        const material = addMaterial(state, product.productId, body);
        return dataReply({ pipelineStatus: "queued", missingConfiguration: [], sourceIds: [material.materialId] }, { message: "虚拟资料已整理并更新索引；相关任务已恢复。" });
    }
    if (path === "/api/v5/knowledge-collection/sources") {
        if (write) {
            expectVersion(state.revision, body.expectedVersion);
            const base = structuredClone(state.collectionSources[0]);
            const source = { ...base, ...body, sourceId: `source-${state.revision}`, name: body.name || body.displayName || "新增虚拟采集源", displayName: body.name || "新增虚拟采集源", enabled: true, rowVersion: 1 };
            state.collectionSources.push(source);
        }
        const snapshots = state.collectionSources.flatMap(s => [1, 2].map(i => ({ snapshotId: `${s.sourceId}-snapshot-${i}`, sourceId: s.sourceId, runId: `collection-${s.sourceId}`, sourceName: s.name, sourceType: s.sourceType, url: "/demo-article/product-guide", content: "虚拟说明：任务需要关联输入、资料、人工确认和输出。", excerpt: "任务需要关联输入、资料、人工确认和输出。", entityType: "product", entityName: s.defaultProductName, knowledgeBaseId: s.defaultKnowledgeBaseId, knowledgeBaseName: state.knowledge.find(k => k.id === s.defaultKnowledgeBaseId)?.name || "虚拟产品知识库", classificationConfidence: 1, classificationReasons: ["演示产品名称匹配"], classifierVersion: "demo-v1", title: `${s.displayName} · 示例 ${i}`, canonicalUrl: "/demo-article/product-guide", sourceUrl: "/demo-article/product-guide", collectionStatus: i === 1 ? "collected" : "updated", governanceStatus: "indexed", productId: s.productId, productName: state.products.find(p => p.productId === s.productId)?.displayName, summary: "虚拟资料已经整理为可引用的知识条目。", contentText: "任务需要记录输入、来源、人工确认和输出。", markdown: "# 虚拟资料\n\n任务需要记录输入、来源、人工确认和输出。", collectedAt: state.now, createdAt: state.now, updatedAt: state.now, rowVersion: 1 })));
        return dataReply({ stateVersion: state.revision, sources: state.collectionSources, todaySnapshots: snapshots, latestRuns: state.collectionSources.map(s => ({ runId: `collection-${s.sourceId}`, sourceId: s.sourceId, status: "success", discoveredCount: 2, collectedCount: 1, updatedCount: 1, unchangedCount: 0, failedCount: 0, startedAt: state.now, completedAt: state.now })), snapshots, runs: [], jobs: [], summary: { sourceCount: state.collectionSources.length, enabledSourceCount: state.collectionSources.filter(s => s.enabled).length, collectedCount: snapshots.length, indexedCount: snapshots.length, failedCount: 0 } });
    }
    const source = path.match(/^\/api\/v5\/knowledge-collection\/sources\/([^/]+)$/);
    if (source && write) {
        const s = required(state.collectionSources.find(s => s.sourceId === source[1]), "采集来源");
        expectVersion(s.rowVersion, body.expectedVersion);
        s.enabled = body.enabled;
        s.rowVersion++;
        return dataReply(s);
    }
    return undefined;
}
