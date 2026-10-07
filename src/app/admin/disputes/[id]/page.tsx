import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStaffDisputeCase } from "@/server/disputes";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { DisputeCaseView } from "@/components/dashboard/dispute-case-view";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/server/permissions";

export const metadata: Metadata = {
  title: "Dispute case",
  description: "BidBlitz staff transaction dispute workspace.",
  robots: { index: false, follow: false },
};

export default async function AdminDisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/disputes/${id}`);

  const [caseData, canManageTeam, canManageDisputes] = await Promise.all([
    getStaffDisputeCase(id, user.id),
    hasPermission(user.id, "admin.manage_team"),
    hasPermission(user.id, "disputes.manage"),
  ]);

  if (!caseData) {
    return (
      <div className="page-container py-10 sm:py-14">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <Scale className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold">This dispute is not available</h1>
          <Button asChild className="mt-5">
            <Link href="/admin/disputes">Back to dispute queue</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container space-y-5 py-8 sm:py-12">
      <AdminNav active="disputes" showTeam={canManageTeam} />
      <div className="mx-auto max-w-5xl">
        <DisputeCaseView
          caseData={caseData}
          viewerId={user.id}
          staff={canManageDisputes}
          canContribute={canManageDisputes}
        />
      </div>
    </div>
  );
}
