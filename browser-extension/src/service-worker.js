const RUNNER_URL = "http://127.0.0.1:17321";
const PLATFORM_CONFIG = {
  doubao: { label: "豆包", version: "doubao-dom@1.0.0", urls: ["https://www.doubao.com/*"], newConversationUrl: "https://www.doubao.com/chat/" },
  deepseek: { label: "DeepSeek", version: "deepseek-dom@1.0.0", urls: ["https://chat.deepseek.com/*"], newConversationUrl: "https://chat.deepseek.com/" },
  chatgpt: { label: "ChatGPT", version: "chatgpt-dom@1.0.0", urls: ["https://chatgpt.com/*"], newConversationUrl: "https://chatgpt.com/" },
  qwen: { label: "千问", version: "qwen-dom@1.0.0", urls: ["https://tongyi.aliyun.com/qianwen/*", "https://chat.qwen.ai/*"], newConversationUrl: "https://chat.qwen.ai/" }
};
let pollInProgress = false;

async function runnerFetch(path, options = {}) {
  const response = await fetch(`${RUNNER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || `Runner request failed: ${response.status}`);
  return body;
}

async function platformTabs(platform) {
  return chrome.tabs.query({ url: PLATFORM_CONFIG[platform]?.urls || [] });
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("新会话页面加载超时。"));
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
  const tab = await chrome.tabs.create({ url: config.newConversationUrl, active: true });
  if (!tab.id) throw new Error(`无法为 ${config.label} 创建新会话标签页。`);
  await waitForTabComplete(tab.id);
  return tab;
}

async function sendCaptureTask(tabId, task) {
  const message = { type: "RUN_CAPTURE", task, startedAt: new Date().toISOString() };
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
  const adapters = await Promise.all(Object.entries(PLATFORM_CONFIG).map(async ([platform, config]) => {
    const tabs = await platformTabs(platform);
    return { platform, version: config.version, status: tabs.length ? "ready" : "needs_login", message: tabs.length ? `已找到 ${config.label} 任务页面。` : `请打开并登录 ${config.label}。` };
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
  const code = ["needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"].includes(error.code) ? error.code : "capture_failed";
  const recovery = code === "needs_login"
    ? `在 ${PLATFORM_CONFIG[task.platform]?.label || task.platform} 页面重新登录后，从任务列表重试。`
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
  let task;
  try {
    await heartbeat().catch(() => undefined);
    const response = await runnerFetch("/tasks/next", { method: "POST", body: "{}" });
    if (!response.task) return;
    task = response.task;
    const tabs = await platformTabs(task.platform);
    if (!tabs.length) {
      await runnerFetch(`/tasks/${encodeURIComponent(task.id)}/status`, { method: "POST", body: JSON.stringify({ task, status: "waiting_for_browser", note: `没有找到已登录的 ${PLATFORM_CONFIG[task.platform]?.label || task.platform} 标签页。` }) });
      return;
    }
    const tab = await createConversationTab(task.platform);
    await sendCaptureTask(tab.id, task);
  } catch (error) {
    if (task) {
      await postFailure(task, { code: "adapter_mismatch", stage: "environment_checking", message: error.message || "浏览器伴侣无法创建新会话页面。" }, PLATFORM_CONFIG[task.platform]?.version || "unknown");
    }
  } finally {
    pollInProgress = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("capture-poll", { periodInMinutes: 1 });
  pollTask().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => pollTask().catch(() => undefined));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "capture-poll") pollTask().catch(() => undefined);
});
chrome.action.onClicked.addListener(() => pollTask().catch(() => undefined));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
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
