import { redirect } from "next/navigation";

export default async function HostedLoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  redirect(query.error ? "/?loginError=invalid" : "/?setup=login");
}
