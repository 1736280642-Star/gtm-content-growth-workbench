import { observationError, observationOk } from "@/lib/v5/observation-api";
import { getMonthlyReview } from "@/lib/v5/monthly-review-service";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { month: string } }) {
  try {
    return observationOk(await getMonthlyReview(params.month));
  } catch (error) {
    return observationError(error, "MONTHLY_REVIEW_READ_FAILED", "问题级月度复盘读取失败，请检查上游适配器。");
  }
}
