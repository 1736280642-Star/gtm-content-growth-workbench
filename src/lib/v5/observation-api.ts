import { NextResponse } from "next/server";
import type { V5ObservationApiEnvelope } from "./observation-contracts";
import { ObservationServiceError } from "./observation-service";

export async function readObservationPayload(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ObservationServiceError(400, "INVALID_JSON_BODY", "请求体必须是有效的 JSON 对象。");
  }
}

export function observationOk<T>(data: T, status = 200) {
  return NextResponse.json<V5ObservationApiEnvelope<T>>({ ok: true, data }, { status, headers: { "cache-control": "no-store" } });
}

export function observationError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const serviceError =
    error instanceof ObservationServiceError
      ? error
      : new ObservationServiceError(500, fallbackCode, fallbackMessage);
  return NextResponse.json<V5ObservationApiEnvelope<never>>(
    {
      ok: false,
      error: {
        code: serviceError.code,
        message: serviceError.message,
        details: serviceError.details,
        recoveryAction: serviceError.recoveryAction
      }
    },
    { status: serviceError.status, headers: { "cache-control": "no-store" } }
  );
}
