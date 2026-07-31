import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const args = process.argv.slice(2);
const port = readPort(args);
const env = {
  ...process.env,
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR?.trim() || `.next-dev-${port}`
};

const child = spawn(process.execPath, [nextBin, "dev", ...args], {
  env,
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(`[workbench] Failed to start Next.js: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

function readPort(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--port" || token === "-p") {
      return normalizePort(tokens[index + 1]);
    }
    if (token.startsWith("--port=")) {
      return normalizePort(token.slice("--port=".length));
    }
  }
  return normalizePort(process.env.PORT);
}

function normalizePort(value) {
  const port = Number.parseInt(String(value || "3000"), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
}
