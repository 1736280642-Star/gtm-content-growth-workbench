import type { WorkbenchState } from "../workbench-store";

export interface WorkbenchRepository {
  storage: "local_json" | "mysql" | "memory";
  read(): WorkbenchState;
  write(state: WorkbenchState): WorkbenchState;
}
