"use client";

import { Button, Card, Space, Steps, Typography } from "antd";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export default function KnowledgeImportPage() {
  return (
    <>
      <PageHeader
        title="内容导入"
        subtitle="先选择资料来源，再进入对应导入子页面；解析预览、保存和向量化分步完成。"
        actions={
          <Space>
            <Link href="/knowledge">
              <Button>返回知识库列表</Button>
            </Link>
            <Link href="/knowledge/vectorize">
              <Button>切片与向量化</Button>
            </Link>
            <Link href="/knowledge/rule-packages">
              <Button>产品表达规则包</Button>
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
            适合官网博客、产品页、帮助文档和外部资料。支持一行一个 URL，解析为 Markdown 预览后保存为待向量化知识库。
          </Typography.Paragraph>
          <Steps
            size="small"
            direction="vertical"
            items={[
              { title: "填写知识库信息" },
              { title: "粘贴多个 URL" },
              { title: "解析为 Markdown" },
              { title: "保存为待向量化" }
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
              { title: "保存为待向量化" }
            ]}
          />
        </Card>
      </div>
    </>
  );
}
