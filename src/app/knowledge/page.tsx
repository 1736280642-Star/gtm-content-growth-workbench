import { redirect } from "next/navigation";

export default async function LegacyKnowledgePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.view === "questions") redirect("/questions-keywords");
  if (params.import === "wechat") redirect("/products/sources?import=wechat");
  redirect("/products");
}
