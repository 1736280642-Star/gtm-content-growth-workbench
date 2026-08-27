import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceUrl = new URL("../src/lib/v5/hosted-email-sender-service.ts", import.meta.url);
const providerUrl = new URL("../src/app/hosted/email-sender/provider.ts", import.meta.url);

test("个人发件邮箱只支持明确的供应商白名单", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /personalEmailProviders = \["qq", "163", "aliyun", "gmail", "outlook"\] as const/);
});

test("授权页根据邮箱域名自动识别供应商", async () => {
  const { detectHostedEmailProvider } = await import(providerUrl);
  assert.equal(detectHostedEmailProvider("owner@qq.com"), "qq");
  assert.equal(detectHostedEmailProvider("owner@163.com"), "163");
  assert.equal(detectHostedEmailProvider("owner@jotoglobal.com"), "aliyun");
  assert.equal(detectHostedEmailProvider("owner@gmail.com"), "gmail");
  assert.equal(detectHostedEmailProvider("owner@hotmail.com"), "outlook");
  assert.equal(detectHostedEmailProvider("owner@@qq.com"), undefined);
  assert.equal(detectHostedEmailProvider("owner@jototch.cn"), "aliyun");
  assert.equal(detectHostedEmailProvider("owner@company.example"), undefined);
});

test("部署级设置口令采用失败关闭门禁", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /HOSTED_EMAIL_SETUP_TOKEN/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /设置口令无效/);
  assert.match(source, /设置口令尚未配置/);
});

test("SMTP、Gmail 与 Outlook 使用各自的正式发送协议", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /smtp\.qq\.com/);
  assert.match(source, /smtp\.163\.com/);
  assert.match(source, /smtp\.qiye\.aliyun\.com/);
  assert.match(source, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
  assert.match(source, /graph\.microsoft\.com\/v1\.0\/me\/sendMail/);
  assert.match(source, /gmail\.send/);
  assert.match(source, /Mail\.Send/);
});

test("Gmail OAuth 使用 OpenID UserInfo 识别已验证邮箱且不扩大 Gmail 权限", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /openidconnect\.googleapis\.com\/v1\/userinfo/);
  assert.match(source, /payload\.email_verified === true/);
  assert.doesNotMatch(source, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/profile/);
  assert.match(source, /\["openid", "email", "https:\/\/www\.googleapis\.com\/auth\/gmail\.send"\]/);
});

test("OAuth 回调使用部署访问地址且不把页面重定向异常误报为授权失败", async () => {
  const source = await readFile(new URL("../src/app/api/v5/hosted/email-sender/oauth/callback/[provider]/route.ts", import.meta.url), "utf8");
  assert.match(source, /HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL/);
  assert.match(source, /url\.hostname === "0\.0\.0\.0"/);
  assert.match(source, /url\.hostname = "127\.0\.0\.1"/);
  assert.match(source, /reason: safeFailureCode\(error\)/);
  assert.doesNotMatch(source, /new URL\("\/hosted\/email-sender", request\.url\)/);
  assert.match(source, /return setupPage\(request, \{ result: "connected", provider: result\.provider \}\);/);
});

test("授权信息以 AES-256-GCM 密文落库且审计不包含凭据", async () => {
  const [service, migration] = await Promise.all([
    readFile(serviceUrl, "utf8"),
    readFile(new URL("../database/migrations/20260823_041_v5_personal_email_sender.sql", import.meta.url), "utf8")
  ]);
  assert.match(service, /aes-256-gcm/);
  assert.match(migration, /encrypted_credentials TEXT NOT NULL/);
  assert.doesNotMatch(migration, /app_password|refresh_token/i);
  assert.doesNotMatch(service, /afterSummary: \{[^}]*appPassword|afterSummary: \{[^}]*refreshToken/s);
});

