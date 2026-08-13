"use client";

import { Button, Space } from "antd";
import { FormOutlined, ReloadOutlined, UnorderedListOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { MediaLibraryWorkspace } from "@/components/free-production/MediaLibraryWorkspace";
import { PageHeader } from "@/components/PageHeader";

export default function FreeProductionAssetsPage() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <>
      <PageHeader
        title="微信公众号内容生产 · 素材图库"
        subtitle="上传时标记素材对应的产品与用途，需要时按产品筛选。"
        actions={<Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => setRefreshSignal((current) => current + 1)}>刷新</Button>
          <Link href="/free-production"><Button type="primary" icon={<FormOutlined />}>返回内容生产</Button></Link>
          <Link href="/free-production/tasks"><Button icon={<UnorderedListOutlined />}>任务与发布</Button></Link>
        </Space>}
      />
      <MediaLibraryWorkspace refreshSignal={refreshSignal} />
    </>
  );
}
