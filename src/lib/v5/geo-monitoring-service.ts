import type { CreateGeoMonitoringQuestionRequest, UpdateGeoMonitoringQuestionRequest } from "./geo-monitoring-contracts";
import { hasV5GovernanceDatabaseConfig, V5GovernanceRepositoryError } from "./knowledge-governance-repository";
import { assertObservationMutationContext } from "./observation-service";
import { createGeoMonitoringQuestion, getGeoMonitoringWorkspace, updateGeoMonitoringQuestion } from "./geo-monitoring-repository";

export async function readGeoMonitoringWorkspace(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new V5GovernanceRepositoryError("invalid_month", "month 必须使用 YYYY-MM。", 422);
  if (!hasV5GovernanceDatabaseConfig()) return { source: "pending_config" as const, questions: [], recommendations: [], metrics: [], message: "配置正式 MySQL 后才能启用问题监控；系统不会使用本地模拟结果。" };
  return getGeoMonitoringWorkspace(month);
}

export async function activateGeoMonitoringQuestion(input: CreateGeoMonitoringQuestionRequest) {
  assertObservationMutationContext(input);
  if (!hasV5GovernanceDatabaseConfig()) throw new V5GovernanceRepositoryError("pending_config", "正式 MySQL 尚未配置，不能创建监控问题。", 503);
  return createGeoMonitoringQuestion(input);
}

export async function reviseGeoMonitoringQuestion(id: string, input: UpdateGeoMonitoringQuestionRequest) {
  assertObservationMutationContext(input);
  if (!hasV5GovernanceDatabaseConfig()) throw new V5GovernanceRepositoryError("pending_config", "正式 MySQL 尚未配置，不能修改监控问题。", 503);
  return updateGeoMonitoringQuestion(id, input);
}
