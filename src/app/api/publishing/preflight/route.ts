import { preflightPublishContent, rewriteJuejinContentOnce } from "@/lib/publish-content-preflight";
import { preparePublishContent, preparePublishContentWithAi } from "@/lib/workbench-store";
import { serializePublishMutation } from "@/lib/publish-mutation-queue";
import type { DirectPublishPlatformKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const supported = new Set<DirectPublishPlatformKey>(["wechat", "juejin", "csdn", "zhihu"]);

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const platform = input.platform as DirectPublishPlatformKey;
  if (!supported.has(platform)) {
    return Response.json({ ok: false, message: "Unsupported publish platform." }, { status: 400 });
  }
  if (typeof input.draftId === "string") {
    if (input.rewriteMode === "deterministic") {
      const result = await serializePublishMutation(() => preparePublishContent({ ...input, autoRewrite: true }));
      return Response.json(result, { status: result.ok ? 200 : 422 });
    }
    const result = await serializePublishMutation(() => preparePublishContentWithAi(input));
    return Response.json(result, { status: result.ok ? 200 : 422 });
  }
  const title = typeof input.title === "string" ? input.title : "";
  const markdown = typeof input.markdown === "string" ? input.markdown : "";
  let result = preflightPublishContent({ platform, title, markdown });
  let rewritten;
  if (!result.passed && platform === "juejin" && input.autoRewrite === true) {
    rewritten = rewriteJuejinContentOnce({ title, markdown });
    result = {
      ...preflightPublishContent({ platform, title: rewritten.title, markdown: rewritten.markdown }),
      rewriteApplied: true
    };
  }
  return Response.json({ ok: result.passed, preflight: result, rewritten }, { status: result.passed ? 200 : 422 });
}
