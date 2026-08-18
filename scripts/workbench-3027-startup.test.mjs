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
});

test("production deployment remains explicit and separate from daily startup", async () => {
  const deploy = await readFile("scripts/deploy-docker-3027.ps1", "utf8");
  const wrapper = await readFile("scripts/start-docker-3027.ps1", "utf8");
  assert.match(deploy, /Build-WorkbenchProductionImages/);
  assert.doesNotMatch(deploy, /"down"|--remove-orphans/);
  assert.match(wrapper, /ensure-workbench-3027\.ps1/);
});

test("Windows logon task uses the no-build launcher and ignores duplicate starts", async () => {
  const register = await readFile("scripts/register-workbench-3027-autostart.ps1", "utf8");
  assert.match(register, /ensure-workbench-3027\.ps1/);
  assert.match(register, /-AtLogOn/);
  assert.match(register, /-MultipleInstances IgnoreNew/);
  assert.match(register, /-RestartCount 3/);
  assert.match(register, /-NoOpen/);
});
