import { botVisits, publishRecords, tasks } from "./demo-data";

function getSeedMonthRange() {
  const dates = tasks.map((task) => task.publishDate).sort();
  const month = dates[0]?.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);

  return {
    monthStart: `${month}-01`,
    monthEnd: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  };
}

export function getDashboardSummary() {
  const generated = tasks.filter((task) =>
    ["generated", "pending_review", "approved", "queued", "published", "url_filled"].includes(task.status)
  ).length;
  const approved = tasks.filter((task) => ["approved", "queued", "published", "url_filled"].includes(task.status)).length;
  const published = publishRecords.filter((record) => ["published", "url_filled"].includes(record.publishStatus)).length;
  const pendingUrl = publishRecords.filter((record) => record.publishStatus === "published" && !record.publishedUrl).length;

  return {
    period: getSeedMonthRange(),
    metrics: {
      targetTotal: tasks.length,
      generated,
      approved,
      published,
      pendingUrl,
      aiBotPv: botVisits.reduce((sum, item) => sum + item.pv, 0)
    }
  };
}

