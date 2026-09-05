import { NextResponse } from "next/server";
// Demo builds replace every production API module with this closed boundary.
// The real repositories, credentials, model providers and publishers are not bundled.
export const dynamic = "force-dynamic";
function blocked() {
    return NextResponse.json({ ok: false, error: { code: "demo_browser_session_required", message: "请在当前浏览器的演示页面操作。此部署没有真实业务 API。" } }, { status: 403 });
}
export const GET = blocked;
export const POST = blocked;
export const PUT = blocked;
export const PATCH = blocked;
export const DELETE = blocked;
export const OPTIONS = blocked;
export const HEAD = blocked;
