import { redirect } from "next/navigation";

export default async function LegacyKnowledgeImportPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const productId = typeof params.productId === "string" ? params.productId : "";
  redirect(productId ? `/products/${encodeURIComponent(productId)}?tab=materials` : "/products");
}
