import { getV5ConfigurationStatus } from "@/lib/v5/article-expression-service";
import { v5FoundationErrorResponse } from "@/lib/v5/foundation-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(getV5ConfigurationStatus());
  } catch (error) {
    return v5FoundationErrorResponse(error);
  }
}
