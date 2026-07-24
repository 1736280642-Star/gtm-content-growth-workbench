import { randomUUID } from "node:crypto";
import type { CreateNextMonthProposalRequest, MonthlyQuestionReview, MonthlyReview, NextMonthProposal } from "./monthly-review-contracts";
import { appendObservationAudit, hashObservationPayload, readV5ObservationState, updateV5ObservationState } from "./observation-repository";
import { readObservationReferenceSnapshot } from "./observation-reference-adapter";
import { assertMonth, assertObservationMutationContext, ObservationServiceError } from "./observation-service";

function getNextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthlyReview(month: string): Promise<MonthlyReview> {
  assertMonth(month);
  const [state, reference] = await Promise.all([readV5ObservationState(), readObservationReferenceSnapshot()]);
  const tasks = Object.values(state.tasks).filter((task) => task.createdAt.startsWith(month));
  const published = reference.publishedContent.filter((item) => item.publishedAt.startsWith(month));
  const plans = reference.monthlyPlans.filter((item) => item.month === month);
  const questionKeys = new Set([
    ...plans.flatMap((item) => item.questionKeys),
    ...published.map((item) => item.questionKey),
    ...tasks.map((item) => item.questionKey)
  ]);
  const questions: MonthlyQuestionReview[] = Array.from(questionKeys).map((questionKey) => {
    const referenceQuestion = reference.questions.find((item) => item.questionKey === questionKey);
    const questionTasks = tasks.filter((task) => task.questionKey === questionKey);
    const questionPublished = published.filter((item) => item.questionKey === questionKey);
    const monthlyPlans = plans.filter((item) => item.questionKeys.includes(questionKey));
    const confirmedGapCodes = Array.from(
      new Set(
        questionTasks.flatMap((task) => {
          const answerId = task.answerId;
          if (!answerId) return [];
          return Object.values(state.gaps)
            .filter((gap) => gap.answerId === answerId && gap.status === "confirmed")
            .map((gap) => gap.code);
        })
      )
    );
    const completedTasks = questionTasks.filter((task) => task.status === "completed");
    const entityMentionCount = completedTasks.filter((task) => task.answerId && state.answers[task.answerId]?.targetEntityMentioned).length;
    const recommendation = confirmedGapCodes.includes("evidence_gap")
      ? "先补公开证据，再由下月 MonthlyPlan 判断是否安排内容。"
      : confirmedGapCodes.some((code) => code === "entity_gap" || code === "citation_gap" || code === "answer_coverage_gap")
        ? "形成内容候选 Proposal，由下月计划人工审批。"
        : "继续按需执行单次测试，不预设周期采集。";
    return {
      id: `monthly-question-review-${month}-${hashObservationPayload(questionKey).slice(0, 10)}`,
      month,
      questionKey,
      questionText: referenceQuestion?.text || questionTasks[0]?.questionText || questionKey,
      monthlyPlanIds: monthlyPlans.map((item) => item.monthlyPlanId),
      plannedContentCount: monthlyPlans.reduce((sum, item) => sum + item.plannedContentCount, 0),
      publishedContent: questionPublished.map(({ contentId, title, channel, publishedAt, metricSummary }) => ({
        contentId,
        title,
        channel,
        publishedAt,
        metricSummary
      })),
      captureTaskIds: questionTasks.map((item) => item.id),
      captureSummary: completedTasks.length
        ? `${completedTasks.length} 次有效采集，${entityMentionCount} 次出现目标实体。`
        : "本月尚无完成的 AI 前台测试。",
      confirmedGapCodes,
      recommendation,
      dataStatus: reference.source === "pending_config" ? "pending_config" : questionPublished.length && completedTasks.length ? "complete" : "partial"
    };
  });
  const proposals = Object.values(state.proposals)
    .filter((item) => item.sourceMonth === month)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const review: MonthlyReview = {
    id: `monthly-review-${month}`,
    month,
    dataAsOf: new Date().toISOString(),
    source: reference.source,
    metrics: {
      plannedContent: plans.reduce((sum, item) => sum + item.plannedContentCount, 0),
      publishedContent: published.length,
      effectiveMetricReturns: published.filter((item) => Boolean(item.metricSummary)).length,
      captureTasks: tasks.length,
      pendingGaps: Object.values(state.gaps).filter((item) => item.status === "candidate" && state.answers[item.answerId]?.createdAt.startsWith(month)).length
    },
    questions,
    proposals,
    message: reference.message
  };
  return review;
}

export async function createNextMonthProposal(month: string, input: CreateNextMonthProposalRequest): Promise<NextMonthProposal> {
  assertMonth(month);
  assertObservationMutationContext(input);
  const review = await getMonthlyReview(month);
  const question = review.questions.find((item) => item.id === input.questionReviewId);
  if (!question) throw new ObservationServiceError(404, "MONTHLY_QUESTION_REVIEW_NOT_FOUND", "未找到对应的问题级月度复盘。");
  if (!input.recommendation.trim() || !input.rationale.trim()) {
    throw new ObservationServiceError(422, "PROPOSAL_CONTENT_REQUIRED", "请填写下月建议和形成依据。");
  }
  return updateV5ObservationState((state) => {
    const duplicate = Object.values(state.proposals).find(
      (item) => item.sourceMonthlyReviewId === review.id && item.questionKey === question.questionKey && item.status === "proposal"
    );
    if (duplicate) return duplicate;
    const proposal: NextMonthProposal = {
      id: `next-month-proposal-${randomUUID()}`,
      version: 1,
      sourceMonthlyReviewId: review.id,
      sourceMonth: month,
      targetMonth: getNextMonth(month),
      questionKey: question.questionKey,
      recommendation: input.recommendation.trim(),
      rationale: input.rationale.trim(),
      status: "proposal",
      monthlyTaskCreated: false,
      quotaChanged: false,
      createdAt: new Date().toISOString(),
      createdBy: input.actor.actorId
    };
    state.proposals[proposal.id] = proposal;
    appendObservationAudit(state, {
      event: "next_month_proposal_created",
      objectType: "NextMonthProposal",
      objectId: proposal.id,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      reason: input.reason,
      sourceIds: [review.id, question.questionKey],
      beforeVersion: 0,
      afterVersion: 1
    });
    return proposal;
  });
}
