import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/server/queries";
import { PeerReviewForm } from "@/components/profile/peer-review-form";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ReportDialog } from "@/components/auction/report-dialog";
import { ReviewList } from "@/components/profile/review-list";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState, SectionHeading } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const data = await getProfileByUsername(username);
  if (!data) return { title: "Profile", robots: { index: false } };
  return {
    title: `${data.profile.display_name} (@${data.profile.username})`,
    // A profile without a bio still needs a description — an empty string
    // renders no meta description at all, which the pre-launch UX audit flags.
    description:
      data.profile.bio?.trim() ||
      `Public profile for ${data.profile.display_name} (@${data.profile.username}) on BidBlitz: reviews, listings and member details.`,
    alternates: { canonical: `/profile/${data.profile.username}` },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const data = await getProfileByUsername(username);
  if (!data) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSelf = user?.id === data.profile.id;

  const { data: eligibility, error: eligibilityError } = user && !isSelf
    ? await supabase.rpc("chat_review_context", { p_peer: data.profile.id }).maybeSingle()
    : { data: null, error: null };

  return (
    <div className="page-container space-y-10 py-10 sm:py-14">
      <ProfileHeader profile={data.profile} isSelf={isSelf} />
      {/* Reporting someone is rare and serious, so it sits apart from the
          profile itself rather than beside the name: one quiet control that a
          visitor finds when they need it, invisible to the profile owner. */}
      {!isSelf && (
        <div className="flex justify-end">
          <ReportDialog userId={data.profile.id} username={data.profile.username} />
        </div>
      )}

      <section className="space-y-4" aria-labelledby="profile-reviews-heading">
        <SectionHeading
          title={<span id="profile-reviews-heading">Reviews</span>}
        />
        {!isSelf && (eligibilityError ? (
          <p role="status" className="text-sm text-muted-foreground">Review availability could not be loaded.</p>
        ) : eligibility?.already_reviewed ? (
          <p className="text-sm text-muted-foreground">You’ve already rated your interaction with this member.</p>
        ) : eligibility ? (
          <PeerReviewForm peerId={data.profile.id} name={data.profile.display_name} />
        ) : (
          <p className="text-sm text-muted-foreground">You can rate this member after you’ve both sent a message in the same listing chat.</p>
        ))}
        <ReviewList reviews={data.reviews} viewerId={user?.id} />
      </section>

      <section className="space-y-4" aria-labelledby="profile-listings-heading">
        <SectionHeading
          title={<span id="profile-listings-heading">Listings</span>}
        />
        <div data-testid="profile-listings">
          <AuctionGrid
            items={data.listings}
            empty={
              <EmptyState
                icon={PackageSearch}
                title="No listings yet"
                description={
                  isSelf
                    ? "You have no public listings yet. Publish an auction and it appears here."
                    : "This seller has no public listings right now."
                }
                compact
                action={
                  isSelf ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/sell">List an item</Link>
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </div>
      </section>
    </div>
  );
}
