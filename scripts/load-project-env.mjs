import process from "node:process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

export function loadProjectEnv() {
  if (loaded) {
    return;
  }

  const envPath = join(process.cwd(), ".env.local");

  if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  loaded = true;
}
