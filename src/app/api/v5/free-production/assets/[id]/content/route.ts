import { mediaLibraryErrorResponse } from "@/lib/v5/media-library-api";
import { readMediaLibraryAssetContent } from "@/lib/v5/media-library-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const asset = await readMediaLibraryAssetContent(id);
    return new Response(new Uint8Array(asset.data), {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(asset.data.length),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return mediaLibraryErrorResponse(error);
  }
}

