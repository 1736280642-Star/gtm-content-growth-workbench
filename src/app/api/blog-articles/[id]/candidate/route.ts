import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({
    ok: false,
    status: "retired",
    error: { code: "BLOG_CANDIDATE_POOL_RETIRED", message: "博客候选池已下线；官网问题将直接进入 GEO 调研与内容策略链路。" }
  }, { status: 410 });
}

export async function POST() { return retired(); }
export async function PATCH() { return retired(); }
export async function DELETE() { return retired(); }
