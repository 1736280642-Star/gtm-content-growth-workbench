import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";
import { observationError } from "@/lib/v5/observation-api";
import { ObservationServiceError } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return observationError(
      new ObservationServiceError(
        410,
        "USER_CAPTURE_PAIRING_RETIRED",
        "普通用户不再配对采集设备。请由部署人员在首页部署板块配置 24 小时共享采集服务器。"
      ),
      "USER_CAPTURE_PAIRING_RETIRED",
      "普通用户不再配对采集设备。"
    );
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}
