import type { DirectPublishPlatformKey, PlatformPublishPayload, PublishAttemptStatus, PublishFailureCode } from "../types";

export interface AuthStatus {
  ok: boolean;
  status: "ready" | "pending_config" | "auth_required" | "manual_takeover_required" | "failed";
  message: string;
  nextAction: string;
  missingConfig?: string[];
}

export interface ValidationResult {
  ok: boolean;
  message: string;
  nextAction: string;
  failureCode?: PublishFailureCode;
}

export interface PublishResult {
  ok: boolean;
  status: PublishAttemptStatus;
  mode: "mock" | "dry_run" | "real";
  publishStatus?: "submitted" | "confirmed" | "pending_review" | "failed";
  platformArticleId?: string;
  externalTaskId?: string;
  publicUrl?: string;
  idempotencyKey?: string;
  pendingCsvReturn?: boolean;
  failureCode?: PublishFailureCode;
  failureReason?: string;
  nextAction: string;
  diagnosticSummary?: string;
}

export interface VerifyResult {
  ok: boolean;
  status: PublishAttemptStatus;
  verifyStatus: "verified" | "pending" | "failed";
  platformArticleId?: string;
  externalTaskId?: string;
  publicUrl?: string;
  pendingCsvReturn?: boolean;
  failureCode?: PublishFailureCode;
  failureReason?: string;
  nextAction: string;
}

export interface PublishAdapter {
  platform: DirectPublishPlatformKey;
  checkAuth(): Promise<AuthStatus>;
  validatePayload(payload: PlatformPublishPayload): Promise<ValidationResult>;
  publish(payload: PlatformPublishPayload): Promise<PublishResult>;
  verify(result: PublishResult): Promise<VerifyResult>;
}
