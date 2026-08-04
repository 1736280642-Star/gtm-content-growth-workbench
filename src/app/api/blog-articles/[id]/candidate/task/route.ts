import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: false,
    status: "retired",
    error: { code: "BLOG_CANDIDATE_POOL_RETIRED", message: "博客候选池已下线，系统会从问题池直接生成 GEO 内容策略。" }
  }, { status: 410 });
}
