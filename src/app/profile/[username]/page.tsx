import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/server/queries";
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

  // The shared query returns review *content* but not the auction link target,
  // so fetch only the id mapping — one tiny query instead of editing shared code.
  const auctionByReview = new Map<string, string>();
  if (data.reviews.length > 0) {
    const { data: rows } = await supabase
      .from("reviews")
      .select("id, auction_id")
      .in(
        "id",
        data.reviews.map((r) => r.id)
      );
    for (const row of rows ?? []) auctionByReview.set(row.id, row.auction_id);
  }

  const reviews = data.reviews.map((review) => ({
    ...review,
    auctionId: auctionByReview.get(review.id) ?? null,
  }));

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
        <ReviewList reviews={reviews} />
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
