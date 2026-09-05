import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (process.env.APP_RUNTIME_MODE !== "demo") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    if (/^\/api\/v5\/hosted\/authorization-sessions\/demo-session-(wechat|zhihu|csdn|juejin)\/events$/.test(path)) {
      return new NextResponse('event: terminal\ndata: {"status":"confirmed","simulated":true}\n\n', { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    if (/\/api\/v5\/free-production\/(assets\/[^/]+\/content|batches\/[^/]+\/(cover|visual-candidates\/[^/]+\/content))$/.test(path)) {
      return NextResponse.rewrite(new URL("/demo-assets/cover.svg", request.url));
    }
    return NextResponse.json({ ok: false, error: { code: "demo_browser_session_required", message: "演示 API 在当前浏览器的隔离数据中运行，请从演示页面操作。" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (["/hosted/email", "/hosted/success", "/hosted/settings", "/hosted/connections"].includes(path) || path.startsWith("/hosted/connect/")) {
    if (!request.nextUrl.searchParams.has("orderId")) { const url = request.nextUrl.clone(); url.searchParams.set("orderId", "demo-order-orbitdesk"); return NextResponse.redirect(url); }
  }
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", "connect-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; form-action 'self'; object-src 'none'");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|demo-assets).*)"] };
