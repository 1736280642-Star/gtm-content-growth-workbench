import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI frontend connections bind tasks to a concrete device and platform", async () => {
  const [migration, repository, taskRoute] = await Promise.all([
    read("database/migrations/20260820_038_v5_ai_frontend_connections.sql"),
    read("src/lib/v5/capture-repository.ts"),
    read("src/app/api/v5/capture-tasks/route.ts")
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_frontend_connections/);
  assert.match(migration, /capture_tasks ADD COLUMN IF NOT EXISTS connection_id/);
  assert.match(repository, /capture_task_connection_device_mismatch/);
  assert.match(repository, /c\.device_id = \?/);
  assert.match(taskRoute, /connectionId/);
});

test("hosted mode creates a real connected capture task and wakes the extension", async () => {
  const [page, panel, route, manifest, worker] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/components/HostedAiFrontendTestPanel.tsx"),
    read("src/app/api/v5/hosted/ai-front-test/route.ts"),
    read("browser-extension/manifest.json"),
    read("browser-extension/src/service-worker.js")
  ]);
  assert.match(page, /HostedAiFrontendTestPanel/);
  assert.match(panel, /\/api\/v5\/hosted\/ai-front-test/);
  assert.match(panel, /NEXT_PUBLIC_V5_CAPTURE_EXTENSION_ID/);
  assert.match(route, /createConnectedManualCaptureTask/);
  assert.match(manifest, /externally_connectable/);
  assert.match(worker, /onMessageExternal/);
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
