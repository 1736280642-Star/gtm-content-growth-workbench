chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_CAPTURE") return false;
  const adapter = globalThis.JotoCaptureAdapters?.[message.task.platform];
  (async () => {
    if (!adapter) throw Object.assign(new Error(`没有加载 ${message.task.platform} 适配器。`), { code: "adapter_mismatch" });
    const health = await adapter.waitUntilReady();
    if (!health.ok) throw Object.assign(new Error(health.message), { code: health.code, stage: "environment_checking" });
    await chrome.runtime.sendMessage({ type: "TASK_STATUS", task: message.task, status: "submitting_prompt", note: "已定位输入框，正在提交问题。", adapterVersion: adapter.version });
    await adapter.submitQuestion(message.task.questionText);
    const { answer, signals } = await adapter.observeCompletion();
    const screenshot = await adapter.withPrivacyMask(() => chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }));
    const manifest = {
      taskId: message.task.id, captureSessionId: message.task.captureSessionId || message.task.id,
      adapterVersion: adapter.version, browserVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown",
      startedAt: message.startedAt || new Date().toISOString(), completedAt: new Date().toISOString(),
      answerHtmlSanitized: adapter.sanitizedHtml(answer), answerText: adapter.visibleText(answer),
      citations: adapter.extractCitations(answer), gaps: [], targetEntity: message.task.targetEntity,
      targetEntityMentioned: Boolean(message.task.targetEntity && adapter.visibleText(answer).includes(message.task.targetEntity)),
      screenshot: { mimeType: "image/png", dataBase64: screenshot.dataBase64, redactionsApplied: ["account_identity", "conversation_history", "notifications"], viewport: { width: innerWidth, height: innerHeight } },
      completionSignals: signals, captureWarnings: []
    };
    await chrome.runtime.sendMessage({ type: "SUBMIT_CAPTURE_RESULT", task: message.task, manifest });
    sendResponse({ ok: true });
  })().catch(async (error) => {
    await chrome.runtime.sendMessage({ type: "TASK_FAILURE", task: message.task, error: { code: error.code || "capture_failed", stage: error.stage || "capturing", message: error.message || "捕获失败" }, adapterVersion: adapter?.version });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
