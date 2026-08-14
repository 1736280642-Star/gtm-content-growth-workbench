import { randomUUID } from "node:crypto";
import type { CreateNextMonthProposalRequest, MonthlyQuestionReview, MonthlyReview, NextMonthProposal } from "./monthly-review-contracts";
import { appendObservationAudit, hashObservationPayload, readV5ObservationState, updateV5ObservationState } from "./observation-repository";
import { readObservationReferenceSnapshot } from "./observation-reference-adapter";
import { assertMonth, assertObservationMutationContext, ObservationServiceError } from "./observation-service";
import { listFormalCaptureObservations } from "./capture-repository";
import { listApprovedGeoMonitoringQuestions } from "./question-service";

function getNextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthlyReview(month: string): Promise<MonthlyReview> {
  assertMonth(month);
  const [state, reference] = await Promise.all([readV5ObservationState(), readObservationReferenceSnapshot()]);
  const approvedQuestions = listApprovedGeoMonitoringQuestions();
  const formalCapture = reference.source === "formal_adapter" ? await listFormalCaptureObservations() : [];
  const normalizeFormalTask = (item: (typeof formalCapture)[number]) => ({
    ...item.task,
    questionKey: item.task.questionVersionId
      ? reference.questions.find((question) => question.questionVersionId === item.task.questionVersionId)?.questionKey || item.task.questionKey
      : item.task.questionKey
  });
  const allTasks = reference.source === "formal_adapter"
    ? formalCapture.map(normalizeFormalTask)
    : Object.values(state.tasks);
  const tasks = reference.source === "formal_adapter"
    ? formalCapture.filter((item) => item.task.createdAt.startsWith(month)).map(normalizeFormalTask)
    : Object.values(state.tasks).filter((task) => task.createdAt.startsWith(month));
  const answers = reference.source === "formal_adapter"
    ? Object.fromEntries(formalCapture.flatMap((item) => item.answer ? [[item.answer.id, item.answer] as const] : []))
    : state.answers;
  const gaps = reference.source === "formal_adapter"
    ? Object.fromEntries(formalCapture.flatMap((item) => item.gaps.map((gap) => [gap.id, gap] as const)))
    : state.gaps;
  const published = reference.publishedContent.filter((item) => item.publishedAt.startsWith(month));
  const plans = reference.monthlyPlans.filter((item) => item.month === month);
  const questionKeys = new Set([
    ...approvedQuestions.map((item) => item.questionId),
    ...plans.flatMap((item) => item.questionKeys),
    ...published.map((item) => item.questionKey),
    ...tasks.map((item) => item.questionKey)
  ]);
  const questions: MonthlyQuestionReview[] = Array.from(questionKeys).map((questionKey) => {
    const approvedQuestion = approvedQuestions.find((item) => item.questionId === questionKey);
    const referenceQuestion = reference.questions.find((item) => item.questionKey === questionKey);
    const questionTasks = tasks.filter((task) => task.questionKey === questionKey);
    const allQuestionTasks = allTasks.filter((task) => task.questionKey === questionKey);
    const questionPublished = published.filter((item) => item.questionKey === questionKey);
    const monthlyPlans = plans.filter((item) => item.questionKeys.includes(questionKey));
    const confirmedGapCodes = Array.from(
      new Set(
        questionTasks.flatMap((task) => {
          const answerId = task.answerId;
          if (!answerId) return [];
          return Object.values(gaps)
            .filter((gap) => gap.answerId === answerId && gap.status === "confirmed")
            .map((gap) => gap.code);
        })
      )
    );
    const completedTasks = questionTasks.filter((task) => task.status === "completed");
    const entityMentionCount = completedTasks.filter((task) => task.answerId && answers[task.answerId]?.targetEntityMentioned).length;
    const lastRetestedAt = allQuestionTasks
      .flatMap((task) => task.answerId && (reference.source === "formal_adapter"
        ? formalCapture.find((item) => item.task.id === task.id)?.answer?.createdAt
        : state.answers[task.answerId]?.createdAt) || [])
      .sort((left, right) => right.localeCompare(left))[0];
    const publishLivenessFailed = questionPublished.some((item) => item.liveness24h === "failed" || item.liveness72h === "failed");
    const livenessObservationComplete = questionPublished.length > 0
      && questionPublished.every((item) => item.liveness72h && item.liveness72h !== "pending");
    const recommendation = publishLivenessFailed
      ? "先处理发布存活异常并核验平台回执，不自动增加下月发布配额。"
      : confirmedGapCodes.includes("evidence_gap")
      ? "先补公开证据，再由下月 MonthlyPlan 判断是否安排内容。"
      : confirmedGapCodes.some((code) => code === "entity_gap" || code === "citation_gap" || code === "answer_coverage_gap")
        ? "形成内容候选 Proposal，由下月计划人工审批。"
        : "继续按需执行单次测试，不预设周期采集。";
    return {
      id: `monthly-question-review-${month}-${hashObservationPayload(questionKey).slice(0, 10)}`,
      month,
      questionKey,
      questionText: approvedQuestion?.currentVersion.text || referenceQuestion?.text || questionTasks[0]?.questionText || questionKey,
      geoMonitoringApproved: Boolean(approvedQuestion),
      monthlyPlanIds: monthlyPlans.map((item) => item.monthlyPlanId),
      plannedContentCount: monthlyPlans.reduce((sum, item) => sum + item.plannedContentCount, 0),
      publishedContent: questionPublished.map(({ contentId, title, channel, publishedAt, publicUrl, publishScheduleId, liveness24h, liveness72h, removedAt, hasMetricReturn, metricSummary }) => ({
        contentId,
        title,
        channel,
        publishedAt,
        publicUrl,
        publishScheduleId,
        liveness24h,
        liveness72h,
        removedAt,
        hasMetricReturn,
        metricSummary
      })),
      captureTaskIds: questionTasks.map((item) => item.id),
      captureSummary: completedTasks.length
        ? `${completedTasks.length} 次有效采集，${entityMentionCount} 次出现目标实体。`
        : "本月尚无完成的 AI 前台测试。",
      lastRetestedAt,
      confirmedGapCodes,
      recommendationEvidenceRefs: [
        ...questionPublished.map((item) => `published_content:${item.contentId}`),
        ...questionPublished.map((item) => `publish_liveness_24h:${item.contentId}:${item.liveness24h || "pending"}`),
        ...questionPublished.map((item) => `publish_liveness_72h:${item.contentId}:${item.liveness72h || "pending"}`),
        ...completedTasks.map((item) => `geo_capture_task:${item.id}`),
        ...completedTasks.flatMap((item) => (item.sourcePublishedContentIds || [])
          .filter((contentId) => questionPublished.some((publishedItem) => publishedItem.contentId === contentId))
          .map((contentId) => `geo_retest_link:${item.id}:${contentId}`)),
        ...confirmedGapCodes.map((code) => `confirmed_gap:${code}`)
      ],
      recommendation,
      dataStatus: reference.source === "pending_config"
        ? "pending_config"
        : questionPublished.length && completedTasks.length && livenessObservationComplete ? "complete" : "partial"
    };
  });
  const proposals = Object.values(state.proposals)
    .filter((item) => item.sourceMonth === month)
    .map((item) => ({ ...item, evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [] }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const review: MonthlyReview = {
    id: `monthly-review-${month}`,
    month,
    dataAsOf: new Date().toISOString(),
    source: reference.source,
    metrics: {
      plannedContent: plans.reduce((sum, item) => sum + item.plannedContentCount, 0),
      publishedContent: published.length,
      effectiveMetricReturns: published.filter((item) => item.hasMetricReturn === true).length,
      survival24hPassed: published.filter((item) => item.liveness24h === "passed").length,
      survival24hEligible: published.filter((item) => item.liveness24h !== "pending").length,
      survival72hPassed: published.filter((item) => item.liveness72h === "passed").length,
      survival72hEligible: published.filter((item) => item.liveness72h !== "pending").length,
      captureTasks: tasks.length,
      pendingGaps: Object.values(gaps).filter((item) => item.status === "candidate" && answers[item.answerId]?.createdAt.startsWith(month)).length
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
  if (question && !question.publishedContent.length) {
    throw new ObservationServiceError(
      409,
      "FORMAL_PUBLISHED_EVIDENCE_REQUIRED",
      "该问题本月没有正式发布内容，不能据此生成下月调整 Proposal。"
    );
  }
  if (!question) throw new ObservationServiceError(404, "MONTHLY_QUESTION_REVIEW_NOT_FOUND", "未找到对应的问题级月度复盘。");
  if (review.source === "formal_adapter" && question.publishedContent.some((item) => item.liveness72h === "pending" || !item.liveness72h)) {
    throw new ObservationServiceError(
      409,
      "FORMAL_LIVENESS_EVIDENCE_PENDING",
      "该问题的正式发布内容尚未完成 72 小时存活观察，不能提前形成下月调整 Proposal。"
    );
  }
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
      evidenceRefs: question.recommendationEvidenceRefs,
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
