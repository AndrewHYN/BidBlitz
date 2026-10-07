import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPartyDisputeCase } from "@/server/disputes";
import { Button } from "@/components/ui/button";
import { DisputeCaseView } from "@/components/dashboard/dispute-case-view";

export const metadata: Metadata = {
  title: "Transaction dispute",
  description: "Private BidBlitz transaction dispute case.",
  robots: { index: false, follow: false },
};

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/disputes/${id}`);

  const caseData = await getPartyDisputeCase(id, user.id);
  if (!caseData) {
    return (
      <div className="page-container py-10 sm:py-14">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold">This dispute is not available</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Cases are private to the buyer and seller of the transaction.
          </p>
          <Button asChild className="mt-5">
            <Link href="/dashboard/disputes">Back to disputes</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container py-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <DisputeCaseView caseData={caseData} viewerId={user.id} />
      </div>
    </div>
  );
}
