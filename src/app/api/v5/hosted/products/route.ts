import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { requireHostedIdentity } from "@/lib/v5/hosted-identity-service";
import { getV5GovernancePool } from "@/lib/v5/knowledge-governance-repository";
import { v5GovernanceErrorResponse } from "@/lib/v5/knowledge-governance-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await requireHostedIdentity(request);
    const [rows] = await getV5GovernancePool().query<RowDataPacket[]>(
      `SELECT product.id AS product_id, product.display_name, product.official_url,
              product.product_category, product.strategy_pack_id,
              access.product_id AS workspace_product_id
       FROM product_entity product
       LEFT JOIN hosted_workspace_product access
         ON access.product_id = product.id AND access.workspace_id = ?
       WHERE product.status = 'active'
       ORDER BY access.product_id IS NULL, product.updated_at DESC`,
      [identity.workspaceId]
    );
    return NextResponse.json({
      ok: true,
      products: rows.map((row) => ({
        productId: String(row.product_id),
        displayName: String(row.display_name),
        officialUrl: row.official_url ? String(row.official_url) : undefined,
        productCategory: row.product_category ? String(row.product_category) : undefined,
        strategyPackId: row.strategy_pack_id ? String(row.strategy_pack_id) : undefined,
        linkedToWorkspace: Boolean(row.workspace_product_id)
      }))
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return v5GovernanceErrorResponse(error);
  }
}

