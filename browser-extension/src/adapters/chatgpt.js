(function registerChatGptAdapter() {
  const VERSION = "chatgpt-dom@1.0.0";
  const selectors = {
    composer: ["#prompt-textarea", "[data-testid='prompt-textarea']", "div[contenteditable='true']"],
    submit: ["[data-testid='send-button']", "button[aria-label*='Send']", "button[aria-label*='发送']"],
    stop: ["[data-testid='stop-button']", "button[aria-label*='Stop']", "button[aria-label*='停止']"],
    answer: ["[data-message-author-role='assistant']", "article[data-testid^='conversation-turn-']"],
    account: ["[data-testid*='profile']", "[aria-label*='account' i]", "img[alt*='User' i]"],
    unrelated: ["nav", "aside", "[data-testid*='history']", "[class*='sidebar']"]
  };

  function first(selectorList) {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function all(selectorList) {
    return selectorList.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  }

  function latestAnswer() {
    const answers = all(selectors.answer);
    return answers.at(-1) || null;
  }

  function visibleText(node) {
    return (node && node.innerText ? node.innerText : "").replace(/\s+/g, " ").trim();
  }

  function assertSupportedPage() {
    if (location.hostname !== "chatgpt.com") return { ok: false, code: "adapter_mismatch", message: "当前标签页不是 ChatGPT。" };
    if (!first(selectors.composer)) return { ok: false, code: "needs_login", message: "没有找到输入框，登录状态可能已失效。" };
    return { ok: true, version: VERSION };
  }

  async function submitQuestion(question) {
    const composer = first(selectors.composer);
    if (!composer) throw Object.assign(new Error("没有找到 ChatGPT 输入框。"), { code: "needs_login" });
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      composer.value = question;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      composer.textContent = question;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: question }));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const submit = first(selectors.submit);
    if (!submit) throw Object.assign(new Error("页面结构已变化，未找到提交按钮。"), { code: "adapter_mismatch" });
    submit.click();
  }

  async function observeCompletion({ firstTokenTimeoutMs = 30000, totalTimeoutMs = 180000, stableWindowMs = 2000 } = {}) {
    const startedAt = Date.now();
    let answerNodeDetected = false;
    let lastText = "";
    let lastChangeAt = Date.now();
    let completionMarkerDetected = false;
    while (Date.now() - startedAt < totalTimeoutMs) {
      const answer = latestAnswer();
      const text = visibleText(answer);
      if (text) answerNodeDetected = true;
      if (!answerNodeDetected && Date.now() - startedAt > firstTokenTimeoutMs) {
        throw Object.assign(new Error("等待回答首字超时。"), { code: "timed_out", stage: "streaming" });
      }
      if (text !== lastText) {
        lastText = text;
        lastChangeAt = Date.now();
      }
      const stopControlDisappeared = !first(selectors.stop);
      completionMarkerDetected = Boolean(answer && answer.querySelector("[data-testid*='copy'], button[aria-label*='Copy'], button[aria-label*='复制']"));
      if (answerNodeDetected && text && Date.now() - lastChangeAt >= stableWindowMs && (stopControlDisappeared || completionMarkerDetected)) {
        return { answer, signals: { answerNodeDetected, stopControlDisappeared, completionMarkerDetected, stableWindowMs: Date.now() - lastChangeAt, firstTokenWithinTimeout: true, totalTimeoutExceeded: false } };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Object.assign(new Error("采集超过总任务超时。"), { code: "timed_out", stage: "stabilizing" });
  }

  function extractCitations(answer) {
    const seen = new Set();
    return Array.from(answer.querySelectorAll("a[href]"))
      .flatMap((anchor, index) => {
        const href = anchor.href;
        if (!/^https?:\/\//i.test(href) || seen.has(href)) return [];
        seen.add(href);
        return [{ label: anchor.textContent.trim() || `[${index + 1}]`, url: href, title: anchor.getAttribute("title") || anchor.textContent.trim(), visibleSnippet: anchor.closest("p, li")?.textContent?.trim() || "", position: index + 1, capturedAt: new Date().toISOString(), verificationStatus: "unverified", sourceType: "unknown" }];
      });
  }

  function sanitizedHtml(answer) {
    const clone = answer.cloneNode(true);
    clone.querySelectorAll("input, textarea, form, button, script, style, [contenteditable='true']").forEach((node) => node.remove());
    clone.querySelectorAll("*").forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        if (/^(data-|aria-)|style|class|id/i.test(attribute.name)) node.removeAttribute(attribute.name);
      });
    });
    return clone.innerHTML;
  }

  async function withPrivacyMask(capture) {
    const nodes = [...all(selectors.account), ...all(selectors.unrelated)];
    const previous = nodes.map((node) => node.getAttribute("style"));
    nodes.forEach((node) => node.setAttribute("style", `${node.getAttribute("style") || ""};filter:blur(18px)!important;visibility:hidden!important`));
    try { return await capture(); }
    finally { nodes.forEach((node, index) => previous[index] === null ? node.removeAttribute("style") : node.setAttribute("style", previous[index])); }
  }

  globalThis.JotoCaptureAdapters = globalThis.JotoCaptureAdapters || {};
  globalThis.JotoCaptureAdapters.chatgpt = { version: VERSION, assertSupportedPage, submitQuestion, observeCompletion, extractCitations, sanitizedHtml, visibleText, withPrivacyMask };
})();
