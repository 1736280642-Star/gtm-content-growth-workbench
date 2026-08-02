import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const candidates = [
  process.env.ARCS_BROWSER_PATH,
  join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
].filter(Boolean);
const browserPath = candidates.find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error("No Chromium browser executable was found.");

const extensionDir =
  process.env.JOTO_PUBLISH_EXTENSION_RUNTIME_DIR || join(localAppData, "JotoPublishRunner", "extension");
if (!existsSync(join(extensionDir, "manifest.json"))) {
  throw new Error("Publish extension runtime is missing; run npm.cmd run extension:publish:prepare first.");
}
const profileDir =
  process.env.JUEJIN_BROWSER_PROFILE_DIR || join(localAppData, "JotoPublishProfiles", "juejin");

const child = spawn(
  browserPath,
  [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-minimized",
    "https://juejin.cn/creator/content/article"
  ],
  { detached: true, stdio: "ignore", windowsHide: true }
);
child.unref();
process.stdout.write(`publish_extension_browser_pid=${child.pid}\n`);
