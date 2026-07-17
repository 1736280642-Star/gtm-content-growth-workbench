import type { RagIndexSnapshotStatus, RagJobStatus } from "./contracts";

const indexTransitions: Record<RagIndexSnapshotStatus, RagIndexSnapshotStatus[]> = {
  pending_config: ["building", "archived"],
  building: ["validating", "pending_config", "archived"],
  validating: ["ready", "building", "pending_config", "archived"],
  ready: ["active", "archived"],
  active: ["superseded", "rollback_target"],
  superseded: ["rollback_target", "archived"],
  rollback_target: ["active", "archived"],
  archived: []
};

const jobTransitions: Record<RagJobStatus, RagJobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["completed", "partial_failed", "failed", "pending_config", "awaiting_validation", "cancelled"],
  pending_config: ["queued", "cancelled"],
  awaiting_validation: ["completed", "failed", "cancelled"],
  completed: [],
  partial_failed: ["queued", "cancelled"],
  failed: ["queued", "cancelled"],
  cancelled: []
};

export class RagStateTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`${entity} 状态不能从 ${from} 变更为 ${to}。`);
    this.name = "RagStateTransitionError";
  }
}

export function assertRagIndexTransition(from: RagIndexSnapshotStatus, to: RagIndexSnapshotStatus) {
  if (!indexTransitions[from].includes(to)) throw new RagStateTransitionError("IndexSnapshot", from, to);
}

export function assertRagJobTransition(from: RagJobStatus, to: RagJobStatus) {
  if (!jobTransitions[from].includes(to)) throw new RagStateTransitionError("RagJob", from, to);
}
