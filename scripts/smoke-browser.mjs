import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = parseArgs();
const baseUrl = (typeof args["base-url"] === "string" ? args["base-url"] : process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
let remoteDebuggingPort = Number(args["debug-port"] || 0);
const userDataDir = join(tmpdir(), `gtm-browser-smoke-${Date.now()}`);
const results = [];
const failures = [];

if (args.help || args.h) {
  printJson({
    script: "smoke-browser",
    usage: "node scripts/smoke-browser.mjs [--base-url http://127.0.0.1:3000] [--debug-port 9223]"
  });
  process.exit(0);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf("=");

    if (equalsIndex >= 0) {
      parsed[rawKey.slice(0, equalsIndex)] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }

  return parsed;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function fileExists(pathName) {
  try {
    const { access } = await import("node:fs/promises");
    await access(pathName);
    return true;
  } catch {
    return false;
  }
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Unable to allocate a free debugging port"));
        }
      });
    });
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body: text.trim() ? JSON.parse(text) : {}
  };
}

function record(name, ok, detail) {
  const item = { name, ok: Boolean(ok), detail };
  results.push(item);

  if (!item.ok) {
    failures.push(item);
  }

  return item.ok;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 150) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();

      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw lastError || new Error(`Timed out after ${timeoutMs}ms`);
}

