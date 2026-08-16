import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { formatBytes } from "./knowledge-capacity-report.mjs";

const scriptPath = new URL("./bootstrap-full-production.ps1", import.meta.url);
const source = readFileSync(scriptPath, "utf8");

test("production bootstrap has no-silent-downgrade and credential safeguards", () => {
  assert.match(source, /RandomNumberGenerator/);
  assert.match(source, /MySQL volume already exists but \.env is missing/);
  assert.match(source, /value was not printed/);
  assert.match(source, /api\/health\?deep=true/);
  assert.match(source, /Wait-WorkbenchFullProductionReady/);
  assert.match(source, /AllowPendingProvider/);
  assert.doesNotMatch(source, /Write-(?:Host|Output)[^\n]*(?:MYSQL_PASSWORD|DASHSCOPE_API_KEY).*\$/i);
});

test("production bootstrap is valid PowerShell", { skip: process.platform !== "win32" }, () => {
  const parserCommand = [
    "$tokens = $null",
    "$errors = $null",
    `[System.Management.Automation.Language.Parser]::ParseFile('${decodeURIComponent(scriptPath.pathname).replace(/^\//, "").replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null`,
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parserCommand], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("capacity report formats storage without loading deployment credentials", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB");
  const capacitySource = readFileSync(new URL("./knowledge-capacity-report.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(capacitySource, /loadEnvFile|dotenv|readFile[^\n]*["']\.env/i);
  assert.doesNotMatch(capacitySource, /MYSQL_PASSWORD|DASHSCOPE_API_KEY/);
});
