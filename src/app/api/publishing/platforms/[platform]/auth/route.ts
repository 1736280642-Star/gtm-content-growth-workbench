import { probePublishPlatformAuth } from "@/lib/publish-job-service";
import type { DirectPublishPlatformKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const supported = new Set<DirectPublishPlatformKey>(["wechat", "juejin", "csdn", "zhihu"]);

export async function GET(_request: Request, context: { params: { platform: string } }) {
  const platform = context.params.platform as DirectPublishPlatformKey;
  if (!supported.has(platform)) {
    return Response.json({ ok: false, message: "Unsupported publish platform." }, { status: 400 });
  }
  const result = await probePublishPlatformAuth(platform);
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
