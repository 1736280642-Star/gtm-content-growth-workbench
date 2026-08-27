import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { evaluateHostedDeploymentReadiness } from "../src/lib/v5/hosted-deployment-readiness.ts";

test("deployment readiness reports names only and honors selected features", () => {
  const secret = "this-value-must-never-be-returned";
  const result = evaluateHostedDeploymentReadiness({
    mode: "vercel",
    features: ["email", "geo", "browser_publish"],
    environment: {
      MYSQL_HOST: "database.example",
      MYSQL_PORT: "3306",
      MYSQL_DATABASE: "joto",
      MYSQL_USER: "joto",
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
  assert.deepEqual(result.groups.find((group) => group.id === "browser_publish")?.missing, ["JOTO_PUBLISH_RUNNER_TOKEN"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("deployment center exposes six guided sections, official sources and sanitized templates", async () => {
  const [component, page, envExample, localEnvExample, route] = await Promise.all([
    readFile(new URL("../src/components/HostedDeploymentCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.env.local.example", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/deployment-readiness/route.ts", import.meta.url), "utf8")
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
  for (const captureGuideText of [
    "chrome:\/\/extensions\/",
    "edge:\/\/extensions\/",
    "browser-extension",
    "JOTO AI Front Test Companion",
    "capture-companion:start",
    "capture-companion:autostart",
    "下载最新 main ZIP"
  ]) assert.match(component, new RegExp(captureGuideText));
  assert.match(component, /const allDeploymentFeatures: HostedDeploymentFeature\[\]/);
  for (const feature of ["email", "geo", "wechat", "browser_publish", "metrics", "capture"]) {
    assert.match(component, new RegExp(`"${feature}"`));
  }
  assert.doesNotMatch(component, /toggleFeature|setFeatures|deploymentFeatureGrid/);
  assert.match(page, /HostedDeploymentCenter/);
  assert.match(envExample, /WECHATSYNC_BRIDGE_TOKEN=/);
  assert.match(envExample, /WECHAT_MP_APP_ID=/);
  assert.match(localEnvExample, /HOSTED_CAPTURE_SETUP_TOKEN=/);
  assert.match(route, /timingSafeEqual/);
  assert.doesNotMatch(route, /process\.env\[[^\]]+\].*(?:json|NextResponse)/);
});
