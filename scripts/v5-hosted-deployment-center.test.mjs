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

test("deployment center exposes five guided sections with AI and GEO first", async () => {
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
    "填写 AI 与 GEO 凭证",
    "选择系统发件邮箱",
    "启动自动发布执行器",
    "填写渠道必需信息",
    "检查配置并完成交接"
  ]) assert.match(component, new RegExp(heading));
  assert.doesNotMatch(component, /准备运行环境和数据库|deployment-runtime/);
  for (const [number, heading] of [
    [1, "填写 AI 与 GEO 凭证"],
    [2, "选择系统发件邮箱"],
    [3, "启动自动发布执行器"],
    [4, "填写渠道必需信息"],
    [5, "检查配置并完成交接"]
  ]) assert.match(component, new RegExp(`number=\\{${number}\\} title="${heading}"`));

  for (const source of [
    "help.aliyun.com/zh/model-studio/get-api-key",
    "open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    "console.volcengine.com/ark",
    "mp.weixin.qq.com",
    "console.cloud.google.com/auth/clients",
    "entra.microsoft.com"
  ]) assert.match(component, new RegExp(source.replaceAll(".", "\\.")));

  assert.match(component, /所有产品能力默认开启/);
  assert.match(component, /本地 Docker/);
  assert.match(component, /服务器部署/);
  assert.match(component, /EnvFieldForm/);
  assert.doesNotMatch(component, /复制当前模板|实时生成的可部署配置|businessTemplateBlocked/);
  assert.doesNotMatch(component, /setSetupToken/);
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
  assert.match(page, /邮箱链路已连接，继续完成整体验收/);
  assert.match(page, /现在处理：完整部署初始化/);
  assert.match(page, /pageAudience !== "deployment" \? <aside/);
  assert.doesNotMatch(page, /一次走完首次部署，之后只交给用户使用。|从数据库、AI、邮箱到自动发布|部署人员操作，普通用户不接触密钥/);
  assert.match(page, /ReturningOperationsHome/);
  assert.match(page, /orders\.slice\(0, 1\)\.map/);
  assert.match(ordersRoute, /listHostedPromotionOrderRecords\(identity\.workspaceId, 1\)/);
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
