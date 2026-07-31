import { createHmac, randomUUID } from "node:crypto";

function canonicalResource(value) {
  const url = new URL(value);
  const entries = Array.from(url.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
  const query = entries.map(([key, item]) => `${key}=${item}`).join("&");
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export function createCsdnGatewayHeaders({
  method,
  url,
  appKey,
  signingKey,
  accept = "*/*",
  contentType = "",
  date = "",
  nonce = randomUUID()
}) {
  if (!appKey || !signingKey) throw new Error("CSDN API gateway credentials are required");

  const signedHeaders = {
    "x-ca-key": appKey,
    "x-ca-nonce": nonce
  };
  const canonicalHeaders = Object.entries(signedHeaders)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const stringToSign = [method.toUpperCase(), accept, "", contentType, date].join("\n") +
    `\n${canonicalHeaders}${canonicalResource(url)}`;
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("base64");

  return {
    "X-Ca-Key": appKey,
    "X-Ca-Nonce": nonce,
    "X-Ca-Signature": signature,
    "X-Ca-Signature-Headers": "x-ca-key,x-ca-nonce"
  };
}
