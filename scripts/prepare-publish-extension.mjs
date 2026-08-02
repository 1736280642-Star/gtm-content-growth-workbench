import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);

const runtimeRoot =
  process.env.JOTO_PUBLISH_EXTENSION_RUNTIME_DIR ||
  join(process.env.LOCALAPPDATA || join(homedir(), ".joto"), "JotoPublishRunner", "extension");
mkdirSync(runtimeRoot, { recursive: true });
cpSync(join(projectRoot, "publish-extension"), runtimeRoot, { recursive: true, force: true });
process.stdout.write(`${runtimeRoot}\n`);
