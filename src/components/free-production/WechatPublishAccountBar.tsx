"use client";

import { CheckCircleFilled, PlusOutlined, ReloadOutlined, SendOutlined, SettingOutlined, WechatFilled } from "@ant-design/icons";
import { Avatar, Button, Skeleton, Tooltip, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callJsonApi } from "@/lib/client-api";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { ProductRolloutReadiness } from "@/lib/v5/product-rollout-readiness-service";

function publishBlockReason(batch: FreeProductionBatch, readiness?: ProductRolloutReadiness) {
  if (!readiness) return "正在检查公众号账号";
  if (!readiness.configuredAccountCandidate) return "请先新增并连接公众号账号";
  if (readiness.confirmedAccount !== readiness.configuredAccountCandidate) return "请先确认当前产品使用的公众号";
  const authGate = readiness.gates.find((gate) => gate.key === "auth");
  if (authGate?.status === "blocked") return authGate.nextAction || authGate.detail;
  if (!batch.currentDraftArtifactId) return "正文尚未生成";
  const blockers = batch.risks.filter((risk) => ["needs_input", "needs_approval", "blocked"].includes(risk.status));
  if (blockers.length) return `还有 ${blockers.length} 项发布阻断需要处理`;
  if (batch.status !== "ready_for_confirmation" && batch.status !== "publish_failed") return "正文尚未通过完整检查";
  return undefined;
}

export function WechatPublishAccountBar({ batch, publishing, onPublish }: { batch: FreeProductionBatch; publishing: boolean; onPublish: () => void }) {
  const [messageApi, messageContext] = message.useMessage();
  const [readiness, setReadiness] = useState<ProductRolloutReadiness>();
  const [loading, setLoading] = useState(true);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await callJsonApi<{ ok: true; data: ProductRolloutReadiness }>(
        `/api/v5/products/${encodeURIComponent(batch.productId)}/rollout-readiness?platform=wechat`,
        { cache: "no-store" }
      );
      setReadiness(response.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "公众号账号状态读取失败");
    } finally {
      setLoading(false);
    }
  }, [batch.productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const confirmAccount = useCallback(async () => {
    if (!readiness?.configuredAccountCandidate) return;
    setBinding(true);
    try {
      await callJsonApi(`/api/v5/products/${encodeURIComponent(batch.productId)}/publish-account-binding`, {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          platform: "wechat",
          accountLabel: readiness.configuredAccountCandidate,
          expectedVersion: readiness.accountBindingVersion || 0
        })
      });
      messageApi.success("公众号已绑定到当前产品");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "公众号绑定失败");
    } finally {
      setBinding(false);
    }
  }, [batch.productId, messageApi, readiness, refresh]);

  const blockedReason = useMemo(() => publishBlockReason(batch, readiness), [batch, readiness]);
  const accountName = readiness?.configuredAccountCandidateLabel || readiness?.configuredAccountCandidate;
  const accountConfirmed = Boolean(accountName && readiness?.confirmedAccount === readiness?.configuredAccountCandidate);

  return (
    <>{messageContext}<section className="wechat-publish-account-bar" aria-label="公众号账号与发布">
      <div className="wechat-publish-account-main">
        <span className="wechat-publish-account-label">发布到</span>
        {loading ? <Skeleton.Avatar active size={36} /> : accountName ? (
          <>
            <Avatar className="wechat-account-avatar" size={36} icon={<WechatFilled />} />
            <div className="wechat-publish-account-copy">
              <strong>{accountName}</strong>
              <span>{accountConfirmed ? <><CheckCircleFilled /> 已绑定当前产品</> : "已连接，等待绑定当前产品"}</span>
            </div>
            {!accountConfirmed ? <Button size="small" loading={binding} onClick={() => void confirmAccount()}>绑定此账号</Button> : null}
          </>
        ) : (
          <div className="wechat-publish-account-copy">
            <strong>尚未绑定公众号</strong>
            <span>{error || "先安全接入公众号，再回到这里快捷选择"}</span>
          </div>
        )}
      </div>
      <div className="wechat-publish-account-actions">
        {!accountName ? <Link href="/settings?tab=connections"><Button icon={<PlusOutlined />}>新增账号绑定</Button></Link> : null}
        <Link href="/settings?tab=rules"><Button type="text" icon={<SettingOutlined />}>管理账号</Button></Link>
        {error ? <Tooltip title="重新检查账号连接"><Button type="text" icon={<ReloadOutlined />} onClick={() => void refresh()} /></Tooltip> : null}
        <Tooltip title={blockedReason}>
          <span><Button type="primary" icon={<SendOutlined />} loading={publishing} disabled={Boolean(blockedReason)} onClick={onPublish}>去发布</Button></span>
        </Tooltip>
      </div>
    </section></>
  );
}
