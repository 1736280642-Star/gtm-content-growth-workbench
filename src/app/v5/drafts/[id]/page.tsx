import { redirect } from "next/navigation";

export default async function FormalDraftCompatibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;
  redirect(`/monthly-plan?step=production&draftId=${encodeURIComponent(routeParams.id)}`);
}
