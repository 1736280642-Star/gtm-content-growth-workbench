import { NextResponse } from "next/server";
import { getWorkspaceSetting } from "@/lib/workbench-store";
import { getMonthlyWorkspaceReadModel } from "@/lib/v5/monthly-workspace-read-model";

export const dynamic = "force-dynamic";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") || currentMonth();
  try {
    const workspace = await getMonthlyWorkspaceReadModel(month);
    const tasks = workspace.productionTasks;
    const accounts = getWorkspaceSetting().publishAccountByChannel || {};
    const attention = workspace.source.governanceData === "failed" || workspace.source.productionQueue === "failed";
    const items = [
      { key: "knowledge", label: "知识采集", status: workspace.knowledgeBases.some((item) => item.status === "ready") ? "healthy" : "attention", detail: "知识库与来源快照" },
      { key: "research", label: "GEO 调研", status: workspace.targetQuestions.length ? "healthy" : "running", detail: "联网问题发现与 AI 前台测试" },
      { key: "strategy", label: "月度策略", status: attention ? "attention" : workspace.plan?.status === "confirmed" ? "healthy" : "running", detail: workspace.formal.message },
      { key: "production", label: "内容生产", status: tasks.some((item) => item.status === "system_recovering" || item.status === "awaiting_material") ? "attention" : tasks.some((item) => item.status === "generating" || item.status === "ready_for_generation") ? "running" : tasks.some((item) => item.status === "available" || item.status === "scheduled" || item.status === "published") ? "healthy" : "waiting" },
      { key: "schedule", label: "自动排程", status: tasks.some((item) => item.status === "available") && Object.keys(accounts).length === 0 ? "attention" : tasks.some((item) => item.status === "scheduled" || item.status === "published") ? "healthy" : tasks.some((item) => item.status === "available") ? "running" : "waiting", detail: "仅使用已配置的默认发布账号" },
      { key: "publishing", label: "发布回传", status: tasks.some((item) => item.status === "published") ? "healthy" : tasks.some((item) => item.status === "scheduled") ? "running" : "waiting" },
      { key: "review", label: "数据复盘", status: tasks.some((item) => item.status === "published") ? "running" : "waiting" }
    ];
    return NextResponse.json({ ok: true, status: "success", data: { month, items } });
  } catch (error) {
    return NextResponse.json({ ok: true, status: "attention", data: { month, items: [], message: error instanceof Error ? error.message : "自动化状态读取失败" } });
  }
}
