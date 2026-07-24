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
  "/monthly-strategy": "月度策略包（已并入月度内容矩阵）",
  "/monthly-matrix": "月度内容矩阵",
  "/monthly-matrix/strategy": "月度策略工作区",
  "/monthly-matrix/content-types": "内容类型库",
  "/monthly-matrix/batch-generation": "批量生成中心",
  "/batch-generation": "批量生成中心",
  "/exceptions": "异常拦截（已并入批量生成中心）",
  "/publish-schedule": "人工排程（已并入批量生成中心）",
  "/publish-schedule/daily-execution": "当日执行",
  "/daily-execution": "当日执行",
  "/monthly-review": "月度复盘",
  "/ai-front-test": "AI 前台测试",
  "/v5/drafts": "正式 Markdown 正文",
  "/weekly-plan": "周计划",
  "/today": "今日发布",
  "/publish": "数据回传",
  "/weekly-report": "周度复盘",
  "/knowledge": "知识库",
  "/questions-keywords": "问题与关键词池",
  "/distilled-terms": "问题与关键词池（兼容入口）",
  "/blog-monitor": "官网博客监控",
  "/blog-candidates": "博客候选池",
  "/configuration": "配置管理",
  "/real-integration": "配置管理（兼容入口）",
  "/ai-config": "配置管理（兼容入口）",
  "/settings": "工作台设置"
};

const roleVisibleRoutes: Record<WorkspaceRole, string[]> = {
  content_publisher: ["/", "/today", "/publish", "/weekly-plan", "/weekly-report", "/settings"],
  content_growth: ["/", "/monthly-review", "/ai-front-test", "/weekly-plan", "/weekly-report", "/questions-keywords", "/blog-monitor", "/blog-candidates", "/settings"],
  workbench_operator: [
    "/",
    "/monthly-matrix",
    "/batch-generation",
    "/daily-execution",
    "/monthly-review",
    "/ai-front-test",
    "/v5/drafts",
    "/weekly-plan",
    "/today",
    "/publish",
    "/weekly-report",
    "/knowledge",
    "/questions-keywords",
    "/blog-monitor",
    "/blog-candidates",
    "/configuration",
    "/settings"
  ],
  knowledge_manager: ["/", "/knowledge", "/questions-keywords", "/weekly-report", "/settings"],
  developer_admin: [
    "/",
    "/monthly-matrix",
    "/batch-generation",
    "/daily-execution",
    "/monthly-review",
    "/ai-front-test",
    "/v5/drafts",
    "/weekly-plan",
    "/today",
    "/publish",
    "/weekly-report",
    "/knowledge",
    "/questions-keywords",
    "/blog-monitor",
    "/blog-candidates",
    "/configuration",
    "/settings"
  ]
};

const roleDefaultRoutes: Record<WorkspaceRole, string> = {
  content_publisher: "/today",
  content_growth: "/weekly-report",
  workbench_operator: "/weekly-report",
  knowledge_manager: "/knowledge",
  developer_admin: "/configuration"
};

export function getVisibleRoutesForRole(role: WorkspaceRole) {
  return roleVisibleRoutes[role] || roleVisibleRoutes.content_publisher;
}

export function canViewRoute(role: WorkspaceRole, route: string) {
  const visibleRoutes = getVisibleRoutesForRole(role);
  return visibleRoutes.some((allowedRoute) => route === allowedRoute || route.startsWith(`${allowedRoute}/`));
}

export function getDefaultRouteForRole(role: WorkspaceRole) {
  return roleDefaultRoutes[role] || "/";
}

export function getRouteLabel(route: string) {
  return workspaceRouteLabels[route] || route;
}

export function canViewAiGovernance(role: WorkspaceRole) {
  return role === "workbench_operator" || role === "developer_admin";
}

export function canManagePromptVersions(role: WorkspaceRole) {
  return role === "workbench_operator" || role === "developer_admin";
}

export function canManageProductExpressionRules(role: WorkspaceRole) {
  return role === "knowledge_manager" || role === "workbench_operator" || role === "developer_admin";
}

export function canManageWeeklyReportSuggestions(role: WorkspaceRole) {
  return role === "content_growth" || role === "workbench_operator" || role === "developer_admin";
}
