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
  const [homePage, senderPage, styles] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted/email-sender/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/hosted-mode.module.css", import.meta.url), "utf8")
  ]);
  assert.match(homePage, /我是普通用户/);
  assert.match(homePage, /我是部署人员/);
  assert.match(homePage, /普通用户不需要配置发件邮箱、SMTP、OAuth 或 Setup Token/);
  assert.match(homePage, /HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(homePage, /randomBytes\(32\)/);
  assert.match(homePage, /Project Settings/);
  assert.match(homePage, /之前保存的 SMTP 或 OAuth 凭据将无法解密/);
  assert.match(homePage, /Gmail \/ Outlook OAuth 到底是什么/);
  assert.match(homePage, /HOSTED_EMAIL_MICROSOFT_CLIENT_ID/);
  assert.match(homePage, /https:\/\/console\.cloud\.google\.com\/auth\/clients/);
  assert.match(homePage, /https:\/\/console\.cloud\.google\.com\/apis\/library\/gmail\.googleapis\.com/);
  assert.match(homePage, /https:\/\/entra\.microsoft\.com\/#view\/Microsoft_AAD_RegisteredApps/);
  assert.match(homePage, /https:\/\/mail\.qq\.com\//);
  assert.match(homePage, /https:\/\/mail\.163\.com\//);
  assert.match(homePage, /https:\/\/help\.aliyun\.com\/zh\/document_detail\/444380\.html/);
  assert.match(homePage, /oauth\/callback\/gmail/);
  assert.match(homePage, /oauth\/callback\/outlook/);
  assert.doesNotMatch(homePage, /oauth\/callback\/(?:google|microsoft)/);
  assert.match(homePage, /deployment-ai-capture/);
  assert.match(homePage, /V5_CAPTURE_EXTENSION_ID/);
  assert.match(homePage, /capture-companion:autostart/);
  assert.match(homePage, /切到普通用户试发/);
  assert.doesNotMatch(homePage, /identitySenderSetup/);
  assert.doesNotMatch(homePage, /部署管理员一次性准备/);
  assert.match(senderPage, /\?role=deployment#deployment-email/);
  assert.match(styles, /\.workspace\[hidden\]/);
  assert.match(styles, /\.deploymentWorkspace\[hidden\]/);
});

test("登录邮件与通知邮件复用统一投递适配器", async () => {
  const [identity, notification, emailClient] = await Promise.all([
    readFile(new URL("../src/lib/v5/hosted-identity-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-notification-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/v5/hosted-email-client.ts", import.meta.url), "utf8")
  ]);
  assert.match(identity, /deliverHostedTransactionalEmail/);
  assert.match(notification, /deliverHostedTransactionalEmail/);
  assert.match(emailClient, /deliverWithPersonalEmailSender/);
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
