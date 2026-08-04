import { redirect } from "next/navigation";

export default function TodayCompatibilityPage() {
  redirect("/monthly-plan?step=execution&view=today");
}
