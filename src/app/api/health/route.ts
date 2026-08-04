import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { callEmbeddingProvider } from "@/lib/embedding-provider";
import type { KnowledgeEmbeddingModelProvider } from "@/lib/types";
import { getOpenSearchAuthorizationHeader, getRagInfrastructureStatus } from "@/lib/v5/rag/infrastructure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Probe = { status: "ready" | "degraded" | "failed" | "pending_config"; latencyMs?: number; message?: string; [key: string]: unknown };

async function probeMysql(): Promise<Probe> {
  const startedAt = Date.now();
  const infra = getRagInfrastructureStatus();
  if (infra.mysql.status !== "ready") return { status: "pending_config", message: "MySQL environment is incomplete." };
  let connection: Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      connectTimeout: 5_000
    });
    await connection.query("SELECT 1");
    let queues: Record<string, number> | undefined;
    try {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT status, COUNT(*) AS total FROM rag_index_job GROUP BY status");
      queues = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.total)]));
    } catch {
      // Core profile may be healthy before the optional RAG migration exists.
    }
    return { status: "ready", latencyMs: Date.now() - startedAt, ...(queues ? { ragJobs: queues } : {}) };
  } catch (error) {
    return { status: "failed", latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : "MySQL probe failed." };
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

async function probeOpenSearch(required: boolean): Promise<Probe> {
  const startedAt = Date.now();
  const infra = getRagInfrastructureStatus();
  if (infra.opensearch.status !== "ready") return { status: required ? "pending_config" : "degraded", message: "OpenSearch is not configured for this profile." };
  try {
    const authorization = getOpenSearchAuthorizationHeader();
    const baseUrl = process.env.OPENSEARCH_URL!.replace(/\/$/, "");
    const [clusterResponse, aliasesResponse] = await Promise.all([
      fetch(`${baseUrl}/_cluster/health`, { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(5_000) }),
      fetch(`${baseUrl}/_cat/aliases/*-active?format=json&h=alias,index`, { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(5_000) })
    ]);
    if (!clusterResponse.ok) throw new Error(`OpenSearch health returned HTTP ${clusterResponse.status}.`);
    const cluster = await clusterResponse.json() as { status?: string; number_of_nodes?: number };
    const aliases = aliasesResponse.ok ? await aliasesResponse.json() as Array<{ alias?: string; index?: string }> : [];
    const status = cluster.status === "red" ? "failed" : "ready";
    return {
      status,
      latencyMs: Date.now() - startedAt,
      clusterStatus: cluster.status,
      nodes: cluster.number_of_nodes,
      activeAliases: aliases.map((item) => ({ alias: item.alias, index: item.index }))
    };
  } catch (error) {
    return { status: "failed", latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : "OpenSearch probe failed." };
  }
}

async function probeEmbedding(deep: boolean, required: boolean): Promise<Probe> {
  const infra = getRagInfrastructureStatus();
  if (infra.embedding.status !== "ready" || !infra.embedding.provider) {
    return { status: required ? "pending_config" : "degraded", message: "Embedding provider is not configured for this profile." };
  }
  if (!deep) return { status: "ready", mode: "configuration", provider: infra.embedding.provider, model: infra.embedding.model };
  const startedAt = Date.now();
  const result = await callEmbeddingProvider({ provider: infra.embedding.provider as KnowledgeEmbeddingModelProvider, input: "health probe" });
  return {
    status: result.ok ? "ready" : result.status === "pending_config" ? "pending_config" : "failed",
    latencyMs: Date.now() - startedAt,
    mode: "live_request",
    provider: result.provider,
    model: result.model || infra.embedding.model,
    ...(result.errorMessage ? { message: result.errorMessage } : {})
  };
}

async function probeWorkers(required: boolean): Promise<Probe> {
  const directory = process.env.WORKER_STATUS_DIR?.trim() || "/app/runtime/worker-status";
  const maximumAgeMs = Number(process.env.WORKER_HEALTH_MAX_AGE_SECONDS || 45) * 1000;
  const expected = ["rag-index-worker", "knowledge-worker", "content-worker", "publish-worker"];
  try {
    const files: string[] = await readdir(directory).catch(() => [] as string[]);
    const records = await Promise.all(expected.map(async (role) => {
      if (!files.includes(`${role}.json`)) return { role, status: "missing" };
      try {
        const payload = JSON.parse(await readFile(join(directory, `${role}.json`), "utf8"));
        const ageMs = Date.now() - Date.parse(payload.heartbeatAt);
        return { role, status: payload.status === "running" && ageMs <= maximumAgeMs ? "ready" : "stale", ageMs, jobs: payload.jobs || [] };
      } catch {
        return { role, status: "invalid" };
      }
    }));
    const ready = records.every((record) => record.status === "ready");
    return { status: ready ? "ready" : required ? "failed" : "degraded", workers: records };
  } catch (error) {
    return { status: required ? "failed" : "degraded", message: error instanceof Error ? error.message : "Worker status probe failed." };
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const profile = process.env.DEPLOYMENT_PROFILE === "full" ? "full" : "core";
  const webOnly = request.nextUrl.searchParams.get("scope") === "web";
  const deep = request.nextUrl.searchParams.get("deep") === "true";
  const fullRequired = profile === "full" && !webOnly;
  const [mysqlProbe, openSearchProbe, embeddingProbe, workerProbe] = await Promise.all([
    probeMysql(),
    probeOpenSearch(fullRequired),
    probeEmbedding(deep, fullRequired),
    probeWorkers(fullRequired)
  ]);
  const required = webOnly ? [mysqlProbe] : fullRequired ? [mysqlProbe, openSearchProbe, embeddingProbe, workerProbe] : [mysqlProbe];
  const ok = required.every((probe) => probe.status === "ready");
  const payload = {
    ok,
    status: ok ? "ready" : "degraded",
    profile,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    services: { mysql: mysqlProbe, opensearch: openSearchProbe, embedding: embeddingProbe, workers: workerProbe }
  };
  return NextResponse.json(payload, { status: ok || !webOnly ? 200 : 503, headers: { "cache-control": "no-store" } });
}
