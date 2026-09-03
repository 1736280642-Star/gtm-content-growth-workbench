import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.HOSTED_REVIEW_LINK_SECRET = "hosted-managed-mode-test-secret";

const [{ compileHostedOrderNextAction, deriveHostedChannelAuthorizationPhase, deriveHostedWorkflowState }, { buildHostedReviewExpiry, buildHostedReviewToken, hashHostedReviewToken }, { dispatchHostedNotifications }, { allHostedChannelCapsReached, resolveHostedDailyResultGuidance }, { buildHostedPreferenceToken, verifyHostedPreferenceToken }] = await Promise.all([
  import("../src/lib/v5/hosted-managed-contracts.ts"),
  import("../src/lib/v5/hosted-review-repository.ts"),
  import("../src/lib/v5/hosted-notification-service.ts"),
  import("../src/lib/v5/hosted-daily-batch-service.ts"),
  import("../src/lib/v5/hosted-link-signing.ts")
]);

function order(status, overrides = {}) {
  return {
    orderId: "hosted-order-test",
    productId: "product-test",
    productName: "测试产品",
    contactEmail: "test@example.com",
    contactEmailVerified: false,
    status,
    channels: [{ channel: "wechat" }],
    dailyCaps: {},
    notificationPreferences: { dailyDigest: true, actionRequired: true, monthlyCompleted: true },
    materialSummary: { fileNames: [], acceptedSourceCount: 1, failedSources: [], importStatus: "queued" },
    timezone: "Asia/Shanghai",
    rowVersion: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides
  };
}

test("托管用户状态始终编译成一个明确下一步", () => {
  assert.equal(compileHostedOrderNextAction(order("preparing")).type, "wait");
  assert.equal(compileHostedOrderNextAction(order("pending_strategy_review")).type, "review_strategy");
  assert.equal(compileHostedOrderNextAction(order("generating_sample")).label, "正在生成代表样文");
  assert.equal(compileHostedOrderNextAction(order("pending_sample_review")).type, "review_sample");
  assert.equal(compileHostedOrderNextAction(order("running")).type, "view_results");
  assert.equal(compileHostedOrderNextAction(order("action_required", { lastError: { code: "auth", message: "需要重新连接账号" } })).description, "需要重新连接账号");
  assert.equal(compileHostedOrderNextAction(order("paused")).type, "resume");
});

test("渠道授权异常直接指向托管设置中的唯一处理动作", () => {
  const action = compileHostedOrderNextAction(order("action_required", {
    lastError: { code: "hosted_channel_authorization_required", message: "需要确认发布账号" }
  }));
  assert.equal(action.href, "/hosted/settings?orderId=hosted-order-test");
  assert.equal(action.type, "resolve_issue");
});

test("第三方渠道授权始终只暴露一个当前步骤", () => {
  assert.equal(deriveHostedChannelAuthorizationPhase({ ruleReady: false, accountPassed: false, authPassed: false }), "system_setup");
  assert.equal(deriveHostedChannelAuthorizationPhase({ ruleReady: true, accountPassed: false, authPassed: false }), "needs_login");
  assert.equal(deriveHostedChannelAuthorizationPhase({ ruleReady: true, accountPassed: false, authPassed: false, authDetail: "需要安全挑战" }), "manual_takeover_required");
  assert.equal(deriveHostedChannelAuthorizationPhase({ ruleReady: true, accountPassed: false, authPassed: true }), "needs_account_confirmation");
  assert.equal(deriveHostedChannelAuthorizationPhase({ ruleReady: true, accountPassed: true, authPassed: true }), "connected");
});

test("审核 Token 可重建、只落哈希且不同有效期产生不同 Token", () => {
  const first = buildHostedReviewToken("hosted-review-test", "2026-08-23T00:00:00.000Z");
  const replay = buildHostedReviewToken("hosted-review-test", "2026-08-23T00:00:00.000Z");
  const renewed = buildHostedReviewToken("hosted-review-test", "2026-08-24T00:00:00.000Z");
  assert.equal(first, replay);
  assert.notEqual(first, renewed);
  assert.match(hashHostedReviewToken(first), /^[a-f0-9]{64}$/);
  assert.ok(!hashHostedReviewToken(first).includes("hosted-review-test"));
});

test("已确认策略后的样文运行态不会退回待确认策略", () => {
  const running = deriveHostedWorkflowState({
    strategyStatus: "superseded",
    sample: {
      strategyPackId: "strategy-approved",
      taskId: "sample-task",
      operationId: "sample-operation",
      operationStatus: "running",
      progressStage: "calling_provider",
      attemptCount: 1,
      reviewStatus: "pending_generation",
      hasReviewableDraft: false
    }
  });
  assert.deepEqual(running, { status: "generating_sample", currentActionType: "generate_sample" });

  const failed = deriveHostedWorkflowState({
    strategyStatus: "strategy_approved",
    sample: {
      operationStatus: "failed",
      attemptCount: 1,
      hasReviewableDraft: false,
      error: { code: "provider_failed", message: "AI 服务暂时不可用" }
    }
  });
  assert.equal(failed.status, "action_required");
  assert.equal(failed.currentActionType, "retry_sample");
  assert.equal(failed.lastError?.code, "hosted_sample_generation_failed");
});

