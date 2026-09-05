import { dataReply, demoError, expectVersion, reply, required, type DemoRecord, type DemoRequest, type DemoState } from "../model";
import { makeTask } from "../fixtures/core";
import { makeFreeBatch, renderDemoArticle } from "../fixtures/production";
import { applyFactArticle } from "../fixtures/fact-article";
import { makeVisualPlan } from "../fixtures/visuals";
import { addMail } from "./hosted";
import { markdownSections } from "@/lib/v5/joto-wechat-layout-renderer";
export function monthlyWorkspace(state: DemoState, month = state.month): DemoRecord {
    const config = { month, businessGoal: "以虚拟内容展示完整月度生产与复盘流程", targetDeliverableCount: state.tasks.length, groups: state.products.map(p => ({ groupQuotaId: `group-${p.productId}`, rulePackageVersionId: `rule-${p.productId}`, productId: p.productId, productName: p.displayName, selectedChannels: ["wechat", "zhihu", "csdn", "juejin"], articleQuota: state.tasks.filter(t => t.productId === p.productId).length })) };
    const plan = { id: `demo-plan-${month}`, version: state.settings.monthlyVersion || 1, status: state.scenario === "completed" ? "completed" : "running", config, createdAt: state.now, createdBy: "demo-user", updatedAt: state.now, updatedBy: "demo-user", matrixTasks: state.tasks };
    return { schemaVersion: 1, month, plan, draftPlan: config, rulePackages: state.products.map(p => ({ id: `rule-${p.productId}`, productId: p.productId, productName: p.displayName, version: "1", status: "active", monthlyProductionReady: true, allowedChannels: ["wechat", "zhihu", "csdn", "juejin"], knowledgeBaseIds: [`kb-${p.productId}`], sourceSnapshotHash: `snapshot-${p.productId}` })), channels: ["wechat", "zhihu", "csdn", "juejin"], strategyRows: state.questions.map((q, i) => ({ id: q.questionId, priority: i ? "P1" : "P0", term: q.questionText, source: "虚拟调研", priorityReason: "用户高频任务", productName: state.products.find(p => p.productId === q.productId)?.displayName, rulePackageVersion: "1", allocatedQuota: 2, channelAllocation: ["wechat"], contentTypeSuggestions: ["场景解读"], evidenceStatus: "ready", estimatedReadyItemCount: 2, estimatedAutoDowngradeItemCount: 0, estimatedMissingEvidenceItemCount: 0, requiredClaims: ["任务可追溯"], evidenceGaps: [], status: "ready" })), batchQueueItems: state.tasks.map(t => ({ id: t.taskId, matrixItemId: t.taskId, monthlyPlanId: t.monthlyPlanId, matrixVersionId: "demo-matrix-v1", title: t.title, productId: t.productId, product: t.productNameSnapshot, channel: t.channel, contentType: t.contentType, primaryDistilledTerm: t.question, priority: "P0", rulePackageVersion: "1", platformExpressionType: "scenario", titleConfirmed: true, evidencePreview: t.failureReason ? "needs_material" : "ready", finalEvidenceGate: t.failureReason ? "blocked" : "ready", claimCount: 3, generationStatus: "generated", hardRuleStatus: "passed", qualityResult: t.failureReason ? "exception" : "passed", scheduleStatus: t.scheduledAt ? "active" : "unscheduled", scheduleDate: t.scheduledAt?.slice(0, 10), scheduleTime: "09:00", platformAccount: t.platformAccount, prepublishConfirmed: true, displayStatus: t.status === "published" ? "published" : t.failureReason ? "exception" : "scheduled", draftId: t.formalDraftId, formal: true, publicUrl: t.publicUrl })), exceptionItems: state.tasks.filter(t => t.failureReason).map(t => ({ id: `exception-${t.taskId}`, matrixItemId: t.taskId, code: "evidence_missing", title: t.title, reason: t.failureReason, nextAction: "补充虚拟资料", responsibility: "user" })), scheduleDraftItems: state.tasks.map(t => ({ matrixItemId: t.taskId, id: t.taskId, title: t.title, productId: t.productId, product: t.productNameSnapshot, channel: t.channel, scheduleDate: t.scheduledAt?.slice(0, 10), scheduleTime: "09:00", platformAccount: t.platformAccount, status: t.status === "published" ? "published" : "scheduled", publicUrl: t.publicUrl })), targetQuestions: state.questions.map(q => ({ questionVersionId: q.questionVersionId, question: q.questionText, productId: q.productId, status: "monthly_ready", source: "v5_formal" })), knowledgeBases: state.knowledge.map(k => ({ knowledgeBaseId: k.knowledgeBaseId, name: k.name, productId: k.productId, sourceSnapshotHash: k.sourceSnapshotHash, status: "ready", source: "v5_formal" })), articleTypeProfiles: state.articleTypes, strategyPackage: { strategyPackageId: "demo-monthly-strategy", version: 1, status: "approved", targetDeliverableCount: state.tasks.length, quotaRules: [], preflightResults: [], createdAt: state.now, updatedAt: state.now }, productionTasks: state.tasks, generationBatches: [{ batchId: "demo-generation", month, taskIds: state.tasks.map(t => t.taskId), pendingTaskIds: [], completedTaskIds: state.tasks.filter(t => !t.failureReason).map(t => t.taskId), failedTaskIds: state.tasks.filter(t => t.failureReason).map(t => t.taskId), status: "completed", createdAt: state.now, updatedAt: state.now }], source: { monthlyData: "persisted", referenceData: "v4_runtime", governanceData: "v5_mysql", productionQueue: "v5_mysql" }, formal: { monthlyPlan: { monthlyPlanId: plan.id, monthStart: `${month}-01`, monthEnd: `${month}-${new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()}`, status: "approved" }, productionReadiness: [], productionPoolEntries: [], message: "演示环境：全部数据与执行结果均为模拟。" } };
}
export function productionRequest(state: DemoState, req: DemoRequest) {
    const url = new URL(req.path, "https://demo.invalid"), path = url.pathname, body = req.body, write = req.method !== "GET";
    if (path === "/api/v5/monthly-workspace")
        return dataReply(monthlyWorkspace(state, url.searchParams.get("month") || state.month));
    if (path === "/api/v5/monthly-workspace/tasks") {
        const id = url.searchParams.get("taskId");
        const workspace = monthlyWorkspace(state);
        return dataReply({ ...workspace, tasks: id ? state.tasks.filter(t => t.taskId === id) : state.tasks, productionTasks: id ? state.tasks.filter(t => t.taskId === id) : state.tasks });
    }
    const intercept = path.match(/^\/api\/v5\/monthly-plans\/([^/]+)\/tasks\/([^/]+)\/interception$/);
    if (intercept && write) {
        expectVersion(state.settings.monthlyVersion || 1, body.expectedVersion);
        const task = required(state.tasks.find(t => t.taskId === intercept[2]), "生产任务");
        if (task.status === "published")
            demoError("已发布的任务不能拦截。", 409);
        task.status = "intercepted";
        task.scheduledAt = undefined;
        task.interceptedAt = state.now;
        task.interceptionReason = body.auditReason;
        state.settings.monthlyVersion = (state.settings.monthlyVersion || 1) + 1;
        return dataReply(task, { message: "已拦截发布" });
    }
    if (path === "/api/v5/free-production/catalog")
        return dataReply({ products: state.products.map(p => ({ productId: p.productId, name: p.displayName, rulePackages: [{ id: `rule-${p.productId}`, name: "虚拟产品表达规则", version: 1, status: "active" }], knowledgeBases: [{ knowledgeBaseId: `kb-${p.productId}`, name: `${p.displayName}虚拟知识库`, sourceSnapshotId: `snapshot-${p.productId}`, sourceSnapshotHash: `snapshot-${p.productId}`, status: "ready" }] })), expressionTypes: state.expressions, channelReadiness: [{ channel: "wechat_official_account", label: "微信公众号", connected: true, accounts: [{ id: "demo-account-wechat", name: "星屿实验室（虚拟账号）" }] }], currentMonth: state.month });
    if (path === "/api/v5/free-content-expression-types") {
        if (write) {
            const input = body.input || body;
            const base = required(state.expressions.find(e => e.typeId === input.baseTypeId) || state.expressions[0], "内容类型");
            const expression = structuredClone(base), id = `demo-expression-custom-${state.revision}`;
            expression.typeId = id;
            expression.currentVersionId = `${id}-v1`;
            expression.activeVersionId = expression.currentVersionId;
            expression.currentVersion = { ...expression.currentVersion, typeId: id, freeContentExpressionTypeVersionId: expression.currentVersionId, name: input.name || "自定义演示类型", description: input.description || expression.currentVersion.description, sourceMode: input.sourceMode || "knowledge", visualSuggestionMode: input.visualSuggestionMode || "placeholders" };
            expression.activeVersion = expression.currentVersion;
            state.expressions.push(expression);
            return dataReply(expression);
        }
        return dataReply(state.expressions);
    }
    if (path === "/api/v5/free-production/batches/from-expression" && write) {
        const expression = required(state.expressions.find(e => e.activeVersionId === body.expressionTypeVersionId)?.activeVersion, "已启用内容类型");
        const product = required(state.products.find(p => p.productId === (body.productId || expression.productId)), "演示产品");
        if (!body.expressionFocus?.trim())
            demoError("请填写本篇内容的表达重点。");
        if (expression.sourceMode === "knowledge") {
            if (!body.knowledgeSnapshotIds?.length || body.knowledgeSnapshotIds.some((id: string) => id !== `snapshot-${product.productId}`))
                demoError("请选择当前产品的虚拟资料。");
        }
        else {
            if (!body.factItems?.length || body.factItems.some((fact: DemoRecord) => !fact.publicConfirmed || !fact.time?.trim() || !fact.location?.trim() || !fact.people?.trim() || !fact.event?.trim()))
                demoError("请补齐事件事实并确认可以公开。");
            if (expression.sourceMode === "facts_with_meeting_text" && !body.meetingText?.trim())
                demoError("请提供虚拟会议文本。");
        }
        const batch = makeFreeBatch(product, expression, state.month, state.now, `demo-free-${state.revision}`, body.expressionFocus || "一次团队活动的完整记录");
        if (expression.sourceMode !== "knowledge")
            applyFactArticle(batch, body.factItems, body.meetingText);
        state.freeBatches.unshift(batch);
        return dataReply(batch);
    }
    if (path === "/api/v5/free-production/batches") {
        if (req.method === "DELETE") {
            const ids = body.items?.map((item: DemoRecord) => item.id) || body.batchIds || body.ids || [];
            for (const id of ids) {
                const batch = required(state.freeBatches.find(b => b.id === id), "正文");
                expectVersion(batch.version, body.items?.find((item: DemoRecord) => item.id === id)?.expectedVersion);
                if (["draft_created", "published", "publishing"].includes(batch.status))
                    demoError("已发送或已发布的正文不能删除。", 409);
            }
            if (!Array.isArray(ids) || !ids.length)
                demoError("请选择要删除的演示任务。");
            state.freeBatches = state.freeBatches.filter(b => !ids.includes(b.id));
            return dataReply({ deletedIds: ids });
        }
        return dataReply(state.freeBatches);
    }
    const batchRoute = path.match(/^\/api\/v5\/free-production\/batches\/([^/]+)(?:\/(.+))?$/);
    if (batchRoute) {
        const batch = required(state.freeBatches.find(b => b.id === batchRoute[1]), "内容生产任务"), action = batchRoute[2];
        if (!action)
            return dataReply(batch);
        const artifact = required(batch.draftArtifacts.find(a => a.id === batch.currentDraftArtifactId), "正文产物");
        if (write && ["published", "publishing", "draft_created", "cancelled"].includes(batch.status))
            demoError("当前正文已经发布或结束，不能继续修改。", 409);
        if (write && body.artifactId && body.artifactId !== artifact.id)
            demoError("正文版本已变化，请刷新后重试。", 409);
        if (action === "visual-plan") {
            const plans = state.settings.visualPlans || {};
            let plan = plans[batch.id] || makeVisualPlan(batch, state.now);
            if (write) {
                expectVersion(batch.version, body.expectedVersion);
                if (body.artifactId !== artifact.id)
                    demoError("正文已变化，请刷新后生成。", 409);
                plan = makeVisualPlan(batch, state.now);
                state.settings.visualPlans = { ...plans, [batch.id]: plan };
                return dataReply(plan);
            }
            if (plan.artifactId !== artifact.id)
                plan = { ...plan, status: "stale" };
            return dataReply({ applicable: true, plan, provider: { status: "ready", label: "虚拟图片生成器", missingConfig: [] } });
        }
        if (action === "cover" && !write)
            return dataReply({ contentUrl: "/demo-assets/cover.svg", previewUrl: "/demo-assets/cover.svg", fileName: "virtual-cover.svg", status: "ready" });
        if (write) {
            expectVersion(batch.version, body.expectedVersion);
            if (["published", "publishing", "draft_created", "cancelled"].includes(batch.status))
                demoError("当前正文已经发布或结束，不能继续修改。", 409);
            if (action === "confirm-and-publish") {
                if (batch.risks.some(r => ["blocked", "needs_input", "needs_approval"].includes(r.status)))
                    demoError("请先处理正文中的资料或确认事项。");
                if (body.contentDigest && body.contentDigest !== artifact.contentDigest)
                    demoError("正文版本已变化，请重新确认。", 409);
                batch.status = "draft_created";
                batch.draftCreatedAt = state.now;
                batch.draftUrl = `/demo-article/${batch.id}`;
                batch.externalRecordId = `demo-wechat-draft-${batch.id}`;
                batch.confirmedContentDigest = artifact.contentDigest;
                batch.nextAction = "已写入模拟公众号草稿箱，可查看正文；未正式发布。";
            }
            else if (action === "supplements") {
                for (const value of body.supplements || []) {
                    const risk = required(batch.risks.find(r => r.id === value.riskId), "待补充项");
                    risk.value = typeof value.value === "string" ? value.value : JSON.stringify(value.value);
                    risk.status = "ready";
                    risk.resolvedAt = state.now;
                }
                batch.riskAndGapSummary = { ready: batch.risks.filter(r => r.status === "ready").length, needsInput: batch.risks.filter(r => r.status === "needs_input").length, needsApproval: 0, warning: 0, blocked: 0 };
            }
            else if (action === "recheck" || action === "retry-failures") {
                batch.status = batch.risks.some(r => r.status === "needs_input") ? "needs_input" : "ready_for_confirmation";
                batch.failureMessage = undefined;
                batch.failureCode = undefined;
                batch.nextAction = "核对正文后确认发布。";
            }
            else if (action === "content" || action === "layout" || action === "visual-assets" || action === "hotspot") {
                const next = structuredClone(artifact);
                next.previousArtifactId = artifact.id;
                next.id = `artifact-${batch.id}-${batch.version + 1}`;
                next.version++;
                next.createdAt = state.now;
                if (action === "content") {
                    if (!body.title?.trim() || !body.articleBody?.trim())
                        demoError("标题和正文不能为空。");
                    next.selectedTitle = body.title;
                    next.summary = body.summary || "";
                    next.articleBody = body.articleBody;
                }
                if (action === "visual-assets") {
                    const visual = required(next.visualSuggestions.find(v => v.id === body.suggestionId), "配图建议");
                    if (body.mediaAssetId)
                        required(state.assets.find(a => a.id === body.mediaAssetId), "虚拟素材");
                    visual.boundAssetRef = body.mediaAssetId ? `workbench-media:${body.mediaAssetId}` : undefined;
                }
                if (action === "hotspot") {
                    next.articleBody = `> 虚拟热点：团队开始重视可检查的 AI 工作过程。此信息为演示编写。\n\n${next.articleBody}`;
                    next.hotspotIntegration = { provider: "aihot", hotspotId: `demo-hotspot-${state.revision}`, title: "虚拟热点：团队开始关注 AI 结果的可检查性", summary: "独立编写的演示新闻，不对应真实事件。", category: "industry", sourceName: "演示资讯", originalUrl: "/demo-article/demo-news", aihotUrl: "/demo-article/demo-news", relevanceScore: 0.82, selectionReason: "与团队协作和人工判断相关", writingAngle: "用过程透明度解释场景", hookPlan: { hookType: "question", factAnchor: "虚拟团队案例", readerTension: "结果难以核对", bridgeQuestion: "怎样保留人工判断？", titleUse: "optional" }, affectedSectionKeys: ["section-1"], riskNotes: ["此热点为虚构"], sourceEvidenceVersion: "1", sourceTitle: "演示资讯", sourceProvider: "demo", sourceContentHash: "demo-news", sourceFetchedAt: state.now, sourceEvidenceIds: ["demo-news"], hotspotDataUpdatedAt: state.now, hotspotDataFreshness: "cached", integratedAt: state.now };
                }
                const templateId = body.templateId || next.wechatPresentation?.templateId || "joto-official-v1";
                next.sections = markdownSections(next.selectedTitle, next.articleBody).map(section => ({ ...section, citations: [{ claimText: "虚拟资料说明", sourceIds: next.sourceExcerpts.map(source => source.id) }] }));
                next.contentDigest = `${batch.id}-digest-${next.version}`;
                next.wechatPresentation = { templateId, previewHtml: renderDemoArticle(next.selectedTitle, next.articleBody, templateId, next.visualSuggestions), publishHtml: renderDemoArticle(next.selectedTitle, next.articleBody, templateId, next.visualSuggestions), htmlHash: `html-${next.id}`, validation: { passed: true, blockers: [], warnings: [], checkedAt: state.now } };
                batch.draftArtifacts.push(next);
                batch.currentDraftArtifactId = next.id;
            }
            else if (action === "restore-version") {
                const previous = required(batch.draftArtifacts.find(a => a.id === artifact.previousArtifactId), "上一版本");
                batch.currentDraftArtifactId = previous.id;
                batch.status = "ready_for_confirmation";
            }
            else if (action === "visual-plan/selection") {
                const plan = state.settings.visualPlans?.[batch.id] || makeVisualPlan(batch, state.now);
                if (body.planId !== plan.planId || body.artifactId !== artifact.id)
                    demoError("封面与正文版本不匹配，请重新生成。", 409);
                const selected = required(plan.candidates.find((c: DemoRecord) => c.candidateId === body.candidateId), "封面候选");
                plan.selectedCoverCandidateId = selected.candidateId;
                plan.status = "applied";
                plan.version++;
                plan.candidates.forEach((c: DemoRecord) => { c.status = c.candidateId === selected.candidateId ? "selected" : "ready"; });
                state.settings.visualPlans = { ...state.settings.visualPlans, [batch.id]: plan };
                batch.risks.filter(r => r.key === "wechat_cover").forEach(r => { r.status = "ready"; r.assetRef = selected.contentUrl; r.resolvedAt = state.now; });
                batch.version++;
                batch.updatedAt = state.now;
                return dataReply({ batch, plan });
            }
            else if (action === "cover") {
                for (const risk of batch.risks.filter(r => r.key === "wechat_cover")) {
                    risk.status = "ready";
                    risk.assetRef = "/demo-assets/cover.svg";
                    risk.resolvedAt = state.now;
                }
            }
            else
                return undefined;
            batch.version++;
            batch.updatedAt = state.now;
            return dataReply(batch);
        }
    }
    if (path === "/api/v5/free-production/assets") {
        if (write) {
            const product = required(state.products.find(p => p.productId === body.productId), "素材所属产品");
            const file = body.file || body;
            const asset = { id: `asset-${state.revision}`, productId: product.productId, productNameSnapshot: product.displayName, name: file.fileName || "虚拟素材", originalFileName: file.fileName || "virtual-image.svg", description: body.description || "虚拟演示素材", mimeType: "image/svg+xml", mediaKind: "image", byteSize: 1200, status: "active", createdBy: "demo-user", updatedBy: "demo-user", createdAt: state.now, updatedAt: state.now, version: 1, contentUrl: "/demo-assets/workflow.svg" };
            state.assets.unshift(asset);
            return dataReply(asset);
        }
        const productId = url.searchParams.get("productId");
        const items = state.assets.filter(a => a.status !== "archived" && (!productId || a.productId === productId));
        return dataReply({ items, total: items.length });
    }
    const asset = path.match(/^\/api\/v5\/free-production\/assets\/([^/]+)$/);
    if (asset) {
        const row = required(state.assets.find(a => a.id === asset[1]), "虚拟素材");
        if (write) {
            expectVersion(row.version, body.expectedVersion);
            if (req.method === "DELETE")
                row.status = "archived";
            else {
                row.description = body.description || row.description;
                row.productId = body.productId || row.productId;
            }
            row.version++;
        }
        return dataReply(row);
    }
    const draftRoute = path.match(/^\/api\/v5\/drafts\/([^/]+)(?:\/(.+))?$/);
    if (draftRoute) {
        const draft = required(state.drafts[draftRoute[1]], "正文"), action = draftRoute[2];
        if (!action)
            return dataReply(draft);
        if (action === "sample-review") {
            if (write) {
                expectVersion(draft.version || 1, body.expectedVersion);
                draft.history = [{ draftVersionId: `${draftRoute[1]}-v${draft.version || 1}`, versionNumber: draft.version || 1, title: draft.title, markdown: draft.markdown, copyAllowed: true, createdAt: state.now, provider: "demo", model: "deterministic-simulator", decision: draft.sampleApproved ? "approved" : undefined }, ...(draft.history || [])];
                draft.sampleApproved = body.decision === "approve" || body.decision === "approved" || body.action === "approve";
                draft.reviewDecision = body.decision;
                draft.feedback = body.revisionInstruction || body.feedback;
                if (body.decision === "changes_requested") {
                    if (!draft.feedback?.trim())
                        demoError("请填写修改意见。");
                    draft.markdown = `> 根据本次演示修改意见补充：${draft.feedback}\n\n${draft.markdown}`;
                    const target = state.tasks.find(t => t.formalDraftId === draftRoute[1]);
                    if (target?.currentDraft)
                        target.currentDraft.markdown = draft.markdown;
                }
                draft.version = (draft.version || 1) + 1;
                const task = state.tasks.find(t => t.formalDraftId === draftRoute[1]);
                if (task && draft.sampleApproved) {
                    state.strategies[task.productId!].status = "production_ready";
                    for (const order of state.orders.filter(o => o.productId === task.productId)) {
                        order.status = "running";
                        order.rowVersion++;
                    }
                }
            }
            const task = state.tasks.find(t => t.formalDraftId === draftRoute[1]);
            return dataReply({ eligible: true, reviewStatus: draft.sampleApproved ? "approved" : "pending_review", strategyReady: draft.sampleApproved, productId: task?.productId, taskId: task?.taskId, draftVersionId: draftRoute[1], decision: draft.sampleApproved ? "approved" : "pending", status: draft.sampleApproved ? "approved" : "pending_review", rowVersion: draft.version || 1, feedback: draft.feedback, versionNumber: draft.version || 1, canReview: true, latestDecision: draft.reviewDecision });
        }
    }
    if (path === "/api/v5/article-type-profiles/supplement" && write)
        return dataReply({ status: "success", message: "虚拟建议已生成，请人工确认后采用。", suggestions: [{ field: "structureModules", value: ["场景与问题", "操作步骤", "使用边界"], reason: "便于说明从输入到结果的过程。" }], overlaps: [], missingInformation: [] });
    if (path === "/api/v5/article-type-profiles") {
        if (write) {
            const input = body.input || body;
            if (!input.name?.trim())
                demoError("请输入类型名称。");
            const id = `demo-article-type-${state.revision}`, profile = structuredClone(state.articleTypes[0]);
            profile.profileId = id;
            profile.status = "draft";
            profile.revision = 1;
            profile.rowVersion = 1;
            profile.currentVersion = { ...profile.currentVersion, ...input, profileId: id, profileVersionId: `${id}-v1`, version: 1, status: "draft" };
            profile.currentVersionId = profile.currentVersion.profileVersionId;
            delete profile.activeVersion;
            delete profile.activeVersionId;
            state.articleTypes.push(profile);
            return dataReply(profile);
        }
        return dataReply(state.articleTypes);
    }
    const typeRoute = path.match(/^\/api\/v5\/article-type-profiles\/([^/]+)(?:\/(activate))?$/);
    if (typeRoute) {
        const profile = required(state.articleTypes.find(p => p.profileId === typeRoute[1]), "内容类型");
        if (write) {
            expectVersion(profile.revision, body.expectedVersion);
            const input = body.input || body;
            if (typeRoute[2]) {
                profile.status = "active";
                profile.currentVersion.status = "active";
                profile.activeVersion = structuredClone(profile.currentVersion);
                profile.activeVersionId = profile.currentVersion.profileVersionId;
            }
            else if (body.action === "disable")
                profile.status = "disabled";
            else {
                profile.name = input.name || profile.name;
                profile.currentVersion = { ...profile.currentVersion, ...input, version: profile.currentVersion.version + 1, status: "draft" };
                profile.status = "draft";
            }
            profile.rowVersion++;
            profile.revision++;
        }
        return dataReply(profile, { profile });
    }
    return undefined;
}
