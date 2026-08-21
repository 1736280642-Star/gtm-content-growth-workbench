const RUNNER_URL = "http://127.0.0.1:17321";
const PLATFORM_CONFIG = {
  doubao: { label: "豆包", version: "doubao-dom@1.0.1", urls: ["https://www.doubao.com/*"], newConversationUrl: "https://www.doubao.com/chat/" },
  deepseek: { label: "DeepSeek", version: "deepseek-dom@1.0.1", urls: ["https://chat.deepseek.com/*"], newConversationUrl: "https://chat.deepseek.com/" },
  chatgpt: { label: "ChatGPT", version: "chatgpt-dom@1.0.0", urls: ["https://chatgpt.com/*"], newConversationUrl: "https://chatgpt.com/" },
  qwen: { label: "千问", version: "qwen-dom@1.0.2", urls: ["https://tongyi.aliyun.com/qianwen/*", "https://chat.qwen.ai/*", "https://www.qianwen.com/*", "https://qianwen.com/*"], newConversationUrl: "https://www.qianwen.com/" }
};
let pollInProgress = false;
let pollStartedAt = 0;

async function runnerFetch(path, options = {}) {
  const response = await fetch(`${RUNNER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || `Runner request failed: ${response.status}`);
  return body;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      try {
        resolve(await chrome.tabs.get(tabId));
      } catch {
        reject(new Error("新会话标签页已关闭，无法继续采集。"));
      }
    }, timeoutMs);
    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function createConversationTab(platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config?.newConversationUrl) throw new Error(`不支持的平台：${platform}`);
  const captureWindow = await chrome.windows.create({
    url: config.newConversationUrl,
    type: "popup",
    focused: false,
    width: 1180,
    height: 860
  });
  const tab = captureWindow?.tabs?.[0] || (captureWindow?.id ? (await chrome.tabs.query({ windowId: captureWindow.id }))[0] : undefined);
  if (!tab?.id) throw new Error(`无法为 ${config.label} 创建后台采集窗口。`);
  await waitForTabComplete(tab.id);
  return { ...tab, windowId: captureWindow.id };
}

async function closeCaptureWindow(tab) {
  try {
    if (tab.windowId) await chrome.windows.remove(tab.windowId);
    else if (tab.id) await chrome.tabs.remove(tab.id);
  } catch {
    // 用户可能已经关闭窗口；任务结果不受影响。
  }
}

async function createBindingTab(platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config?.newConversationUrl) throw new Error("不支持的平台：" + platform);
  const tab = await chrome.tabs.create({ url: config.newConversationUrl, active: true });
  if (!tab.id) throw new Error("无法打开 " + config.label + " 登录页。");
  await waitForTabComplete(tab.id);
  return tab;
}

async function bindAccountConnection(input) {
  const tab = await createBindingTab(input.platform);
  const health = await sendCaptureTaskMessage(tab.id, { type: "CHECK_CONNECTION", platform: input.platform });
  if (!health?.ok) {
    throw Object.assign(new Error(health?.message || "请在打开的页面完成登录后再次点击绑定。"), { code: health?.code || "needs_login" });
  }
  return runnerFetch("/extension/connections", {
    method: "POST",
    body: JSON.stringify({
      platform: input.platform,
      accountAlias: input.accountAlias,
      browserProfileSlot: input.browserProfileSlot || "default",
      isolationPolicy: input.isolationPolicy
    })
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Object.assign(new Error(message), { code: "timed_out", stage: "capturing" })), timeoutMs);
    promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function sendCaptureTask(tabId, task) {
  const message = { type: "RUN_CAPTURE", task, startedAt: new Date().toISOString() };
  try {
    return await withTimeout(chrome.tabs.sendMessage(tabId, message), 270000, `${task.platform} 采集页面超过 270 秒未返回。`);
  } catch (error) {
    if (!String(error?.message || error).includes("Receiving end does not exist")) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/adapters/china-ai.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/capture.js"] });
    return withTimeout(chrome.tabs.sendMessage(tabId, message), 270000, `${task.platform} 采集页面超过 270 秒未返回。`);
  }
}

async function sendCaptureTaskMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!String(error?.message || error).includes("Receiving end does not exist")) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/adapters/china-ai.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/capture.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function heartbeat() {
  const adapters = Object.entries(PLATFORM_CONFIG).map(([platform, config]) => ({
    platform,
    version: config.version,
    status: "ready",
    message: `${config.label} 适配器可用；执行任务时自动打开页面并验证登录。`
  }));
  await runnerFetch("/extension/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      extensionVersion: chrome.runtime.getManifest().version,
      adapters
    })
  });
}

async function postFailure(task, error, adapterVersion) {
  const code = ["needs_login", "isolation_unverified", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"].includes(error.code) ? error.code : "capture_failed";
  const recovery = code === "needs_login"
    ? `在 ${PLATFORM_CONFIG[task.platform]?.label || task.platform} 页面重新登录后，从任务列表重试。`
    : code === "isolation_unverified"
      ? "使用专用中立测试 Profile，或按平台要求关闭记忆和自定义指令后重试。"
    : code === "adapter_mismatch"
      ? "停止任务并更新平台适配器；可使用人工调试定位新页面结构。"
      : code === "timed_out"
        ? "确认网络和页面响应后重新执行一次采集。"
        : "保留当前数据后重新执行；如页面要求验证码，请人工接管。";
  return runnerFetch(`/tasks/${encodeURIComponent(task.id)}/status`, {
    method: "POST",
    body: JSON.stringify({
      task,
      status: code,
      note: error.message,
      adapterVersion,
      failure: {
        status: code,
        stage: error.stage || task.status,
        reason: error.message,
        retainedData: ["任务参数", "采集条件", "状态时间线"],
        resumable: code === "needs_login" || code === "interrupted",
        recoveryAction: recovery,
        occurredAt: new Date().toISOString()
      }
    })
  });
}

async function pollTask() {
  if (pollInProgress) return;
  pollInProgress = true;
  pollStartedAt = Date.now();
  let task;
  let tab;
  try {
    await heartbeat().catch(() => undefined);
    const response = await runnerFetch("/tasks/next", { method: "POST", body: "{}" });
    if (!response.task) return;
    task = response.task;
    tab = await createConversationTab(task.platform);
    const result = await sendCaptureTask(tab.id, task);
    if (!result?.ok) return;
  } catch (error) {
    if (task) {
      await postFailure(task, { code: error.code || "adapter_mismatch", stage: error.stage || "environment_checking", message: error.message || "浏览器伴侣无法创建新会话页面。" }, PLATFORM_CONFIG[task.platform]?.version || "unknown");
    }
  } finally {
    if (tab) await closeCaptureWindow(tab);
    pollInProgress = false;
    pollStartedAt = 0;
  }
}

function recoverStalePoll() {
  if (!pollInProgress || !pollStartedAt || Date.now() - pollStartedAt <= 300000) return false;
  pollInProgress = false;
  pollStartedAt = 0;
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("capture-poll", { periodInMinutes: 1 });
  pollTask().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => pollTask().catch(() => undefined));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "capture-poll") {
    recoverStalePoll();
    (pollInProgress ? heartbeat() : pollTask()).catch(() => undefined);
  }
});
chrome.action.onClicked.addListener(() => {
  recoverStalePoll();
  (pollInProgress ? heartbeat() : pollTask()).catch(() => undefined);
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== "JOTO_CAPTURE_POLL") return false;
  const allowed = sender.url && (
    sender.url.startsWith("http://127.0.0.1:3027/")
    || sender.url.startsWith("http://localhost:3027/")
    || /^https:\/\/([a-z0-9-]+\.)*jotoai\.com\//i.test(sender.url)
  );
  if (!allowed) {
    sendResponse({ ok: false, error: "来源页面不在工作台白名单。" });
    return false;
  }
  recoverStalePoll();
  sendResponse({ ok: true, accepted: true });
  (pollInProgress ? heartbeat() : pollTask()).catch(() => undefined);
  return false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "PAIR_DEVICE") {
      const result = await runnerFetch("/extension/pair", { method: "POST", body: JSON.stringify({ pairingCode: message.pairingCode }) });
      sendResponse(result);
      return;
    }
    if (message.type === "BIND_ACCOUNT") {
      const result = await bindAccountConnection(message);
      sendResponse(result);
      return;
    }
    if (message.type === "POLL_NOW") {
      recoverStalePoll();
      await (pollInProgress ? heartbeat() : pollTask());
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "CAPTURE_SCREENSHOT") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" });
      sendResponse({ dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
      return;
    }
    if (message.type === "TASK_STATUS") {
      await runnerFetch(`/tasks/${encodeURIComponent(message.task.id)}/status`, { method: "POST", body: JSON.stringify(message) });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "SUBMIT_CAPTURE_RESULT") {
      await runnerFetch(`/tasks/${encodeURIComponent(message.task.id)}/result`, { method: "POST", body: JSON.stringify(message) });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "TASK_FAILURE") {
      await postFailure(message.task, message.error, message.adapterVersion);
      sendResponse({ ok: true });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
