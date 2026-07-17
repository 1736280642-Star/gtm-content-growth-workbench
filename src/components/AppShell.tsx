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
  FontSizeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RocketOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Alert, Button, Layout, Menu, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { canViewRoute, getDefaultRouteForRole, getRouteLabel, getVisibleRoutesForRole, workspaceRoleLabels } from "@/lib/permissions";
import { useWorkbenchSnapshot } from "@/lib/client-state";

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
  { key: "/batch-generation", icon: <RocketOutlined />, label: <Link href="/batch-generation">批量生成中心</Link> },
  { key: "/daily-execution", icon: <CheckSquareOutlined />, label: <Link href="/daily-execution">当日执行</Link> },
  { key: "/monthly-review", icon: <BarChartOutlined />, label: <Link href="/monthly-review">月度复盘</Link> },
  { key: "/publish", icon: <UploadOutlined />, label: <Link href="/publish">数据回传</Link> },
  { key: "/knowledge", icon: <BookOutlined />, label: <Link href="/knowledge">知识库</Link> },
  { key: "/distilled-terms", icon: <FontSizeOutlined />, label: <Link href="/distilled-terms">蒸馏词池</Link> },
  { key: "/blog-monitor", icon: <FileSearchOutlined />, label: <Link href="/blog-monitor">官网博客监控</Link> },
  { key: "/blog-candidates", icon: <FileSearchOutlined />, label: <Link href="/blog-candidates">博客候选池</Link> },
  { key: "/geo-test", icon: <RocketOutlined />, label: <Link href="/geo-test">GEO 测试</Link> },
  { key: "/real-integration", icon: <CloudSyncOutlined />, label: <Link href="/real-integration">连接管理</Link> },
  { key: "/ai-config", icon: <ApiOutlined />, label: <Link href="/ai-config">AI 配置</Link> },
  { key: "/settings", icon: <SettingOutlined />, label: <Link href="/settings">工作台设置</Link> }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const {
    state: { workspaceSetting }
  } = useWorkbenchSnapshot();
  const visibleRouteKeys = getVisibleRoutesForRole(workspaceSetting.currentRole);
  const visibleNavItems = navItems.filter((item) => visibleRouteKeys.includes(item.key));
  const currentPageKey = navItems
    .map((item) => item.key)
    .filter((key) => key === "/" || pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  const selectedKey = visibleNavItems
    .map((item) => item.key)
    .filter((key) => key === "/" || pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  const currentRouteVisible = !currentPageKey || canViewRoute(workspaceSetting.currentRole, currentPageKey);
  const defaultRoute = getDefaultRouteForRole(workspaceSetting.currentRole);
  const restrictedPageLabel = currentPageKey ? getRouteLabel(currentPageKey) : "当前页面";

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
        <Menu mode="inline" selectedKeys={[selectedKey || "/"]} items={visibleNavItems} />
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
          <Typography.Text strong>{"月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘"}</Typography.Text>
          <Space>
            <Tag color="blue">{workspaceRoleLabels[workspaceSetting.currentRole]}</Tag>
            <Typography.Text type="secondary">AI 可控、效果可评估、复盘能回流</Typography.Text>
          </Space>
        </Header>
        <Content style={contentStyle}>
          {currentRouteVisible ? (
            children
          ) : (
            <Alert
              showIcon
              type="warning"
              message="当前角色无权进入此页面"
              description={`为了避免普通业务流程看到内部治理配置和排查信息，工作台不会渲染「${restrictedPageLabel}」页面内容。当前角色：${
                workspaceRoleLabels[workspaceSetting.currentRole]
              }。`}
              action={
                <Space>
                  <Link href={defaultRoute}>
                    <Button size="small" type="primary">
                      去{getRouteLabel(defaultRoute)}
                    </Button>
                  </Link>
                  <Link href="/settings">
                    <Button size="small">切换角色</Button>
                  </Link>
                </Space>
              }
            />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
