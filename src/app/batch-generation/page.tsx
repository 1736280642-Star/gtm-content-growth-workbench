import { redirect } from "next/navigation";

export default function LegacyBatchGenerationPage() {
  redirect("/monthly-plan?step=production");
}
