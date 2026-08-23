import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceUrl = new URL("../src/lib/v5/hosted-email-sender-service.ts", import.meta.url);

test("个人发件邮箱只支持明确的四种供应商", async () => {
  const { personalEmailProviders } = await import(serviceUrl);
  assert.deepEqual(personalEmailProviders, ["qq", "163", "gmail", "outlook"]);
});

test("部署级设置口令采用失败关闭门禁", async () => {
  process.env.HOSTED_EMAIL_SETUP_TOKEN = "test-only-setup-token";
  const { requireHostedEmailSetupToken } = await import(serviceUrl);
  assert.throws(() => requireHostedEmailSetupToken("wrong"), /设置口令无效/);
  assert.doesNotThrow(() => requireHostedEmailSetupToken("test-only-setup-token"));
  delete process.env.HOSTED_EMAIL_SETUP_TOKEN;
});

test("SMTP、Gmail 与 Outlook 使用各自的正式发送协议", async () => {
  const source = await readFile(serviceUrl, "utf8");
  assert.match(source, /smtp\.qq\.com/);
  assert.match(source, /smtp\.163\.com/);
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
