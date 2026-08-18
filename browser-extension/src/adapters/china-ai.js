(function registerChinaAiAdapters() {
  const shared = {
    composer: ["textarea", "div[contenteditable='true']"],
    submit: ["button[type='submit']", "button[aria-label*='发送']", "button[aria-label*='Send' i]"],
    stop: ["button[aria-label*='停止']", "button[aria-label*='Stop' i]"],
    copy: ["button[aria-label*='复制']", "button[aria-label*='Copy' i]"],
    account: ["[class*='avatar' i]", "[class*='profile' i]", "[aria-label*='账号']", "[aria-label*='account' i]"],
    unrelated: ["nav", "aside", "[class*='sidebar' i]", "[class*='history' i]"]
  };
  const configs = {
    doubao: {
      hosts: ["www.doubao.com", "doubao.com"], version: "doubao-dom@1.0.1",
      composer: ["textarea[data-testid*='chat']", "textarea", "div[contenteditable='true']"],
      answer: ["[data-testid*='message'] [class*='markdown' i]", "[class*='message' i] [class*='content' i]", "[class*='markdown' i]"]
    },
    deepseek: {
      hosts: ["chat.deepseek.com"], version: "deepseek-dom@1.0.1",
      composer: ["textarea", "div[contenteditable='true']"],
      answer: ["[data-role='assistant']", "[class*='ds-markdown']", "[class*='markdown' i]"]
    },
    chatgpt: {
      hosts: ["chatgpt.com"], version: "chatgpt-dom@1.0.0",
      composer: ["#prompt-textarea", "textarea", "div[contenteditable='true']"],
      submit: ["button[data-testid='send-button']", "button[aria-label*='Send' i]", "button[type='submit']"],
      stop: ["button[data-testid='stop-button']", "button[aria-label*='Stop' i]"],
      copy: ["button[data-testid='copy-turn-action-button']", "button[aria-label*='Copy' i]"],
      answer: ["[data-message-author-role='assistant']", "article[data-testid^='conversation-turn-'] [class*='markdown' i]"]
    },
    qwen: {
      hosts: ["tongyi.aliyun.com", "chat.qwen.ai", "www.qianwen.com", "qianwen.com"], version: "qwen-dom@1.0.2",
      composer: ["textarea", "div[contenteditable='true']"],
      answer: ["[data-role='assistant']", "[class*='qwen-markdown']", "[class*='markdown' i]"]
    }
  };

  const first = (selectors) => selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  const all = (selectors) => selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  const visibleText = (node) => (node?.innerText || "").replace(/\s+/g, " ").trim();

  function buildAdapter(platform, config) {
    const selectors = { ...shared, ...config };
    const latestAnswer = () => all(selectors.answer).filter((node) => visibleText(node)).at(-1) || null;
    function assertSupportedPage() {
      if (!config.hosts.includes(location.hostname)) return { ok: false, code: "adapter_mismatch", message: `当前标签页不是 ${platform} 官方前台。` };
      if (!first(selectors.composer)) return { ok: false, code: "needs_login", message: `没有找到 ${platform} 输入框，登录状态可能已失效或页面结构已变化。` };
      if (latestAnswer()) return { ok: false, code: "adapter_mismatch", message: `${platform} 新标签页恢复了已有会话，已停止采集以避免上下文污染。` };
      return { ok: true, version: config.version };
    }
    async function waitUntilReady(timeoutMs = 20000) {
      const startedAt = Date.now();
      let health = assertSupportedPage();
      while (!health.ok && health.code === "needs_login" && Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        health = assertSupportedPage();
      }
      return health;
    }
    async function submitQuestion(question) {
      const composer = first(selectors.composer);
      if (!composer) throw Object.assign(new Error(`没有找到 ${platform} 输入框。`), { code: "needs_login" });
      composer.focus();
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
        setter ? setter.call(composer, question) : composer.value = question;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: question }));
        composer.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const inserted = document.execCommand("insertText", false, question);
        if (!inserted) composer.textContent = question;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: question }));
      }
      let submit = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        submit = first(selectors.submit);
        if (submit && !submit.disabled && submit.getAttribute("aria-disabled") !== "true") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (submit && !submit.disabled && submit.getAttribute("aria-disabled") !== "true") {
        submit.click();
        return;
      }
      if (["doubao", "deepseek", "qwen"].includes(platform)) {
        for (const type of ["keydown", "keypress", "keyup"]) {
          composer.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const remainingText = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
          ? composer.value.trim()
          : (composer.textContent || "").trim();
        if (!remainingText || latestAnswer()) return;
      }
      throw Object.assign(new Error(`${platform} 发送按钮未启用，页面可能未接受输入。`), { code: "adapter_mismatch", stage: "submitting_prompt" });
    }
    async function observeCompletion({ firstTokenTimeoutMs = 45000, totalTimeoutMs = 240000, stableWindowMs = 2500 } = {}) {
      const startedAt = Date.now();
      let lastText = "";
      let lastChangeAt = startedAt;
      while (Date.now() - startedAt < totalTimeoutMs) {
        const answer = latestAnswer();
        const text = visibleText(answer);
        if (!text && Date.now() - startedAt > firstTokenTimeoutMs) throw Object.assign(new Error("等待回答首字超时。"), { code: "timed_out", stage: "streaming" });
        if (text !== lastText) { lastText = text; lastChangeAt = Date.now(); }
        const stopControlDisappeared = !first(selectors.stop);
        const completionMarkerDetected = Boolean(answer && selectors.copy.some((selector) => answer.querySelector(selector)));
        if (answer && text && Date.now() - lastChangeAt >= stableWindowMs && (stopControlDisappeared || completionMarkerDetected)) {
          return { answer, signals: { answerNodeDetected: true, stopControlDisappeared, completionMarkerDetected, stableWindowMs: Date.now() - lastChangeAt, firstTokenWithinTimeout: true, totalTimeoutExceeded: false } };
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw Object.assign(new Error("采集超过总任务超时。"), { code: "timed_out", stage: "stabilizing" });
    }
    function extractCitations(answer) {
      const seen = new Set();
      return Array.from(answer.querySelectorAll("a[href]")).flatMap((anchor, index) => {
        const url = anchor.href;
        if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
        seen.add(url);
        return [{ label: anchor.textContent.trim() || `引用 ${index + 1}`, url, title: anchor.title || anchor.textContent.trim(), visibleSnippet: anchor.closest("p, li")?.textContent?.trim() || "", position: index + 1, capturedAt: new Date().toISOString(), verificationStatus: "unverified", sourceType: "unknown" }];
      });
    }
    function sanitizedHtml(answer) {
      const clone = answer.cloneNode(true);
      clone.querySelectorAll("input, textarea, form, button, script, style, [contenteditable='true']").forEach((node) => node.remove());
      clone.querySelectorAll("*").forEach((node) => Array.from(node.attributes).forEach((attribute) => {
        if (/^(data-|aria-)|style|class|id/i.test(attribute.name)) node.removeAttribute(attribute.name);
      }));
      return clone.innerHTML;
    }
    async function withPrivacyMask(capture) {
      const nodes = [...all(selectors.account), ...all(selectors.unrelated)];
      const previous = nodes.map((node) => node.getAttribute("style"));
      nodes.forEach((node) => node.setAttribute("style", `${node.getAttribute("style") || ""};filter:blur(18px)!important;visibility:hidden!important`));
      try { return await capture(); }
      finally { nodes.forEach((node, index) => previous[index] === null ? node.removeAttribute("style") : node.setAttribute("style", previous[index])); }
    }
    return { platform, version: config.version, assertSupportedPage, waitUntilReady, submitQuestion, observeCompletion, extractCitations, sanitizedHtml, visibleText, withPrivacyMask };
  }

  globalThis.JotoCaptureAdapters = Object.fromEntries(Object.entries(configs).map(([platform, config]) => [platform, buildAdapter(platform, config)]));
})();
