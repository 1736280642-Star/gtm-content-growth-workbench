"use client";

import {
  ApiOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CloudSyncOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  RocketOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const { Header, Sider, Content } = Layout;

const navItems = [
  { key: "/", icon: <DashboardOutlined />, label: <Link href="/">首页</Link> },
  { key: "/weekly-plan", icon: <CalendarOutlined />, label: <Link href="/weekly-plan">周计划</Link> },
  { key: "/today", icon: <CheckSquareOutlined />, label: <Link href="/today">今日发布</Link> },
  { key: "/publish", icon: <UploadOutlined />, label: <Link href="/publish">数据回传</Link> },
  { key: "/blog-monitor", icon: <FileSearchOutlined />, label: <Link href="/blog-monitor">官网博客监控</Link> },
  { key: "/blog-candidates", icon: <FileSearchOutlined />, label: <Link href="/blog-candidates">博客候选池</Link> },
  { key: "/geo-test", icon: <RocketOutlined />, label: <Link href="/geo-test">GEO 测试</Link> },
  { key: "/weekly-report", icon: <BarChartOutlined />, label: <Link href="/weekly-report">周度复盘</Link> },
  { key: "/knowledge", icon: <BookOutlined />, label: <Link href="/knowledge">知识库</Link> },
  { key: "/real-integration", icon: <CloudSyncOutlined />, label: <Link href="/real-integration">真实接入</Link> },
  { key: "/ai-config", icon: <ApiOutlined />, label: <Link href="/ai-config">AI 配置</Link> },
  { key: "/settings", icon: <SettingOutlined />, label: <Link href="/settings">工作台设置</Link> }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const selectedKey = navItems
    .map((item) => item.key)
    .filter((key) => key === "/" || pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <Layout className="app-shell">
      <Sider width={228} theme="light">
        <div style={{ padding: 18 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            JOTO GTM
          </Typography.Title>
          <Typography.Text type="secondary">内容增长工作台 V3</Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey || "/"]} items={navItems} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e6e8ef",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <Typography.Text strong>{"知识库 -> 周计划 -> 今日发布 -> 数据回传 -> 周度复盘"}</Typography.Text>
          <Typography.Text type="secondary">诊断优先，动作收敛，数据回传独立</Typography.Text>
        </Header>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
