import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { WorkbenchState } from "../workbench-store";
import type { WorkbenchRepository } from "./types";

const bridgeTimeoutMs = Number(process.env.MYSQL_BRIDGE_TIMEOUT_MS || 15000);

interface BridgeResponse<T> {
  ok: boolean;
  found?: boolean;
  state?: T;
  message?: string;
  missingEnv?: string[];
}

function callBridge<T>(action: "read" | "write", payload?: unknown): BridgeResponse<T> {
  const scriptPath = join(process.cwd(), "scripts/mysql-state-store.mjs");
  const output = execFileSync(process.execPath, [scriptPath, action], {
    input: payload === undefined ? undefined : `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    env: process.env,
    timeout: bridgeTimeoutMs
  });

  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);

  if (!line) {
    return { ok: false, message: "Empty MySQL bridge response" };
  }

  return JSON.parse(line) as BridgeResponse<T>;
}

export function createMySqlBridgeRepository(
  createInitialState: () => WorkbenchState,
  normalizeState: (state: Partial<WorkbenchState>) => WorkbenchState
): WorkbenchRepository {
  return {
    storage: "mysql",
    read() {
      const response = callBridge<WorkbenchState>("read");

      if (!response.ok) {
        throw new Error(response.message || "Failed to read MySQL state");
      }

      if (!response.found || !response.state) {
        const initialState = createInitialState();
        this.write(initialState);
        return initialState;
      }

      return normalizeState(response.state);
    },
    write(state) {
      const response = callBridge("write", { state });

      if (!response.ok) {
        throw new Error(response.message || "Failed to write MySQL state");
      }

      return state;
    }
  };
}
