import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.HOSTED_REVIEW_LINK_SECRET = "hosted-managed-mode-test-secret";

const [{ compileHostedOrderNextAction, deriveHostedChannelAuthorizationPhase }, { buildHostedReviewToken, hashHostedReviewToken }, { dispatchHostedNotifications }, { allHostedChannelCapsReached }, { buildHostedPreferenceToken, verifyHostedPreferenceToken }] = await Promise.all([
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
    readFile(new URL("../src/app/hosted/connect/[channel]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-rollout-readiness-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(channelService, /getProductRolloutReadiness/);
  assert.match(managedService, /hosted_channel_authorization_required/);
  assert.match(managedService, /\["review_ready", "completed"\]/);
  assert.match(managedService, /monthly_completed/);
  assert.match(settingsPage, /\/hosted\/connect\//);
  assert.match(connectPage, /publish-account-binding/);
  assert.match(rolloutService, /hosted_managed_order_paused/);
  assert.match(rolloutService, /hosted_managed_channel_disabled/);
});

test("第三方授权使用专用浏览器，不要求用户粘贴敏感凭据", async () => {
  const [connectPage, authorizationService, formalClient, bridge, arcsServer, arcsPlatforms, rolloutService] = await Promise.all([
    readFile(new URL("../src/app/hosted/connect/[channel]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-channel-authorization-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/formal-publish-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/wechatsync-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../arcs-runner/joto_arcs_runner/server.py", import.meta.url), "utf8"),
    readFile(new URL("../arcs-runner/joto_arcs_runner/platforms.py", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/product-rollout-readiness-service.ts", import.meta.url), "utf8")
  ]);
  assert.match(connectPage, /打开 .* 登录窗口/);
  assert.match(connectPage, /我已完成登录，重新检查/);
  assert.match(connectPage, /确认用于/);
  assert.doesNotMatch(connectPage, /<Input|<TextArea|setCookie|setToken/);
  assert.match(authorizationService, /hosted_channel_rule_not_active/);
  assert.match(formalClient, /openFormalPublishAuthorization/);
  assert.match(bridge, /\/auth\/connect/);
  assert.match(arcsServer, /path == "\/auth\/connect"/);
  assert.match(arcsPlatforms, /def open_auth/);
  assert.match(rolloutService, /publish_account_auth_required/);
  assert.match(rolloutService, /zhihu:managed-profile/);
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
