import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD
});

try {
  const [products] = await connection.query(
    "SELECT entity_relationship, strategy_pack_id FROM product_entity WHERE id = 'tencent-adp-joto' LIMIT 1"
  );
  if (!products[0]) throw new Error("adp_product_not_found");
  const [strategies] = await connection.query(
    `SELECT status,
       JSON_UNQUOTE(JSON_EXTRACT(content_plan_json, '$.coreExpressions.fixedExpression')) AS fixed_expression,
       JSON_UNQUOTE(JSON_EXTRACT(content_plan_json, '$.coreExpressions.ctaLabel')) AS cta_label,
       JSON_UNQUOTE(JSON_EXTRACT(content_plan_json, '$.coreExpressions.ctaUrl')) AS cta_url
     FROM product_strategy_packs WHERE id = ? LIMIT 1`,
    [products[0].strategy_pack_id]
  );
  console.log(JSON.stringify({
    entityRelationship: products[0].entity_relationship,
    strategyStatus: strategies[0]?.status,
    fixedExpression: strategies[0]?.fixed_expression,
    ctaLabel: strategies[0]?.cta_label,
    ctaUrl: strategies[0]?.cta_url
  }, null, 2));
} finally {
  await connection.end();
}
