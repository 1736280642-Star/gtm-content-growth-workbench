"use client";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Result } from "antd";
import Link from "next/link";
import { CaptureEnvironmentStatus } from "@/components/CaptureEnvironmentStatus";
import { PageHeader } from "@/components/PageHeader";
import { useWorkbenchSnapshot } from "@/lib/client-state";
import { useFrontendCapture } from "@/lib/v5/use-frontend-capture";

export default function CaptureEnvironmentPage() {
  const { state: { workspaceSetting } } = useWorkbenchSnapshot();
  const { workspace, loading, error, refresh } = useFrontendCapture(workspaceSetting.currentRole);

  if (error && !workspace) return <Result status="error" title="采集环境读取失败" subTitle={error} extra={<Button onClick={() => refresh()}>重试</Button>} />;

  return (
    <>
      <PageHeader
        title="AI 前台测试 / 采集环境"
        subtitle="确认 Chrome 浏览器伴侣、本地 Runner 和平台适配器状态；页面不会展示 Cookie、Token 或完整本机路径。"
        actions={<><Link href="/ai-front-test"><Button icon={<ArrowLeftOutlined />}>返回测试台</Button></Link><Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh()}>刷新状态</Button></>}
      />
      <Card size="small" className="capture-environment-card" loading={!workspace && loading}>
        {workspace ? <CaptureEnvironmentStatus value={workspace.environment} loading={loading} onRefresh={() => refresh()} /> : null}
        <Alert
          showIcon
          type="info"
          message="Computer Use 不参与常规采集"
          description="仅在人工接管或适配器调试时使用；完成后需重新检查环境，并在任务中保留人工介入记录。"
          style={{ marginTop: 16 }}
        />
      </Card>
    </>
  );
}
