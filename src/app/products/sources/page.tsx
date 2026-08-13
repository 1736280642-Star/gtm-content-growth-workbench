"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { KnowledgeCollectionWorkspace } from "@/components/KnowledgeCollectionWorkspace";
import { PageHeader } from "@/components/PageHeader";

function ProductSourcesWorkspace() {
  const searchParams = useSearchParams();
  const initialImportType = searchParams.get("import") === "wechat" ? "wechat_account" as const : undefined;
  return (
    <>
      <PageHeader
        title="持续资料采集"
        subtitle="为产品资料接入站点或公众号来源，系统按计划持续归档新内容。"
        actions={<Link href="/products"><Button icon={<ArrowLeftOutlined />}>返回产品知识库</Button></Link>}
      />
      <KnowledgeCollectionWorkspace initialImportType={initialImportType} />
    </>
  );
}

export default function ProductSourcesPage() {
  return <Suspense fallback={null}><ProductSourcesWorkspace /></Suspense>;
}
