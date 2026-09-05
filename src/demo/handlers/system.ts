import { dataReply, demoError, expectVersion, reply, required, type DemoRecord, type DemoRequest, type DemoState } from "../model";
import { legacySnapshot } from "../legacy-snapshot";
function expressionProfiles(state: DemoState) {
    if (!state.expressionProfiles.length)
        state.expressionProfiles = state.articleTypes.map(p => ({ profileId: `expression-${p.profileId}`, name: p.name, applicableArticleTypes: ["scenario"], applicableChannels: ["wechat", "csdn", "juejin", "zhihu"], currentVersionId: `expression-${p.profileId}-v1`, defaultProfile: true, rowVersion: 1, createdAt: state.now, updatedAt: state.now, currentVersion: { profileVersionId: `expression-${p.profileId}-v1`, profileId: `expression-${p.profileId}`, versionNumber: 1, status: "active", targetAudience: "运营负责人", writingFocus: "解释可复现的用户操作", structureModules: ["场景与问题", "操作步骤", "使用边界"].map((label, i) => ({ moduleId: `module-${i}`, label, guidance: `具体说明${label}`, required: true })), forbiddenStyles: ["无依据的效果承诺"], minLength: 600, maxLength: 1400, cta: "查看虚拟产品说明", otherInstructions: "所有内容均为虚拟演示资料", systemRuleFallbackFields: [], systemRuleVersion: "demo-v1", evidenceWarning: false, createdAt: state.now, createdBy: "demo-user" } }));
    return state.expressionProfiles;
}
export function systemRequest(state: DemoState, req: DemoRequest) {
    const path = new URL(req.path, "https://demo.invalid").pathname, body = req.body, write = req.method !== "GET";
    if (path === "/api/workbench-state")
        return reply(legacySnapshot(state));
    if (path === "/api/workspace-settings" && write) {
        Object.assign(state.settings, body);
        return dataReply({ workspaceSetting: state.settings }, { message: "演示设置已保存。" });
    }
    if (path === "/api/v5/automation/status")
        return dataReply({ items: [{ id: "demo-production", key: "content_production", name: "内容生产", label: "内容生产", status: "healthy", message: "虚拟正文已生成", lastRunAt: state.now }, { id: "demo-publish", key: "publishing", name: "发布与回传", label: "发布与回传", status: state.tasks.some(t => t.failureReason) ? "attention" : "healthy", message: "模拟发布结果已回传", lastRunAt: state.now }, { id: "demo-observation", key: "monitoring", name: "GEO 监测", label: "GEO 监测", status: "healthy", message: "合成样本已汇总", lastRunAt: state.now }], checkedAt: state.now });
    if (path === "/api/health")
        return reply({ ok: true, status: "ready", profile: "demo", checkedAt: state.now, latencyMs: 0, services: { database: { status: "ready", provider: "browser", message: "演示数据保存在当前浏览器" }, opensearch: { status: "ready", activeAliases: [{ alias: "demo-knowledge", index: "demo-synthetic-v1" }] }, generation: { status: "ready", provider: "simulator", model: "deterministic" }, workers: { status: "ready", workers: ["generation", "publish", "observation"].map(role => ({ role, status: "ready", ageMs: 0, jobs: [{ name: `demo-${role}`, state: "completed", lastFinishedAt: state.now, consecutiveFailures: 0 }] })) } } });
    if (path === "/api/v5/configuration/status")
        return dataReply({ items: [...['content_model', 'embedding_model', 'geo_search_zhipu', 'geo_search_doubao', 'geo_search_qwen'].map(key => ({ key, label: { content_model: "正文生成模型", research_model: "GEO 研究模型", embedding_model: "知识索引模型", geo_search_zhipu: "智谱 GEO 搜索（模拟）", geo_search_doubao: "豆包 GEO 搜索（模拟）", geo_search_qwen: "千问 GEO 搜索（模拟）" }[key], purpose: "通过模拟执行器返回确定的演示结果", category: "model" })), ...['wechat', 'zhihu', 'csdn', 'juejin'].map(key => ({ key, label: `${key} 发布连接`, purpose: "模拟发布并生成可打开的演示文章", category: "publish_connection" })), { key: "capture", label: "AI 前台监测", purpose: "展示虚拟问答样本", category: "observation_connection" }, { key: "metrics", label: "渠道指标采集", purpose: "合成数据展示指标口径", category: "content_metrics_connection" }].map(item => ({ ...item, status: "ready", accountAlias: "虚拟演示连接", lastCheckedAt: state.now, nextAction: "可进入相关页面演示。" })) });
    if (path === "/api/v5/article-expression-profiles") {
        const profiles = expressionProfiles(state);
        if (write) {
            const input = body.input || body;
            const profile = structuredClone(profiles[0]);
            profile.profileId = `expression-${state.revision}`;
            profile.name = input.name || "自定义表达规则";
            profile.rowVersion = 1;
            Object.assign(profile.currentVersion, input);
            state.expressionProfiles.push(profile);
            return dataReply(profile);
        }
        return dataReply({ profiles, stateVersion: state.revision });
    }
    const expression = path.match(/^\/api\/v5\/article-expression-profiles\/([^/]+)(?:\/(publish))?$/);
    if (expression) {
        const profile = required(expressionProfiles(state).find(p => p.profileId === expression[1]), "表达规则");
        if (write) {
            expectVersion(profile.rowVersion, body.expectedVersion);
            Object.assign(profile.currentVersion, body.input || body);
            if (body.name)
                profile.name = body.name;
            if (expression[2])
                profile.currentVersion.status = "active";
            profile.rowVersion++;
            profile.currentVersion.versionNumber++;
        }
        return dataReply(profile);
    }
    if (path === "/api/v5/knowledge-collection/wechat-status")
        return dataReply({ configured: true, baseUrlConfigured: true, apiKeyConfigured: true, sourceCount: state.collectionSources.length, enabledSourceCount: state.collectionSources.filter(s => s.enabled).length, failedSourceCount: 0, latestCollectedAt: state.now });
    if (path === "/api/v5/hosted/ai-capture-setup")
        return dataReply({ serviceOnline: true, availablePlatforms: ["chatgpt", "doubao", "deepseek", "qwen"] });
    if (path === "/api/v5/hosted/ai-front-test") {
        if (write) {
            state.settings.lastCapture = { taskId: `demo-capture-${state.revision}`, platform: body.platform || "chatgpt", status: "completed", question: "如何让团队的任务和资料可追溯？", message: "虚拟采集已完成，请到内容监控塔查看合成问答样本。" };
        }
        return dataReply(state.settings.lastCapture || { taskId: "demo-capture-initial", platform: "chatgpt", status: "completed", question: "哪些步骤需要人工确认？", message: "虚拟样本已准备。" });
    }
    if (path === "/api/v5/hosted/deployment-readiness")
        return reply({ readyGroups: 4, totalGroups: 4, configurationReady: true, groups: ["AI 与 GEO", "邮件通知", "发布渠道", "监控与回传"].map((label, i) => ({ id: `demo-group-${i}`, label, missing: [], ready: true, manualChecks: ["此项使用模拟执行，不代表真实服务连接。"] })), safety: { directPublishEnabled: false, directPublishMock: true } });
    if (path === "/api/v5/hosted/ai-capture-deployment" && write)
        return dataReply({ status: "ready", message: "演示采集环境已就绪。", serviceOnline: true, availablePlatforms: ["chatgpt", "doubao", "deepseek", "qwen"], steps: [{ label: "模拟服务", status: "ready" }] });
    const legacyKb = path.match(/^\/api\/knowledge-bases\/([^/]+)(?:\/(product-expression))?$/);
    if (legacyKb) {
        const kb = required(state.knowledge.find(k => k.id === legacyKb[1]), "知识库");
        if (write) {
            if (legacyKb[2]) {
                const draft = required(kb.productExpressionRuleDraft, "表达规则草稿");
                if (body.action === "regenerate") {
                    const { previousSnapshot: _, ...previous } = draft;
                    kb.productExpressionRuleDraft = { ...draft, version: String(Number(draft.version) + 1), previousVersion: draft.version, previousSnapshot: previous, status: "draft", generatedAt: state.now };
                } else if (body.action === "activate") {
                    draft.status = "active";
                    draft.activatedAt = state.now;
                } else if (body.action === "rollback" || body.action === "discard") {
                    kb.productExpressionRuleDraft = structuredClone(required(draft.previousSnapshot, "可恢复的上一版本"));
                } else demoError("请选择生成、确认或恢复规则版本。");
            }
            else
                Object.assign(kb, body);
            kb.rowVersion++;
        }
        return dataReply({ knowledgeBase: kb, productExpressionRulePackage: kb.productExpressionRulePackage }, { message: "虚拟规则已保存。" });
    }
    if (path === "/api/knowledge-bases/vectorize" && write) {
        for (const kb of state.knowledge) {
            kb.vectorized = true;
            kb.vectorStatus = "ready";
        }
        return dataReply({ processed: state.knowledge.length }, { message: "虚拟索引已更新。" });
    }
    const draft = path.match(/^\/api\/article-drafts\/([^/]+)$/);
    if (draft && write) {
        const row = required(state.drafts[draft[1]], "正文");
        Object.assign(row, body);
        for (const task of state.tasks.filter(t => t.formalDraftId === draft[1])) {
            if (task.currentDraft) {
                task.currentDraft.markdown = body.content || body.body || body.markdown || task.currentDraft.markdown;
                row.markdown = task.currentDraft.markdown;
                task.title = body.title || task.title;
                task.currentDraft.title = task.title;
            }
        }
        return dataReply(row, { message: "演示正文已保存。" });
    }
    return undefined;
}
