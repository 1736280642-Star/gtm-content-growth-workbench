const RUNNER_URL = "http://127.0.0.1:17321";
const ADAPTER_VERSION = "chatgpt-dom@1.0.0";

async function runnerFetch(path, options = {}) {
  const response = await fetch(`${RUNNER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || `Runner request failed: ${response.status}`);
  return body;
}

async function chatGptTabs() {
  return chrome.tabs.query({ url: "https://chatgpt.com/*" });
}

async function heartbeat() {
  const tabs = await chatGptTabs();
  await runnerFetch("/extension/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      extensionVersion: chrome.runtime.getManifest().version,
      adapters: [{ platform: "chatgpt", version: ADAPTER_VERSION, status: tabs.length ? "ready" : "needs_login", message: tabs.length ? "已找到 ChatGPT 任务页面。" : "请打开并登录 ChatGPT。" }]
    })
  });
}

async function postFailure(task, error, adapterVersion) {
  const code = ["needs_login", "adapter_mismatch", "interrupted", "timed_out", "capture_failed"].includes(error.code) ? error.code : "capture_failed";
  const recovery = code === "needs_login"
    ? "在 ChatGPT 页面重新登录后，从任务列表重试。"
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
  await heartbeat().catch(() => undefined);
  const response = await runnerFetch("/tasks/next");
  if (!response.task) return;
  const task = response.task;
  const tabs = await chatGptTabs();
  const tab = tabs.find((item) => item.active) || tabs[0];
  if (!tab?.id) {
    await runnerFetch(`/tasks/${encodeURIComponent(task.id)}/status`, { method: "POST", body: JSON.stringify({ task, status: "waiting_for_browser", note: "没有找到已登录的 ChatGPT 标签页。" }) });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "RUN_CAPTURE", task, startedAt: new Date().toISOString() });
  } catch (error) {
    await postFailure(task, { code: "adapter_mismatch", stage: "environment_checking", message: error.message || "浏览器伴侣无法连接任务页面。" }, ADAPTER_VERSION);
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
