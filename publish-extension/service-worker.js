import { runtimeConfig } from "./runtime-config.js";
import { executeInMainWorld, platformStartUrl } from "./page-executor.js";

const POLL_ALARM = "joto-publish-poll";
const workerId = runtimeConfig.workerId || `extension-${crypto.randomUUID()}`;

async function bridgeFetch(path, init = {}) {
  const response = await fetch(`${runtimeConfig.bridgeUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Bridge request failed (${response.status}).`);
  return response.json();
}

async function findOrOpenTab(platform) {
  const startUrl = platformStartUrl(platform);
  const host = new URL(startUrl).hostname;
  const tabs = await chrome.tabs.query({ url: [`https://${host}/*`] });
  const tab = tabs.find((candidate) => candidate.id);
  if (tab) return tab;
  return chrome.tabs.create({ url: startUrl, active: false });
}

async function waitForTab(tabId) {
  for (let index = 0; index < 60; index += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Platform tab did not become ready.");
}

async function runJob(job) {
  const tab = await findOrOpenTab(job.platform);
  await waitForTab(tab.id);
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: executeInMainWorld,
    args: [{ ...job.payload, platform: job.platform }]
  });
  return execution?.result || {
    ok: false,
    status: "pending_verify",
    failureCode: "publish_action_unconfirmed",
    failureReason: "The page executor returned no result."
  };
}

async function poll() {
  await bridgeFetch("/extension/publish/heartbeat", {
    method: "POST",
    body: JSON.stringify({ workerId, platforms: ["juejin"] })
  });
  const job = await bridgeFetch(`/extension/publish/tasks/next?workerId=${encodeURIComponent(workerId)}`);
  if (!job?.id) return;
  let result;
  try {
    result = await runJob(job);
  } catch (error) {
    result = {
      ok: false,
      status: "pending_verify",
      publishStatus: "failed",
      failureCode: "publish_action_unconfirmed",
      failureReason: error instanceof Error ? error.message : "Extension execution failed."
    };
  }
  await bridgeFetch(`/extension/publish/tasks/${job.id}/result`, {
    method: "POST",
    body: JSON.stringify({ workerId, result })
  });
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.1 }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) poll().catch(() => {});
});
poll().catch(() => {});
