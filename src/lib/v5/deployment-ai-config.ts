import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { V5GovernanceServiceError } from "./knowledge-governance-service";

const CONFIG_FILE_NAME = "deployment-ai-config.enc.json";
const MAX_PASTE_LENGTH = 64_000;

export const deploymentAiConfigNames = [
  "DASHSCOPE_API_KEY",
  "QWEN_MODEL",
  "QWEN_BASE_URL",
  "QWEN_EMBEDDING_MODEL",
  "QWEN_EMBEDDING_BASE_URL",
  "GEO_RESEARCH_ZHIPU_API_KEY",
  "GEO_RESEARCH_ZHIPU_MODEL",
  "GEO_RESEARCH_ZHIPU_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_BASE_URL",
  "DOUBAO_API_KEY",
  "DOUBAO_MODEL",
  "DOUBAO_BASE_URL",
  "DOUBAO_EMBEDDING_MODEL",
  "DOUBAO_EMBEDDING_BASE_URL",
  "GEO_RESEARCH_DOUBAO_API_KEY",
  "GEO_RESEARCH_DOUBAO_MODEL",
  "GEO_RESEARCH_DOUBAO_BASE_URL",
  "GEO_RESEARCH_QWEN_API_KEY",
  "GEO_RESEARCH_QWEN_MODEL",
  "GEO_RESEARCH_QWEN_BASE_URL",
  "RAG_EMBEDDING_PROVIDER"
] as const;

export type DeploymentAiConfigName = (typeof deploymentAiConfigNames)[number];

const allowedNames = new Set<string>(deploymentAiConfigNames);
const requiredNames: DeploymentAiConfigName[] = ["DASHSCOPE_API_KEY", "GEO_RESEARCH_ZHIPU_API_KEY"];
const defaults: Partial<Record<DeploymentAiConfigName, string>> = {
  QWEN_MODEL: "qwen-plus",
  QWEN_EMBEDDING_MODEL: "text-embedding-v3",
  GEO_RESEARCH_ZHIPU_MODEL: "glm-4-air",
  RAG_EMBEDDING_PROVIDER: "qwen_embedding"
};

interface EncryptedEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface StoredAiConfig {
  version: number;
  updatedAt: string;
  values: Partial<Record<DeploymentAiConfigName, string>>;
}

let cache: { mtimeMs: number; config: StoredAiConfig } | undefined;

function configPath() {
  const runtimeDirectory = process.env.WORKER_STATUS_DIR?.trim()
    || path.join(process.cwd(), "runtime", "worker-status");
  return path.join(runtimeDirectory, CONFIG_FILE_NAME);
}

function encryptionKey() {
  const configured = process.env.HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new V5GovernanceServiceError(
      "HOSTED_AI_CONFIG_ENCRYPTION_KEY_MISSING",
      "尚未配置服务端凭证加密密钥。",
      503,
      "先在 .env.local 配置 HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY 并重启一次；之后 AI Key 可直接在首页更新。"
    );
  }
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new V5GovernanceServiceError(
      "HOSTED_AI_CONFIG_ENCRYPTION_KEY_INVALID",
      "服务端凭证加密密钥格式无效。",
      503,
      "HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY 必须是 64 位 hex 或 32 字节 base64。"
    );
  }
  return key;
}

function encrypt(config: StoredAiConfig): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt(text: string): StoredAiConfig {
  const envelope = JSON.parse(text) as EncryptedEnvelope;
  if (envelope.version !== 1) throw new Error("unsupported deployment AI config envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext) as StoredAiConfig;
}

function readStoredConfig(): StoredAiConfig | undefined {
  try {
    const target = configPath();
    const metadata = statSync(target);
    if (cache?.mtimeMs === metadata.mtimeMs) return cache.config;
    const config = decrypt(readFileSync(target, "utf8"));
    cache = { mtimeMs: metadata.mtimeMs, config };
    return config;
  } catch {
    return undefined;
  }
}

function cleanValue(raw: string) {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function parsePastedConfig(raw: string) {
  if (!raw.trim()) {
    throw new V5GovernanceServiceError("HOSTED_AI_CONFIG_EMPTY", "请先粘贴至少一条 Provider 配置。", 400);
  }
  if (raw.length > MAX_PASTE_LENGTH) {
    throw new V5GovernanceServiceError("HOSTED_AI_CONFIG_TOO_LARGE", "粘贴内容过长，请只保留 AI Provider 配置。", 413);
  }
  const values: Partial<Record<DeploymentAiConfigName, string>> = {};
  const ignored: string[] = [];
  for (const originalLine of raw.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().replace(/^export\s+/, "");
    if (!allowedNames.has(name)) {
      ignored.push(name);
      continue;
    }
    const value = cleanValue(line.slice(separator + 1));
    if (value) values[name as DeploymentAiConfigName] = value;
  }
  if (!Object.keys(values).length) {
    throw new V5GovernanceServiceError(
      "HOSTED_AI_CONFIG_NOT_RECOGNIZED",
      "没有识别到可保存的 AI Provider 配置。",
      400,
      "请使用 KEY=value 格式，例如 DASHSCOPE_API_KEY=你的值。"
    );
  }
  return { values, ignored: [...new Set(ignored)].slice(0, 20) };
}

export function getDeploymentRuntimeValue(name: string) {
  const stored = readStoredConfig()?.values[name as DeploymentAiConfigName]?.trim();
  return stored || process.env[name]?.trim();
}

export function getDeploymentRuntimeEnvironment(): NodeJS.ProcessEnv {
  const stored = readStoredConfig()?.values || {};
  return { ...process.env, ...stored };
}

export function getDeploymentAiConfigStatus() {
  const environment = getDeploymentRuntimeEnvironment();
  const configured = deploymentAiConfigNames.filter((name) => Boolean(environment[name]?.trim()));
  const missingRequired = requiredNames.filter((name) => !environment[name]?.trim());
  return {
    configured,
    missingRequired,
    ready: missingRequired.length === 0,
    updatedAt: readStoredConfig()?.updatedAt
  };
}

export function saveDeploymentAiConfig(raw: string) {
  const parsed = parsePastedConfig(raw);
  const previous = readStoredConfig();
  const values = { ...defaults, ...(previous?.values || {}), ...parsed.values };
  const config: StoredAiConfig = {
    version: (previous?.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    values
  };
  const target = configPath();
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(encrypt(config)), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  cache = undefined;
  return { ...getDeploymentAiConfigStatus(), ignored: parsed.ignored };
}
