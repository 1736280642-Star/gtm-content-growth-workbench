import { redirect } from "next/navigation";

export default function LegacyMonthlyMatrixTasksPage() {
  redirect("/monthly-plan?step=production");
}
