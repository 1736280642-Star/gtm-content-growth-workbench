import type { WorkbenchState } from "../workbench-store";
import { createLocalJsonRepository } from "./local-json";
import { createMySqlBridgeRepository } from "./mysql-bridge";
import type { WorkbenchRepository } from "./types";

let repository: WorkbenchRepository | undefined;

export function getWorkbenchRepository(createInitialState: () => WorkbenchState, normalizeState: (state: Partial<WorkbenchState>) => WorkbenchState) {
  if (!repository) {
    const hasMySqlEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"].every((name) => Boolean(process.env[name]?.trim()));
    const storageMode = process.env.WORKBENCH_STORAGE || (hasMySqlEnv ? "mysql" : "local_json");

    repository = storageMode === "mysql" ? createMySqlBridgeRepository(createInitialState, normalizeState) : createLocalJsonRepository(createInitialState, normalizeState);
  }

  return repository;
}
