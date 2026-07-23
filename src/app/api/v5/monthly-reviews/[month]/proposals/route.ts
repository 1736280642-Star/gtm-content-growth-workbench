import type { CreateNextMonthProposalRequest } from "@/lib/v5/monthly-review-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { createNextMonthProposal } from "@/lib/v5/monthly-review-service";

export async function POST(request: Request, { params }: { params: { month: string } }) {
  try {
    return observationOk(
      await createNextMonthProposal(params.month, (await readObservationPayload(request)) as unknown as CreateNextMonthProposalRequest),
      201
    );
  } catch (error) {
    return observationError(error, "NEXT_MONTH_PROPOSAL_CREATE_FAILED", "下月 Proposal 创建失败，请检查问题复盘和形成依据。");
  }
}
