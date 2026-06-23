import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadProjectEnv } from "../scripts/load-project-env.mjs";

loadProjectEnv();

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf("=");

    if (equalsIndex >= 0) {
      const key = rawKey.slice(0, equalsIndex);
      args[key] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      args[rawKey] = next;
      index += 1;
      continue;
    }

    args[rawKey] = true;
  }

  return args;
}

export function getBaseUrl(args) {
  const value = typeof args["base-url"] === "string" ? args["base-url"] : process.env.WORKBENCH_BASE_URL;
  return (value || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

export function parseList(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function readStdinText() {
  if (process.stdin.isTTY) {
    return "";
  }

  return await new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

export async function readTextFromPath(filePath) {
  const resolvedPath = resolve(filePath);
  const text = await readFile(resolvedPath, "utf8");

  return {
    text,
    filePath: resolvedPath,
    fileName: basename(resolvedPath)
  };
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readResponseBody(response, pathName) {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: "failed",
      message: `Non-JSON response from ${pathName}: ${text.slice(0, 200)}`
    };
  }
}

export async function postJson(baseUrl, pathName, payload) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    ok: response.ok,
    body: await readResponseBody(response, pathName)
  };
}

export async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);

  return {
    status: response.status,
    ok: response.ok,
    body: await readResponseBody(response, pathName)
  };
}

export async function postText(baseUrl, pathName, text, contentType = "text/plain; charset=utf-8") {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": contentType
    },
    body: text
  });

  return {
    status: response.status,
    ok: response.ok,
    body: await readResponseBody(response, pathName)
  };
}

export function shouldTreatAsFatal(body, httpStatus = 200) {
  if (body && typeof body === "object") {
    if (body.status === "pending_config" || body.status === "pending_input") {
      return false;
    }

    if (body.status === "failed") {
      return true;
    }
  }

  return httpStatus >= 400;
}
