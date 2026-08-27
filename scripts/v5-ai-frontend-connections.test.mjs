import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("deployment-shared AI frontend tasks keep requester ownership", async () => {
  const [migration, repository, hostedRoute] = await Promise.all([
    read("database/migrations/20260827_042_v5_deployment_shared_ai_capture.sql"),
    read("src/lib/v5/capture-repository.ts"),
    read("src/app/api/v5/hosted/ai-front-test/route.ts")
  ]);
  assert.match(migration, /execution_scope/);
  assert.match(migration, /requested_workspace_id/);
  assert.match(migration, /requested_user_id/);
  assert.match(repository, /createDeploymentSharedCaptureTask/);
  assert.match(repository, /c\.execution_scope = 'deployment_shared'/);
  assert.match(repository, /requestedWorkspaceId: input\.workspaceId/);
  assert.match(repository, /requestedUserId: input\.userId/);
  assert.match(hostedRoute, /requested_workspace_id = \? AND requested_user_id = \?/);
  assert.match(hostedRoute, /createDeploymentSharedCaptureTask/);
  assert.doesNotMatch(hostedRoute, /payload\.connectionId/);
});

test("ordinary users only send requests while deployment personnel manage the shared server", async () => {
  const [page, settingsPage, panel, requestPanel, setupRoute, deploymentRoute, deploymentGuide, pairingRoute] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/app/hosted/settings/page.tsx"),
    read("src/components/HostedAiFrontendTestPanel.tsx"),
    read("src/components/HostedAiCaptureRequestPanel.tsx"),
    read("src/app/api/v5/hosted/ai-capture-setup/route.ts"),
    read("src/app/api/v5/hosted/ai-capture-deployment/route.ts"),
    read("src/components/HostedAiCaptureDeploymentGuide.tsx"),
    read("src/app/api/v5/capture-pairing-codes/route.ts")
  ]);
  assert.doesNotMatch(page, /HostedAiFrontendTestPanel/);
  assert.match(page, /确认委托，开始调研/);
  assert.match(page, /是否开启 AI 前台测试/);
  assert.match(page, /setup-ai-frontend/);
  assert.match(page, /HostedAiCaptureRequestPanel/);
  assert.match(page, /HostedAiCaptureDeploymentGuide/);
  assert.match(page, /普通用户不接触这些配置/);
  assert.match(settingsPage, /HostedAiFrontendTestPanel/);
  assert.match(settingsPage, /AI 前台验证（可选）/);
  assert.match(panel, /HostedAiCaptureRequestPanel/);
  assert.match(requestPanel, /\/api\/v5\/hosted\/ai-front-test/);
  assert.match(requestPanel, /\/api\/v5\/hosted\/ai-capture-setup/);
  assert.doesNotMatch(requestPanel, /NEXT_PUBLIC_V5_CAPTURE_EXTENSION_ID/);
  assert.match(setupRoute, /requireHostedIdentity/);
  assert.match(setupRoute, /executionScope: "deployment_shared"/);
  assert.doesNotMatch(setupRoute, /requester:/);
  assert.match(deploymentRoute, /requireHostedCaptureSetupToken/);
  assert.match(deploymentRoute, /executionScope: "deployment_shared"/);
  assert.match(deploymentGuide, /name="setupToken"/);
  assert.doesNotMatch(deploymentGuide, /useState\([^)]*setupToken/);
  assert.match(pairingRoute, /USER_CAPTURE_PAIRING_RETIRED/);
});

test("extension opens a non-focused capture window without requiring a pre-opened platform tab", async () => {
  const worker = await read("browser-extension/src/service-worker.js");
  assert.match(worker, /chrome\.windows\.create/);
  assert.match(worker, /focused: false/);
  assert.match(worker, /closeCaptureWindow/);
  assert.doesNotMatch(worker, /if \(!tabs\.length\)/);
  assert.doesNotMatch(worker, /await platformTabs\(task\.platform\)/);
});

test("neutral benchmark evidence fails closed without verified isolation", async () => {
  const [adapter, capture, repository, runner, popup, statusRoute] = await Promise.all([
    read("browser-extension/src/adapters/china-ai.js"),
    read("browser-extension/src/content/capture.js"),
    read("src/lib/v5/capture-repository.ts"),
    read("capture-runner/src/server.mjs"),
    read("browser-extension/src/popup/popup.js"),
    read("src/app/api/v5/capture-tasks/[id]/status/route.ts")
  ]);
  assert.match(adapter, /verifyIsolation/);
  assert.match(capture, /isolation_unverified/);
  assert.match(capture, /isolationAttestation/);
  assert.match(runner, /isolationAttestation: manifest\.isolationAttestation/);
  assert.match(repository, /capture_isolation_unverified/);
  assert.match(repository, /user_attested/);
  assert.match(repository, /legacyUnsafeProfile/);
  assert.match(popup, /dedicated_account/);
  assert.match(popup, /memory_off/);
  assert.match(popup, /custom_instructions_off/);
  assert.match(popup, /personalized_user_sample/);
  assert.match(runner, /api\/v5\/capture-tasks\/\$\{encodeURIComponent\(taskId\)\}\/status/);
  assert.match(statusRoute, /recordCaptureTaskFailure/);
});

test("Windows companion keeps Runner alive and can launch the paired Chrome profile", async () => {
  const [desktop, register, packageJson] = await Promise.all([
    read("scripts/capture-runner-desktop.ps1"),
    read("scripts/register-capture-companion-autostart.ps1"),
    read("package.json")
  ]);
  assert.match(desktop, /NotifyIcon/);
  assert.match(desktop, /V5_CAPTURE_CHROME_PROFILE_DIRECTORY/);
  assert.match(desktop, /--start-minimized/);
  assert.match(register, /GetFolderPath\("Startup"\)/);
  assert.match(packageJson, /capture-companion:autostart/);
});
