import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { connect as connectTcp } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const args = parseArgs();
const baseUrl = (typeof args["base-url"] === "string" ? args["base-url"] : process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3047").replace(/\/+$/, "");
const smokeScope = normalizeScope(args.scope);
let remoteDebuggingPort = Number(args["debug-port"] || 0);
let lastCdpTargetProbe = "not-started";
const userDataDir = join(tmpdir(), `gtm-browser-smoke-${Date.now()}`);
const results = [];
const failures = [];

if (args.help || args.h) {
  printJson({
    script: "smoke-browser",
    usage: "node scripts/smoke-browser.mjs [--scope full|roles|content|responsive|publish|v5] [--base-url http://127.0.0.1:3047] [--debug-port 9223]"
  });
  process.exit(0);
}

function normalizeScope(scope) {
  const value = typeof scope === "string" ? scope : "full";
  const allowedScopes = new Set(["full", "roles", "content", "responsive", "publish", "v5"]);

  if (!allowedScopes.has(value)) {
    throw new Error(`Unsupported smoke browser scope: ${value}`);
  }

  return value;
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
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  return new Promise((resolve) => {
    process.stdout.write(text, resolve);
  });
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

async function requestJsonWithRetry(url, options = {}, timeoutMs = 10000) {
  return waitFor(async () => {
    try {
      const response = await requestJson(url, options);
      return response.ok ? response : false;
    } catch {
      return false;
    }
  }, timeoutMs);
}

async function createCdpPageTarget(timeoutMs = 15000) {
  const url = `http://127.0.0.1:${remoteDebuggingPort}/json/new?${encodeURIComponent("about:blank")}`;

  try {
    return await waitFor(async () => {
    for (const method of ["PUT", "GET"]) {
      try {
        const response = await requestJson(url, { method });
        lastCdpTargetProbe = `new method=${method} status=${response.status} hasWs=${Boolean(response.body?.webSocketDebuggerUrl)}`;

        if (response.body?.webSocketDebuggerUrl) {
          return response.body;
        }
      } catch (error) {
        lastCdpTargetProbe = `new method=${method} error: ${error instanceof Error ? error.message : String(error)}`;
        // Retry until Chrome exposes the page target endpoint.
      }
    }

    try {
      const listResponse = await requestJson(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
      const targets = Array.isArray(listResponse.body) ? listResponse.body : [];
      lastCdpTargetProbe = `list status=${listResponse.status} targets=${targets.map((item) => item.type || "-").join(",") || "none"}`;
      const existingTarget = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);

      if (existingTarget) {
        return existingTarget;
      }
    } catch (error) {
      lastCdpTargetProbe = `list error: ${error instanceof Error ? error.message : String(error)}`;
      // Retry until Chrome exposes at least one page target.
    }

    return false;
    }, timeoutMs);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last CDP probe: ${lastCdpTargetProbe}`);
  }
}

async function resolveCurrentRole() {
  const response = await requestJson(`${baseUrl}/api/workbench-state`);

  return response.body.state?.workspaceSetting?.currentRole;
}

async function setCurrentRole(currentRole) {
  if (!currentRole) return;

  const response = await requestJson(`${baseUrl}/api/workspace-settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ currentRole })
  });

  const savedRole = response.body.data?.workspaceSetting?.currentRole;

  if (!response.ok || savedRole !== currentRole) {
    throw new Error(response.body.message || `Failed to switch role to ${currentRole}`);
  }
}

