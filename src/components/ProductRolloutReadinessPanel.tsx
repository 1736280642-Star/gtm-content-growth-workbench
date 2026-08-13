"use client";

import { Alert, Button, Card, Segmented, Space, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";
import type { DirectPublishPlatformKey } from "@/lib/types";
import type { ProductRolloutReadiness } from "@/lib/v5/product-rollout-readiness-service";

const platformOptions: Array<{ label: string; value: DirectPublishPlatformKey }> = [
  { label: "知乎", value: "zhihu" },
  { label: "公众号", value: "wechat" },
  { label: "掘金", value: "juejin" },
  { label: "CSDN", value: "csdn" }
];

export function ProductRolloutReadinessPanel({ productId }: { productId: string }) {
  const [platform, setPlatform] = useState<DirectPublishPlatformKey>("wechat");
  const [data, setData] = useState<ProductRolloutReadiness>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await callJsonApi<{ ok: true; data: ProductRolloutReadiness }>(
        `/api/v5/products/${encodeURIComponent(productId)}/rollout-readiness?platform=${platform}`,
        { cache: "no-store" }
      );
      setData(response.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发布准入检查失败");
    } finally {
      setLoading(false);
    }
  }, [platform, productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const confirmAccount = useCallback(async () => {
    if (!data?.configuredAccountCandidate) return;
    setConfirmingAccount(true);
    try {
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/publish-account-binding`, {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          platform,
          accountLabel: data.configuredAccountCandidate,
          expectedVersion: data.accountBindingVersion || 0
        })
      });
      messageApi.success("已确认 WorkBuddy 使用该发布账号");
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "发布账号确认失败");
    } finally {
      setConfirmingAccount(false);
    }
  }, [data, messageApi, platform, productId, refresh]);

  return (
    <>{messageContext}<Card
      bordered={false}
      title="批量生成与真实发布准入"
      extra={<Button loading={loading} onClick={() => void refresh()}>重新检查</Button>}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Segmented options={platformOptions} value={platform} onChange={(value) => setPlatform(value as DirectPublishPlatformKey)} />
        {data?.configuredAccountCandidate ? (
          <Alert
            showIcon
            type={data.confirmedAccount === data.configuredAccountCandidate ? "success" : "info"}
            message={data.confirmedAccount === data.configuredAccountCandidate
              ? `已确认账号：${data.configuredAccountCandidateLabel || data.confirmedAccount}`
              : `待确认账号：${data.configuredAccountCandidateLabel || data.configuredAccountCandidate}`}
            description="这里只绑定产品与账号标识；登录凭证仍由本机发布桥接器保管。"
            action={data.confirmedAccount === data.configuredAccountCandidate ? undefined : <Button type="primary" loading={confirmingAccount} onClick={() => void confirmAccount()}>确认用于当前产品</Button>}
          />
        ) : (
          <Alert
            showIcon
            type="warning"
            message="没有可唯一识别的发布账号"
            description="如果平台尚未连接或存在多个账号，请先在设置页指定默认账号。"
            action={<Link href="/settings"><Button>前往设置</Button></Link>}
          />
        )}
        {error ? <Alert showIcon type="error" message={error} /> : null}
        {data ? (
          <>
            <Alert
              showIcon
              type={data.canScheduleRealPublish ? "success" : "warning"}
              message={data.canScheduleRealPublish ? "已满足真实发布准入" : data.canEnterBatchGeneration ? "内容可批量生成，发布连接仍需处理" : "请先完成策略与样稿验收"}
              description="系统只展示必要门禁，不会自动绑定账号，也不会因账号已连接而绕过内容质量确认。"
            />
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {data.gates.map((gate) => (
                <div key={gate.key} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <Tag color={gate.status === "passed" ? "green" : "gold"}>{gate.status === "passed" ? "已通过" : "待处理"}</Tag>
                  <div>
                    <Typography.Text>{gate.detail}</Typography.Text>
                    {gate.nextAction ? <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{gate.nextAction}</Typography.Paragraph> : null}
                  </div>
                </div>
              ))}
            </Space>
          </>
        ) : null}
      </Space>
    </Card></>
  );
}
