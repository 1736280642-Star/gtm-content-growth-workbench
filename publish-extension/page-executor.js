const PLATFORM_URLS = {
  juejin: "https://juejin.cn/editor/drafts/new?v=2",
  csdn: "https://editor.csdn.net/md/",
  zhihu: "https://zhuanlan.zhihu.com/write"
};

export function platformStartUrl(platform) {
  return PLATFORM_URLS[platform];
}

export async function executeInMainWorld(payload) {
  const isRiskChallenge = (text) =>
    /验证码|滑块|安全验证|账号异常|访问过于频繁|captcha|verify you are human/i.test(String(text || ""));
  const observations = [];
  const nativeFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  const record = (kind, url, status, body) => {
    const safeBody = String(body || "").slice(0, 4_000);
    if (/cookie|authorization|token|csrf/i.test(safeBody)) return;
    observations.push({ kind, url: String(url || "").slice(0, 500), status, body: safeBody });
  };

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const clone = response.clone();
    clone.text().then((body) => record("fetch", response.url, response.status, body)).catch(() => {});
    return response;
  };
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__jotoUrl = url;
    return originalXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", () => record("xhr", this.__jotoUrl, this.status, this.responseText));
    return originalXhrSend.apply(this, args);
  };

  try {
    const bodyText = document.body?.innerText || "";
    if (isRiskChallenge(bodyText)) {
      return {
        ok: false,
        status: "risk_blocked",
        failureCode: "risk_blocked",
        failureReason: "Platform security challenge detected.",
        nextAction: "Keep the job stopped; do not retry publish while the account is challenged.",
        observations
      };
    }

    if (payload.operation === "auth_probe") {
      const loginDetected =
        /登录|注册|sign in|log in/i.test(bodyText.slice(0, 8_000)) ||
        /passport|login|signin/i.test(window.location.href);
      return {
        ok: !loginDetected,
        authenticated: !loginDetected,
        status: loginDetected ? "auth_required" : "ready",
        failureCode: loginDetected ? "auth_required" : undefined,
        failureReason: loginDetected ? "Platform login is required." : undefined,
        observations
      };
    }

    if (payload.platform === "juejin") {
      const base = { uuid: "0", aid: "2608", spider: "0" };
      const draftResponse = await nativeFetch("https://api.juejin.cn/content_api/v1/article_draft/create", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...base,
          title: payload.title,
          brief_content: payload.summary || payload.markdown.slice(0, 100),
          mark_content: payload.markdown,
          category_id: payload.categoryId || "",
          tag_ids: payload.tagIds || [],
          edit_type: 10,
          html_content: "deprecated"
        })
      });
      const draftBody = await draftResponse.json().catch(() => ({}));
      record("fetch", draftResponse.url, draftResponse.status, JSON.stringify(draftBody));
      const articleId = String(draftBody?.data?.id || draftBody?.data?.article_id || "");
      if (!draftResponse.ok || !articleId) {
        return {
          ok: false,
          status: "failed",
          failureCode: isRiskChallenge(JSON.stringify(draftBody)) ? "risk_blocked" : "adapter_failed",
          failureReason: "Juejin draft creation was not accepted.",
          observations
        };
      }
      const publishResponse = await nativeFetch("https://api.juejin.cn/content_api/v1/article/publish", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, draft_id: articleId, sync_to_org: false })
      });
      const publishBody = await publishResponse.json().catch(() => ({}));
      record("fetch", publishResponse.url, publishResponse.status, JSON.stringify(publishBody));
      const publishedId = String(publishBody?.data?.article_id || publishBody?.data?.id || articleId);
      if (!publishResponse.ok || Number(publishBody?.err_no || 0) !== 0) {
        return {
          ok: false,
          status: isRiskChallenge(JSON.stringify(publishBody)) ? "risk_blocked" : "pending_verify",
          publishStatus: "failed",
          failureCode: isRiskChallenge(JSON.stringify(publishBody)) ? "risk_blocked" : "publish_action_unconfirmed",
          externalDraftId: articleId,
          failureReason: "Juejin publish response was not accepted.",
          observations
        };
      }
      return {
        ok: true,
        status: "published_pending_url",
        publishStatus: "published_pending_url",
        platformArticleId: publishedId,
        externalDraftId: articleId,
        editorUrl: `https://juejin.cn/editor/drafts/${articleId}`,
        publicUrl: `https://juejin.cn/post/${publishedId}`,
        observations
      };
    }

    return {
      ok: false,
      status: "pending_verify",
      publishStatus: "failed",
      failureCode: "adapter_failed",
      failureReason: `${payload.platform} page-context executor is not configured for a stable platform API.`,
      nextAction: "Use the existing deterministic Arcs runner fallback; do not guess platform requests.",
      observations
    };
  } finally {
    window.fetch = nativeFetch;
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.send = originalXhrSend;
  }
}