async function prepareValidPublishMatrix() {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const weeklyPlan = snapshot.body.state?.weeklyPlan;
  const publishMatrix = weeklyPlan?.publishMatrix;

  if (!weeklyPlan?.id || !Array.isArray(publishMatrix) || !publishMatrix.length) {
    return;
  }

  await requestJson(`${baseUrl}/api/weekly-plans/${weeklyPlan.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      publishMatrix: publishMatrix.map((day, index) => ({
        ...day,
        plannedCount: index === 0 ? 1 : 0,
        paused: index !== 0,
        locked: false,
        source: "manual"
      }))
    })
  });
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
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
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

  try {
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
    }, 45000));
    cdpReady = Boolean(ready);
  } catch (error) {
    child.kill();
    throw error;
  }

  return child;
}

async function openPage() {
  const versionResponse = await requestJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
  const browserWebSocketUrl = versionResponse.body?.webSocketDebuggerUrl;

  if (!versionResponse.ok || !browserWebSocketUrl) {
    throw new Error("Chrome CDP did not return a browser websocket URL.");
  }

  const socket = await createWebSocketTransport(browserWebSocketUrl);
  let nextId = 1;
  const pending = new Map();
  let targetId;
  let pageSessionId;

  socket.onMessage((message) => {
    const payload = JSON.parse(message);

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

  function sendRaw(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  const createdTarget = await sendRaw("Target.createTarget", { url: "about:blank" });
  targetId = createdTarget.targetId;

  if (!targetId) {
    throw new Error("Chrome CDP Target.createTarget did not return targetId.");
  }

  const attachedTarget = await sendRaw("Target.attachToTarget", { targetId, flatten: true });
  pageSessionId = attachedTarget.sessionId;

  if (!pageSessionId) {
    throw new Error("Chrome CDP Target.attachToTarget did not return sessionId.");
  }

  function send(method, params = {}, timeoutMs) {
    return sendRaw(method, params, pageSessionId, timeoutMs);
  }

  await send("Page.enable");
  await send("DOM.enable");

  async function setViewport(width, height, mobile = false) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      screenWidth: width,
      screenHeight: height,
      deviceScaleFactor: 1,
      mobile
    });
    await delay(150);
  }

  await setViewport(1440, 1000, false);

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
    await send("Page.navigate", { url: `${baseUrl}${pathName}` }, 180000);
    await waitFor(() => evaluate("document.readyState === 'complete'"), 15000);
    await delay(500);
  }

  async function click(selector) {
    try {
      await waitFor(() => evaluate(`
        (() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          return Boolean(element && !element.disabled && element.offsetParent !== null);
        })()
      `), 10000);
    } catch (error) {
      const state = await evaluate(`
        (() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) {
            return {
              exists: false,
              bodyText: document.body.innerText.slice(0, 400)
            };
          }
          const rect = element.getBoundingClientRect();
          return {
            exists: true,
            disabled: Boolean(element.disabled),
            ariaDisabled: element.getAttribute("aria-disabled"),
            className: element.className,
            offsetParent: Boolean(element.offsetParent),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            text: element.innerText,
            bodyText: document.body.innerText.slice(0, 400)
          };
        })()
      `);
      throw new Error(`Unable to find clickable ${selector}: ${JSON.stringify(state)}`);
    }
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

  async function hover(selector) {
    await waitFor(() => evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && element.offsetParent !== null);
      })()
    `), 10000);
    const point = await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return undefined;
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `);

    if (!point) throw new Error(`Unable to hover ${selector}`);

    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none"
    });
    await delay(350);
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
    setViewport,
    navigate,
    click,
    hover,
    fill,
    exists,
    containsText,
    close: async () => {
      try {
        if (targetId) {
          await sendRaw("Target.closeTarget", { targetId });
        }
      } catch {
        // The browser process may already be closing at the end of a smoke run.
      } finally {
        socket.close();
      }
    }
  };
}

function createWebSocketTransport(rawUrl) {
  const url = new URL(rawUrl);
  const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));

  if (url.protocol !== "ws:") {
    throw new Error(`Only local ws:// CDP sockets are supported by smoke-browser: ${url.protocol}`);
  }

  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    const socket = connectTcp({ host: url.hostname, port });
    const messageHandlers = new Set();
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let connected = false;
    let fragmentBuffer = Buffer.alloc(0);

    const fail = (error) => {
      try {
        socket.destroy();
      } catch {
        // Ignore cleanup errors.
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const handleFrames = () => {
      while (frameBuffer.length >= 2) {
        const first = frameBuffer[0];
        const second = frameBuffer[1];
        const fin = Boolean(first & 0x80);
        const opcode = first & 0x0f;
        const masked = Boolean(second & 0x80);
        let length = second & 0x7f;
        let offset = 2;

        if (length === 126) {
          if (frameBuffer.length < offset + 2) return;
          length = frameBuffer.readUInt16BE(offset);
          offset += 2;
        } else if (length === 127) {
          if (frameBuffer.length < offset + 8) return;
          const high = frameBuffer.readUInt32BE(offset);
          const low = frameBuffer.readUInt32BE(offset + 4);
          const combined = high * 2 ** 32 + low;
          if (!Number.isSafeInteger(combined)) {
            throw new Error("CDP websocket frame is too large to parse safely.");
          }
          length = combined;
          offset += 8;
        }

        const maskLength = masked ? 4 : 0;
        if (frameBuffer.length < offset + maskLength + length) return;

        let payload = frameBuffer.subarray(offset + maskLength, offset + maskLength + length);
        if (masked) {
          const mask = frameBuffer.subarray(offset, offset + 4);
          payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
        }
        frameBuffer = frameBuffer.subarray(offset + maskLength + length);

        if (opcode === 0x8) {
          socket.end();
          return;
        }

        if (opcode === 0x9) {
          sendFrame(payload, 0xA);
          continue;
        }

        if (opcode === 0x1 || opcode === 0x0) {
          fragmentBuffer = opcode === 0x1 ? Buffer.from(payload) : Buffer.concat([fragmentBuffer, payload]);

          if (fin) {
            const text = fragmentBuffer.toString("utf8");
            fragmentBuffer = Buffer.alloc(0);
            for (const handler of messageHandlers) {
              handler(text);
            }
          }
        }
      }
    };

    const sendFrame = (payload, opcode = 0x1) => {
      const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
      const mask = randomBytes(4);
      let headerLength = 2;

      if (data.length >= 126 && data.length <= 65535) {
        headerLength += 2;
      } else if (data.length > 65535) {
        headerLength += 8;
      }

      const header = Buffer.alloc(headerLength);
      header[0] = 0x80 | opcode;

      if (data.length < 126) {
        header[1] = 0x80 | data.length;
      } else if (data.length <= 65535) {
        header[1] = 0x80 | 126;
        header.writeUInt16BE(data.length, 2);
      } else {
        header[1] = 0x80 | 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(data.length, 6);
      }

      const maskedPayload = Buffer.alloc(data.length);
      for (let index = 0; index < data.length; index += 1) {
        maskedPayload[index] = data[index] ^ mask[index % 4];
      }

      socket.write(Buffer.concat([header, mask, maskedPayload]));
    };

    socket.once("error", (error) => {
      if (!connected) {
        fail(error);
      }
    });

    socket.once("connect", () => {
      const pathName = `${url.pathname}${url.search}`;
      socket.write(
        [
          `GET ${pathName} HTTP/1.1`,
          `Host: ${url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n"
        ].join("\r\n")
      );
    });

    socket.on("data", (chunk) => {
      if (!connected) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf("\r\n\r\n");

        if (headerEnd === -1) return;

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString("utf8");
        const statusLine = headerText.split("\r\n")[0] || "";
        const acceptHeader = headerText
          .split("\r\n")
          .map((line) => line.split(":"))
          .find(([name]) => name?.toLowerCase() === "sec-websocket-accept")?.[1]
          ?.trim();

        if (!statusLine.includes("101") || acceptHeader !== expectedAccept) {
          fail(new Error(`CDP websocket handshake failed: ${statusLine}`));
          return;
        }

        connected = true;
        frameBuffer = handshakeBuffer.subarray(headerEnd + 4);
        handshakeBuffer = Buffer.alloc(0);
        resolve({
          send: (text) => sendFrame(text),
          onMessage: (handler) => messageHandlers.add(handler),
          close: () => {
            try {
              sendFrame(Buffer.alloc(0), 0x8);
            } finally {
              socket.end();
            }
          }
        });
        handleFrames();
        return;
      }

      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      handleFrames();
    });
  });
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
    method: "POST"
  });
  const record = approvedDraft.body.data?.record;

  if (!approvedDraft.ok || !record?.id) {
    throw new Error(approvedDraft.body.message || "Failed to approve draft");
  }

  return { task, draft, record };
}

async function resolvePublishRecordForTask(taskId) {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const savedDraft = snapshot.body.state?.drafts?.find((draftItem) => draftItem.taskId === taskId);
  const savedRecord = snapshot.body.state?.publishRecords?.find((recordItem) => recordItem.draftId === savedDraft?.id);

  if (!snapshot.ok || !savedRecord?.id) {
    return undefined;
  }

  return savedRecord;
}

async function resolveDistributionTargetsForTask(taskId) {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const savedDraft = snapshot.body.state?.drafts?.find((draftItem) => draftItem.taskId === taskId);
  const savedRecord = snapshot.body.state?.publishRecords?.find((recordItem) => recordItem.draftId === savedDraft?.id);

  if (!snapshot.ok || !savedRecord?.id) {
    return [];
  }

  return (snapshot.body.state?.distributionTargets || []).filter((target) => target.publishRecordId === savedRecord.id);
}

async function prepareLowConfidencePlanTask() {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const tasks = snapshot.body.state?.tasks || [];
  const task = tasks.find((item) => item.status === "planned") || tasks[0];

  if (!snapshot.ok || !task?.id) {
    throw new Error("No weekly plan task found for batch confirmation guard validation");
  }

  const patched = await requestJson(`${baseUrl}/api/content-tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confidence: 0.52,
      riskNote: "需要人工复核：证据不足，暂不建议批量确认。"
    })
  });

  if (!patched.ok) {
    throw new Error(patched.body.message || "Failed to prepare low-confidence task");
  }

  return patched.body.data?.task || task;
}

async function prepareConfirmedBriefTask() {
  const generatedPlan = await requestJson(`${baseUrl}/api/weekly-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days: 1, dailyCount: 1, channels: ["wechat"] })
  });
  const task = generatedPlan.body.tasks?.[0];

  if (!generatedPlan.ok || !task?.id) {
    throw new Error(generatedPlan.body.message || "Failed to prepare brief task plan");
  }

  const patched = await requestJson(`${baseUrl}/api/content-tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: task.title,
      sourceProblem: task.sourceProblem || "企业想确认 Dify 服务商是否具备长期交付能力。",
      primaryDistilledTerm: task.primaryDistilledTerm || "Dify 企业版服务商",
      officialLinkTarget: task.officialLinkTarget || "https://jotoai.com",
      riskNote: "暂无风险",
      confidence: 0.86
    })
  });

  if (!patched.ok) {
    throw new Error(patched.body.message || "Failed to prepare safe brief task");
  }

  const safeTask = patched.body.data?.task || task;
  const confirmed = await requestJson(`${baseUrl}/api/content-tasks/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskIds: [safeTask.id], mode: "single" })
  });

  if (!confirmed.ok || (confirmed.body.data?.confirmed || 0) < 1) {
    throw new Error(confirmed.body.message || "Failed to confirm brief task");
  }

  return safeTask;
}

async function prepareActivatedRulePackageForBrief() {
  await setCurrentRole("knowledge_manager");

  try {
    const stamp = Date.now();
    const knowledgeName = `JOTO Dify Rule ${stamp}`;
    const created = await requestJson(`${baseUrl}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: knowledgeName,
        type: "brand",
        trustLevel: "high",
        status: "enabled",
        sourceType: "manual",
        usageScope: "product expression, Dify service provider, content generation constraints",
        productExpressionSource: true,
        contentPreview: [
          `${knowledgeName} is a product expression source for JOTO and Dify enterprise service provider content.`,
          "It should constrain article wording around enterprise delivery, operations, official evidence, and long-term service boundaries.",
          "Do not write absolute promises, unsupported delivery claims, or channel copy that sounds like a hard advertisement."
        ].join("\n\n")
      })
    });
    const knowledgeBase = created.body.data?.knowledgeBase;

    if (!created.ok || !knowledgeBase?.id || !knowledgeBase.productExpressionRuleDraft?.version) {
      throw new Error(created.body.message || "Failed to create product expression knowledge base");
    }

    const activated = await requestJson(`${baseUrl}/api/knowledge-bases/${knowledgeBase.id}/product-expression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activate" })
    });
    const activeKnowledgeBase = activated.body.data?.knowledgeBase;
    const ruleDraft = activeKnowledgeBase?.productExpressionRuleDraft;

    if (!activated.ok || !activeKnowledgeBase?.id || ruleDraft?.status !== "active") {
      throw new Error(activated.body.message || "Failed to activate product expression rule package");
    }

    return { knowledgeBase: activeKnowledgeBase, ruleDraft };
  } finally {
    await setCurrentRole("workbench_operator");
  }
}

async function prepareConfirmedBriefTaskForRulePackage(rulePackageContext) {
  const task = await prepareConfirmedBriefTask();
  const patched = await requestJson(`${baseUrl}/api/content-tasks/${task.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      product: "joto_brand",
      title: `Rule package inheritance check ${rulePackageContext.knowledgeBase.name}`,
      sourceProblem: "Enterprise teams need a Dify service provider article constrained by the newest product expression rule package.",
      primaryDistilledTerm: "Dify enterprise service provider",
      targetKeywords: ["Dify", "Dify enterprise service provider", "JOTO", rulePackageContext.knowledgeBase.name],
      officialLinkTarget: "https://jotoai.com",
      evidenceNeed: "Use the activated product expression rule package and one official evidence chunk.",
      riskNote: "No blocking risk for browser smoke validation.",
      confidence: 0.9
    })
  });

  if (!patched.ok || !patched.body.data?.task?.id) {
    throw new Error(patched.body.message || "Failed to prepare rule package inheritance task");
  }

  return patched.body.data.task;
}

