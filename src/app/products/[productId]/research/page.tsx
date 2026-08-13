"use client";

import { useParams } from "next/navigation";
import { ProductGeoResearchWorkspace } from "@/components/ProductGeoResearchWorkspace";

export default function ProductResearchPage() {
  const { productId } = useParams<{ productId: string }>();
  return <ProductGeoResearchWorkspace productId={productId} />;
}