test("托管订单绑定样文任务并在生成期间自动刷新", async () => {
  const [migration, repository, reviewService, managedService, successPage, retryRoute] = await Promise.all([
    readFile(new URL("../database/migrations/20260829_043_v5_hosted_sample_progress.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-managed-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-review-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-managed-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/success/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/orders/[orderId]/sample-retry/route.ts", import.meta.url), "utf8")
  ]);
  for (const column of ["current_strategy_pack_id", "current_sample_task_id", "current_sample_operation_id"]) {
    assert.match(migration, new RegExp(column));
    assert.match(repository, new RegExp(column));
  }
  assert.match(reviewService, /status: "generating_sample"|\? "generating_sample"/);
  assert.match(managedService, /readHostedOrderSampleProgress/);
  assert.match(managedService, /hosted_sample_generation_failed/);
  assert.match(successPage, /window\.setInterval/);
  assert.match(successPage, /页面每 4 秒自动更新/);
  assert.match(successPage, /重新生成样文/);
  assert.match(retryRoute, /retryHostedSampleGeneration/);
});

test("新 GEO 调研运行时托管端回到调研进度并清除旧样文绑定", async () => {
  const [repository, managedService] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-managed-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-managed-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(repository, /readHostedProductActiveResearchRun/);
  assert.match(repository, /readHostedOrderHasInvalidatedWorkflowBinding/);
  assert.match(repository, /pack\.invalidated_at IS NOT NULL/);
  assert.match(repository, /'planned', 'queued', 'running', 'awaiting_frontend', 'synthesizing'/);
  assert.match(repository, /CASE WHEN \? THEN NULL ELSE COALESCE/);
  assert.match(repository, /newer_research\.created_at > strategy\.created_at/);
  assert.match(repository, /newer_research\.status NOT IN \('failed', 'cancelled'\)/);
  assert.match(managedService, /activeResearch[\s\S]*status: "preparing"/);
  assert.match(managedService, /clearWorkflowBinding: Boolean\(activeResearch \|\| invalidatedWorkflowBinding\)/);
  assert.match(managedService, /if \(!order\.lastError\?\.code\) return true/);
});

