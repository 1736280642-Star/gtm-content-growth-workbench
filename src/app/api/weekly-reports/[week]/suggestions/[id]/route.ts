import { readRequestPayload } from "@/lib/api-utils";
import { canManageWeeklyReportSuggestions } from "@/lib/permissions";
import { decideWeeklyReportSuggestion, filterWeeklyReportForRole, readWorkbenchState } from "@/lib/workbench-store";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { week: string; id: string } }) {
  const payload = await readRequestPayload(request);
  const state = readWorkbenchState();

  if (!canManageWeeklyReportSuggestions(state.workspaceSetting.currentRole)) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "当前角色无权处理周报建议，请联系内容增长人员或工作台运营。"
      },
      { status: 403 }
    );
  }

  const result = decideWeeklyReportSuggestion(params.week, params.id, payload);
  const response =
    result.ok && result.data?.report
      ? {
          ...result,
          data: {
            ...result.data,
            report: filterWeeklyReportForRole(result.data.report, state.workspaceSetting.currentRole)
          }
        }
      : result;

  return NextResponse.json(response, { status: result.ok ? 200 : 400 });
}
