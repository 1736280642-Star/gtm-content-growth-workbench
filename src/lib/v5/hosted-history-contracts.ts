/** User-facing, read-only result snapshots. Never include action tokens or credentials. */
export const hostedHistorySteps = ["research", "strategy", "sample-generation", "sample-review", "publishing"] as const;
export type HostedHistoryStep = typeof hostedHistorySteps[number];
export interface HostedResultContent {
  title: string;
  summary: string;
  sourceId: string;
  sourceVersion: string;
  sections: Array<{ title: string; items: string[] }>;
  article?: { title: string; markdown: string };
  publications?: Array<{ taskId: string; title: string; channel: string; status: string; publicUrl?: string; failureReason?: string; nextAction?: string }>;
}
export interface HostedResultSnapshot extends HostedResultContent {
  resultId: string;
  orderId: string;
  step: HostedHistoryStep;
  createdAt: string;
  decision?: "approve" | "changes_requested";
  comment?: string;
}
export type HostedResultSummary = Pick<HostedResultSnapshot, "resultId" | "orderId" | "step" | "title" | "summary" | "sourceVersion" | "createdAt" | "decision">;
export interface HostedHistoryView {
  order: { orderId: string; productName: string };
  entries: HostedResultSummary[];
  result?: HostedResultSnapshot;
}
export function summarizeHostedResult(result: HostedResultSnapshot): HostedResultSummary {
  const { resultId, orderId, step, title, summary, sourceVersion, createdAt, decision } = result;
  return { resultId, orderId, step, title, summary, sourceVersion, createdAt, decision };
}
export function hostedHistoryHref(orderId: string, step: HostedHistoryStep, resultId?: string) {
  const query = new URLSearchParams({ orderId, step });
  if (resultId) query.set("resultId", resultId);
  return `/hosted/history?${query}`;
}
