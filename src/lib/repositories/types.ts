import type { WorkbenchState } from "../workbench-store";

export interface WorkbenchRepository {
  storage: "local_json" | "mysql";
  read(): WorkbenchState;
  write(state: WorkbenchState): WorkbenchState;
}
