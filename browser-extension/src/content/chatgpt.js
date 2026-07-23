chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_CAPTURE") return false;
  const adapter = globalThis.JotoCaptureAdapters?.chatgpt;
  (async () => {
    const health = adapter.assertSupportedPage();
    if (!health.ok) throw Object.assign(new Error(health.message), { code: health.code, stage: "environment_checking" });
    await chrome.runtime.sendMessage({ type: "TASK_STATUS", task: message.task, status: "submitting_prompt", note: "已定位输入框，正在提交问题。", adapterVersion: adapter.version });
    await adapter.submitQuestion(message.task.questionText);
    await chrome.runtime.sendMessage({ type: "TASK_STATUS", task: { ...message.task, version: message.task.version + 1 }, status: "streaming", note: "问题已提交，正在监听流式回答。", adapterVersion: adapter.version });
    const { answer, signals } = await adapter.observeCompletion();
    await chrome.runtime.sendMessage({ type: "TASK_STATUS", task: { ...message.task, version: message.task.version + 2 }, status: "stabilizing", note: "停止信号已出现，回答文本进入稳定窗口。", adapterVersion: adapter.version });
    await chrome.runtime.sendMessage({ type: "TASK_STATUS", task: { ...message.task, version: message.task.version + 3 }, status: "capturing", note: "回答已稳定，正在生成脱敏工件。", adapterVersion: adapter.version });
    const screenshot = await adapter.withPrivacyMask(() => chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }));
    const manifest = {
      taskId: message.task.id,
      captureSessionId: message.task.captureSessionId,
      adapterVersion: adapter.version,
      browserVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown",
      startedAt: message.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      answerHtmlSanitized: adapter.sanitizedHtml(answer),
      answerText: adapter.visibleText(answer),
      citations: adapter.extractCitations(answer),
      screenshot: { mimeType: "image/png", dataBase64: screenshot.dataBase64, redactionsApplied: ["account_identity", "conversation_history", "notifications"], viewport: { width: innerWidth, height: innerHeight } },
      completionSignals: signals,
      captureWarnings: []
    };
    await chrome.runtime.sendMessage({ type: "SUBMIT_CAPTURE_RESULT", task: { ...message.task, version: message.task.version + 4 }, manifest });
    sendResponse({ ok: true });
  })().catch(async (error) => {
    await chrome.runtime.sendMessage({ type: "TASK_FAILURE", task: message.task, error: { code: error.code || "capture_failed", stage: error.stage || "capturing", message: error.message || "捕获失败" }, adapterVersion: adapter?.version });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