test("审核过期时间以 Date 写入 MySQL，同时以 ISO 字符串参与 Token 签名", async () => {
  const now = Date.parse("2026-08-27T09:06:16.275Z");
  const expiresAtDate = buildHostedReviewExpiry(72, now);
  assert.ok(expiresAtDate instanceof Date);
  assert.equal(expiresAtDate.toISOString(), "2026-08-30T09:06:16.275Z");

  const repository = await readFile(new URL("../src/lib/v5/hosted-review-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /buildHostedReviewToken\(reviewRequestId, expiresAt\)/);
  assert.match(repository, /tokenHash, expiresAtDate, idempotencyKey/);
  assert.doesNotMatch(repository, /tokenHash, expiresAt, idempotencyKey/);
});

test("有效签名且到期时间一致的审核链接可安全修复历史哈希失配", async () => {
  const repository = await readFile(new URL("../src/lib/v5/hosted-review-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /WHERE review\.id = \? LIMIT 1 FOR UPDATE/);
  assert.match(repository, /storedExpiry !== verified\.expiresAt/);
  assert.match(repository, /review\.status === "cancelled"/);
  assert.match(repository, /hosted_review_token_hash_reconciled/);
  assert.match(repository, /UPDATE hosted_review_request SET token_hash = \?/);
  assert.doesNotMatch(repository, /WHERE review\.id = \? AND review\.token_hash = \?/);
});

test("邮件通知偏好使用签名链接且篡改后失效", () => {
  const token = buildHostedPreferenceToken("hosted-order-test");
  assert.equal(verifyHostedPreferenceToken(token).orderId, "hosted-order-test");
  assert.throws(() => verifyHostedPreferenceToken(`${token.slice(0, -1)}x`), /通知偏好链接无效/);
});

test("托管前端不再依赖会话假数据或模拟结果邮件", async () => {
  const [home, success, email] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/success/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/email/page.tsx", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(home, /sessionStorage|joto-hosted-task|选择文章表达/);
  assert.match(home, /\/api\/v5\/hosted\/orders/);
  assert.match(success, /\/api\/v5\/hosted\/orders/);
  assert.doesNotMatch(email, /模拟阿里邮箱|marketing@example\.cn|const results =/);
  assert.match(email, /daily-batches/);
});

test("首次配置以单页六步向导呈现并保留可折叠详细指引", async () => {
  const [home, login, success, settings, connectionsPage, connections] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/success/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/settings/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/connections/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/connections/HostedConnectionsWorkspace.tsx", import.meta.url), "utf8")
  ]);

  for (const sectionId of ["setup-identity", "setup-product", "setup-channels", "setup-notifications", "setup-accounts", "setup-ready"]) {
    assert.match(home, new RegExp(`id="${sectionId}"`));
  }
  assert.match(home, /<details className=\{styles\.setupGuide\}/);
  assert.match(home, /配置通行证/);
  assert.match(home, /调研就绪/);
  assert.match(home, /发布就绪/);
  assert.match(home, /HostedConnectionsWorkspace/);
  assert.match(home, /publish-account-binding/);
  assert.match(home, /\/api\/v5\/hosted\/auth\/request/);
  assert.match(login, /redirect\(query\.error \? "\/\?loginError=invalid" : "\/\?setup=login"\)/);
  assert.match(success, /#setup-accounts/);
  assert.match(settings, /#setup-accounts/);
  assert.match(connectionsPage, /export default function HostedConnectionsPage/);
  assert.doesNotMatch(connectionsPage, /export function HostedConnectionsWorkspace/);
  assert.match(connections, /export function HostedConnectionsWorkspace/);
  assert.doesNotMatch(`${home}\n${login}\n${success}\n${settings}`, /\/settings\?tab=connections/);
});

test("每日上限归属于 MonthlyPlan 排程且使用较小安全值", async () => {
  const monthlyAutomation = await readFile(new URL("../src/lib/v5/monthly-automation-service.ts", import.meta.url), "utf8");
  assert.match(monthlyAutomation, /hosted_promotion_order/);
  assert.match(monthlyAutomation, /policy\.dailyLimit = Math\.min\(policy\.dailyLimit, hostedCap\)/);
  assert.match(monthlyAutomation, /readV5MonthlyPlanRecord/);
});

test("多渠道批次不会因单一渠道先到上限而提前关闭", () => {
  const caps = { wechat: 1, zhihu: 1 };
  const firstChannelOnly = [
    { taskId: "wechat-1", title: "A", channel: "wechat", status: "published", publicUrl: "https://example.com/a" },
    { taskId: "zhihu-1", title: "B", channel: "zhihu", status: "platform_review" }
  ];
  assert.equal(allHostedChannelCapsReached(caps, firstChannelOnly), false);
  assert.equal(allHostedChannelCapsReached(caps, [
    firstChannelOnly[0],
    { ...firstChannelOnly[1], status: "published", publicUrl: "https://example.com/b" }
  ]), true);
});

test("每日结果使用统一责任模型区分自动处理与用户处理", () => {
  const autoRetry = resolveHostedDailyResultGuidance({ status: "failed", publishStatus: "failed", attemptCount: 1 });
  assert.equal(autoRetry.responsibility, "system");
  assert.equal(autoRetry.userActionRequired, false);
  assert.match(autoRetry.nextAction, /自动重试/);

  const exhausted = resolveHostedDailyResultGuidance({ status: "failed", publishStatus: "failed", attemptCount: 3 });
  assert.equal(exhausted.responsibility, "user");
  assert.equal(exhausted.userActionRequired, true);

  const platformReview = resolveHostedDailyResultGuidance({ status: "platform_review", publishStatus: "published" });
  assert.equal(platformReview.responsibility, "external");
  assert.equal(platformReview.userActionRequired, false);

  const explicitTakeover = resolveHostedDailyResultGuidance({ status: "platform_review", responsibility: "user", userActionRequired: true });
  assert.equal(explicitTakeover.responsibility, "user");
  assert.equal(explicitTakeover.userActionRequired, true);
});

test("结果邮件呈现失败原因、唯一处理入口和真实 MonthlyReview 摘要", async () => {
  const [dailyService, managedService, notificationService] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-daily-batch-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-managed-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-notification-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(dailyService, /item\.user_action_required/);
  assert.match(dailyService, /failureReason/);
  assert.match(dailyService, /actionLabel/);
  assert.match(managedService, /getMonthlyReview\(month\)/);
  assert.match(managedService, /review\.productOptimizations\.find/);
  assert.match(managedService, /monthlySummary\.dataStatus !== "complete"/);
  assert.match(managedService, /notification\.event_type = 'monthly_completed'/);
  assert.match(notificationService, /本轮结论/);
  assert.match(notificationService, /确认的问题/);
  assert.match(notificationService, /下一轮建议仅作为后续计划候选/);
});

test("托管 Worker 已接入生产 Supervisor", async () => {
  const [supervisor, migration] = await Promise.all([
    readFile(new URL("../workers/production-supervisor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../database/migrations/20260820_039_v5_hosted_managed_mode.sql", import.meta.url), "utf8")
  ]);
  assert.match(supervisor, /hosted-managed-worker\.mjs/);
  for (const table of ["hosted_promotion_order", "hosted_review_request", "hosted_daily_publish_batch", "hosted_notification_outbox"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("未配置邮件供应商时保持待投递，不伪造已发送", async () => {
  delete process.env.HOSTED_EMAIL_DELIVERY_URL;
  delete process.env.HOSTED_EMAIL_DELIVERY_TOKEN;
  const result = await dispatchHostedNotifications();
  assert.equal(result.pendingConfig, true);
  assert.equal(result.processed, 0);
});

test("渠道授权、暂停门禁与月度完成均通过正式状态编排", async () => {
  const [managedService, channelService, settingsPage, connectPage, rolloutService] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-managed-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-channel-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/settings/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/connections/HostedConnectionsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-rollout-readiness-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(channelService, /getProductRolloutReadiness/);
  assert.match(managedService, /hosted_channel_authorization_required/);
  assert.match(managedService, /\["review_ready", "completed"\]/);
  assert.match(managedService, /monthly_completed/);
  assert.match(settingsPage, /\/hosted\/connections\?orderId=/);
  assert.match(connectPage, /channel-connections/);
  assert.match(rolloutService, /hosted_managed_order_paused/);
  assert.match(rolloutService, /hosted_managed_channel_disabled/);
});

test("第三方授权使用专用浏览器，不要求用户粘贴敏感凭据", async () => {
  const [connectPage, authorizationService, formalClient, executorWorker, arcsServer, arcsPlatforms, rolloutService] = await Promise.all([
    readFile(new URL("../src/app/hosted/connections/HostedConnectionsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/channel-account-connection-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/formal-publish-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/browser-executor-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../arcs-runner/joto_arcs_runner/server.py", import.meta.url), "utf8"),
    readFile(new URL("../arcs-runner/joto_arcs_runner/platforms.py", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-rollout-readiness-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(connectPage, /云端托管/);
  assert.match(connectPage, /Desktop Connector/);
  assert.match(connectPage, /确认用于/);
  assert.doesNotMatch(connectPage, /setCookie|setToken/);
  assert.match(authorizationService, /account_detected/);
  assert.match(formalClient, /executeGovernedBrowserOperation/);
  assert.match(executorWorker, /\/auth\/connect/);
  assert.match(arcsServer, /path == "\/auth\/identify"/);
  assert.match(arcsPlatforms, /def open_auth/);
  assert.match(arcsPlatforms, /def identify_account/);
  assert.match(rolloutService, /hosted_publish_account_connection_required/);
});

test("策略修改意见会进入新一轮正式 GEO 调研而不是卡在已驳回状态", async () => {
  const reviewService = await readFile(new URL("../src/lib/v5/hosted-review-service.ts", import.meta.url), "utf8");
  assert.match(reviewService, /updateGeoResearchProject/);
  assert.match(reviewService, /startGeoResearchRun/);
  assert.match(reviewService, /strategyRevisionQueued/);
});

test("策略邮件允许人工直接编辑并保存当前候选包，不必重新调研", async () => {
  const [reviewPage, reviewRoute, reviewService, strategyService, strategyRepository] = await Promise.all([
    readFile(new URL("../src/app/hosted/review/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/reviews/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-review-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-strategy-pack-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-strategy-pack-repository.ts", import.meta.url), "utf8")
  ]);
  assert.match(reviewPage, /保存核心表达/);
  assert.match(reviewPage, /产品身份表达/);
  assert.match(reviewPage, /实体关系与责任边界/);
  assert.match(reviewPage, /固定表达或 CTA/);
  assert.doesNotMatch(reviewRoute, /articleDirections/);
  assert.doesNotMatch(reviewRoute, /targetAudience/);
  assert.match(reviewPage, /method: "PATCH"/);
  assert.match(reviewPage, /还有未保存的核心表达/);
  assert.match(reviewRoute, /export async function PATCH/);
  assert.match(reviewService, /editHostedStrategyReview/);
  assert.match(strategyService, /editPendingProductGeoStrategyPack/);
  assert.match(strategyRepository, /updatePendingProductStrategyContent/);
  assert.match(strategyRepository, /product_strategy_content_human_edited/);
  assert.match(strategyRepository, /status = 'draft'/);
});

test("结果邮件提供签名退订入口且行动邮件保持强制", async () => {
  const [notificationService, preferencePage] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-notification-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/preferences/[token]/page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(notificationService, /buildHostedPreferenceToken/);
  assert.match(preferencePage, /退订每日结果/);
  assert.match(preferencePage, /必须处理的行动邮件/);
});
