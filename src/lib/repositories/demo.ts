import { demoRead, demoWrite } from "../demo/store";
import { demoWorkbenchSeed } from "../demo/fixtures/workbench";
import type { WorkbenchState } from "../workbench-store";
import type { WorkbenchRepository } from "./types";

const WORKBENCH_KEY = "demo:workbench-state";

/**
 * 演示模式主状态仓库：内存读写，冷启动从打包 fixtures 重放。
 * 不做任何 fs / 子进程 / MySQL 访问，保证在 Vercel 只读运行时可用。
 */
export function createDemoRepository(
  _createInitialState: () => WorkbenchState,
  normalizeState: (state: Partial<WorkbenchState>) => WorkbenchState
): WorkbenchRepository {
  return {
    storage: "memory",
    read() {
      return demoRead(WORKBENCH_KEY, () => normalizeState(demoWorkbenchSeed));
    },
    write(state) {
      return demoWrite(WORKBENCH_KEY, state);
    }
  };
}
