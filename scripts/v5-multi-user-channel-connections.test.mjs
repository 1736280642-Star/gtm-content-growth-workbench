import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("multi-tenant schema scopes identities, orders, account bindings and executor jobs", async () => {
  const migration = await read("database/migrations/20260821_040_v5_multi_user_channel_connections.sql");
  for (const table of ["hosted_identity_user", "hosted_workspace_member", "publish_account_connection", "channel_authorization_session", "browser_executor_node", "browser_execution_job"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /uq_hosted_order_workspace_idempotency ON hosted_promotion_order \(workspace_id, idempotency_key\)/);
  assert.match(migration, /uq_product_publish_account_workspace_platform ON product_publish_account_binding \(workspace_id, product_id, platform\)/);
  assert.match(migration, /auth_token_hash CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(migration, /cookie|password|access_token/i);
});

test("email login keeps raw tokens out of database and request URLs", async () => {
  const [identity, verifyPage, verifyRoute] = await Promise.all([
    read("src/lib/v5/hosted-identity-service.ts"),
    read("src/app/hosted/login/verify/page.tsx"),
    read("src/app/api/v5/hosted/auth/verify/route.ts")
  ]);
  assert.match(identity, /\/hosted\/login\/verify#token=/);
  assert.match(identity, /sha256\(token\)/);
  assert.match(identity, /HttpOnly/);
  assert.match(verifyPage, /window\.location\.hash/);
  assert.match(verifyPage, /history\.replaceState/);
  assert.match(verifyRoute, /export async function POST/);
  assert.doesNotMatch(verifyRoute, /searchParams\.get\("token"\)/);
});

test("channel connection flow identifies a real public account before binding", async () => {
  const [service, wizard, arcs] = await Promise.all([
    read("src/lib/v5/channel-account-connection-service.ts"),
    read("src/app/hosted/connections/HostedConnectionsWorkspace.tsx"),
    read("arcs-runner/joto_arcs_runner/platforms.py")
  ]);
  assert.match(service, /accountFingerprint: createHash\("sha256"\)/);
  assert.match(service, /status !== "account_detected"/);
  assert.match(service, /workspace_id = \? AND product_id = \? AND platform = \?/);
  assert.match(wizard, /确认用于/);
  assert.match(wizard, /pairing-codes/);
  assert.match(arcs, /def identify_account/);
  assert.match(arcs, /actual_fingerprint != expected_fingerprint/);
  assert.match(arcs, /当前登录账号与工作台确认账号不一致/);
});

test("browser executor uses bearer node identities, leases and durable profile handles", async () => {
  const [pool, worker, runnerServer] = await Promise.all([
    read("src/lib/v5/browser-executor-pool.ts"),
    read("workers/browser-executor-worker.mjs"),
    read("arcs-runner/joto_arcs_runner/server.py")
  ]);
  assert.match(pool, /authorization\.startsWith\("Bearer "\)/);
  assert.match(pool, /lease_expires_at = DATE_ADD\(NOW\(\), INTERVAL 20 MINUTE\)/);
  assert.match(pool, /attempt_count < 3/);
  assert.match(pool, /executeGovernedBrowserOperation/);
  assert.match(worker, /\["publish", "verify"\]/);
  assert.match(worker, /PUBLISH_EXECUTOR_STATE_PATH/);
  assert.match(runnerServer, /governed account connection requires browserProfileRef and accountFingerprint/);
  assert.doesNotMatch(worker, /console\.log\([^\n]*(nodeToken|pairingCode|runnerToken)/);
});

test("hosted mutable order routes require session identity and workspace access", async () => {
  const paths = [
    "src/app/api/v5/hosted/orders/[orderId]/settings/route.ts",
    "src/app/api/v5/hosted/orders/[orderId]/pause/route.ts",
    "src/app/api/v5/hosted/orders/[orderId]/review-email/route.ts",
    "src/app/api/v5/hosted/orders/[orderId]/daily-batches/route.ts"
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /requireHostedIdentity/);
    assert.match(source, /assertWorkspaceOrderAccess/);
  }
});

test("hosted product picker exposes the governed catalog and links only after explicit selection", async () => {
  const [productsRoute, linkRoute, home] = await Promise.all([
    read("src/app/api/v5/hosted/products/route.ts"),
    read("src/app/api/v5/hosted/products/[productId]/link/route.ts"),
    read("src/app/page.tsx")
  ]);
  assert.match(productsRoute, /FROM product_entity product/);
  assert.match(productsRoute, /LEFT JOIN hosted_workspace_product access/);
  assert.match(productsRoute, /linkedToWorkspace/);
  assert.match(linkRoute, /requireHostedRole/);
  assert.match(linkRoute, /getActiveProduct/);
  assert.match(linkRoute, /linkWorkspaceProduct/);
  assert.match(home, /后台知识库已有 · 点击选用/);
  assert.match(home, /hosted\/products\/\$\{encodeURIComponent\(product\.productId\)\}\/link/);
});