async function prepareDraftRiskReviewTask() {
  const task = await prepareConfirmedBriefTask();
  const generatedDraft = await requestJson(`${baseUrl}/api/content-tasks/${task.id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const draft = generatedDraft.body.data?.draft;

  if (!generatedDraft.ok || !draft?.id) {
    throw new Error(generatedDraft.body.message || "Failed to prepare draft risk task");
  }

  const riskContent = [
    `# ${task.title}`,
    "",
    "JOTO 是 Dify 企业版服务商中最强的长期交付伙伴，可以 100% 保证企业项目成功落地。",
    "",
    "这段内容故意用于浏览器 smoke，验证草稿质检页能在正文内标红高风险片段并提供人工处理动作。"
  ].join("\n");

  const patchedDraft = await requestJson(`${baseUrl}/api/article-drafts/${draft.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: draft.title,
      summary: draft.summary,
      content: riskContent,
      editNote: "browser smoke prepares high-risk draft QA state"
    })
  });

  if (!patchedDraft.ok) {
    throw new Error(patchedDraft.body.message || "Failed to prepare high-risk draft");
  }

  return { task, draft: patchedDraft.body.data?.draft || draft };
}

const restrictedAiConfigRoleExpectations = [
  { testName: "ai_config_restricted_content_publisher", role: "content_publisher", roleLabel: "内容发布人员", actionLabel: "去今日发布" },
  { testName: "ai_config_restricted_content_growth", role: "content_growth", roleLabel: "内容增长 / GEO 人员", actionLabel: "去周度复盘" },
  { testName: "ai_config_restricted_knowledge_manager", role: "knowledge_manager", roleLabel: "知识库 / 产品表达维护", actionLabel: "去知识库" }
];

async function assertAiConfigRestrictedRole(page, expectation) {
  await setCurrentRole(expectation.role);
  await page.navigate(`/ai-config?role-smoke=${expectation.role}-${Date.now()}`);
  await waitFor(async () => {
    const text = await page.evaluate("document.body.innerText");

    return (
      text.includes("当前角色无权进入此页面") &&
      text.includes(`当前角色：${expectation.roleLabel}`) &&
      text.includes(expectation.actionLabel)
    );
  }, 30000);

  const bodyText = await page.evaluate("document.body.innerText");
  const requiredText = [
    "当前角色无权进入此页面",
    "为了避免普通业务流程看到内部治理配置和排查信息",
    `当前角色：${expectation.roleLabel}`,
    expectation.actionLabel,
    "切换角色"
  ];
  const forbiddenText = [
    "Provider",
    "Prompt 版本",
    "调用日志",
    "运行全部诊断",
    "复制 .env.local 模板",
    "管理模型、API、Prompt",
    "Prompt、模型日志、规则包",
    "效果摘要"
  ];
  const missing = requiredText.filter((item) => !bodyText.includes(item));
  const leaked = forbiddenText.filter((item) => bodyText.includes(item));

  if (missing.length || leaked.length) {
    throw new Error(`missing=${missing.join(",") || "-"} leaked=${leaked.join(",") || "-"}`);
  }

  record(expectation.testName, true, expectation.actionLabel);
}

async function clickButtonByText(page, text) {
  try {
    await waitFor(() => page.evaluate(`
      (() => {
        const needle = ${JSON.stringify(text)};
        const compactNeedle = needle.replace(/\\s+/g, "");
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((button) => {
          const label = (button.textContent || button.innerText || "").replace(/\\s+/g, " ").trim();
          return !button.disabled && (label.includes(needle) || label.replace(/\\s+/g, "").includes(compactNeedle));
        });
      })()
    `), 10000);
  } catch (error) {
    const state = await page.evaluate(`
      (() => ({
        bodyText: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 600),
        buttons: Array.from(document.querySelectorAll("button")).map((button) => ({
          text: (button.textContent || button.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120),
          disabled: Boolean(button.disabled),
          className: String(button.className || "").slice(0, 120)
        })).filter((button) => button.text)
      }))()
    `);
    throw new Error(`Unable to find button with text ${text}: ${JSON.stringify(state)}`);
  }

  const clicked = await page.evaluate(`
    (() => {
      const needle = ${JSON.stringify(text)};
      const compactNeedle = needle.replace(/\\s+/g, "");
      const buttons = Array.from(document.querySelectorAll("button"));
      const button = buttons.find((item) => {
        const label = (item.textContent || item.innerText || "").replace(/\\s+/g, " ").trim();
        return !item.disabled && (label.includes(needle) || label.replace(/\\s+/g, "").includes(compactNeedle));
      });
      if (!button) return false;
      button.scrollIntoView({ block: "center", inline: "center" });
      button.click();
      window.scrollTo(0, window.scrollY);
      return true;
    })()
  `);

  if (!clicked) {
    throw new Error(`Unable to click button with text: ${text}`);
  }

  await delay(250);
}

async function clickElementByText(page, selector, text) {
  try {
    await waitFor(() => page.evaluate(`
      (() => {
        const needle = ${JSON.stringify(text)};
        const compactNeedle = needle.replace(/\\s+/g, "");
        const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        return elements.some((element) => {
          const label = (element.textContent || element.innerText || "").replace(/\\s+/g, " ").trim();
          return label.includes(needle) || label.replace(/\\s+/g, "").includes(compactNeedle);
        });
      })()
    `), 15000);
  } catch (error) {
    const state = await page.evaluate(`
      (() => {
        const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((element) => ({
          text: (element.textContent || element.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120),
          className: String(element.className || "").slice(0, 120),
          role: element.getAttribute("role")
        })).filter((item) => item.text);
        return {
          bodyText: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 600),
          elements
        };
      })()
    `);
    throw new Error(`Unable to find text element ${selector} / ${text}: ${JSON.stringify(state)}`);
  }

  const clicked = await page.evaluate(`
    (() => {
      const needle = ${JSON.stringify(text)};
      const compactNeedle = needle.replace(/\\s+/g, "");
      const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const element = elements.find((item) => {
        const label = (item.textContent || item.innerText || "").replace(/\\s+/g, " ").trim();
        return label.includes(needle) || label.replace(/\\s+/g, "").includes(compactNeedle);
      });
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return true;
    })()
  `);

  if (!clicked) {
    throw new Error(`Unable to click element with text: ${selector} / ${text}`);
  }

  await delay(250);
}

async function clickElementBySelector(page, selector) {
  await waitFor(() => page.evaluate(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return Boolean(element && !element.disabled && element.offsetParent !== null);
    })()
  `), 10000);

  const clicked = await page.evaluate(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return true;
    })()
  `);

  if (!clicked) {
    throw new Error(`Unable to click element: ${selector}`);
  }

  await delay(250);
}

async function getElementText(page, selector) {
  return page.evaluate(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element ? (element.textContent || element.innerText || "").replace(/\\s+/g, " ").trim() : "";
    })()
  `);
}

async function fillFirstAvailableInput(page, selectors, value) {
  const attempted = [];

  for (const selector of selectors) {
    attempted.push(selector);

    if (!(await page.exists(selector))) {
      continue;
    }

    try {
      await page.fill(selector, value);
      return selector;
    } catch {
      // Try the next selector shape. Ant Design may attach data attributes to
      // either the wrapper or the native input depending on the component.
    }
  }

  const state = await page.evaluate(`
    (() => ({
      bodyText: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 600),
      inputs: Array.from(document.querySelectorAll("input")).map((input) => ({
        testId: input.getAttribute("data-testid"),
        value: input.value,
        placeholder: input.getAttribute("placeholder"),
        className: String(input.className || "").slice(0, 120)
      }))
    }))()
  `);

  throw new Error(`Unable to fill input from selectors ${attempted.join(", ")}: ${JSON.stringify(state)}`);
}

async function ensureElementVisibleAcrossPagination(page, selector, maxPages = 8) {
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const isVisible = await page.evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && !element.disabled && element.offsetParent !== null);
      })()
    `);

    if (isVisible) {
      return true;
    }

    const moved = await clickVisiblePaginationNext(page);

    if (!moved) {
      return false;
    }
  }

  return false;
}

async function ensureTextVisibleAcrossPagination(page, text, maxPages = 8) {
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (await page.containsText(text)) {
      return true;
    }

    const moved = await clickVisiblePaginationNext(page);

    if (!moved) {
      return false;
    }
  }

  return page.containsText(text);
}

async function clickVisiblePaginationNext(page) {
  const clicked = await page.evaluate(`
    (() => {
      const candidates = Array.from(document.querySelectorAll("li.ant-pagination-next:not(.ant-pagination-disabled) button, li.ant-pagination-next:not(.ant-pagination-disabled)"));
      const target = candidates.find((element) => {
        const control = element.tagName === "BUTTON" ? element : element.querySelector("button");
        return element.offsetParent !== null && (!control || !control.disabled);
      });

      if (!target) return false;

      const control = target.tagName === "BUTTON" ? target : target.querySelector("button") || target;
      control.scrollIntoView({ block: "center", inline: "center" });
      control.click();
      return true;
    })()
  `);

  if (clicked) {
    await delay(700);
  }

  return clicked;
}

async function resolveKnowledgeBaseWithRuleDraftId() {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const knowledgeBases = snapshot.body.state?.knowledgeBases || snapshot.body.knowledgeBases || [];
  const knowledgeBase = knowledgeBases.find((item) => item.productExpressionRuleDraft) || knowledgeBases[0];

  if (!snapshot.ok || !knowledgeBase?.id) {
    throw new Error("No knowledge base id found for responsive drawer validation");
  }

  return knowledgeBase.id;
}

async function ensureVisibleDistilledTerm() {
  let snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  let term = (snapshot.body.state?.distilledTerms || snapshot.body.distilledTerms || []).find((item) => item.status !== "disabled");

  if (snapshot.ok && term?.id) {
    return term;
  }

  const response = await requestJson(`${baseUrl}/api/distilled-terms/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "企业想接入 Dify，但不知道如何判断 Dify 企业版服务商是否具备长期交付能力" })
  });

  if (!response.ok || response.body.data?.discarded) {
    throw new Error(response.body.message || "Failed to prepare visible distilled term");
  }

  snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  term = (snapshot.body.state?.distilledTerms || snapshot.body.distilledTerms || []).find((item) => item.status !== "disabled");

  if (!term?.id) {
    throw new Error("No visible distilled term found after preparation");
  }

  return term;
}

