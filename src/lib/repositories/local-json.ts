import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkbenchState } from "../workbench-store";
import type { WorkbenchRepository } from "./types";

export function createLocalJsonRepository(createInitialState: () => WorkbenchState, normalizeState: (state: Partial<WorkbenchState>) => WorkbenchState): WorkbenchRepository {
  const statePath = join(process.cwd(), process.env.WORKBENCH_STATE_PATH || "data/workbench-state.json");

  return {
    storage: "local_json",
    read() {
      if (!existsSync(statePath)) {
        const initialState = createInitialState();
        this.write(initialState);
        return initialState;
      }

      const state = JSON.parse(readFileSync(statePath, "utf8")) as Partial<WorkbenchState>;
      return normalizeState(state);
    },
    write(state) {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      return state;
    }
  };
}
