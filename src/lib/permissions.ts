import type { WorkspaceRole } from "./types";

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  content_publisher: "内容发布人员",
  content_growth: "内容增长 / GEO 人员",
  workbench_operator: "工作台运营 / 质量评估",
  knowledge_manager: "知识库 / 产品表达维护",
  developer_admin: "开发管理员"
};

export const workspaceRouteLabels: Record<string, string> = {
  "/": "首页",
  "/weekly-plan": "周计划",
  "/today": "今日发布",
  "/publish": "数据回传",
  "/weekly-report": "周度复盘",
  "/knowledge": "知识库",
  "/distilled-terms": "蒸馏词池",
  "/blog-monitor": "官网博客监控",
  "/blog-candidates": "博客候选池",
  "/geo-test": "GEO 测试",
  "/real-integration": "真实接入",
  "/ai-config": "AI 配置",
  "/settings": "工作台设置"
};

const roleVisibleRoutes: Record<WorkspaceRole, string[]> = {
  content_publisher: ["/", "/today", "/publish", "/weekly-plan", "/weekly-report", "/settings"],
  content_growth: ["/", "/weekly-plan", "/weekly-report", "/distilled-terms", "/blog-monitor", "/blog-candidates", "/geo-test", "/settings"],
  workbench_operator: [
    "/",
    "/weekly-plan",
    "/today",
    "/publish",
    "/weekly-report",
    "/knowledge",
    "/distilled-terms",
    "/blog-monitor",
    "/blog-candidates",
    "/geo-test",
    "/real-integration",
    "/ai-config",
    "/settings"
  ],
  knowledge_manager: ["/", "/knowledge", "/distilled-terms", "/geo-test", "/weekly-report", "/settings"],
  developer_admin: [
    "/",
    "/weekly-plan",
    "/today",
    "/publish",
    "/weekly-report",
    "/knowledge",
    "/distilled-terms",
    "/blog-monitor",
    "/blog-candidates",
    "/geo-test",
    "/real-integration",
    "/ai-config",
    "/settings"
  ]
};

const roleDefaultRoutes: Record<WorkspaceRole, string> = {
  content_publisher: "/today",
  content_growth: "/weekly-report",
  workbench_operator: "/weekly-report",
  knowledge_manager: "/knowledge",
  developer_admin: "/ai-config"
};

const debugAllRoutes = Object.keys(workspaceRouteLabels);

export function getVisibleRoutesForRole(role: WorkspaceRole) {
  return debugAllRoutes;
}

export function canViewRoute(role: WorkspaceRole, route: string) {
  return debugAllRoutes.includes(route);
}

export function getDefaultRouteForRole(role: WorkspaceRole) {
  return roleDefaultRoutes[role] || "/";
}

export function getRouteLabel(route: string) {
  return workspaceRouteLabels[route] || route;
}

export function canViewAiGovernance(role: WorkspaceRole) {
  return true;
}

export function canManagePromptVersions(role: WorkspaceRole) {
  return true;
}

export function canManageProductExpressionRules(role: WorkspaceRole) {
  return true;
}

export function canManageWeeklyReportSuggestions(role: WorkspaceRole) {
  return true;
}
