import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/server/queries";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ReviewList } from "@/components/profile/review-list";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState, SectionHeading } from "@/components/auction/page-header";

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
    description: data.profile.bio ?? undefined,
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
                description="This seller has no public listings right now."
                compact
              />
            }
          />
        </div>
      </section>
    </div>
  );
}
