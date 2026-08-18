"use client";

import { BookOutlined, ControlOutlined, DashboardOutlined, FundProjectionScreenOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, WechatOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Layout, Menu, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const { Header, Sider, Content } = Layout;
const shellStyle: CSSProperties = { minHeight: "100vh", display: "flex", background: "#f6f5f4" };
const siderStyle: CSSProperties = { minHeight: "100vh", background: "#fbfbfa", borderRight: "1px solid #e6e6e6" };
const mainLayoutStyle: CSSProperties = { minWidth: 0, flex: "1 1 auto" };
const contentStyle: CSSProperties = { minWidth: 0, padding: "20px 24px 32px" };

// 用户业务入口保持一级可见，避免用二级工具菜单重复表达同一流程。
const mainNavItems = [
  { key: "/", icon: <DashboardOutlined />, label: <Link href="/">托管模式</Link> },
  { key: "/products", icon: <BookOutlined />, label: <Link href="/products">产品知识库</Link> },
  { key: "/content-automation", icon: <ControlOutlined />, label: <Link href="/content-automation">内容自动化</Link> },
  { key: "/free-production", icon: <WechatOutlined />, label: <Link href="/free-production">公众号内容生产</Link> },
  { key: "/content-monitor", icon: <FundProjectionScreenOutlined />, label: <Link href="/content-monitor">内容监控塔</Link> },
  { key: "/settings", icon: <SettingOutlined />, label: <Link href="/settings">设置</Link> },
];

const allNavKeys = mainNavItems.map((item) => item.key);

interface SystemStatusSummary {
  statusText: string;
  statusColor: "green" | "gold" | "red";
  autoCount: number;
  attentionCount: number;
}

async function fetchSystemStatus(): Promise<SystemStatusSummary> {
  try {
    const response = await fetch("/api/v5/automation/status", { cache: "no-store" });
    const body = await response.json() as { ok?: boolean; data?: { items?: Array<{ status?: string }> } };
    if (!body.ok) throw new Error("status fetch failed");
    const items = body.data?.items || [];
    const attentionItems = items.filter((item) => item.status === "attention").length;
    const runningItems = items.filter((item) => item.status === "running").length;
    const autoCount = runningItems + items.filter((item) => item.status === "healthy").length;
    if (attentionItems > 0) return { statusText: `${attentionItems} 项需你处理`, statusColor: "gold", autoCount, attentionCount: attentionItems };
    if (runningItems > 0) return { statusText: "系统正常运行", statusColor: "green", autoCount, attentionCount: 0 };
    return { statusText: "系统正常运行", statusColor: "green", autoCount, attentionCount: 0 };
  } catch {
    return { statusText: "系统状态读取中", statusColor: "green", autoCount: 0, attentionCount: 0 };
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigationPathname = pathname === "/monthly-plan" ? "/content-automation" : pathname;
  const isHostedMode = pathname === "/" || pathname.startsWith("/hosted");
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatusSummary>({ statusText: "系统状态读取中", statusColor: "green", autoCount: 0, attentionCount: 0 });
  const statusRefreshInFlight = useRef(false);
  const selectedKey = allNavKeys.filter((key) => navigationPathname.startsWith(key)).sort((a, b) => b.length - a.length)[0];

  const refreshStatus = useCallback(() => {
    if (isHostedMode || statusRefreshInFlight.current || document.visibilityState !== "visible") return;
    statusRefreshInFlight.current = true;
    void fetchSystemStatus()
      .then(setSystemStatus)
      .finally(() => { statusRefreshInFlight.current = false; });
  }, [isHostedMode]);

  useEffect(() => {
    if (isHostedMode) return;
    if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true);
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 60_000);
    document.addEventListener("visibilitychange", refreshStatus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshStatus);
    };
  }, [isHostedMode, refreshStatus]);

  if (isHostedMode) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: "#176b52",
            colorInfo: "#2967a3",
            colorText: "#18201d",
            colorTextSecondary: "#63716b",
            colorBorder: "#dce4df",
            colorBgLayout: "#f5f7f4",
            colorBgContainer: "#ffffff",
            borderRadius: 8,
            borderRadiusLG: 12,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
            fontSize: 14,
            controlHeight: 38,
            controlHeightLG: 46,
            boxShadow: "0 1px 2px rgba(24, 32, 29, 0.04)",
            boxShadowSecondary: "0 18px 45px rgba(24, 32, 29, 0.1)"
          },
          components: {
            Button: { fontWeight: 650, primaryShadow: "none", defaultShadow: "none" },
            Input: { activeShadow: "0 0 0 3px rgba(23, 107, 82, 0.12)" },
            Card: { headerHeight: 48, bodyPadding: 20 }
          }
        }}
      >
        <div className="hosted-shell">
          <header className="hosted-topbar">
            <Link className="hosted-brand" href="/">
              <span className="hosted-brand-mark">J</span>
              <span><strong>JOTO</strong><small>推广托管</small></span>
            </Link>
            <nav className="hosted-nav" aria-label="托管模式导航">
              <Link className={pathname === "/" ? "is-active" : ""} href="/">发起推广</Link>
              <Link className={pathname.startsWith("/hosted/email") ? "is-active" : ""} href="/hosted/email">结果邮件</Link>
              <Link className="hosted-console-link" href="/content-automation">进入运营控制台 <span aria-hidden="true">↗</span></Link>
            </nav>
          </header>
          <main className="hosted-main">{children}</main>
          <footer className="hosted-footer"><span>JOTO GTM</span><span>默认自动运行 · 只有必须判断时才打扰你</span></footer>
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#0075de",
          colorInfo: "#0075de",
          colorText: "#31302e",
          colorTextSecondary: "#615d59",
          colorBorder: "#e6e6e6",
          colorBorderSecondary: "#eeeeec",
          colorBgLayout: "#f6f5f4",
          colorBgContainer: "#ffffff",
          borderRadius: 6,
          borderRadiusLG: 10,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 14,
          controlHeight: 32,
          controlHeightSM: 28,
          controlHeightLG: 38,
          lineHeight: 1.5,
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
          boxShadowSecondary: "0 8px 30px rgba(0, 0, 0, 0.08)"
        },
        components: {
          Button: { fontWeight: 500, primaryShadow: "none", defaultShadow: "none" },
          Card: { headerHeight: 44, bodyPadding: 16, headerFontSize: 15 },
          Menu: { itemHeight: 36, itemBorderRadius: 5, itemMarginInline: 8 },
          Table: { cellPaddingBlock: 9, cellPaddingInline: 12, headerBg: "#f7f7f5", headerColor: "#615d59" },
          Tabs: { horizontalItemPadding: "9px 2px", titleFontSize: 14 },
          Tag: { defaultBg: "#f6f5f4", defaultColor: "#615d59" }
        }
      }}
    >
    <Layout className="app-shell" style={shellStyle}>
      <Sider className="app-sider" collapsed={siderCollapsed} collapsedWidth={64} style={siderStyle} theme="light" trigger={null} width={220}>
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
          items={mainNavItems}
          onClick={() => { if (window.matchMedia("(max-width: 760px)").matches) setSiderCollapsed(true); }}
        />
      </Sider>
      <Layout style={mainLayoutStyle}>
        <Header className="app-header" style={{ background: "rgba(255,255,255,.92)", borderBottom: "1px solid #e6e6e6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Space>
            <Tag color={systemStatus.statusColor}>{systemStatus.statusText}</Tag>
            {systemStatus.autoCount > 0 ? <Typography.Text type="secondary">{systemStatus.autoCount} 项自动处理中</Typography.Text> : null}
          </Space>
          <Space><Typography.Text type="secondary">默认自动运行 · 异常才需人工处理</Typography.Text></Space>
        </Header>
        <Content style={contentStyle}>{children}</Content>
      </Layout>
    </Layout>
    </ConfigProvider>
  );
}
