function statusFailure(publishStatus, payload) {
  const labels = {
    2: "原创校验失败",
    3: "常规发布失败",
    4: "平台审核未通过",
    5: "发布成功后文章已被用户删除",
    6: "发布成功后文章已被平台封禁"
  };
  const label = labels[publishStatus] || `未知发布状态 ${publishStatus}`;
  return {
    ok: false,
    status: publishStatus === 4 ? "manual_takeover_required" : "failed",
    publishStatus: publishStatus === 4 ? "pending_review" : "failed",
    failureCode: publishStatus === 4 ? "manual_takeover_required" : "adapter_failed",
    failureReason: `微信公众号${label}。${payload.fail_idx?.length ? `失败文章序号：${payload.fail_idx.join(",")}` : ""}`,
    nextAction: "请到公众号后台查看官方失败原因；确认没有成功文章后再创建新的发布排程。"
  };
}

export function normalizeWechatPublishStatus(payload, publishId) {
  if (payload?.errcode && payload.errcode !== 0) {
    return {
      ok: false,
      status: payload.errcode === 48001 ? "pending_config" : "failed",
      publishStatus: "failed",
      externalTaskId: publishId,
      failureCode: payload.errcode === 48001 ? "pending_config" : "adapter_failed",
      failureReason: `微信公众号发布状态查询失败：${payload.errmsg || payload.errcode}`,
      nextAction: payload.errcode === 48001 ? "请确认公众号主体和认证状态具备发布接口权限。" : "请检查公众号后台发布任务，不要重复提交。"
    };
  }

  const publishStatus = Number(payload?.publish_status);
  if (publishStatus === 0) {
    const detail = payload.article_detail || {};
    const firstItem = Array.isArray(detail.item) ? detail.item[0] : undefined;
    const publicUrl = firstItem?.article_url || firstItem?.url;
    const platformArticleId = detail.article_id || payload.article_id;
    return {
      ok: true,
      status: publicUrl ? "published_verified" : "published_pending_url",
      publishStatus: "confirmed",
      externalTaskId: publishId,
      platformArticleId: platformArticleId ? String(platformArticleId) : undefined,
      publicUrl,
      pendingCsvReturn: !publicUrl,
      nextAction: publicUrl ? "微信公众号已正式发布并返回公开链接。" : "微信公众号已确认发布，公开链接等待后续查询或人工回填。"
    };
  }

  if (publishStatus === 1 || Number.isNaN(publishStatus)) {
    return {
      ok: true,
      status: "pending_verify",
      publishStatus: "submitted",
      externalTaskId: publishId,
      pendingCsvReturn: true,
      nextAction: "微信公众号仍在处理发布任务；后续只查询状态，不要重复提交。"
    };
  }

  return { ...statusFailure(publishStatus, payload), externalTaskId: publishId };
}

export async function verifyWechatPublish({ apiBase, accessToken, publishId, fetchJson }) {
  const url = new URL(`${apiBase}/cgi-bin/freepublish/get`);
  url.searchParams.set("access_token", accessToken);
  const { response, payload } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId })
  });

  if (!response.ok) {
    return {
      ok: false,
      status: "pending_verify",
      publishStatus: "submitted",
      externalTaskId: publishId,
      pendingCsvReturn: true,
      failureCode: "verification_failed",
      failureReason: `微信公众号发布状态查询 HTTP ${response.status}。`,
      nextAction: "不要重复提交；恢复连接后只查询发布任务状态。"
    };
  }

  return normalizeWechatPublishStatus(payload, publishId);
}

export async function submitAndPollWechatPublish({
  apiBase,
  accessToken,
  mediaId,
  fetchJson,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollAttempts = 10,
  pollIntervalMs = 3_000
}) {
  const url = new URL(`${apiBase}/cgi-bin/freepublish/submit`);
  url.searchParams.set("access_token", accessToken);
  const { response, payload } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId })
  });

  if (!response.ok || payload?.errcode || !payload?.publish_id) {
    const permissionDenied = payload?.errcode === 48001;
    return {
      ok: false,
      status: permissionDenied ? "pending_config" : "failed",
      publishStatus: "failed",
      failureCode: permissionDenied ? "pending_config" : "adapter_failed",
      failureReason: `微信公众号正式发布提交失败：${payload?.errmsg || `HTTP ${response.status}`}`,
      nextAction: permissionDenied ? "请确认公众号为具备发布接口权限的认证服务号。" : "请检查公众号草稿和后台状态，确认未发布后再创建新排程。"
    };
  }

  const publishId = String(payload.publish_id);
  let result = {
    ok: true,
    status: "pending_verify",
    publishStatus: "submitted",
    externalTaskId: publishId,
    pendingCsvReturn: true,
    nextAction: "微信公众号发布任务已提交，等待官方状态。"
  };

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (attempt > 0) await sleep(pollIntervalMs);
    result = await verifyWechatPublish({ apiBase, accessToken, publishId, fetchJson });
    if (result.status !== "pending_verify") return result;
  }

  return result;
}
