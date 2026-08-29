import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("daily 3027 launcher is idempotent and never builds or tears down the stack", async () => {
  const launcher = await readFile("scripts/ensure-workbench-3027.ps1", "utf8");
  assert.match(launcher, /Test-WorkbenchHttpReady/);
  assert.match(launcher, /Enter-WorkbenchStartupLock/);
  assert.match(launcher, /Start-DockerEngine/);
  assert.match(launcher, /Assert-WorkbenchProductionImagesAvailable/);
  assert.match(launcher, /"up", "-d", "--no-build", "--pull", "never"/);
  assert.doesNotMatch(launcher, /Build-WorkbenchProductionImages/);
  assert.doesNotMatch(launcher, /"down"|--force-recreate/);
  assert.match(launcher, /Ensure-WorkbenchChannelPublishCompanions/);
});

test("production deployment remains explicit and separate from daily startup", async () => {
  const deploy = await readFile("scripts/deploy-docker-3027.ps1", "utf8");
  const wrapper = await readFile("scripts/start-docker-3027.ps1", "utf8");
  assert.match(deploy, /Build-WorkbenchProductionImages/);
  assert.match(deploy, /Ensure-WorkbenchChannelPublishCompanions/);
  assert.doesNotMatch(deploy, /"down"|--remove-orphans/);
  assert.match(wrapper, /ensure-workbench-3027\.ps1/);
});

test("Docker environment wrapper forwards deployment setup tokens from project config", async () => {
  const [environmentWrapper, compose] = await Promise.all([
    readFile("scripts/docker-compose-with-project-env.mjs", "utf8"),
    readFile("compose.yaml", "utf8")
  ]);
  for (const name of ["HOSTED_EMAIL_SETUP_TOKEN", "HOSTED_CAPTURE_SETUP_TOKEN"]) {
    assert.match(environmentWrapper, new RegExp(`"${name}"`));
    assert.ok(compose.includes(name + ": ${" + name + ":-}"));
  }
});

test("Windows logon task uses the no-build launcher and ignores duplicate starts", async () => {
  const register = await readFile("scripts/register-workbench-3027-autostart.ps1", "utf8");
  assert.match(register, /ensure-workbench-3027\.ps1/);
  assert.match(register, /-AtLogOn/);
  assert.match(register, /-MultipleInstances IgnoreNew/);
  assert.match(register, /-RestartCount 3/);
  assert.match(register, /-NoOpen/);
  assert.match(register, /Wechatsync Bridge and Arcs Runner/);
});

test("channel publishing companions are loopback-only, hidden, idempotent, and keep secrets out of output", async () => {
  const [launcher, projectEnvLauncher, probe, common, development] = await Promise.all([
    readFile("scripts/ensure-channel-publish-companions.ps1", "utf8"),
    readFile("scripts/run-with-project-env.mjs", "utf8"),
    readFile("scripts/probe-channel-publish-companions.mjs", "utf8"),
    readFile("scripts/workbench-3027-common.ps1", "utf8"),
    readFile("scripts/start-dev-3027.ps1", "utf8")
  ]);
  assert.match(launcher, /Local\\JotoChannelPublishCompanions/);
  assert.match(launcher, /arcs-runner\\\.venv\\Scripts\\python\.exe/);
  assert.match(launcher, /-WindowStyle Hidden/);
  assert.match(launcher, /RedirectStandardOutput/);
  assert.match(launcher, /JotoPublishRunner/);
  assert.match(launcher, /run-with-project-env\.mjs/);
  assert.match(projectEnvLauncher, /loadProjectEnv\(\)/);
  assert.match(projectEnvLauncher, /env: process\.env/);
  assert.doesNotMatch(projectEnvLauncher, /console\.log\([^)]*(TOKEN|SECRET|PASSWORD)/i);
  assert.match(probe, /LOOPBACK_HOSTS/);
  assert.match(probe, /JOTO_PUBLISH_RUNNER_TOKEN/);
  assert.match(probe, /bridgeTokenConfigured: Boolean/);
  assert.doesNotMatch(probe, /JSON\.stringify\([^)]*Token/);
  assert.match(common, /third-party channel actions stay fail-closed/);
  assert.match(development, /Ensure-WorkbenchChannelPublishCompanions/);
});
