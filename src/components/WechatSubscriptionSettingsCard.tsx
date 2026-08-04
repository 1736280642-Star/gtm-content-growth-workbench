"use client";

import { ApiOutlined, CheckCircleOutlined, ExclamationCircleOutlined, WechatOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Skeleton, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { callJsonApi } from "@/lib/client-api";

type WechatStatusResponse = {
  ok: true;
  data: {
    configured: boolean;
    baseUrlConfigured: boolean;
    apiKeyConfigured: boolean;
    sourceCount: number;
    enabledSourceCount: number;
    failedSourceCount: number;
    latestCollectedAt?: string;
  };
};

export function WechatSubscriptionSettingsCard() {
  const [status, setStatus] = useState<WechatStatusResponse["data"]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callJsonApi<WechatStatusResponse>("/api/v5/knowledge-collection/wechat-status", { cache: "no-store" })
      .then((result) => setStatus(result.data))
      .catch(() => setFailed(true));
  }, []);

  return (
    <Card id="wechat-subscription" className="wechat-settings-card" bordered={false}>
      <div className="wechat-settings-heading">
        <Space align="start">
          <span className="wechat-settings-icon"><WechatOutlined /></span>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>公众号订阅监控台</Typography.Title>
            <Typography.Text type="secondary">连接外部订阅服务，持续拉取公众号文章并送入知识库治理。</Typography.Text>
          </div>
        </Space>
        {!status && !failed ? <Skeleton.Button active size="small" /> : status?.configured ? <Tag color="success" icon={<CheckCircleOutlined />}>已接通</Tag> : <Tag color="warning" icon={<ExclamationCircleOutlined />}>待配置</Tag>}
      </div>

      {failed ? <Alert showIcon type="error" message="暂时无法读取连接状态" description="刷新页面重试；该异常不会回显任何 API 配置内容。" /> : null}
      {status ? (
        <div className="wechat-settings-status-grid">
          <div><span>API 地址</span><strong>{status.baseUrlConfigured ? "已配置" : "未配置"}</strong></div>
          <div><span>API Key</span><strong>{status.apiKeyConfigured ? "已配置" : "未配置"}</strong></div>
          <div><span>监控公众号</span><strong>{status.enabledSourceCount} / {status.sourceCount}</strong></div>
          <div><span>采集异常</span><strong className={status.failedSourceCount ? "is-error" : undefined}>{status.failedSourceCount}</strong></div>
        </div>
      ) : null}

      <Alert
        className="wechat-settings-guidance"
        showIcon
        type="info"
        icon={<ApiOutlined />}
        message="凭证由管理员自行配置，不在浏览器中填写或回显"
        description={(
          <div>
            <Typography.Paragraph>先在公众号订阅服务后台关注所需账号并创建 API Key，再将以下变量写入部署环境或本地 <code>.env.local</code>，随后重启 Web 与采集 Worker。</Typography.Paragraph>
            <pre><code>WECHAT_COLLECTION_BASE_URL=&lt;订阅服务 API 地址&gt;{"\n"}WECHAT_COLLECTION_API_KEY=&lt;服务后台创建的 API Key&gt;</code></pre>
          </div>
        )}
      />

      <Space wrap>
        <Link href="/knowledge?view=assets&import=wechat"><Button type="primary" className="wechat-settings-action" icon={<WechatOutlined />}>管理公众号来源</Button></Link>
        <Button href="https://weixinzs.org/features/mp-article-ai-skill" target="_blank" rel="noreferrer">查看订阅服务说明</Button>
        {status?.latestCollectedAt ? <Typography.Text type="secondary">最近采集：{new Date(status.latestCollectedAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text> : null}
      </Space>
    </Card>
  );
}
