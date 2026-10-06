import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/auction/page-header";
import { AcceptInviteForm } from "@/components/dashboard/accept-invite-form";

export const metadata: Metadata = {
  title: "Team invitation",
  robots: { index: false, follow: false },
};

/**
 * Team invitation landing. The token proves nothing by itself: acceptance
 * binds the SIGNED-IN account whose email matches, inside accept_team_invite,
 * which re-checks expiry, revocation and single-use under lock. An expired or
 * mismatched link reads as invalid, never as information about the invite.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/team/accept?token=${encodeURIComponent(token)}`);

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <PageHeader
          title="Team invitation"
          description="An invite only becomes access when the matching account accepts it here."
        />
        <AcceptInviteForm token={token} />
      </div>
    </div>
  );
}
