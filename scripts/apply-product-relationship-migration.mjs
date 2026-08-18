import mysql from "mysql2/promise";

const required = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing database configuration: ${missing.join(", ")}`);

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});

try {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_entity' AND COLUMN_NAME = 'entity_relationship'`,
    [process.env.MYSQL_DATABASE]
  );
  if (!columns.length) {
    await connection.query(
      "ALTER TABLE product_entity ADD COLUMN entity_relationship TEXT NULL AFTER product_category"
    );
  }
  const [result] = await connection.execute(
    `UPDATE product_entity
     SET canonical_name = 'WorkBuddy', display_name = 'WorkBuddy', brand_name = '腾讯', official_entity = '腾讯',
         entity_relationship = COALESCE(NULLIF(entity_relationship, ''),
           'WorkBuddy 和腾讯云 ADP 均属于腾讯旗下产品；JOTO 提供 WorkBuddy 专项落地服务。'),
         aliases = JSON_ARRAY('WorkBuddy', 'JOTO WorkBuddy'), confirmed_at = NOW(), row_version = row_version + 1
     WHERE id = 'joto-workbuddy' AND canonical_name = 'WorkBuddy x JOTO'`
  );
  process.stdout.write(`${JSON.stringify({ ok: true, updatedRows: result.affectedRows })}\n`);
} finally {
  await connection.end();
}