async function runStep(name, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function startBrowser() {
  const executable = await resolveChromePath();

  if (!executable) {
    throw new Error("Chrome or Edge executable was not found. Set CHROME_PATH to enable smoke:browser.");
  }

  if (!remoteDebuggingPort) {
    remoteDebuggingPort = await getFreePort();
  }

  mkdirSync(userDataDir, { recursive: true });
  let cdpReady = false;

  const child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,1000",
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    {
      stdio: "ignore",
      windowsHide: true
    }
  );

  child.once("exit", (code, signal) => {
    if (!cdpReady && (code !== null || signal)) {
      record("chrome_process_exit", false, `Chrome exited before CDP was ready: code=${code ?? "-"} signal=${signal ?? "-"}`);
    }
  });

  const ready = await runStep("chrome_cdp_ready", () => waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before CDP was ready: code=${child.exitCode}`);
    }

    try {
      const response = await requestJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
      return response.ok && response.body.webSocketDebuggerUrl;
    } catch {
      return false;
    }
  }, 30000));
  cdpReady = Boolean(ready);

  return child;
}

async function openPage() {
  const response = await requestJson(`http://127.0.0.1:${remoteDebuggingPort}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT"
  });
  const target = response.body;
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);

      if (payload.error) {
        reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      } else {
        resolve(payload.result || {});
      }
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function send(method, params = {}) {
    const id = nextId++;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }

    return result.result?.value;
  }

  async function navigate(pathName) {
    await send("Page.navigate", { url: `${baseUrl}${pathName}` });
    await waitFor(() => evaluate("document.readyState === 'complete'"), 15000);
    await delay(500);
  }

  async function click(selector) {
    await waitFor(() => evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && !element.disabled && element.offsetParent !== null);
      })()
    `), 10000);
    await delay(100);
    const point = await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return undefined;
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(x, y);
        return { x, y, hit: Boolean(topElement && (topElement === element || element.contains(topElement) || topElement.contains(element))), viewport: { width: window.innerWidth, height: window.innerHeight } };
      })()
    `);

    if (!point) {
      throw new Error(`Unable to click ${selector}`);
    }

    if (point.x < 0 || point.y < 0 || point.x > point.viewport.width || point.y > point.viewport.height) {
      throw new Error(`Target is outside viewport: ${selector}`);
    }

    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none"
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: ${point.x}, clientY: ${point.y}, button: 0 };
        const PointerCtor = window.PointerEvent || window.MouseEvent;
        element.dispatchEvent(new PointerCtor("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerCtor("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.dispatchEvent(new MouseEvent("click", eventInit));
        return true;
      })()
    `);
    await delay(100);
  }

  async function fill(selector, value) {
    await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 10000);
    await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const prototype = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        element.focus();
        descriptor.set.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async function containsText(text) {
    return evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
  }

  async function exists(selector) {
    return evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  }

  return {
    send,
    evaluate,
    navigate,
    click,
    fill,
    exists,
    containsText,
    close: () => socket.close()
  };
}

async function preparePublishRecord() {
  const generatedPlan = await requestJson(`${baseUrl}/api/weekly-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days: 1, dailyCount: 1, channels: ["wechat"] })
  });
  const task = generatedPlan.body.tasks?.[0];

  if (!generatedPlan.ok || !task?.id) {
    throw new Error(generatedPlan.body.message || "Failed to prepare weekly plan");
  }

  await requestJson(`${baseUrl}/api/content-tasks/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskIds: [task.id] })
  });

  const generatedDraft = await requestJson(`${baseUrl}/api/content-tasks/${task.id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const draft = generatedDraft.body.data?.draft;

  if (!generatedDraft.ok || !draft?.id) {
    throw new Error(generatedDraft.body.message || "Failed to prepare draft");
  }

  const approvedDraft = await requestJson(`${baseUrl}/api/article-drafts/${draft.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const recordData = approvedDraft.body.data?.record;

  if (!approvedDraft.ok || !recordData?.id) {
    throw new Error(approvedDraft.body.message || "Failed to prepare publish record");
  }

  return recordData;
}

async function main() {
  let browser;
  let page;

  try {
    browser = await runStep("start_browser", () => startBrowser());
    page = await runStep("open_cdp_page", () => openPage());

    await runStep("navigate_weekly_plan", () => page.navigate("/weekly-plan"));
    await runStep("click_weekly_plan_generate", () => page.click("[data-testid='weekly-plan-generate-button']"));
    await runStep("click_weekly_plan_confirm", () => page.click("[data-testid='weekly-plan-generate-confirm']"));
    const planState = await runStep("wait_weekly_plan_state", () => waitFor(async () => {
      const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
      return snapshot.ok && snapshot.body.state?.tasks?.length >= 1 ? snapshot : false;
    }, 15000));
    record("weekly_plan_popconfirm_generate", planState.ok && planState.body.state?.tasks?.length >= 1, `${planState.body.state?.tasks?.length || 0} tasks after confirmed click`);

    const knowledgeName = `Browser Smoke ${Date.now()}`;
    await runStep("navigate_knowledge", () => page.navigate("/knowledge"));
    await runStep("click_knowledge_create", () => page.click("[data-testid='knowledge-create-button']"));
    await runStep("fill_knowledge_name", () => page.fill("[data-testid='knowledge-name-input']", knowledgeName));
    await runStep("fill_knowledge_scope", () => page.fill("[data-testid='knowledge-scope-input']", "browser smoke validation"));
    await runStep("click_knowledge_save", () => page.click("[data-testid='knowledge-save-button']"));
    await runStep("wait_knowledge_dom", () => waitFor(() => page.containsText(knowledgeName), 15000));
    record("knowledge_modal_create_dom_refresh", await page.containsText(knowledgeName), knowledgeName);

    const publishRecord = await runStep("prepare_publish_record", () => preparePublishRecord());
    const publishedUrl = `https://example.com/browser-smoke/${publishRecord.id}`;
    await runStep("navigate_publish", () => page.navigate("/publish"));
    await runStep("click_publish_mark_published", () => page.click(`[data-testid='publish-mark-published-${publishRecord.id}']`));
    await runStep("click_publish_mark_published_confirm", () => page.click(`[data-testid='publish-mark-published-confirm-${publishRecord.id}']`));
    await runStep("wait_publish_url_entry", () => waitFor(() => page.exists(`[data-testid='publish-fill-url-${publishRecord.id}']`), 15000));
    await runStep("click_publish_url", () => page.click(`[data-testid='publish-fill-url-${publishRecord.id}']`));
    await runStep("fill_publish_url", () => page.fill("[data-testid='publish-url-input']", publishedUrl));
    await runStep("click_publish_url_save", () => page.click("[data-testid='publish-url-save-button']"));
    await runStep("wait_publish_dom", () => waitFor(() => page.containsText(publishedUrl), 15000));
    const finalState = await requestJson(`${baseUrl}/api/workbench-state`);
    const savedRecord = finalState.body.state?.publishRecords?.find((recordItem) => recordItem.id === publishRecord.id);
    record("publish_url_modal_fill_dom_refresh", savedRecord?.publishedUrl === publishedUrl && (await page.containsText(publishedUrl)), publishedUrl);
  } catch (error) {
    record("smoke_browser_runtime", false, error instanceof Error ? error.message : String(error));
  } finally {
    page?.close();
    browser?.kill();
  }

  printJson({
    script: "smoke-browser",
    baseUrl,
    status: failures.length ? "failed" : "success",
    passed: results.filter((item) => item.ok).length,
    failed: failures.length,
    results
  });

  if (failures.length) {
    process.exitCode = 1;
  }
}

main();
