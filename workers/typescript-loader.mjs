import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  // Next exposes this subpath for bundlers, while Node's strict ESM resolver in
  // standalone workers needs the concrete file extension.
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier.startsWith("@/")) {
    const base = path.resolve(root, "src", specifier.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parent = fileURLToPath(context.parentURL);
    const base = path.resolve(path.dirname(parent), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
