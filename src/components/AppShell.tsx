"use client";

import {
  ApiOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  ExperimentOutlined,
  FormOutlined,
  QuestionCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const { Header, Sider, Content } = Layout;

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  background: "#f6f7fb"
};

const siderStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#fff",
  borderRight: "1px solid #e6e8ef"
};

const mainLayoutStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto"
};

const contentStyle: CSSProperties = {
  minWidth: 0,
  padding: 24
};

const navItems = [
  { key: "/", icon: <DashboardOutlined />, label: <Link href="/">首页</Link> },
  { key: "/monthly-matrix", icon: <CalendarOutlined />, label: <Link href="/monthly-matrix">月度内容矩阵</Link> },
  { key: "/free-production", icon: <FormOutlined />, label: <Link href="/free-production">自由内容生产</Link> },
  { key: "/daily-execution", icon: <CheckSquareOutlined />, label: <Link href="/daily-execution">当日执行</Link> },
  { key: "/publish", icon: <UploadOutlined />, label: <Link href="/publish">数据回传</Link> },
  { key: "/questions-keywords", icon: <QuestionCircleOutlined />, label: <Link href="/questions-keywords">问题与关键词池</Link> },
  { key: "/knowledge", icon: <BookOutlined />, label: <Link href="/knowledge">知识库</Link> },
  { key: "/blog-monitor", icon: <FileSearchOutlined />, label: <Link href="/blog-monitor">官网博客监控</Link> },
  { key: "/blog-candidates", icon: <FileSearchOutlined />, label: <Link href="/blog-candidates">博客候选池</Link> },
  { key: "/monthly-review", icon: <BarChartOutlined />, label: <Link href="/monthly-review">月度复盘</Link> },
  { key: "/ai-front-test", icon: <ExperimentOutlined />, label: <Link href="/ai-front-test">AI 前台测试</Link> },
  { key: "/configuration", icon: <ApiOutlined />, label: <Link href="/configuration">配置管理</Link> },
  { key: "/settings", icon: <SettingOutlined />, label: <Link href="/settings">工作台设置</Link> }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const selectedKey = navItems
    .map((item) => item.key)
    .filter((key) => key === "/" || pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true);
  }, []);

  return (
    <Layout className="app-shell" style={shellStyle}>
      <Sider
        className="app-sider"
        collapsed={siderCollapsed}
        collapsedWidth={72}
        style={siderStyle}
        theme="light"
        trigger={null}
        width={228}
      >
        <div className="app-sider-brand">
          {siderCollapsed ? (
            <Typography.Text className="app-sider-mark" strong>
              GTM
            </Typography.Text>
          ) : (
            <div className="app-sider-title-block">
              <Typography.Title level={4} style={{ margin: 0 }}>
                JOTO GTM
              </Typography.Title>
              <Typography.Text type="secondary">内容增长工作台</Typography.Text>
            </div>
          )}
          <Button
            aria-label={siderCollapsed ? "展开导航" : "折叠导航"}
            className="app-sider-collapse-button"
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSiderCollapsed((current) => !current)}
            size="small"
            type="text"
          />
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey || "/"]}
          items={navItems}
          onClick={() => {
            if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true);
          }}
        />
      </Sider>
      <Layout style={mainLayoutStyle}>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e6e8ef",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <Typography.Text strong>{"月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘 -> AI 前台测试"}</Typography.Text>
          <Space>
            <Typography.Text type="secondary">AI 可控、效果可评估、复盘能回流</Typography.Text>
          </Space>
        </Header>
        <Content style={contentStyle}>{children}</Content>
      </Layout>
    </Layout>
  );
}
