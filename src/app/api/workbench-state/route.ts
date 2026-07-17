import { getCurrentWeeklyTasks, readWorkbenchState, type WorkbenchState } from "@/lib/workbench-store";
import type { KnowledgeBase, KnowledgeChunk, KnowledgeSource } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLIENT_CONTENT_PREVIEW_LIMIT = 1200;
const CLIENT_CHUNK_CONTENT_LIMIT = 320;
const CLIENT_CHUNK_LIMIT_PER_KB = 20;
const CLIENT_AUDIT_LOG_LIMIT = 120;

function truncateText(value: string | undefined, limit: number) {
  if (!value || value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n[已截断，完整内容请进入知识库详情查看]`;
}

function summarizeKnowledgeSource(source: KnowledgeSource): KnowledgeSource {
  return {
    ...source,
    rawText: undefined,
    extractedText: "",
    markdown: ""
  };
}

function summarizeKnowledgeChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  return {
    ...chunk,
    content: truncateText(chunk.content, CLIENT_CHUNK_CONTENT_LIMIT) || "",
    embeddingVector: undefined
  };
}

function summarizeKnowledgeBase(knowledgeBase: KnowledgeBase): KnowledgeBase {
  return {
    ...knowledgeBase,
    contentPreview: truncateText(knowledgeBase.contentPreview, CLIENT_CONTENT_PREVIEW_LIMIT),
    sources: knowledgeBase.sources?.map(summarizeKnowledgeSource),
    chunks: knowledgeBase.chunks
      ?.filter((chunk) => chunk.status !== "disabled")
      .slice(0, CLIENT_CHUNK_LIMIT_PER_KB)
      .map(summarizeKnowledgeChunk)
  };
}

function getClientDashboardSummary(state: WorkbenchState) {
  const weeklyTasks = getCurrentWeeklyTasks(state);
  const weeklyTaskIds = new Set(weeklyTasks.map((task) => task.id));
  const weeklyDraftIds = new Set(state.drafts.filter((draft) => weeklyTaskIds.has(draft.taskId)).map((draft) => draft.id));
  const weeklyPublishRecords = state.publishRecords.filter((record) => weeklyDraftIds.has(record.draftId));
  const generated = weeklyTasks.filter((task) => ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const approved = weeklyTasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = weeklyPublishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = weeklyPublishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    weeklyPlan: state.weeklyPlan,
    metrics: {
      targetTotal: state.weeklyPlan.targetTotalCount,
      generated,
      approved,
      published,
      pendingUrl,
      geoHitRate: `${state.geoResults.filter((item) => item.mentionedJoto).length}/${state.geoResults.length}`,
      aiBotPv: state.botVisits.reduce((sum, item) => sum + item.pv, 0)
    },
    dataSource: state.runtime.storage
  };
}

export function GET() {
  const state = readWorkbenchState();
  const clientState = {
    ...state,
    knowledgeBases: state.knowledgeBases.map(summarizeKnowledgeBase),
    auditLog: state.auditLog.slice(0, CLIENT_AUDIT_LOG_LIMIT)
  };

  return NextResponse.json({
    state: clientState,
    summary: getClientDashboardSummary(state)
  });
}
