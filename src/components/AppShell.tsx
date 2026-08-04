"use client";

import { BookOutlined, ControlOutlined, DashboardOutlined, FundProjectionScreenOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Space, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const { Header, Sider, Content } = Layout;
const shellStyle: CSSProperties = { minHeight: "100vh", display: "flex", background: "#f6f7fb" };
const siderStyle: CSSProperties = { minHeight: "100vh", background: "#fff", borderRight: "1px solid #e6e8ef" };
const mainLayoutStyle: CSSProperties = { minWidth: 0, flex: "1 1 auto" };
const contentStyle: CSSProperties = { minWidth: 0, padding: 24 };

const navItems = [
  { key: "/", icon: <DashboardOutlined />, label: <Link href="/">首页</Link> },
  { key: "/knowledge", icon: <BookOutlined />, label: <Link href="/knowledge">知识库</Link> },
  { key: "/monthly-plan", icon: <ControlOutlined />, label: <Link href="/monthly-plan">GEO 内容中心</Link> },
  { key: "/geo-monitor", icon: <FundProjectionScreenOutlined />, label: <Link href="/geo-monitor">GEO 监控塔</Link> },
  { key: "/settings", icon: <SettingOutlined />, label: <Link href="/settings">设置</Link> }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const selectedKey = navItems.map((item) => item.key).filter((key) => pathname.startsWith(key)).sort((a, b) => b.length - a.length)[0];

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true);
  }, []);

  return (
    <Layout className="app-shell" style={shellStyle}>
      <Sider className="app-sider" collapsed={siderCollapsed} collapsedWidth={72} style={siderStyle} theme="light" trigger={null} width={228}>
        <div className="app-sider-brand">
          {siderCollapsed ? (
            <Typography.Text className="app-sider-mark" strong>GTM</Typography.Text>
          ) : (
            <div className="app-sider-title-block"><Typography.Title level={4} style={{ margin: 0 }}>JOTO GTM</Typography.Title></div>
          )}
          <Button
            aria-label={siderCollapsed ? "展开导航" : "收起导航"}
            className="app-sider-collapse-button"
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSiderCollapsed((current) => !current)}
            size="small"
            type="text"
          />
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={navItems}
          onClick={() => { if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true); }}
        />
      </Sider>
      <Layout style={mainLayoutStyle}>
        <Header className="app-header" style={{ background: "#fff", borderBottom: "1px solid #e6e8ef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography.Text strong>知识采集 → GEO 调研 → 月度策略 → 内容生产 → 自动排程 → 发布与复盘</Typography.Text>
          <Space><Typography.Text type="secondary">默认自动运行 · 异常才需人工处理</Typography.Text></Space>
        </Header>
        <Content style={contentStyle}>{children}</Content>
      </Layout>
    </Layout>
  );
}
