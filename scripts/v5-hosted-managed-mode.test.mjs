import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.HOSTED_REVIEW_LINK_SECRET = "hosted-managed-mode-test-secret";

const [{ compileHostedOrderNextAction, deriveHostedChannelAuthorizationPhase }, { buildHostedReviewExpiry, buildHostedReviewToken, hashHostedReviewToken }, { dispatchHostedNotifications }, { allHostedChannelCapsReached }, { buildHostedPreferenceToken, verifyHostedPreferenceToken }] = await Promise.all([
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

test("结果邮件提供签名退订入口且行动邮件保持强制", async () => {
  const [notificationService, preferencePage] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-notification-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/preferences/[token]/page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(notificationService, /buildHostedPreferenceToken/);
  assert.match(preferencePage, /退订每日结果/);
  assert.match(preferencePage, /必须处理的行动邮件/);
});
