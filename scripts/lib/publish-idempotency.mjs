import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function readLedger(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeLedger(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createPublishIdempotencyLedger(filePath) {
  return {
    get(idempotencyKey) {
      return readLedger(filePath)[idempotencyKey];
    },

    begin(idempotencyKey, metadata) {
      const ledger = readLedger(filePath);
      if (ledger[idempotencyKey]) return { created: false, record: ledger[idempotencyKey] };

      const record = {
        ...metadata,
        status: "publishing",
        startedAt: new Date().toISOString()
      };
      ledger[idempotencyKey] = record;
      writeLedger(filePath, ledger);
      return { created: true, record };
    },

    complete(idempotencyKey, result) {
      const ledger = readLedger(filePath);
      const record = {
        ...(ledger[idempotencyKey] || {}),
        result,
        status: result.status || "failed",
        finishedAt: new Date().toISOString()
      };
      ledger[idempotencyKey] = record;
      writeLedger(filePath, ledger);
      return record;
    }
  };
}
