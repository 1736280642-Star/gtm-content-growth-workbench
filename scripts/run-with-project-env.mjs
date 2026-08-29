import process from "node:process";
import { spawn } from "node:child_process";
import { loadProjectEnv } from "./load-project-env.mjs";

const [command, ...argumentsList] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/run-with-project-env.mjs <command> [...arguments]");
  process.exit(2);
}

loadProjectEnv();
const child = spawn(command, argumentsList, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Unable to start project companion: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