test("授权页不把私密凭据放入 React state、URL 或浏览器持久存储", async () => {
  const [page, smtpRoute, oauthStart] = await Promise.all([
    readFile(new URL("../src/app/hosted/email-sender/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/email-sender/smtp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/v5/hosted/email-sender/oauth/start/route.ts", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(page, /useState[^\n]*(?:setupToken|appPassword|refreshToken)/i);
  assert.doesNotMatch(page, /(?:localStorage|sessionStorage)\s*\./);
  assert.match(page, /new FormData\(form\)/);
  assert.match(page, /form\.reset\(\)/);
  assert.match(smtpRoute, /request\.formData\(\)/);
  assert.match(oauthStart, /request\.formData\(\)/);
});

test("首页按普通用户与部署人员分开引导发件配置", async () => {
  const [homePage, senderPage, styles, deploymentCenter] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/email-sender/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted-mode.module.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/HostedDeploymentCenter.tsx", import.meta.url), "utf8")
  ]);
  const deploymentGuide = `${homePage}\n${deploymentCenter}`;
  assert.match(homePage, /我是普通用户/);
  assert.match(homePage, /我是部署人员/);
  assert.match(homePage, /普通用户不需要配置发件邮箱、SMTP、OAuth 或 Setup Token/);
  assert.match(deploymentGuide, /HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(deploymentGuide, /randomBytes\(32\)/);
  assert.match(deploymentGuide, /Project Settings/);
  assert.match(deploymentGuide, /更换后必须重新连接邮箱/);
  assert.match(deploymentGuide, /Google OAuth 应用/);
  assert.match(deploymentGuide, /HOSTED_EMAIL_MICROSOFT_CLIENT_ID/);
  assert.match(deploymentGuide, /https:\/\/console\.cloud\.google\.com\/auth\/clients/);
  assert.match(deploymentGuide, /https:\/\/entra\.microsoft\.com\/#view\/Microsoft_AAD_RegisteredApps/);
  assert.match(deploymentGuide, /oauth\/callback\/gmail/);
  assert.match(deploymentGuide, /oauth\/callback\/outlook/);
  assert.doesNotMatch(deploymentGuide, /oauth\/callback\/(?:google|microsoft)/);
  assert.match(deploymentGuide, /V5_CAPTURE_EXTENSION_ID/);
  assert.match(deploymentGuide, /\/hosted\/email-sender/);
  assert.match(deploymentGuide, /切到普通用户试跑/);
  assert.doesNotMatch(deploymentGuide, /identitySenderSetup/);
  assert.doesNotMatch(deploymentGuide, /部署管理员一次性准备/);
  assert.match(senderPage, /\?role=deployment#deployment-email/);
  assert.match(styles, /\.workspace\[hidden\]/);
  assert.match(styles, /\.deploymentWorkspace\[hidden\]/);
});

test("登录邮件与通知邮件复用统一投递适配器", async () => {
  const [identity, notification, emailClient, emailSender, homePage] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-identity-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-notification-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-email-client.ts", import.meta.url), "utf8"),
    readFile(serviceUrl, "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(identity, /deliverHostedTransactionalEmail/);
  assert.match(identity, /delivery_status IN \('sending', 'sent'\)/);
  assert.match(notification, /deliverHostedTransactionalEmail/);
  assert.match(emailClient, /deliverWithPersonalEmailSender/);
  assert.match(emailSender, /hosted_email_oauth_refresh_unreachable/);
  assert.match(emailSender, /attempts: 2/);
  assert.match(homePage, /重新发送登录邮件/);
  assert.doesNotMatch(homePage, />更换邮箱或重新发送</);
});

test("3027 部署在启动容器前验证 Worker 镜像入口", async () => {
  const [dockerfile, launcher] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../scripts/workbench-3027-common.ps1", import.meta.url), "utf8")
  ]);
  assert.match(dockerfile, /COPY --chown=worker:nodejs workers \.\/workers/);
  assert.match(launcher, /Assert-WorkbenchWorkerImageEntrypoints/);
  assert.match(launcher, /\/app\/workers\/browser-executor-worker\.mjs/);
});
