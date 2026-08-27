"use client";

import { HostedAiCaptureRequestPanel } from "@/components/HostedAiCaptureRequestPanel";

export function HostedAiFrontendTestPanel({ productId }: { productId?: string }) {
  return <HostedAiCaptureRequestPanel productId={productId} />;
}
