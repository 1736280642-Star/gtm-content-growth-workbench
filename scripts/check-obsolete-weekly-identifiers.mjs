import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const scanRoots = ["src", "workers", "scripts", "database", "docs", "data"];
const rootFiles = ["README.md", "package.json", "compose.yaml", "compose.dev-3027.yaml"];
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".yaml", ".yml", ".ps1"]);
const ignoredDirectories = new Set(["node_modules", ".git", ".next", ".tmp", "artifacts", "backups", "保存"]);
const obsoleteIdentifiers = [
  ["weekly", "plan"].join("-"),
  ["weekly", "report"].join("-"),
  ["weekly", "review"].join("-"),
  ["Weekly", "Plan"].join(""),
  ["Weekly", "Report"].join(""),
  ["Weekly", "Review"].join(""),
  ["weekly", "Plan"].join(""),
  ["weekly", "Report"].join(""),
  ["weekly", "Review"].join(""),
  ["周", "计划"].join(""),
  ["周", "报"].join(""),
  ["周", "复盘"].join("")
];

const files = [...rootFiles];
for (const directory of scanRoots) await collect(join(root, directory), files);

const failures = [];
for (const file of files) {
  if (file.endsWith("check-obsolete-weekly-identifiers.mjs")) continue;
  const filePath = file.startsWith(root) ? file : join(root, file);
  const relativePath = relative(root, filePath).replaceAll("\\", "/");
  if (relativePath === "data/workbench-state.json" || /^data\/workbench-.*-state\.json$/.test(relativePath)) continue;
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }

  for (const identifier of obsoleteIdentifiers) {
    if (content.includes(identifier)) {
      failures.push(`${relative(root, filePath)}: ${identifier}`);
    }
  }
}

if (failures.length) {
  console.error("Obsolete non-monthly planning or review identifiers found:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Monthly naming check passed (${files.length} maintained files scanned).`);
}

async function collect(directory, target) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(fullPath, target);
    } else if (entry.isFile() && allowedExtensions.has(extname(entry.name))) {
      target.push(fullPath);
    }
  }
}
