import { timingSafeEqual } from "node:crypto";
import { V5GovernanceRepositoryError } from "./knowledge-governance-repository";

export const DEPLOYMENT_CAPTURE_WORKSPACE_ID = "deployment-shared-capture";
export const DEPLOYMENT_CAPTURE_USER_ID = "deployment-capture-operator";

export function requireHostedCaptureSetupToken(submitted: string) {
  const expected = process.env.HOSTED_CAPTURE_SETUP_TOKEN?.trim();
  if (!expected) {
    throw new V5GovernanceRepositoryError(
      "hosted_capture_setup_token_missing",
      "部署级 AI 采集设置口令尚未配置。",
      503,
      "请在部署环境配置 HOSTED_CAPTURE_SETUP_TOKEN 并重新部署。"
    );
  }
  const submittedBuffer = Buffer.from(submitted.trim());
  const expectedBuffer = Buffer.from(expected);
  if (submittedBuffer.length !== expectedBuffer.length || !timingSafeEqual(submittedBuffer, expectedBuffer)) {
    throw new V5GovernanceRepositoryError("hosted_capture_setup_token_invalid", "部署级 AI 采集设置口令无效。", 403);
  }
}
