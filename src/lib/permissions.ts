import type { WorkspaceRole } from "./types";

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  content_publisher: "内容发布人员",
  content_growth: "内容增长 / GEO 人员",
  workbench_operator: "工作台运营 / 质量评估",
  knowledge_manager: "知识库 / 产品表达维护",
  developer_admin: "开发管理员"
};

export const workspaceRouteLabels: Record<string, string> = {
  "/knowledge": "知识库",
  "/monthly-plan": "GEO 内容中心",
  "/content-monitor": "内容监控塔",
  "/settings": "设置"
};

const roleVisibleRoutes: Record<WorkspaceRole, string[]> = {
  content_publisher: ["/monthly-plan", "/content-monitor", "/settings"],
  content_growth: ["/knowledge", "/monthly-plan", "/content-monitor", "/settings"],
  workbench_operator: ["/knowledge", "/monthly-plan", "/content-monitor", "/settings"],
  knowledge_manager: ["/knowledge", "/content-monitor", "/settings"],
  developer_admin: ["/knowledge", "/monthly-plan", "/content-monitor", "/settings"]
};

const roleDefaultRoutes: Record<WorkspaceRole, string> = {
  content_publisher: "/monthly-plan?step=execution",
  content_growth: "/content-monitor",
  workbench_operator: "/content-monitor",
  knowledge_manager: "/knowledge",
  developer_admin: "/settings"
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

export function canManageMonthlyReviewProposals(role: WorkspaceRole) {
  return role === "content_growth" || role === "workbench_operator" || role === "developer_admin";
}
