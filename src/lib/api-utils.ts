export async function readRequestPayload(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return JSON.parse(text) as Record<string, unknown>;
  }

  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    return { csv: text };
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : undefined;
}
