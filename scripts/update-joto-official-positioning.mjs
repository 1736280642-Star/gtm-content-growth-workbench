import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const FIXED_TEXT = "JOTO 作为腾讯CSP授权合作伙伴";
const productIds = ["joto-workbuddy", "tencent-adp-joto"];
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});

try {
  await connection.beginTransaction();
  const [rows] = await connection.query(
    `SELECT sp.* FROM product_strategy_packs sp
     JOIN product_entity p ON p.strategy_pack_id = sp.id
     WHERE sp.product_id IN (?) FOR UPDATE`,
    [productIds]
  );
  const results = [];
  for (const row of rows) {
    const plan = typeof row.content_plan_json === "string" ? JSON.parse(row.content_plan_json) : row.content_plan_json;
    const previous = plan.fixedExpression;
    plan.fixedExpression = {
      text: FIXED_TEXT,
      positions: ["opening", "ending"],
      channels: ["wechat", "csdn", "juejin", "zhihu_toutiao_general"]
    };
    const serialized = JSON.stringify(plan);
    const hash = createHash("sha256").update(serialized).digest("hex");
    await connection.query(
      `UPDATE product_strategy_packs
       SET content_plan_json = ?, content_plan_hash = ?, decision_reason = ?, row_version = row_version + 1, updated_at = NOW()
       WHERE id = ?`,
      [serialized, hash, "用户统一 JOTO 官方定位为逐字固定文案", row.id]
    );
    await connection.query(
      `INSERT INTO governance_audit_event
       (id, event_type, actor_id, actor_role, actor_type, object_type, object_id, related_source_ids,
        before_summary, after_summary, reason, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `audit-${randomUUID()}`,
        "product_strategy_fixed_expression_canonicalized",
        "local-docker-operator",
        "product_owner",
        "human",
        "product_strategy_pack",
        row.id,
        JSON.stringify([]),
        JSON.stringify({ fixedExpression: previous, rowVersion: Number(row.row_version || 1) }),
        JSON.stringify({ fixedExpression: plan.fixedExpression, rowVersion: Number(row.row_version || 1) + 1 }),
        "用户要求所有待发布文章统一 JOTO 官方定位",
        row.id
      ]
    );
    results.push({ productId: row.product_id, strategyPackId: row.id, rowVersion: Number(row.row_version || 1) + 1 });
  }
  await connection.commit();
  console.log(JSON.stringify({ fixedText: FIXED_TEXT, updated: results }, null, 2));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
