import { resolve } from "node:path";

export function labelValue(labels, key) {
  const prefix = `${key}=`;
  return String(labels || "")
    .split(",")
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

export function normalizedPath(value) {
  return resolve(String(value || "")).replace(/\\/g, "/").toLowerCase();
}

export function selectWorkbenchOneoffs(rows, input) {
  const allowedServices = new Set(input.includeWorkers ? ["workbench-web", "content-worker"] : ["workbench-web"]);
  return rows.filter((row) => {
    const labels = row.Labels || row.labels;
    return labelValue(labels, "com.docker.compose.oneoff") === "True"
      && allowedServices.has(labelValue(labels, "com.docker.compose.service"))
      && normalizedPath(labelValue(labels, "com.docker.compose.project.working_dir")) === normalizedPath(input.workingDirectory)
      && Number(row.ageMinutes) >= input.minimumAgeMinutes;
  });
}
