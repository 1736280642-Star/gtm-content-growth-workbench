import { redirect } from "next/navigation";

export default function FormalDraftCompatibilityPage({ params }: { params: { id: string } }) {
  redirect(`/monthly-matrix/batch-generation?draftId=${encodeURIComponent(params.id)}`);
}
