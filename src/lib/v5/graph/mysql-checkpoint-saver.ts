import type { RowDataPacket } from "mysql2/promise";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getV5GovernancePool } from "../knowledge-governance-repository";

function requiredString(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > 191) throw new Error(`invalid_${field}`);
  return value;
}

function checkpointConfig(config: RunnableConfig, requireCheckpoint = false) {
  const threadId = requiredString(config.configurable?.thread_id, "thread_id");
  const checkpointNs = requiredString(config.configurable?.checkpoint_ns ?? "", "checkpoint_ns", true);
  const rawCheckpointId = config.configurable?.checkpoint_id;
  const checkpointId = rawCheckpointId === undefined ? undefined : requiredString(rawCheckpointId, "checkpoint_id");
  if (requireCheckpoint && !checkpointId) throw new Error("checkpoint_id_required");
  return { threadId, checkpointNs, checkpointId };
}

async function serialize(saver: BaseCheckpointSaver, value: unknown) {
  const [type, bytes] = await saver.serde.dumpsTyped(value);
  return { type, bytes: Buffer.from(bytes) };
}

export class MySqlCheckpointSaver extends BaseCheckpointSaver {
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = checkpointConfig(config);
    const pool = getV5GovernancePool();
    const [rows] = await pool.query<RowDataPacket[]>(
      checkpointId
        ? "SELECT * FROM langgraph_checkpoint WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? LIMIT 1"
        : "SELECT * FROM langgraph_checkpoint WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1",
      checkpointId ? [threadId, checkpointNs, checkpointId] : [threadId, checkpointNs]
    );
    const row = rows[0];
    if (!row) return undefined;
    const resolvedCheckpointId = String(row.checkpoint_id);
    const [writeRows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM langgraph_checkpoint_write WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? ORDER BY task_id, write_index",
      [threadId, checkpointNs, resolvedCheckpointId]
    );
    const pendingWrites = await Promise.all(writeRows.map(async (write) => [
      String(write.task_id),
      String(write.channel),
      await this.serde.loadsTyped(String(write.value_type), write.value_blob as Buffer)
    ] as [string, string, unknown]));
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: resolvedCheckpointId } },
      checkpoint: await this.serde.loadsTyped(String(row.checkpoint_type), row.checkpoint_blob as Buffer) as Checkpoint,
      metadata: await this.serde.loadsTyped(String(row.metadata_type), row.metadata_blob as Buffer) as CheckpointMetadata,
      pendingWrites
    };
    if (row.parent_checkpoint_id) tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: String(row.parent_checkpoint_id) } };
    return tuple;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs, checkpointId } = checkpointConfig(config);
    const beforeId = options?.before?.configurable?.checkpoint_id;
    const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT checkpoint_id FROM langgraph_checkpoint
       WHERE thread_id = ? AND checkpoint_ns = ?
         AND (? IS NULL OR checkpoint_id = ?)
         AND (? IS NULL OR checkpoint_id < ?)
       ORDER BY created_at DESC, checkpoint_id DESC
       LIMIT ?`,
      [threadId, checkpointNs, checkpointId || null, checkpointId || null, beforeId || null, beforeId || null, Math.max(0, options?.limit ?? 100)]
    );
    for (const row of rows) {
      const tuple = await this.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: String(row.checkpoint_id) } });
      if (!tuple) continue;
      if (options?.filter && !Object.entries(options.filter).every(([key, value]) => tuple.metadata?.[key] === value)) continue;
      yield tuple;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const { threadId, checkpointNs, checkpointId: parentCheckpointId } = checkpointConfig(config);
    const [serializedCheckpoint, serializedMetadata] = await Promise.all([serialize(this, checkpoint), serialize(this, metadata)]);
    await getV5GovernancePool().query(
      `INSERT INTO langgraph_checkpoint
       (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_type, checkpoint_blob, metadata_type, metadata_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE parent_checkpoint_id = VALUES(parent_checkpoint_id), checkpoint_type = VALUES(checkpoint_type),
         checkpoint_blob = VALUES(checkpoint_blob), metadata_type = VALUES(metadata_type), metadata_blob = VALUES(metadata_blob)`,
      [threadId, checkpointNs, checkpoint.id, parentCheckpointId || null, serializedCheckpoint.type, serializedCheckpoint.bytes, serializedMetadata.type, serializedMetadata.bytes]
    );
    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { threadId, checkpointNs, checkpointId } = checkpointConfig(config, true);
    for (const [[channel, value], position] of writes.map((write, index) => [write, index] as const)) {
      const writeIndex = WRITES_IDX_MAP[channel] ?? position;
      const serialized = await serialize(this, value);
      await getV5GovernancePool().query(
        `INSERT INTO langgraph_checkpoint_write
         (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index, channel, value_type, value_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           channel = IF(write_index < 0, VALUES(channel), channel),
           value_type = IF(write_index < 0, VALUES(value_type), value_type),
           value_blob = IF(write_index < 0, VALUES(value_blob), value_blob)`,
        [threadId, checkpointNs, checkpointId, taskId, writeIndex, channel, serialized.type, serialized.bytes]
      );
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    requiredString(threadId, "thread_id");
    const connection = await getV5GovernancePool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM langgraph_checkpoint_write WHERE thread_id = ?", [threadId]);
      await connection.query("DELETE FROM langgraph_checkpoint WHERE thread_id = ?", [threadId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
}
