import { botVisits, geoResults, publishRecords, tasks, weeklyPlan } from "./demo-data";

export function getDashboardSummary() {
  const generated = tasks.filter((task) =>
    ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)
  ).length;
  const approved = tasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = publishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = publishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    weeklyPlan,
    metrics: {
      targetTotal: weeklyPlan.targetTotalCount,
      generated,
      approved,
      published,
      pendingUrl,
      geoHitRate: `${geoResults.filter((item) => item.mentionedJoto).length}/${geoResults.length}`,
      aiBotPv: botVisits.reduce((sum, item) => sum + item.pv, 0)
    }
  };
}

