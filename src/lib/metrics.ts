import { botVisits, publishRecords, tasks, monthlyPlan } from "./demo-data";

export function getDashboardSummary() {
  const generated = tasks.filter((task) =>
    ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)
  ).length;
  const approved = tasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = publishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = publishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    monthlyPlan,
    metrics: {
      targetTotal: monthlyPlan.targetTotalCount,
      generated,
      approved,
      published,
      pendingUrl,
      aiBotPv: botVisits.reduce((sum, item) => sum + item.pv, 0)
    }
  };
}
