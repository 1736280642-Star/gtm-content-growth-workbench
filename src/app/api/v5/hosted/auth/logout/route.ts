import { NextResponse } from "next/server";
import {
  clearHostedSessionCookie,
  readHostedIdentity,
  revokeHostedIdentitySession
} from "@/lib/v5/hosted-identity-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await readHostedIdentity(request);
  if (identity) await revokeHostedIdentitySession(identity.sessionId);
  const response = NextResponse.json({ ok: true });
  response.headers.set("set-cookie", clearHostedSessionCookie());
  response.headers.set("cache-control", "no-store");
  return response;
}

