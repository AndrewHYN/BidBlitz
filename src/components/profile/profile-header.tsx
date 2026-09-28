import Link from "next/link";
import { BadgeCheck, CalendarDays, MapPin, Pencil, Star } from "lucide-react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import type { getProfileByUsername } from "@/server/queries";

/**
 * The profile masthead: identity, trust signals and the numbers buyers and
 * sellers actually care about. Server-renderable — no interactivity beyond
 * the (optional) edit link.
 *
 * Every number here is a real aggregate over real rows. There is no follower
 * count, no view count and no "active now" figure, because nothing in the
 * database could produce one truthfully.
 */

type Profile = NonNullable<Awaited<ReturnType<typeof getProfileByUsername>>>["profile"];

function joinedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One reputation figure, in a sentence.
 *
 * This used to be a three-up KPI strip: RATING / SALES / PURCHASES in 11px
 * uppercase, which is the dashboard pattern the design direction explicitly
 * rejects, on the one page that should read like a person. None of the three
 * leads anywhere either — a visitor to a profile wants to know who they are
 * dealing with and whether that person has delivered before, and "32" on its
 * own says neither.
 *
 * So reputation is written out, in words, with the rating carried by the star
 * it belongs to. "No reviews yet" and "32 sales" are both facts a seller
 * actually cares about; a bare numeral in a labelled box is not.
 */
function Reputation({ profile }: { profile: Profile }) {
  const average =
    profile.rating_count > 0 ? profile.rating_sum / profile.rating_count : null;

  return (
    <div
      data-testid="profile-stats"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
    >
      {average === null ? (
        <span data-numeric>No reviews yet</span>
      ) : (
        <span className="flex items-center gap-1" data-numeric>
          <Star className="size-4 fill-current text-primary" aria-hidden />
          <span className="font-semibold text-foreground">{average.toFixed(1)}</span>
          <span>
            from {profile.rating_count}{" "}
            {profile.rating_count === 1 ? "review" : "reviews"}
          </span>
        </span>
      )}

      {profile.sales_count > 0 && (
        <>
          <span aria-hidden className="text-border">·</span>
          <span data-numeric>
            {profile.sales_count} completed {profile.sales_count === 1 ? "sale" : "sales"}
          </span>
        </>
      )}
    </div>
  );
}

export function ProfileHeader({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  return (
    <header data-testid="profile-header" className="space-y-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        {/* The frame is 64px on a phone and 80px from `sm` up. The
            `pixelSize` is the LARGER of the two, so the optimiser builds a
            variant big enough for the largest rendering rather than a 32px
            image stretched across 80px — which is how this component ended up
            asking the image pipeline for a picture smaller than the hole it
            had to fill. */}
        <UserAvatar
          avatarPath={profile.avatar_path}
          name={profile.display_name}
          pixelSize={80}
          className="size-16 text-lg sm:size-20"
        />

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                data-testid="profile-display-name"
                className="truncate text-2xl font-semibold tracking-tight text-balance"
              >
                {profile.display_name}
              </h1>
              <p
                data-testid="profile-username"
                className="truncate text-sm text-muted-foreground"
              >
                @{profile.username}
              </p>
            </div>

            {isSelf && (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings" data-testid="edit-profile-link">
                  <Pencil aria-hidden /> Edit profile
                </Link>
              </Button>
            )}
          </div>

          {/* Identity facts read as one line of prose, not a row of chips. The
              verified badge stays a badge because it is a state, not a fact
              about the person. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {profile.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                {profile.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              Joined {joinedLabel(profile.created_at)}
            </span>
            {profile.email_verified && (
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
                Email verified
              </span>
            )}
          </div>

          <Reputation profile={profile} />
        </div>
      </div>

      {profile.bio && (
        <p className="max-w-2xl border-t border-border/70 pt-5 text-[0.9375rem] leading-[1.7] text-muted-foreground text-pretty">
          {profile.bio}
        </p>
      )}
    </header>
  );
}
