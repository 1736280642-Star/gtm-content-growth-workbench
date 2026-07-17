"use client";

export class ApiRequestError<T = unknown> extends Error {
  status: number;
  payload: T;

  constructor(status: number, payload: T, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

export async function callJsonApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "content-type": "application/json" }),
    ...(options.headers || {})
  };
  const response = await fetch(path, {
    ...options,
    headers
  });
  const payload = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload, payload.message || `Request failed: ${response.status}`);
  }

  return payload;
}

export function formatApiMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  return fallback;
}
