export const dynamic = "force-dynamic";

export async function GET() {
  const bridge = new URL(process.env.WECHATSYNC_BRIDGE_URL || "http://127.0.0.1:9528");
  return Response.json({
    directPublishEnabled: process.env.DIRECT_PUBLISH_ENABLED === "true",
    bridgeOrigin: bridge.origin,
    bridgeTokenConfigured: Boolean(process.env.WECHATSYNC_BRIDGE_TOKEN?.trim()),
    arcsRunnerOrigin: new URL(process.env.ARCS_RUNNER_URL || "http://127.0.0.1:9530").origin
  });
}
