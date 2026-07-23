import { redirect } from "next/navigation";

export default function RealIntegrationCompatibilityPage() {
  redirect("/configuration?tab=connections");
}
