"use client";

import { Button, Card, Space, Steps, Typography } from "antd";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export default function KnowledgeImportPage() {
  return (
    <>
      <PageHeader
        title="内容导入"
        subtitle="选择资料来源后，系统会托管正文并自动完成治理、向量化与索引。"
        actions={
          <Space>
            <Link href="/knowledge">
              <Button>返回知识库列表</Button>
            </Link>
          </Space>
        }
      />

      <div className="knowledge-detail-two-column">
        <Card
          title="URL 导入"
          extra={
            <Link href="/knowledge/import/url">
              <Button type="primary">进入 URL 导入</Button>
            </Link>
          }
        >
          <Typography.Paragraph>
            适合官网博客、产品页、帮助文档和外部资料。服务端解析正文并保存到 MySQL，随后自动创建治理与索引任务。
          </Typography.Paragraph>
          <Steps
            size="small"
            direction="vertical"
            items={[
              { title: "填写知识库信息" },
              { title: "粘贴多个 URL" },
              { title: "解析为 Markdown" },
              { title: "托管并自动索引" }
            ]}
          />
        </Card>

        <Card
          title="文档导入"
          extra={
            <Link href="/knowledge/import/document">
              <Button type="primary">进入文档导入</Button>
            </Link>
          }
        >
          <Typography.Paragraph>
            适合 Markdown、PDF、Word(docx) 等资料。保存前会调用服务端解析器生成 Markdown 预览；旧版 .doc 需先转换为 .docx。
          </Typography.Paragraph>
          <Steps
            size="small"
            direction="vertical"
            items={[
              { title: "填写知识库信息" },
              { title: "上传多份文档" },
              { title: "解析并预览 Markdown" },
              { title: "托管并自动索引" }
            ]}
          />
        </Card>
      </div>
    </>
  );
}
