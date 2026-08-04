import type { FrontendCaptureArtifactManifest, V5MutationContext } from "@/lib/v5/observation-contracts";
import { observationError, observationOk, readObservationPayload } from "@/lib/v5/observation-api";
import { getCaptureArtifact, ingestCaptureArtifact } from "@/lib/v5/observation-service";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    return observationOk(await getCaptureArtifact(routeParams.id));
  } catch (error) {
    return observationError(error, "CAPTURE_ARTIFACT_READ_FAILED", "原始采集记录读取失败，请稍后重试。");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  try {
    const payload = await readObservationPayload(request);
    return observationOk(
      await ingestCaptureArtifact(
        routeParams.id,
        payload.manifest as FrontendCaptureArtifactManifest,
        payload.context as V5MutationContext
      ),
      201
    );
  } catch (error) {
    return observationError(error, "CAPTURE_ARTIFACT_INGEST_FAILED", "原始采集包保存失败，请按恢复提示处理。");
  }
}