async function resolveDistilledTermByQuestion(question) {
  const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
  const terms = snapshot.body.state?.distilledTerms || snapshot.body.distilledTerms || [];

  if (!snapshot.ok) {
    throw new Error(snapshot.body.message || "Failed to resolve distilled terms");
  }

  return terms.find((item) => item.status !== "disabled" && item.sourceQuestion === question);
}

async function generateWeeklyPlanFromDistilledTerm(term) {
  const generatedPlan = await requestJson(`${baseUrl}/api/weekly-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      days: 1,
      dailyCount: 1,
      channels: ["wechat"],
      products: [term.product || "joto_brand"]
    })
  });
  const task = generatedPlan.body.tasks?.find((item) => item.primaryDistilledTerm === term.term) || generatedPlan.body.tasks?.[0];

  if (!generatedPlan.ok || !task?.id || task.primaryDistilledTerm !== term.term) {
    throw new Error(
      generatedPlan.body.message ||
        `Weekly plan did not use distilled term ${term.term}: ${task?.primaryDistilledTerm || "-"}`
    );
  }

  return { generatedPlan, task };
}

const businessPageForbiddenText = [
  "Provider",
  "AI Provider",
  "Prompt",
  "Prompt 版本",
  "模型 trace",
  "trace",
  "rawAnswer",
  "rawCitationUrl",
  "citationRank",
  "embeddingSimilarity",
  "ruleHit",
  "issueCode",
  "confidence",
  "置信度",
  "知识库 Chunk",
  "证据 Chunk"
];

const businessPageBoundaryExpectations = [
  { testName: "business_boundary_content_publisher_weekly_plan", role: "content_publisher", roleLabel: "内容发布人员", pathName: "/weekly-plan", expectedText: "周计划生成预览" },
  { testName: "business_boundary_content_publisher_today", role: "content_publisher", roleLabel: "内容发布人员", pathName: "/today", expectedText: "今日发布" },
  { testName: "business_boundary_content_publisher_publish", role: "content_publisher", roleLabel: "内容发布人员", pathName: "/publish", expectedText: "数据回传" },
  { testName: "business_boundary_content_growth_weekly_report", role: "content_growth", roleLabel: "内容增长 / GEO 人员", pathName: "/weekly-report", expectedText: "周度复盘" },
  { testName: "business_boundary_content_growth_distilled_terms", role: "content_growth", roleLabel: "内容增长 / GEO 人员", pathName: "/distilled-terms", expectedText: "蒸馏词池" },
  { testName: "business_boundary_knowledge_manager_knowledge", role: "knowledge_manager", roleLabel: "知识库 / 产品表达维护", pathName: "/knowledge", expectedText: "知识库" },
  { testName: "business_boundary_knowledge_manager_weekly_report", role: "knowledge_manager", roleLabel: "知识库 / 产品表达维护", pathName: "/weekly-report", expectedText: "周度复盘" }
];

async function assertBusinessPageBoundary(page, expectation) {
  await setCurrentRole(expectation.role);
  const separator = expectation.pathName.includes("?") ? "&" : "?";
  await page.navigate(`${expectation.pathName}${separator}boundary-smoke=${expectation.role}-${Date.now()}`);
  await waitFor(async () => {
    const text = await page.evaluate("document.body.innerText");
    return text.includes(expectation.expectedText) && text.includes(expectation.roleLabel);
  }, 30000);

  if (expectation.beforeAssert) {
    await expectation.beforeAssert(page);
  }

  const bodyText = await page.evaluate("document.body.innerText");
  const leaked = businessPageForbiddenText.filter((item) => bodyText.includes(item));

  if (leaked.length) {
    throw new Error(`business page leaked internal wording: ${leaked.join(", ")}`);
  }

  record(expectation.testName, true, `${expectation.roleLabel} ${expectation.pathName}`);
}

function buildResponsiveAuditExpression() {
  return `
    (() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const allowedOverflowSelector = ".ant-table-content, .ant-table-body, .ant-table-container, [data-responsive-allow-overflow]";
      const textSelectors = [
        "button",
        ".ant-tag",
        ".ant-alert-message",
        ".ant-alert-description",
        ".ant-card-head-title",
        ".page-title",
        ".page-subtitle",
        ".report-kpi-title",
        ".report-kpi-value",
        ".report-kpi-trend",
        ".draft-qa-status-card"
      ].join(",");

      function isVisible(element) {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function summarize(element, rect) {
        const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 90);

        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || "").slice(0, 120),
          text,
          rect: {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      }

      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const bodyOverflow = Math.max(0, documentWidth - window.innerWidth);
      const offscreen = [];
      const overflowSources = [];

      for (const element of Array.from(document.querySelectorAll("body *"))) {
        if (!isVisible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight + 2400) continue;

        if ((rect.right > window.innerWidth + 6 || rect.width > window.innerWidth + 6 || element.scrollWidth - element.clientWidth > 8) && overflowSources.length < 8) {
          overflowSources.push({
            ...summarize(element, rect),
            allowedOverflow: Boolean(element.closest(allowedOverflowSelector)),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          });
        }

        if (element.closest(allowedOverflowSelector)) continue;

        if (rect.left < -6 || rect.right > window.innerWidth + 6 || rect.width > window.innerWidth + 6) {
          offscreen.push(summarize(element, rect));
        }

        if (offscreen.length >= 8) break;
      }

      const textOverflow = [];

      for (const element of Array.from(document.querySelectorAll(textSelectors))) {
        if (!isVisible(element)) continue;
        if (element.closest(allowedOverflowSelector)) continue;
        const rect = element.getBoundingClientRect();
        const scrollOverflow = element.scrollWidth - element.clientWidth;

        if (element.clientWidth > 0 && scrollOverflow > 4) {
          textOverflow.push({
            ...summarize(element, rect),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          });
        }

        if (textOverflow.length >= 8) break;
      }

      return {
        ok: bodyOverflow <= 8 && offscreen.length === 0 && textOverflow.length === 0,
        viewport,
        bodyOverflow,
        offscreen,
        overflowSources,
        textOverflow
      };
    })()
  `;
}

async function assertResponsiveLayout(page, { name, pathName, expectedText, beforeAudit }) {
  await page.setViewport(390, 844, false);

  try {
    await page.navigate(pathName);
    await waitFor(() => page.containsText(expectedText), 30000);

    if (beforeAudit) {
      await beforeAudit(page);
    }

    await delay(700);

    const audit = await page.evaluate(buildResponsiveAuditExpression());

    if (!audit.ok) {
      throw new Error(JSON.stringify(audit));
    }

    record(name, true, `${pathName} mobile ${audit.viewport.width}x${audit.viewport.height}`);
  } finally {
    await page.setViewport(1440, 1000, false);
  }
}

async function assertDesktopLayout(page, { name, pathName, expectedText, beforeAudit }) {
  await page.setViewport(1440, 1000, false);
  await page.navigate(pathName);
  await waitFor(() => page.containsText(expectedText), 30000);

  if (beforeAudit) {
    await beforeAudit(page);
  }

  await delay(700);
  const audit = await page.evaluate(buildResponsiveAuditExpression());

  if (!audit.ok) {
    throw new Error(JSON.stringify(audit));
  }

  record(name, true, `${pathName} desktop ${audit.viewport.width}x${audit.viewport.height}`);
}

async function main() {
  let browser;
  let page;
  let previousRole;
  const runFullScope = smokeScope === "full";
  const shouldRunRoles = runFullScope || smokeScope === "roles";
  const shouldRunContent = runFullScope || smokeScope === "content";
  const shouldRunResponsive = runFullScope || smokeScope === "responsive";
  const shouldRunPublish = runFullScope || smokeScope === "publish";
  const shouldRunV5 = smokeScope === "v5";
  const shouldRunOperatorPage = shouldRunContent || shouldRunResponsive || shouldRunPublish || shouldRunV5;

  try {
    previousRole = await runStep("prepare_workspace_role_read", () => resolveCurrentRole());
    browser = await runStep("start_browser", () => startBrowser());

    if (shouldRunRoles) {
      for (const expectation of restrictedAiConfigRoleExpectations) {
        let restrictedPage;

        await runStep(expectation.testName, async () => {
          restrictedPage = await openPage();

          try {
            await assertAiConfigRestrictedRole(restrictedPage, expectation);
          } finally {
            restrictedPage.close();
          }
        });
      }

      await runStep("business_page_boundary_dom", async () => {
        const boundaryPage = await openPage();

        try {
          const knowledgeBaseId = await resolveKnowledgeBaseWithRuleDraftId();
          const dynamicBusinessPageBoundaryExpectations = [
            ...businessPageBoundaryExpectations,
            {
              testName: "business_boundary_content_growth_weekly_report_publish_drawer",
              role: "content_growth",
              roleLabel: "内容增长 / GEO 人员",
              pathName: "/weekly-report",
              expectedText: "周度复盘",
              beforeAssert: async (currentPage) => {
                await clickButtonByText(currentPage, "查看发布明细");
                await waitFor(() => currentPage.containsText("发布与渠道明细"), 15000);
              }
            },
            {
              testName: "business_boundary_knowledge_manager_knowledge_detail",
              role: "knowledge_manager",
              roleLabel: "知识库 / 产品表达维护",
              pathName: `/knowledge/${knowledgeBaseId}`,
              expectedText: "知识库详情"
            },
            {
              testName: "business_boundary_knowledge_manager_rule_version_drawer",
              role: "knowledge_manager",
              roleLabel: "知识库 / 产品表达维护",
              pathName: `/knowledge/${knowledgeBaseId}`,
              expectedText: "知识库详情",
              beforeAssert: async (currentPage) => {
                await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "产品表达规则包");
                await waitFor(() => currentPage.containsText("规则包草稿"), 15000);
                await clickButtonByText(currentPage, "查看版本差异");
                await waitFor(() => currentPage.containsText("产品表达规则包版本差异"), 15000);
              }
            }
          ];

          for (const expectation of dynamicBusinessPageBoundaryExpectations) {
            await assertBusinessPageBoundary(boundaryPage, expectation);
          }
        } finally {
          boundaryPage.close();
        }
      });
    }

    if (shouldRunOperatorPage) {
      page = await runStep("open_cdp_page", () => openPage());
      await runStep("prepare_workspace_role_operator", () => setCurrentRole("workbench_operator"));
      if (!shouldRunV5) {
        await runStep("prepare_weekly_publish_matrix", () => prepareValidPublishMatrix());
      }
    }

    if (shouldRunV5) {
      await runStep("v5_dashboard_scoped_replacement_desktop", () => assertDesktopLayout(page, {
        name: "v5_dashboard_scoped_replacement_desktop",
        pathName: "/",
        expectedText: "本月内容进展"
      }));
      await runStep("v5_dashboard_scoped_replacement_mobile", () => assertResponsiveLayout(page, {
        name: "v5_dashboard_scoped_replacement_mobile",
        pathName: "/",
        expectedText: "待办与增长反馈"
      }));
      await runStep("v5_monthly_matrix_desktop", () => assertDesktopLayout(page, {
        name: "v5_monthly_matrix_desktop",
        pathName: "/monthly-matrix",
        expectedText: "内容策略包"
      }));
      await runStep("v5_article_type_library_desktop", () => assertDesktopLayout(page, {
        name: "v5_article_type_library_desktop",
        pathName: "/monthly-matrix/content-types",
        expectedText: "系统起始模板不是固定枚举"
      }));
      await runStep("v5_monthly_strategy_desktop", () => assertDesktopLayout(page, {
        name: "v5_monthly_strategy_desktop",
        pathName: "/monthly-matrix/strategy",
        expectedText: "月度目标与目标问题"
      }));
      await runStep("v5_batch_generation_desktop", () => assertDesktopLayout(page, {
        name: "v5_batch_generation_desktop",
        pathName: "/monthly-matrix/batch-generation",
        expectedText: "内容",
        beforeAudit: async (currentPage) => {
          await waitFor(() => currentPage.containsText("已批准策略还没有可执行内容任务"), 30000);
        }
      }));
      await runStep("v5_batch_generation_mobile", () => assertResponsiveLayout(page, {
        name: "v5_batch_generation_mobile",
        pathName: "/monthly-matrix/batch-generation",
        expectedText: "内容"
      }));
      await runStep("v5_schedule_calendar_desktop_hover", () => assertDesktopLayout(page, {
        name: "v5_schedule_calendar_desktop_hover",
        pathName: "/monthly-matrix/batch-generation#schedule",
        expectedText: "人工排程日历",
        beforeAudit: async (currentPage) => {
          await currentPage.hover(".v5-calendar-day[data-testid]");
          await waitFor(() => currentPage.exists(".v5-calendar-popover-empty, .v5-calendar-popover-content"), 15000);
        }
      }));
      await runStep("v5_schedule_calendar_mobile_click", () => assertResponsiveLayout(page, {
        name: "v5_schedule_calendar_mobile_click",
        pathName: "/monthly-matrix/batch-generation#schedule",
        expectedText: "人工排程日历",
        beforeAudit: async (currentPage) => {
          await currentPage.click(".v5-calendar-day[data-testid]");
          await waitFor(() => currentPage.exists(".v5-calendar-popover-empty, .v5-calendar-popover-content"), 15000);
        }
      }));
      await runStep("v5_daily_execution_mobile", () => assertResponsiveLayout(page, {
        name: "v5_daily_execution_mobile",
        pathName: "/daily-execution",
        expectedText: "发布执行视图"
      }));
      await runStep("v5_monthly_review_mobile", () => assertResponsiveLayout(page, {
        name: "v5_monthly_review_mobile",
        pathName: "/monthly-review",
        expectedText: "下月候选调整"
      }));
      await runStep("v5_questions_keywords_desktop", () => assertDesktopLayout(page, {
        name: "v5_questions_keywords_desktop",
        pathName: "/questions-keywords",
        expectedText: "系统持续维护"
      }));
      await runStep("v5_questions_keywords_mobile", () => assertResponsiveLayout(page, {
        name: "v5_questions_keywords_mobile",
        pathName: "/questions-keywords",
        expectedText: "内容覆盖"
      }));
      await runStep("v5_knowledge_workspace_desktop", () => assertDesktopLayout(page, {
        name: "v5_knowledge_workspace_desktop",
        pathName: "/knowledge/kb-adp-service",
        expectedText: "系统理解"
      }));
      await runStep("v5_knowledge_workspace_mobile", () => assertResponsiveLayout(page, {
        name: "v5_knowledge_workspace_mobile",
        pathName: "/knowledge/kb-adp-service",
        expectedText: "待处理"
      }));
      await runStep("v5_configuration_desktop", () => assertDesktopLayout(page, {
        name: "v5_configuration_desktop",
        pathName: "/configuration",
        expectedText: "文章表达预设"
      }));
      await runStep("v5_configuration_mobile", () => assertResponsiveLayout(page, {
        name: "v5_configuration_mobile",
        pathName: "/configuration",
        expectedText: "前台测试连接"
      }));
      await runStep("v5_expression_profile_editor_desktop", () => assertDesktopLayout(page, {
        name: "v5_expression_profile_editor_desktop",
        pathName: "/configuration",
        expectedText: "文章表达预设",
        beforeAudit: async (currentPage) => {
          await currentPage.click('[data-node-key="expression_profiles"]');
          await clickButtonByText(currentPage, "新建预设");
          await waitFor(() => currentPage.containsText("未填写或无法映射的内容会遵循系统规则"), 15000);
          const presetValues = await currentPage.evaluate(`(() => ({
            targetAudience: document.querySelector('#targetAudience')?.value || '',
            writingFocus: document.querySelector('#writingFocus')?.value || '',
            minLength: document.querySelector('#minLength')?.value || '',
            maxLength: document.querySelector('#maxLength')?.value || '',
            cta: document.querySelector('#cta')?.value || '',
            forbiddenStyles: document.querySelector('#forbiddenStyles')?.value || '',
            otherInstructions: document.querySelector('#otherInstructions')?.value || '',
            modules: document.querySelectorAll('.foundation-module-row').length,
            radioGroups: document.querySelectorAll('.ant-radio-group').length,
            selects: document.querySelectorAll('.ant-select').length
          }))()`);
          if (presetValues.targetAudience || presetValues.writingFocus || presetValues.minLength || presetValues.maxLength
            || presetValues.cta || presetValues.forbiddenStyles || presetValues.otherInstructions || presetValues.modules !== 0
            || presetValues.radioGroups !== 0 || presetValues.selects !== 0) {
            throw new Error(`expected blank low-constraint preset form: ${JSON.stringify(presetValues)}`);
          }
        }
      }));
      await runStep("v5_expression_profile_editor_mobile", () => assertResponsiveLayout(page, {
        name: "v5_expression_profile_editor_mobile",
        pathName: "/configuration",
        expectedText: "文章表达预设",
        beforeAudit: async (currentPage) => {
          await currentPage.click('[data-node-key="expression_profiles"]');
          await clickButtonByText(currentPage, "新建预设");
          await waitFor(() => currentPage.containsText("未指定结构，将遵循系统规则"), 15000);
        }
      }));
    }

    if (shouldRunContent || shouldRunResponsive) {
      await runStep("navigate_weekly_plan", () => page.navigate("/weekly-plan"));
      await runStep("wait_workspace_role_loaded", () => waitFor(() => page.containsText("工作台运营 / 质量评估"), 20000));
      await runStep("click_weekly_plan_generate", () => page.click("[data-testid='weekly-plan-generate-button']"));
      await runStep("click_weekly_plan_confirm", () => page.click("[data-testid='weekly-plan-generate-confirm']"));
      const planState = await runStep("wait_weekly_plan_state", () => waitFor(async () => {
        const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
        return snapshot.ok && snapshot.body.state?.tasks?.length >= 1 ? snapshot : false;
      }, 15000));
      record("weekly_plan_popconfirm_generate", planState.ok && planState.body.state?.tasks?.length >= 1, `${planState.body.state?.tasks?.length || 0} tasks after confirmed click`);
    }

    if (shouldRunResponsive) {
      await runStep("responsive_weekly_plan_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_weekly_plan_mobile",
        pathName: "/weekly-plan",
        expectedText: "周计划生成预览"
      }));
      await runStep("responsive_weekly_plan_expanded_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_weekly_plan_expanded_mobile",
        pathName: "/weekly-plan",
        expectedText: "周计划生成预览",
        beforeAudit: async (currentPage) => {
          const expanded = await currentPage.evaluate(`
            (() => {
              const element = document.querySelector(".ant-table-row-expand-icon");
              if (!element) return false;
              element.scrollIntoView({ block: "center", inline: "center" });
              element.click();
              return true;
            })()
          `);
          if (!expanded) {
            throw new Error("Unable to expand weekly plan row on mobile");
          }
          await waitFor(() => currentPage.containsText("AI 生成理由"), 15000);
        }
      }));
    }

    if (shouldRunContent) {
      await runStep("prepare_weekly_plan_batch_review_guard_task", () => prepareLowConfidencePlanTask());
      await runStep("weekly_plan_batch_confirm_guard_modal", async () => {
        await page.navigate(`/weekly-plan?content-smoke=batch-guard-${Date.now()}`);
        await waitFor(() => page.containsText("周计划生成预览"), 20000);
        await waitFor(() => page.containsText("需复核 1 条"), 20000);
        await clickElementBySelector(page, "[data-testid='weekly-plan-batch-confirm-button']");
        await waitFor(() => page.containsText("批量确认前复核"), 15000);

        const bodyText = await page.evaluate("document.body.innerText");
        const requiredText = ["批量确认前复核", "可确认", "需复核", "未达到自动确认阈值"];
        const missing = requiredText.filter((item) => !bodyText.includes(item));

        if (missing.length) {
          throw new Error(`weekly plan batch guard missing text: ${missing.join(", ")}`);
        }

        record("weekly_plan_batch_confirm_guard_modal", true, "batch confirmation guard modal visible");
      });

      const briefTask = await runStep("prepare_today_brief_task", () => prepareConfirmedBriefTask());
      await runStep("today_brief_drawer_evidence_guard", async () => {
        await setCurrentRole("content_publisher");
        await page.navigate(`/today?content-smoke=brief-${briefTask.id}-${Date.now()}`);
        await waitFor(() => page.containsText("今日发布"), 20000);
        const briefButtonSelector = `[data-testid='today-brief-${briefTask.id}']`;
        await waitFor(() => page.exists(briefButtonSelector), 45000);
        const briefButtonVisible = await ensureElementVisibleAcrossPagination(page, briefButtonSelector, 40);

        if (!briefButtonVisible) {
          throw new Error(`today brief button not visible across pagination: ${briefButtonSelector}`);
        }

        await clickElementBySelector(page, briefButtonSelector);
        await waitFor(() => page.containsText("生成 Brief 与证据选择"), 15000);

        const bodyText = await page.evaluate("document.body.innerText");
        const requiredText = ["正文生成会锁定周计划字段", "任务 Brief", "产品表达规则包", "知识库证据", "人工补充证据"];
        const missing = requiredText.filter((item) => !bodyText.includes(item));

        if (missing.length) {
          throw new Error(`today brief drawer missing text: ${missing.join(", ")}`);
        }

        record("today_brief_drawer_evidence_guard", true, briefTask.id);
      });

      const rulePackageContext = await runStep("prepare_activated_rule_package_for_brief", () => prepareActivatedRulePackageForBrief());
      const ruleBriefTask = await runStep("prepare_rule_package_brief_task", () => prepareConfirmedBriefTaskForRulePackage(rulePackageContext));
      await runStep("knowledge_rule_package_today_brief_inheritance", async () => {
        await setCurrentRole("content_publisher");
        await page.navigate(`/today?content-smoke=rule-brief-${ruleBriefTask.id}-${Date.now()}`);
        await waitFor(() => page.containsText("今日发布"), 20000);
        const ruleBriefButtonSelector = `[data-testid='today-brief-${ruleBriefTask.id}']`;
        await waitFor(() => page.exists(ruleBriefButtonSelector), 45000);
        const ruleBriefButtonVisible = await ensureElementVisibleAcrossPagination(page, ruleBriefButtonSelector, 40);

        if (!ruleBriefButtonVisible) {
          throw new Error(`rule package brief button not visible across pagination: ${ruleBriefButtonSelector}`);
        }

        await clickElementBySelector(page, ruleBriefButtonSelector);
        await waitFor(() => page.exists(`[data-testid='today-brief-rule-package-${ruleBriefTask.id}']`), 15000);

        const sourceText = await getElementText(page, `[data-testid='today-brief-rule-source-${ruleBriefTask.id}']`);
        const versionText = await getElementText(page, `[data-testid='today-brief-rule-version-${ruleBriefTask.id}']`);
        const summaryText = await getElementText(page, `[data-testid='today-brief-rule-summary-${ruleBriefTask.id}']`);
        const missing = [];

        if (!sourceText.includes(rulePackageContext.knowledgeBase.name)) {
          missing.push(`source=${sourceText || "-"}`);
        }

        if (!versionText.includes(rulePackageContext.ruleDraft.version)) {
          missing.push(`version=${versionText || "-"}`);
        }

        if (!summaryText) {
          missing.push("summary=-");
        }

        if (missing.length) {
          throw new Error(`rule package brief inheritance mismatch: ${missing.join(", ")}`);
        }

        record(
          "knowledge_rule_package_today_brief_inheritance",
          true,
          `${rulePackageContext.knowledgeBase.name} ${rulePackageContext.ruleDraft.version}`
        );
      });

      await runStep("knowledge_rule_package_draft_generation_inheritance", async () => {
        const selectedChunkId = rulePackageContext.knowledgeBase.chunks?.[0]?.id;
        const generatedDraft = await requestJson(`${baseUrl}/api/content-tasks/${ruleBriefTask.id}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requireEvidence: true,
            evidenceSelection: {
              selectedChunkIds: selectedChunkId ? [selectedChunkId] : [],
              evidenceSummary: `${rulePackageContext.knowledgeBase.name} / product expression rule smoke evidence`
            }
          })
        });
        const draft = generatedDraft.body.data?.draft;
        const source = draft?.generationSource?.productExpressionRuleSource;
        const version = draft?.generationSource?.productExpressionRuleVersion;
        const selectedChunkIds = draft?.generationSource?.selectedChunkIds || [];

        if (
          !generatedDraft.ok ||
          !draft?.id ||
          source !== rulePackageContext.knowledgeBase.name ||
          version !== rulePackageContext.ruleDraft.version ||
          (selectedChunkId && !selectedChunkIds.includes(selectedChunkId))
        ) {
          throw new Error(
            generatedDraft.body.message ||
              `draft generation did not inherit rule package: source=${source || "-"} version=${version || "-"} chunks=${selectedChunkIds.join(",") || "-"}`
          );
        }

        await setCurrentRole("workbench_operator");
        const governance = await requestJson(`${baseUrl}/api/ai-governance`);
        const callLogs = governance.body.callLogs || governance.body.data?.callLogs || [];
        const draftSources = governance.body.draftSources || governance.body.data?.draftSources || [];
        const hasGovernanceRuleSummary = [...callLogs, ...draftSources].some(
          (item) =>
            item.productExpressionRuleSource === rulePackageContext.knowledgeBase.name &&
            item.productExpressionRuleVersion === rulePackageContext.ruleDraft.version
        );

        if (!governance.ok || !hasGovernanceRuleSummary) {
          throw new Error("AI governance summary did not inherit generated draft rule package");
        }

        record("knowledge_rule_package_draft_generation_inheritance", true, draft.id);
      });

      await runStep("distilled_term_search_question_plan_inheritance", async () => {
        const stamp = Date.now();
        const highQuestion = `企业想接入 Dify，但不知道如何判断 Dify 企业版服务商是否具备长期交付能力 ${stamp}`;
        const lowQuestion = `nonsensical frobnicate ${stamp}`;

        await setCurrentRole("content_growth");

        try {
          await page.navigate(`/distilled-terms?content-smoke=distilled-${stamp}`);
          await waitFor(() => page.containsText("蒸馏词池"), 20000);
          await page.fill("[data-testid='distilled-question-input']", highQuestion);
          await page.click("[data-testid='distilled-extract-button']");
          const pooledTerm = await waitFor(() => resolveDistilledTermByQuestion(highQuestion), 20000);
          await page.navigate(`/distilled-terms?content-smoke=distilled-pooled-${stamp}`);
          await waitFor(() => page.containsText("蒸馏词池"), 20000);
          await waitFor(async () => {
            const modeText = await getElementText(page, `[data-testid='distilled-term-generation-mode-${pooledTerm.id}']`);
            return modeText.includes("搜索问题生成");
          }, 20000);
          await waitFor(() => page.containsText(pooledTerm.term), 15000);
          await clickElementBySelector(page, `[data-testid='distilled-term-detail-${pooledTerm.id}']`);
          await waitFor(() => page.exists("[data-testid='distilled-term-detail-drawer']"), 15000);

          const termText = await getElementText(page, "[data-testid='distilled-term-detail-term']");
          const generationModeText = await getElementText(page, "[data-testid='distilled-term-detail-generation-mode']");
          const sourceQuestionText = await getElementText(page, "[data-testid='distilled-term-detail-source-question']");
          const autoPoolMissing = [];

          if (!termText.includes(pooledTerm.term)) autoPoolMissing.push(`term=${termText || "-"}`);
          if (!generationModeText.includes("搜索问题生成")) autoPoolMissing.push(`generationMode=${generationModeText || "-"}`);
          if (!sourceQuestionText.includes(highQuestion)) autoPoolMissing.push(`sourceQuestion=${sourceQuestionText || "-"}`);

          if (autoPoolMissing.length) {
            throw new Error(`distilled term UI auto pool mismatch: ${autoPoolMissing.join(", ")}`);
          }

          record("distilled_term_search_question_ui_auto_pool", true, pooledTerm.term);

          await clickElementBySelector(page, ".ant-drawer-close");
          await waitFor(() => page.evaluate("!document.querySelector(\"[data-testid='distilled-term-detail-drawer']\")"), 15000);

          await page.fill("[data-testid='distilled-question-input']", lowQuestion);
          await page.click("[data-testid='distilled-extract-button']");
          await waitFor(() => page.containsText("已直接丢弃"), 15000);

          const lowConfidenceTerm = await resolveDistilledTermByQuestion(lowQuestion);

          if (lowConfidenceTerm) {
            throw new Error(`low-confidence distilled term should be discarded but was visible: ${lowConfidenceTerm.term}`);
          }

          record("distilled_term_low_confidence_ui_discarded", true, lowQuestion);

          const { task } = await generateWeeklyPlanFromDistilledTerm(pooledTerm);
          await page.navigate(`/weekly-plan?content-smoke=distilled-plan-${stamp}`);
          await waitFor(() => page.containsText("周计划生成预览"), 20000);
          await waitFor(() => page.exists(`tr[data-row-key='${task.id}']`), 20000);
          await clickElementBySelector(page, `tr[data-row-key='${task.id}'] .ant-table-row-expand-icon`);
          await waitFor(() => page.containsText(pooledTerm.term), 15000);
          await waitFor(() => page.containsText("标题来源归因"), 15000);

          const bodyText = await page.evaluate("document.body.innerText");
          const requiredText = [pooledTerm.term, highQuestion, "蒸馏词池", "标题来源归因"];
          const missing = requiredText.filter((item) => !bodyText.includes(item));

          if (missing.length) {
            throw new Error(`distilled term weekly plan inheritance missing text: ${missing.join(", ")}`);
          }

          record("distilled_term_weekly_plan_inheritance", true, `${task.id} uses ${pooledTerm.term}`);
        } finally {
          await setCurrentRole("workbench_operator");
        }
      });

      const draftRiskPrepared = await runStep("prepare_draft_risk_review_task", () => prepareDraftRiskReviewTask());
      await runStep("draft_qa_risk_actions_dom", async () => {
        await page.navigate(`/drafts/${draftRiskPrepared.task.id}?content-smoke=risk-${Date.now()}`);
        await waitFor(() => page.containsText("正文 Markdown 编辑"), 20000);
        await waitFor(() => page.containsText("高风险！问题"), 15000);

        const bodyText = await page.evaluate("document.body.innerText");
        const compactBodyText = bodyText.replace(/\s+/g, "");
        const requiredText = ["高风险！问题", "删除", "AI改写", "保留"];
        const missing = requiredText.filter((item) => !bodyText.includes(item) && !compactBodyText.includes(item.replace(/\s+/g, "")));

        if (missing.length) {
          throw new Error(`draft QA risk actions missing text: ${missing.join(", ")}`);
        }

        await clickButtonByText(page, "保留");
        await waitFor(() => page.containsText("保留高风险片段"), 15000);
        record("draft_qa_risk_actions_dom", true, draftRiskPrepared.task.id);
      });

      const knowledgeName = `Browser Smoke ${Date.now()}`;
      await runStep("navigate_knowledge", () => page.navigate("/knowledge"));
      await runStep("click_knowledge_create", () => page.click("[data-testid='knowledge-create-button']"));
      await runStep("fill_knowledge_name", () => page.fill("[data-testid='knowledge-name-input']", knowledgeName));
      await runStep("fill_knowledge_scope", () => page.fill("[data-testid='knowledge-scope-input']", "browser smoke validation"));
      await runStep("click_knowledge_save", () => page.click("[data-testid='knowledge-save-button']"));
      await runStep("wait_knowledge_dom", () => waitFor(() => page.containsText(knowledgeName), 15000));
      record("knowledge_modal_create_dom_refresh", await page.containsText(knowledgeName), knowledgeName);

      await runStep("weekly_report_next_plan_source_inheritance", async () => {
        await page.navigate(`/weekly-report?content-smoke=next-plan-${Date.now()}`);
        await waitFor(() => page.containsText("周度复盘"), 20000);
        await clickElementBySelector(page, "[data-testid='weekly-report-generate-button']");
        await waitFor(() => page.exists("[data-testid='weekly-report-next-plan-button']"), 20000);
        await clickElementBySelector(page, "[data-testid='weekly-report-next-plan-button']");
        await waitFor(() => page.exists("[data-testid='weekly-report-next-plan-confirm']"), 15000);
        await clickElementBySelector(page, "[data-testid='weekly-report-next-plan-confirm']");

        const nextPlanState = await waitFor(async () => {
          const snapshot = await requestJson(`${baseUrl}/api/workbench-state`);
          const tasks = snapshot.body.state?.tasks || [];
          const hasWeeklyReportTaskSource = tasks.some((task) => task.titleSourceAttributions?.some((source) => source.key === "weekly_report"));
          return snapshot.ok && snapshot.body.state?.weeklyPlan?.status === "draft" && hasWeeklyReportTaskSource ? snapshot : false;
        }, 45000);

        await page.navigate(`/weekly-plan?content-smoke=next-plan-inheritance-${Date.now()}`);
        await waitFor(() => page.containsText("周计划生成预览"), 20000);
        await waitFor(() => page.containsText("周报建议"), 20000);
        await clickElementBySelector(page, ".ant-table-row-expand-icon");
        await waitFor(() => page.containsText("标题来源归因"), 15000);

        const bodyText = await page.evaluate("document.body.innerText");
        const requiredText = ["标题来源归因", "周报建议", "确认建议"];
        const missing = requiredText.filter((item) => !bodyText.includes(item));

        if (missing.length) {
          throw new Error(`weekly report next plan source inheritance missing text: ${missing.join(", ")}`);
        }

        record("weekly_report_next_plan_source_inheritance", true, `${nextPlanState.body.state?.tasks?.length || 0} tasks`);
      });
    }

    let prepared;
    let publishedUrl;

    if (shouldRunResponsive || shouldRunPublish) {
      prepared = await runStep("prepare_today_publish_task", () => preparePublishRecord());
      publishedUrl = `https://example.com/browser-smoke/${prepared.task.id}`;
    }

    if (shouldRunResponsive) {
      await runStep("responsive_draft_qa_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_draft_qa_mobile",
        pathName: `/drafts/${prepared.task.id}`,
        expectedText: "正文 Markdown 编辑"
      }));
      await runStep("responsive_weekly_report_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_weekly_report_mobile",
        pathName: "/weekly-report",
        expectedText: "内容增长视角"
      }));
      await runStep("responsive_weekly_report_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_weekly_report_drawer_mobile",
        pathName: "/weekly-report",
        expectedText: "内容增长视角",
        beforeAudit: async (currentPage) => {
          await clickButtonByText(currentPage, "查看发布明细");
          await waitFor(() => currentPage.containsText("发布与渠道明细"), 15000);
        }
      }));
      const knowledgeBaseId = await runStep("resolve_knowledge_base_rule_id", () => resolveKnowledgeBaseWithRuleDraftId());
      await runStep("responsive_knowledge_rule_version_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_knowledge_rule_version_drawer_mobile",
        pathName: `/knowledge/${knowledgeBaseId}`,
        expectedText: "知识库详情",
        beforeAudit: async (currentPage) => {
          await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "产品表达规则包");
          await waitFor(() => currentPage.containsText("规则包草稿"), 15000);
          await clickButtonByText(currentPage, "查看版本差异");
          await waitFor(() => currentPage.containsText("产品表达规则包版本差异"), 15000);
        }
      }));
      await runStep("responsive_knowledge_source_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_knowledge_source_drawer_mobile",
        pathName: `/knowledge/${knowledgeBaseId}`,
        expectedText: "知识库详情",
        beforeAudit: async (currentPage) => {
          await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "产品表达规则包");
          await waitFor(() => currentPage.containsText("版本边界与风险提示"), 15000);
          await clickButtonByText(currentPage, "查看来源片段");
          await waitFor(() => currentPage.containsText("产品表达规则包来源片段"), 15000);
        }
      }));
      await runStep("prepare_distilled_term_for_drawer", () => ensureVisibleDistilledTerm());
      await runStep("responsive_distilled_term_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_distilled_term_drawer_mobile",
        pathName: "/distilled-terms",
        expectedText: "蒸馏词池",
        beforeAudit: async (currentPage) => {
          await waitFor(() => currentPage.containsText("已入池蒸馏词"), 15000);
          await clickElementBySelector(currentPage, ".ant-table-tbody button");
          await waitFor(() => currentPage.containsText("蒸馏词详情"), 15000);
        }
      }));
      await runStep("responsive_ai_config_call_log_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_ai_config_call_log_drawer_mobile",
        pathName: "/ai-config",
        expectedText: "AI 配置",
        beforeAudit: async (currentPage) => {
          await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "调用日志");
          await waitFor(() => currentPage.containsText("当前日志"), 15000);
          await clickButtonByText(currentPage, "查看");
          await waitFor(() => currentPage.containsText("调用日志详情"), 15000);
        }
      }));
      await runStep("responsive_ai_config_prompt_version_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_ai_config_prompt_version_drawer_mobile",
        pathName: "/ai-config",
        expectedText: "AI 配置",
        beforeAudit: async (currentPage) => {
          await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "Prompt 版本");
          await waitFor(() => currentPage.containsText("查看版本说明"), 15000);
          await clickButtonByText(currentPage, "查看版本说明");
          await waitFor(() => currentPage.containsText("Prompt 版本说明"), 15000);
        }
      }));
      await runStep("responsive_ai_config_quality_drawer_mobile", () => assertResponsiveLayout(page, {
        name: "responsive_ai_config_quality_drawer_mobile",
        pathName: "/ai-config",
        expectedText: "AI 配置",
        beforeAudit: async (currentPage) => {
          await clickElementByText(currentPage, ".ant-tabs-tab, .ant-tabs-tab-btn, [role='tab']", "效果摘要");
          await waitFor(() => currentPage.containsText("质量关联摘要"), 15000);
          await clickButtonByText(currentPage, "查看");
          await waitFor(() => currentPage.containsText("质检反馈详情"), 15000);
        }
      }));
    }

    if (shouldRunPublish) {
      await runStep("navigate_today", async () => {
        await page.navigate(`/today?publish-smoke=confirm-${prepared.task.id}-${Date.now()}`);
        await waitFor(() => page.containsText("今日发布"), 20000);
      });
      const writePlatformDraftButtonSelector = `[data-testid='today-write-platform-drafts-${prepared.task.id}']`;
      const writePlatformDraftButtonVisible = await runStep("find_today_write_platform_drafts_button", () =>
        ensureElementVisibleAcrossPagination(page, writePlatformDraftButtonSelector, 12)
      );

      if (!writePlatformDraftButtonVisible) {
        throw new Error(`Unable to find platform draft write button for task ${prepared.task.id}`);
      }

      await runStep("click_today_write_platform_drafts", () => clickElementBySelector(page, writePlatformDraftButtonSelector));
      await runStep("click_today_write_platform_drafts_confirm", () =>
        page.click(`[data-testid='today-write-platform-drafts-confirm-${prepared.task.id}']`)
      );
      await runStep("today_platform_draft_created_before_publish_confirm", () => waitFor(async () => {
        const currentRecord = await resolvePublishRecordForTask(prepared.task.id);
        const targets = await resolveDistributionTargetsForTask(prepared.task.id);
        return currentRecord?.publishStatus === "queued" && targets.some((target) => target.status === "draft_created")
          ? { currentRecord, targets }
          : false;
      }, 45000));

      const confirmPublishedButtonSelector = `[data-testid='today-confirm-published-${prepared.task.id}']`;
      const confirmPublishedButtonVisible = await runStep("find_today_confirm_published_button", () =>
        ensureElementVisibleAcrossPagination(page, confirmPublishedButtonSelector, 12)
      );

      if (!confirmPublishedButtonVisible) {
        throw new Error(`Unable to find publish confirmation button for task ${prepared.task.id}`);
      }

      await runStep("click_today_confirm_published", () => clickElementBySelector(page, confirmPublishedButtonSelector));
      await runStep("click_today_confirm_published_confirm", () => page.click(`[data-testid='today-confirm-published-confirm-${prepared.task.id}']`));
      await runStep("wait_today_published_state", () => waitFor(async () => {
        const currentRecord = await resolvePublishRecordForTask(prepared.task.id);
        return currentRecord?.publishStatus === "published" ? currentRecord : false;
      }, 45000));
      await runStep("reload_today_for_url_entry", async () => {
        await page.navigate(`/today?publish-smoke=url-${prepared.task.id}-${Date.now()}`);
        await waitFor(() => page.containsText("今日发布"), 20000);
        await waitFor(() => page.containsText(prepared.task.title), 20000);
      });

      const fillUrlButtonSelector = `[data-testid='today-fill-url-${prepared.task.id}']`;
      const fillUrlButtonVisible = await runStep("find_today_fill_url_button", () => ensureElementVisibleAcrossPagination(page, fillUrlButtonSelector, 12));

      if (!fillUrlButtonVisible) {
        throw new Error(`Unable to find URL fill button for task ${prepared.task.id}`);
      }

      await runStep("click_today_fill_url", () => clickElementBySelector(page, fillUrlButtonSelector));
      await runStep("wait_today_url_modal", () => waitFor(() => page.exists("[data-testid='today-url-input']"), 15000));
      await runStep("fill_today_url", () => page.fill("[data-testid='today-url-input']", publishedUrl));
      await runStep("click_today_url_save", () => clickElementBySelector(page, "[data-testid='today-url-save-button']"));
      await runStep("wait_today_url_saved", () => waitFor(async () => {
        const savedRecord = await resolvePublishRecordForTask(prepared.task.id);
        return savedRecord?.publishedUrl === publishedUrl ? savedRecord : false;
      }, 45000));
      const savedRecord = await resolvePublishRecordForTask(prepared.task.id);
      if (!savedRecord?.id) {
        throw new Error(`Unable to resolve publish record after URL fill for task ${prepared.task.id}`);
      }
      record("today_publish_url_modal_fill_dom_refresh", savedRecord?.publishedUrl === publishedUrl, publishedUrl);

      await runStep("publish_data_return_manual_metrics_dom_refresh", async () => {
        await page.navigate(`/publish?publish-smoke=metrics-${prepared.task.id}-${Date.now()}`);
        await waitFor(() => page.containsText("数据回传"), 20000);
        await waitFor(() => page.containsText(savedRecord.title), 20000);

        const metricsButtonSelector = `[data-testid='publish-metrics-${savedRecord.id}']`;
        const buttonVisible = await ensureElementVisibleAcrossPagination(page, metricsButtonSelector, 12);

        if (!buttonVisible) {
          throw new Error(`Unable to find manual metrics button for publish record ${savedRecord.id}`);
        }

        await clickElementBySelector(page, metricsButtonSelector);
        await waitFor(() => page.containsText("手动补录渠道指标"), 15000);
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-impressions'] input", "[data-testid='publish-metrics-impressions']"], "1000");
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-views'] input", "[data-testid='publish-metrics-views']"], "222");
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-likes'] input", "[data-testid='publish-metrics-likes']"], "11");
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-favorites'] input", "[data-testid='publish-metrics-favorites']"], "7");
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-comments'] input", "[data-testid='publish-metrics-comments']"], "3");
        await fillFirstAvailableInput(page, ["[data-testid='publish-metrics-shares'] input", "[data-testid='publish-metrics-shares']"], "2");
        await clickElementBySelector(page, "[data-testid='publish-metrics-save-button']");
        await waitFor(async () => {
          const currentRecord = await resolvePublishRecordForTask(prepared.task.id);
          return currentRecord?.channelMetrics?.views === 222 && currentRecord?.channelMetrics?.likes === 11 ? currentRecord : false;
        }, 45000);

        const currentRecord = await resolvePublishRecordForTask(prepared.task.id);
        record("publish_data_return_manual_metrics_dom_refresh", currentRecord?.channelMetrics?.views === 222, currentRecord?.id);
      });

      await runStep("weekly_report_publish_drawer_metrics_inheritance", async () => {
        const currentRecord = await resolvePublishRecordForTask(prepared.task.id);
        await page.navigate(`/weekly-report?publish-smoke=report-${prepared.task.id}-${Date.now()}`);
        await waitFor(() => page.containsText("周度复盘"), 20000);
        await clickButtonByText(page, "查看发布明细");
        await waitFor(() => page.containsText("发布与渠道明细"), 15000);
        await waitFor(() => page.containsText(currentRecord.title), 20000);

        const recordVisible = await ensureTextVisibleAcrossPagination(page, currentRecord.title, 12);

        if (!recordVisible) {
          throw new Error(`Unable to find publish record in weekly report drawer: ${currentRecord.title}`);
        }

        const bodyText = await page.evaluate("document.body.innerText");
        const compactBodyText = bodyText.replace(/\s+/g, "");
        const requiredText = ["阅读222", "互动23"];
        const missing = requiredText.filter((item) => !compactBodyText.includes(item));

        if (missing.length) {
          throw new Error(`weekly report drawer missing inherited metrics: ${missing.join(", ")}`);
        }

        record("weekly_report_publish_drawer_metrics_inheritance", true, currentRecord.id);
      });
    }
  } catch (error) {
    record("smoke_browser_runtime", false, error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await setCurrentRole(previousRole);
    } catch (error) {
      record("restore_workspace_role", false, error instanceof Error ? error.message : String(error));
    }

  }

  await printJson({
    script: "smoke-browser",
    scope: smokeScope,
    baseUrl,
    status: failures.length ? "failed" : "success",
    passed: results.filter((item) => item.ok).length,
    failed: failures.length,
    results
  });

  if (failures.length) {
    process.exitCode = 1;
  }

  page?.close();
  browser?.kill();
}

main();
