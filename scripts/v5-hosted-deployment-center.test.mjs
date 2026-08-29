import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { evaluateHostedDeploymentReadiness } from "../src/lib/v5/hosted-deployment-readiness.ts";

test("deployment readiness reports names only and honors selected features", () => {
  const secret = "this-value-must-never-be-returned";
  const result = evaluateHostedDeploymentReadiness({
    mode: "server",
    features: ["email", "geo", "browser_publish"],
    environment: {
      MYSQL_PASSWORD: secret,
      HOSTED_PUBLIC_BASE_URL: "https://workbench.example",
      HOSTED_REVIEW_LINK_SECRET: secret,
      HOSTED_EMAIL_SETUP_TOKEN: secret,
      HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY: secret,
      DASHSCOPE_API_KEY: secret,
      GEO_RESEARCH_ZHIPU_API_KEY: secret,
      PUBLISH_EXECUTOR_REGISTRATION_SECRET: secret
    }
  });

  assert.equal(result.totalGroups, 4);
  assert.equal(result.configurationReady, false);
  assert.equal(result.groups.find((group) => group.id === "runtime")?.ready, true);
  assert.doesNotMatch(JSON.stringify(result), /MYSQL_ROOT_PASSWORD/);
  assert.deepEqual(result.groups.find((group) => group.id === "browser_publish")?.missing, ["JOTO_PUBLISH_RUNNER_TOKEN"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("deployment center exposes six guided sections, official sources and sanitized templates", async () => {
  const [component, page, envExample, localEnvExample, route, aiConfigRoute, aiConfigService, ordersRoute] = await Promise.all([
    readFile(new URL("../src/components/HostedDeploymentCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.env.local.example", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/deployment-readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/deployment-ai-config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/deployment-ai-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/orders/route.ts", import.meta.url), "utf8")
  ]);

  for (const heading of [
    "准备运行环境和数据库",
    "连接 AI 与 GEO 服务",
    "配置邮箱登录与安全链接",
    "启动自动发布执行器",
    "配置发布渠道与增强能力",
    "检查配置并完成交接"
  ]) assert.match(component, new RegExp(heading));

  for (const source of [
    "help.aliyun.com/zh/model-studio/get-api-key",
    "open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    "console.volcengine.com/ark",
    "mp.weixin.qq.com",
    "console.cloud.google.com/auth/clients",
    "entra.microsoft.com"
  ]) assert.match(component, new RegExp(source.replaceAll(".", "\\.")));

  assert.match(component, /复制当前模板/);
  assert.match(component, /下载 \{activeTemplate\.filename\}/);
  assert.match(component, /所有产品能力默认开启/);
  assert.match(component, /本地 Docker/);
  assert.match(component, /服务器部署/);
  assert.match(component, /直接粘贴全部 AI Provider 配置/);
  assert.match(component, /识别、加密并立即启用/);
  assert.doesNotMatch(component, /Vercel 托管|id: "vercel"|id: "private"/);
  for (const captureGuideText of [
    "chrome:\/\/extensions\/",
    "edge:\/\/extensions\/",
    "browser-extension",
    "JOTO AI Front Test Companion",
    "capture-companion:start",
    "capture-companion:autostart",
    "下载最新 main ZIP"
  ]) assert.match(component, new RegExp(captureGuideText));
  for (const removedCaptureAction of [
    "查看扩展目录",
    "复制 Chrome 管理地址",
    "复制 Edge 管理地址",
    "复制扩展目录",
    "复制伴侣启动命令",
    "复制开机运行命令"
  ]) assert.doesNotMatch(component, new RegExp(removedCaptureAction));
  assert.match(component, /const allDeploymentFeatures: HostedDeploymentFeature\[\]/);
  for (const feature of ["email", "geo", "wechat", "browser_publish", "metrics", "capture"]) {
    assert.match(component, new RegExp(`"${feature}"`));
  }
  assert.doesNotMatch(component, /toggleFeature|setFeatures|deploymentFeatureGrid/);
  assert.match(page, /HostedDeploymentCenter/);
  assert.match(page, /ReturningOperationsHome/);
  assert.match(page, /发起新的推广批次/);
  assert.match(page, /新批次默认复用上次的产品、渠道和通知设置/);
  assert.match(envExample, /WECHATSYNC_BRIDGE_TOKEN=/);
  assert.match(envExample, /WECHAT_MP_APP_ID=/);
  assert.match(localEnvExample, /HOSTED_CAPTURE_SETUP_TOKEN=/);
  assert.match(localEnvExample, /【必填】/);
  assert.match(localEnvExample, /【选填】/);
  assert.match(localEnvExample, /【默认】/);
  assert.match(localEnvExample, /WORKBENCH_BASE_URL=http:\/\/127\.0\.0\.1:3027/);
  assert.match(localEnvExample, /QWEN_MODEL=qwen-plus/);
  assert.doesNotMatch(localEnvExample, /127\.0\.0\.1:3050/);
  assert.match(route, /timingSafeEqual/);
  assert.doesNotMatch(route, /process\.env\[[^\]]+\].*(?:json|NextResponse)/);
  assert.match(aiConfigRoute, /requireHostedEmailSetupToken/);
  assert.doesNotMatch(aiConfigRoute, /configText.*NextResponse/);
  assert.match(aiConfigService, /aes-256-gcm/);
  assert.match(aiConfigService, /worker-status/);
  assert.match(aiConfigService, /DASHSCOPE_API_KEY/);
  assert.match(aiConfigService, /GEO_RESEARCH_ZHIPU_API_KEY/);
  assert.match(ordersRoute, /export async function GET/);
  assert.match(ordersRoute, /listHostedPromotionOrderRecords/);
});
